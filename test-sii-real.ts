/**
 * test-sii-real.ts
 * ────────────────
 * Prueba directa contra el SII usando el primer contribuyente del ArchivoBase_202603.json
 * 
 * Ejecutar: npx tsx test-sii-real.ts
 */
import fs from 'fs';
import path from 'path';

// ── Cargar JSON ──────────────────────────────────────────────────────────────
const jsonPath = path.join(__dirname, 'ArchivoBase_202603.json');
const rawData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

console.log(`\n${'═'.repeat(70)}`);
console.log(`  TEST REAL SII — ArchivoBase_202603.json`);
console.log(`  ${rawData.length} contribuyentes cargados`);
console.log(`${'═'.repeat(70)}\n`);

// ── Tomar solo el primer registro para prueba ────────────────────────────────
const first = rawData[0];
const rut = first.ContribuyenteID.split('-')[0].replace(/\./g, '');
const dv = first.ContribuyenteID.split('-')[1];
const rtc = first.RUT;
const pass = first.Password;
const periodo = first.Periodo;

console.log(`📌 Contribuyente de prueba:`);
console.log(`   Razón Social: ${first.RazonSocial}`);
console.log(`   RUT:          ${first.ContribuyenteID}`);
console.log(`   Rut limpio:   ${rut}-${dv}`);
console.log(`   RTC:          ${rtc}`);
console.log(`   Password:     ${'*'.repeat(pass.length)}`);
console.log(`   Periodo:      ${periodo}\n`);

