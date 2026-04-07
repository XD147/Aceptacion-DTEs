'use server';

import { SiiClient } from '../services/SiiClient';

/**
 * Procesa un contribuyente completo:
 * 1. Autentica → obtiene TOKEN + Cookies
 * 2. Consulta resumen de DTEs pendientes
 * 3. Por cada tipo de documento, obtiene el detalle
 * 4. Acepta todos los documentos pendientes
 * 5. Cierra sesión
 * 
 * Retorna logs paso a paso para actualización visual en tiempo real.
 */
export async function processContributor(
  rut: string, dv: string, rtc: string, pass: string, periodo: number
) {
  const logs: string[] = [];

  try {
    // ── Paso 1: Autenticación ──────────────────────────────────────────
    logs.push('🔐 Autenticando en SII...');

    const auth = await SiiClient.requestToken(rut, dv, rtc, pass);

    if (!auth) {
      return { success: false, logs: '❌ Credenciales inválidas o fallo de conexión con SII.' };
    }

    logs.push(`✅ Token obtenido: ${auth.token.substring(0, 12)}...`);

    // ── Paso 2: Obtener resumen de pendientes ──────────────────────────
    logs.push('📋 Consultando resumen de DTEs pendientes...');

    const resumen = await SiiClient.getResumen(
      auth.cookie, auth.token, rut, dv, periodo.toString()
    );

    if (!resumen || resumen.length === 0) {
      await SiiClient.logout(auth.cookie, rut);
      return { success: true, logs: logs.join('\n') + '\n📭 Sin documentos pendientes.' };
    }

    // ── Validación: Filtrar items con todos los campos en 0 o vacíos ──
    const resumenValido = resumen.filter((item: any) => {
      const totDoc = Number(item.rsmnTotDoc) || 0;
      const mntTotal = Number(item.rsmnMntTotal) || 0;
      const mntNeto = Number(item.rsmnMntNeto) || 0;
      const mntIVA = Number(item.rsmnMntIVA) || 0;
      const mntExe = Number(item.rsmnMntExe) || 0;
      // Si todos los valores son 0, no hay documentos reales en ese tipo
      return totDoc > 0 || mntTotal !== 0 || mntNeto !== 0 || mntIVA !== 0 || mntExe !== 0;
    });

    if (resumenValido.length === 0) {
      logs.push('📭 Sin documentos pendientes (campos en 0).');
      await SiiClient.logout(auth.cookie, rut);
      return { success: true, logs: logs.join('\n') };
    }

    logs.push(`📊 ${resumenValido.length} tipo(s) de documento con registros válidos (de ${resumen.length} encontrados).`);

    // ── Paso 3: Obtener detalle por tipo de doc ────────────────────────
    let totalDocs = 0;

    for (const item of resumenValido) {
      const tipoDoc = String(item.rsmnTipoDocInteger || '33');
      logs.push(`📄 Consultando detalle tipo ${tipoDoc} (${item.dcvNombreTipoDoc || 'Doc'})...`);

      const detalle = await SiiClient.getDetalleCompra(
        auth.cookie, auth.token, rut, dv, periodo.toString(), tipoDoc
      );

      if (detalle.length === 0) {
        logs.push(`   ⚠️ Sin documentos en tipo ${tipoDoc}.`);
        continue;
      }

      logs.push(`   📝 ${detalle.length} documentos encontrados.`);

      // ── Paso 4: Aceptar documentos ─────────────────────────────────
      logs.push(`   ✍️ Aceptando ${detalle.length} documentos...`);

      const resultado = await SiiClient.aceptarDocumentos(
        auth.cookie, auth.token, rut, dv, detalle
      );

      if (resultado === 'ERROR') {
        logs.push(`   ❌ Error al aceptar documentos tipo ${tipoDoc}.`);
      } else {
        totalDocs += detalle.length;
        logs.push(`   ✅ Aceptados exitosamente.`);
      }
    }

    // ── Paso 5: Cerrar sesión ──────────────────────────────────────────
    await SiiClient.logout(auth.cookie, rut);
    logs.push(`🔓 Sesión cerrada.`);
    logs.push(`🎯 Total: ${totalDocs} documentos aceptados.`);

    return { success: true, logs: logs.join('\n'), totalDocs };

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('API processContributor error:', error);
    return { success: false, logs: logs.join('\n') + `\n💥 Error: ${msg}`, totalDocs: 0 };
  }
}
