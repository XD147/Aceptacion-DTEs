/**
 * SiiClient.ts
 * -----------
 * Traducción fiel de BodyRequest.vb a TypeScript/Node.js
 * 
 * Flujo original VB.NET:
 *   1. RequestToken → POST a zeusr.sii.cl, extrae TOKEN y cookies desde Set-Cookie headers
 *   2. BodyResPendientes → POST JSON a www4.sii.cl/getResumen para obtener DTEs pendientes
 *   3. BodyPendiente → POST JSON a www4.sii.cl/getDetalleCompra para obtener detalle por tipo doc
 *   4. BodyRespuesta → POST JSON a www4.sii.cl/ingresarAceptacionReclamoDocs para aceptar
 *   5. BodyCambioStatus → POST JSON a www4.sii.cl/cambiaTipoCompra para cambiar tipo transacción
 *   6. RequestLogOut → GET a zeusr.sii.cl para cerrar sesión
 * 
 * Rate Limiting:
 *   - Delay mínimo entre peticiones HTTP al SII (REQUEST_DELAY_MS)
 *   - Detección de 429 con retry + backoff exponencial
 *   - Pausa adaptativa cuando se detecta throttling
 */

import * as cheerio from 'cheerio';
import crypto from 'crypto';

// ─── Configuración Rate Limiting ─────────────────────────────────────────────

/** Delay mínimo (ms) entre cada petición HTTP al SII */
const REQUEST_DELAY_MS = 2000;

/** Delay base para backoff exponencial tras un 429 (ms) */
const BACKOFF_BASE_MS = 10000;

/** Máximo de reintentos por petición ante un 429 */
const MAX_RETRIES = 3;

/** Última vez que se hizo una petición al SII (global) */
let lastRequestTime = 0;

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface AuthResult {
  token: string;
  cookie: string;
}

interface ResumenItem {
  rsmnTipoDocInteger: number;  // Tipo de documento (33, 34, etc.)
  dcvNombreTipoDoc: string;    // "Factura Electrónica", etc.
  [key: string]: unknown;
}

interface DetalleDoc {
  detFolio: string;
  detRutDoc: string;
  detDvDoc: string;
  detRznSoc: string;
  detFchDoc: string;
  detMntNeto: number;
  detMntIVA: number;
  detMntTotal: number;
  detTipoTransaccion: string;
  detEventoReceptor: string;
  [key: string]: unknown;
}

interface dteAcuseRe {
  dedCodEvento: string; //"ERM" //Evento Receptor Manual
  detDvDoc: string;
  detNroDoc: string;
  detRutDoc: string;
  detTipoDoc: string;
}

// Columnas que se eliminan en el método Ajuste() original
const COLUMNS_TO_REMOVE = [
  'dhdrCodigo', 'dcvCodigo', 'dcvEstadoContab', 'detCodigo', 'detRznSoc',
  'detFchDoc', 'detFecAcuse', 'detFecReclamado', 'detFecRecepcion',
  'detMntExe', 'detMntNeto', 'detMntActFijo', 'detMntIVAActFijo',
  'detMntIVANoRec', 'detMntCodNoRec', 'detMntSinCredito', 'detMntIVA',
  'detMntTotal', 'detTasaImp', 'detAnulado', 'detIVARetTotal',
  'detIVARetParcial', 'detIVANoRetenido', 'detIVAPropio', 'detIVATerceros',
  'detIVAUsoComun', 'detLiqRutEmisor', 'detLiqDvEmisor', 'detLiqValComNeto',
  'detLiqValComExe', 'detLiqValComIVA', 'detIVAFueraPlazo', 'detTipoDocRef',
  'detFolioDocRef', 'detExpNumId', 'detExpNacionalidad', 'detCredEc',
  'detLey18211', 'detDepEnvase', 'detIndSinCosto', 'detIndServicio',
  'detMntNoFact', 'detMntPeriodo', 'detPsjNac', 'detPsjInt', 'detNumInt',
  'detCdgSIISucur', 'detEmisorNota', 'detTabPuros', 'detTabCigarrillos',
  'detTabElaborado', 'detImpVehiculo', 'detTpoImp', 'detTipoTransaccion',
  'detEventoReceptor', 'detEventoReceptorLeyenda', 'cambiarTipoTran',
  'detPcarga', 'descTipoTransaccion', 'totalDtoiMontoImp', 'totalDinrMontoIVANoR'
];