// ── Paso 1: Autenticación ────────────────────────────────────────────────────
async function testAuth() {
  console.log(`${'─'.repeat(70)}`);
  console.log(`PASO 1: Autenticación en https://zeusr.sii.cl`);
  console.log(`${'─'.repeat(70)}`);

  const body = `rut=${rut}&dv=${dv}&referencia=https%3A%2F%2Fmisiir.sii.cl%2Fcgi_misii%2Fsiihome.cgi&rutcntr=${rtc}&clave=${pass}`;

  console.log(`\n📤 POST https://zeusr.sii.cl/cgi_AUT2000/CAutInicio.cgi`);
  console.log(`   Body: rut=${rut}&dv=${dv}&rutcntr=${rtc}&clave=****\n`);

  try {
    const response = await fetch('https://zeusr.sii.cl/cgi_AUT2000/CAutInicio.cgi', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html, application/xhtml+xml, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko',
        'Referer': 'https://zeusr.sii.cl//AUT2000/InicioAutenticacion/IngresoRutClave.html?https://misiir.sii.cl/cgi_misii/siihome.cgi',
        'Host': 'zeusr.sii.cl',
        'Cache-Control': 'no-cache',
        'Cookie': 's_fid=5C585FE4C9B4ABB2-3F5095B415145CA2',
      },
      body,
      redirect: 'manual',
    });

    console.log(`📥 Status: ${response.status} ${response.statusText}`);
    console.log(`   Tipo: ${response.type}`);

    // ── Headers de respuesta ────────────────────────────────────────────
    console.log(`\n📋 Headers de respuesta:`);
    response.headers.forEach((value, key) => {
      console.log(`   ${key}: ${value.substring(0, 120)}${value.length > 120 ? '...' : ''}`);
    });

    // ── Set-Cookie (clave del flujo) ────────────────────────────────────
    const rawSetCookies = response.headers.getSetCookie?.()
      ?? (response.headers.get('set-cookie')?.split(/,(?=\s*\w+=)/) || []);

    console.log(`\n🍪 Set-Cookie entries: ${rawSetCookies.length}`);
    rawSetCookies.forEach((c, i) => {
      console.log(`   [${i}] ${c.substring(0, 100)}${c.length > 100 ? '...' : ''}`);
    });

    // ── Extracción del TOKEN ────────────────────────────────────────────
    let token = '';
    const cookieParts: string[] = [];

    for (const rawCookie of rawSetCookies) {
      const firstPart = rawCookie.split(';')[0].trim();
      cookieParts.push(firstPart);
      if (rawCookie.includes('TOKEN')) {
        token = firstPart.replace('TOKEN=', '');
      }
    }

    const cookie = cookieParts.join('; ') + '; ';

    if (token) {
      console.log(`\n✅ TOKEN extraído: ${token}`);
      console.log(`✅ Cookie string: ${cookie.substring(0, 80)}...`);
    } else {
      console.log(`\n⚠️  No se encontró TOKEN en Set-Cookie headers.`);
      console.log(`   Intentando extraer de HTML body...\n`);

      const html = await response.text();
      console.log(`   HTML body (primeros 500 chars):`);
      console.log(`   ${html.substring(0, 500)}\n`);

      // Buscar TOKEN en HTML
      const tokenMatch = html.match(/TOKEN[=:][\s'"]*([a-zA-Z0-9_\-]+)/i);
      if (tokenMatch) {
        token = tokenMatch[1];
        console.log(`   ✅ TOKEN desde HTML: ${token}`);
      } else {
        console.log(`   ❌ TOKEN no encontrado en HTML. Credenciales probablemente inválidas.`);
      }
    }

    // ── Si tenemos token, probar Paso 2 ─────────────────────────────────
    if (token) {
      console.log(`\n${'─'.repeat(70)}`);
      console.log(`PASO 2: Consulta de DTEs pendientes (getResumen)`);
      console.log(`${'─'.repeat(70)}\n`);

      const resumenBody = JSON.stringify({
        metaData: {
          namespace: 'cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getResumen',
          conversationId: token,
          transactionId: crypto.randomUUID(),
        },
        data: {
          rutEmisor: rut,
          dvEmisor: dv,
          ptributario: periodo.toString(),
          estadoContab: 'PENDIENTE',
          operacion: 'COMPRA',
        }
      });

      console.log(`📤 POST https://www4.sii.cl/.../getResumen`);

      const resumenResp = await fetch(
        'https://www4.sii.cl/consdcvinternetui/services/data/facadeService/getResumen',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko',
            'Referer': 'https://www4.sii.cl/consdcvinternetui/#/index',
            'Host': 'www4.sii.cl',
            'Cache-Control': 'no-cache',
            'Cookie': `${cookie}MISII={"p":false}`,
          },
          body: resumenBody,
        }
      );

      console.log(`📥 Status: ${resumenResp.status}`);

      const resumenText = await resumenResp.text();
      console.log(`📥 Respuesta (primeros 800 chars):`);
      console.log(`   ${resumenText.substring(0, 800)}\n`);

      try {
        const resumenData = JSON.parse(resumenText);
        const items = resumenData?.first || resumenData?.data || [];
        const arr = Array.isArray(items) ? items : Object.values(items);
        console.log(`📊 Tipos de documento pendientes: ${arr.length}`);
        
        if (arr.length > 0) {
          console.log(`   Primer item:`);
          console.log(`   ${JSON.stringify(arr[0], null, 2).substring(0, 400)}`);
        }
      } catch {
        console.log(`   (Respuesta no es JSON válido)`);
      }

      // ── Logout ──────────────────────────────────────────────────────
      console.log(`\n${'─'.repeat(70)}`);
      console.log(`PASO 3: Logout`);
      console.log(`${'─'.repeat(70)}`);

      await fetch('https://zeusr.sii.cl/cgi_AUT2000/CAutInicio.cgi', {
        method: 'GET',
        headers: {
          'Accept': 'text/html, application/xhtml+xml, */*',
          'Referer': 'https://misiir.sii.cl/cgi_misii/siihome.cgi',
          'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko',
          'Host': 'zeusr.sii.cl',
          'Cookie': `${cookie}MISII={"p":false}; EMG=${rut}`,
        },
      });

      console.log(`✅ Sesión cerrada.\n`);
    }

  } catch (error) {
    console.error(`\n💥 Error de conexión:`, error);
  }

  console.log(`${'═'.repeat(70)}`);
  console.log(`  FIN DEL TEST`);
  console.log(`${'═'.repeat(70)}\n`);
}

testAuth();