// Cabeceras comunes replicando el User-Agent del VB.NET original
const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko',
  'Cache-Control': 'no-cache',
};

// ─── Utilidades de Rate Limiting ─────────────────────────────────────────────

/** Espera el delay mínimo entre peticiones */
async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < REQUEST_DELAY_MS) {
    await new Promise(res => setTimeout(res, REQUEST_DELAY_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

/** Espera con backoff exponencial: base * 2^attempt */
async function backoffWait(attempt: number): Promise<void> {
  const delay = BACKOFF_BASE_MS * Math.pow(2, attempt);
  console.warn(`⏳ Rate limit (429). Esperando ${delay / 1000}s antes de reintentar (intento ${attempt + 1}/${MAX_RETRIES})...`);
  await new Promise(res => setTimeout(res, delay));
}

/** Wrapper de fetch con throttle + retry 429 */
async function fetchWithRateLimit(
  url: string,
  options: RequestInit,
  label: string
): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await throttle();

    const response = await fetch(url, options);

    // Si no es 429, retornar inmediatamente
    if (response.status !== 429) {
      return response;
    }

    // Si es 429 y aún tenemos intentos, hacer backoff
    if (attempt < MAX_RETRIES) {
      await backoffWait(attempt);
    } else {
      // Agotamos reintentos
      throw new Error(`429 Rate Limit en ${label} — Se agotaron ${MAX_RETRIES} reintentos. ID de soporte del SII puede estar en la respuesta.`);
    }
  }

  // Fallback (nunca debería llegar aquí)
  throw new Error(`fetchWithRateLimit: error inesperado en ${label}`);
}

// ─── Clase Principal ─────────────────────────────────────────────────────────

export class SiiClient {

  /**
   * 1. RequestToken — Autenticación en SII
   */
  static async requestToken(
    rut: string, dv: string, rtc: string, pass: string
  ): Promise<AuthResult | null> {

    const body = `rut=${rut}&dv=${dv}&referencia=https%3A%2F%2Fmisiir.sii.cl%2Fcgi_misii%2Fsiihome.cgi&rutcntr=${rtc}&clave=${encodeURIComponent(pass)}`;

    try {
      const response = await fetchWithRateLimit(
        'https://zeusr.sii.cl/cgi_AUT2000/CAutInicio.cgi',
        {
          method: 'POST',
          headers: {
            ...COMMON_HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'text/html, application/xhtml+xml, */*',
            'Referer': 'https://zeusr.sii.cl//AUT2000/InicioAutenticacion/IngresoRutClave.html?https://misiir.sii.cl/cgi_misii/siihome.cgi',
            'Host': 'zeusr.sii.cl',
            'Cookie': 's_fid=5C585FE4C9B4ABB2-3F5095B415145CA2',
          },
          body,
          redirect: 'manual',
        },
        'requestToken'
      );

      // ─── Extracción de cookies (replica el loop VB.NET) ───────────────
      const rawSetCookies = response.headers.getSetCookie?.()
        ?? (response.headers.get('set-cookie')?.split(/,(?=\s*\w+=)/) || []);

      if (rawSetCookies.length <= 1) {
        console.error('SII Auth: Credenciales inválidas o respuesta inválida (≤1 cookies)');
        return null;
      }

      // Construir string de cookies concatenadas
      const cookieParts: string[] = [];
      let token = '';

      for (const rawCookie of rawSetCookies) {
        const firstPart = rawCookie.split(';')[0].trim();
        cookieParts.push(firstPart);

        if (rawCookie.includes('TOKEN')) {
          token = firstPart.replace('TOKEN=', '');
        }
      }

      const cookie = cookieParts.join('; ') + '; ';

      if (!token) {
        // Fallback: intentar parsear TOKEN desde el HTML de respuesta
        const html = await response.text();
        const $ = cheerio.load(html);

        const tokenInput = $('input[name="TOKEN"]').val();
        if (typeof tokenInput === 'string' && tokenInput) {
          token = tokenInput;
        } else {
          const tokenMatch = html.match(/TOKEN[=:][\s'"]*([a-zA-Z0-9_\-]+)/i);
          if (tokenMatch) {
            token = tokenMatch[1];
          }
        }
      }

      if (!token) {
        console.error('SII Auth: No se encontró TOKEN en cookies ni en HTML');
        return null;
      }

      console.log(`SII Auth OK: Token=${token.substring(0, 12)}... Cookies=${cookieParts.length} entries`);
      return { token, cookie };

    } catch (error) {
      console.error('SII Auth Error:', error);
      return null;
    }
  }

  /**
   * 2. getResumen — Documentos pendientes agrupados por tipo
   */
  static async getResumen(
    cookie: string, token: string,
    rut: string, dv: string, periodo: string
  ): Promise<ResumenItem[]> {

    const body = JSON.stringify({
      metaData: {
        namespace: 'cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getResumen',
        conversationId: token,
        transactionId: crypto.randomUUID(),
        page: null,
      },
      data: {
        rutEmisor: this.normalizeRut(rut),
        dvEmisor: dv,
        ptributario: periodo,
        estadoContab: 'PENDIENTE',
        operacion: 'COMPRA',
      }
    });

    try {
      const resp = await fetchWithRateLimit(
        'https://www4.sii.cl/consdcvinternetui/services/data/facadeService/getResumen',
        {
          method: 'POST',
          headers: {
            ...COMMON_HEADERS,
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://www4.sii.cl/consdcvinternetui/#/index',
            'Host': 'www4.sii.cl',
            'Cookie': `${cookie}MISII={"p":false}`,
          },
          body,
        },
        'getResumen'
      );

      const data = await resp.json();
      // El SII devuelve los items en data[] según test real (antes era first)
      const items = data?.data || data?.first || [];
      return Array.isArray(items) ? items : Object.values(items);
    } catch (e) {
      console.error('getResumen error:', e);
      return [];
    }
  }

  /**
   * 3. getDetalleCompra — Detalle de documentos por tipo
   */
  static async getDetalleCompra(
    cookie: string, token: string,
    rut: string, dv: string, periodo: string, tipoDoc: string
  ): Promise<DetalleDoc[]> {

    const body = JSON.stringify({
      metaData: {
        namespace: 'cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getDetalleCompra',
        conversationId: token,
        transactionId: crypto.randomUUID(),
        page: null,
      },
      data: {
        accionRecaptcha: 'RCV_DETC',
        tokenRecaptcha: 't-o-k-e-n-web',
        rutEmisor: this.normalizeRut(rut),
        dvEmisor: dv,
        ptributario: periodo,
        codTipoDoc: tipoDoc,
        operacion: 'COMPRA',
        estadoContab: 'PENDIENTE',
      }
    });

    try {
      const resp = await fetchWithRateLimit(
        'https://www4.sii.cl/consdcvinternetui/services/data/facadeService/getDetalleCompra',
        {
          method: 'POST',
          headers: {
            ...COMMON_HEADERS,
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://www4.sii.cl/consdcvinternetui/',
            'Host': 'www4.sii.cl',
            'Cookie': `${cookie}MISII={"p":false}`,
          },
          body,
        },
        'getDetalleCompra'
      );

      const data = await resp.json();
      const items = data?.first || data?.data || [];
      const rows: DetalleDoc[] = Array.isArray(items) ? items : Object.values(items);

      // Replica del Ajuste() del VB.NET
      return rows.map(row => {
        const cleaned: Record<string, any> = {};
        for (const [key, val] of Object.entries(row)) {
          if (COLUMNS_TO_REMOVE.includes(key)) continue;
          cleaned[key] = val; // Mantener valor original sin defaults arbitrarios
        }
        cleaned['dedCodEvento'] = 'ERM';
        cleaned['detTipoDoc'] = tipoDoc; // Asegurar que el tipo de doc se preserve
        return cleaned as DetalleDoc;
      });
    } catch (e) {
      console.error('getDetalleCompra error:', e);
      return [];
    }
  }

  /** Helper para normalizar RUTs (eliminar puntos y espacios) */
  private static normalizeRut(rut: any): string {
    if (rut === null || rut === undefined) return '';
    const rutStr = String(rut);
    return rutStr.replace(/\./g, '').replace(/\s/g, '');
  }

  /**
   * 4. ingresarAceptacionReclamoDocs — Aceptar documentos
   */
  static async aceptarDocumentos(
    cookie: string, token: string,
    rut: string, dv: string, docsJson: DetalleDoc[]
  ): Promise<string> {
    const CHUNK_SIZE = 10;
    const results: string[] = [];

    // Dividir los documentos en lotes de 10 (límite del SII)
    for (let i = 0; i < docsJson.length; i += CHUNK_SIZE) {
      const chunk = docsJson.slice(i, i + CHUNK_SIZE);
      const dtoAcept: dteAcuseRe[] = chunk.map(doc => ({
        dedCodEvento: 'ERM',
        detDvDoc: String(doc.detDvDoc || ''),
        detNroDoc: String(doc.detNroDoc || doc.detFolio || ''),
        detRutDoc: this.normalizeRut(doc.detRutDoc),
        detTipoDoc: String(doc.detTipoDoc || doc.detTipoTransaccion || '33')
      }));

      const body = JSON.stringify({
        metaData: {
          namespace: 'cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/ingresarAceptacionReclamoDocs',
          conversationId: token,
          transactionId: crypto.randomUUID(),
          page: null,
        },
        data: {
          dteAcuRe: dtoAcept,
          rutAutenticado: this.normalizeRut(rut),
          dvAutenticado: dv,
        }
      });

      console.log(`🚀 Enviando lote de ${chunk.length} documentos (${i + chunk.length}/${docsJson.length})...`);

      try {
        const resp = await fetchWithRateLimit(
          'https://www4.sii.cl/consdcvinternetui/services/data/facadeService/ingresarAceptacionReclamoDocs',
          {
            method: 'POST',
            headers: {
              ...COMMON_HEADERS,
              'Content-Type': 'application/json',
              'Accept': 'application/json, text/plain, */*',
              'Referer': 'https://www4.sii.cl/consdcvinternetui/#/index',
              'Host': 'www4.sii.cl',
              'Cookie': `${cookie}MISII={"p":false}`,
            },
            body,
          },
          `aceptarDocumentos (lote ${Math.floor(i / CHUNK_SIZE) + 1})`
        );
        const text = await resp.text();
        results.push(text);
      } catch (e) {
        console.error(`Error en lote ${Math.floor(i / CHUNK_SIZE) + 1}:`, e);
        results.push(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return results.join(' | ');
  }


  /**
   * 5. cambiaTipoCompra — Cambiar tipo de transacción
   */
  static async cambiarTipoCompra(
    cookie: string, token: string,
    rut: string, dv: string, periodo: string,
    folio: string, rtcon: string, dvcon: string
  ): Promise<string> {

    const body = JSON.stringify({
      metaData: {
        namespace: 'cl.sii.sdi.lob.diii.dcv.data.api.interfaces.compcompra.FacadeServiceCompCompra/cambiaTipoCompra',
        conversationId: token,
        transactionId: '1',
        page: { pageSize: '1', pageIndex: '1' },
      },
      data: {
        rut: parseInt(rut),
        dv,
        operacion: 'COMPRA',
        tipoDocumento: '33',
        numeroDocumento: folio,
        periodoTributario: periodo,
        tipoCompra: '6',
        rutContraparte: rtcon,
        dvContraparte: dvcon,
      }
    });

    try {
      const resp = await fetchWithRateLimit(
        'https://www4.sii.cl/complementoscvui/services/data/facadeServiceCompCompraService/cambiaTipoCompra',
        {
          method: 'POST',
          headers: {
            ...COMMON_HEADERS,
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://www4.sii.cl/complementoscvui/',
            'Host': 'www4.sii.cl',
            'Cookie': `${cookie}MISII={"p":false}`,
          },
          body,
        },
        'cambiarTipoCompra'
      );

      return await resp.text();
    } catch (e) {
      console.error('cambiarTipoCompra error:', e);
      return 'ERROR';
    }
  }

  /**
   * 6. logout — Cerrar sesión
   */
  static async logout(cookie: string, rutEMG: string): Promise<void> {
    try {
      await throttle(); // Respetar rate limit incluso en logout
      await fetch('https://zeusr.sii.cl/cgi_AUT2000/CAutInicio.cgi', {
        method: 'GET',
        headers: {
          ...COMMON_HEADERS,
          'Accept': 'text/html, application/xhtml+xml, */*',
          'Referer': 'https://misiir.sii.cl/cgi_misii/siihome.cgi',
          'Host': 'zeusr.sii.cl',
          'DNT': '1',
          'Cookie': `${cookie}MISII={"p":false}; EMG=${rutEMG}`,
        },
      });
    } catch (e) {
      console.error('logout error:', e);
    }
  }
}
