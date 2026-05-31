// Prueba de extremo a extremo de la facturación electrónica contra el entorno de
// HOMOLOGACIÓN de AFIP (sandbox — nada de esto es fiscal ni real).
//
// Uso:
//   node scripts/afip-homo-test.js            → salud + login WSAA + último N°
//   node scripts/afip-homo-test.js --emit     → además, emite una Factura B de prueba (pide CAE)
//
// Lee el certificado y la clave desde C:\Users\<user>\afip-conquies\ (fuera del repo).
// Cachea el Ticket de Acceso en ta-cache.json (AFIP rechaza pedir 2 TA mientras
// hay uno vigente; el cache evita ese error al re-correr la prueba).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loginWSAA } from '../lib/afip/wsaa.js';
import { feDummy, feCompUltimoAutorizado, feParamGetPtosVenta, feCAESolicitar } from '../lib/afip/wsfe-client.js';
import { feCaeSolicitarPayload } from '../src/lib/wsfe.js';

const ENV  = 'homologacion';
const CUIT = '20379269614';
const DIR  = join(homedir(), 'afip-conquies');
const CERT = readFileSync(join(DIR, 'kamak.crt'), 'utf8');
const KEY  = readFileSync(join(DIR, 'conquies.key'), 'utf8');
const TA_CACHE = join(DIR, 'ta-cache.json');
const EMITIR = process.argv.includes('--emit');

const log = (...a) => console.log(...a);
const ok  = (s) => '\x1b[32m' + s + '\x1b[0m';
const bad = (s) => '\x1b[31m' + s + '\x1b[0m';

// Obtiene un Ticket de Acceso (token+sign), reusando el cache si sigue vigente.
async function getTA() {
  if (existsSync(TA_CACHE)) {
    try {
      const c = JSON.parse(readFileSync(TA_CACHE, 'utf8'));
      if (c.expirationTime && new Date(c.expirationTime).getTime() > Date.now() + 60000) {
        log('  (reusando TA cacheado, vence ' + c.expirationTime + ')');
        return c;
      }
    } catch { /* cache inválido → pedir nuevo */ }
  }
  let ta;
  try {
    ta = await loginWSAA({ certPem: CERT, keyPem: KEY, service: 'wsfe', env: ENV, digest: 'sha256' });
  } catch (e) {
    // Si la firma SHA256 no fuera aceptada, reintentar con SHA1 (compat histórica).
    if (/firma|sign|cms|digest|certificad/i.test(e.message)) {
      log('  SHA256 falló (' + e.message + '), reintento con SHA1...');
      ta = await loginWSAA({ certPem: CERT, keyPem: KEY, service: 'wsfe', env: ENV, digest: 'sha1' });
    } else throw e;
  }
  writeFileSync(TA_CACHE, JSON.stringify(ta, null, 2));
  return ta;
}

async function main() {
  log('\n=== Prueba WSFE homologación · CUIT ' + CUIT + ' ===\n');

  // 1) Salud del servicio (sin auth)
  log('1) FEDummy (salud del servicio)...');
  const dummy = await feDummy(ENV);
  const sano = dummy.appServer === 'OK' && dummy.dbServer === 'OK' && dummy.authServer === 'OK';
  log('   App=' + dummy.appServer + ' Db=' + dummy.dbServer + ' Auth=' + dummy.authServer + '  ' + (sano ? ok('OK') : bad('REVISAR')));

  // 2) Login WSAA (firma del certificado)
  log('\n2) Login WSAA (firmando con tu certificado)...');
  const ta = await getTA();
  log('   token: ' + ta.token.slice(0, 24) + '...  sign: ' + ta.sign.slice(0, 16) + '...  ' + ok('FIRMA ACEPTADA'));
  const auth = { token: ta.token, sign: ta.sign, cuit: CUIT };

  // 3) Puntos de venta habilitados
  log('\n3) FEParamGetPtosVenta (puntos de venta habilitados)...');
  let ptoVta = 1;
  try {
    const pts = await feParamGetPtosVenta(ENV, auth);
    if (pts.length) {
      log('   ' + JSON.stringify(pts));
      const libre = pts.find(p => p.bloqueado !== 'S');
      if (libre) ptoVta = libre.nro;
    } else {
      log('   (sin puntos de venta declarados — uso PtoVta=1 para la prueba)');
    }
  } catch (e) {
    log('   ' + bad('aviso: ') + e.message + '  → uso PtoVta=1');
  }

  // 4) Último comprobante autorizado (consulta AUTENTICADA → prueba el token)
  const CBTE_TIPO = 6; // Factura B
  log('\n4) FECompUltimoAutorizado (PtoVta=' + ptoVta + ', Factura B)...');
  const ultimo = await feCompUltimoAutorizado(ENV, auth, { ptoVta, cbteTipo: CBTE_TIPO });
  log('   último N° autorizado: ' + ultimo.nro + '  ' + ok('CONSULTA AUTENTICADA OK'));

  log('\n' + ok('✓ La cadena completa (certificado → WSAA → WSFE autenticado) FUNCIONA.'));

  if (!EMITIR) {
    log('\n(Para emitir una Factura B de prueba y pedir un CAE real de sandbox, corré con --emit)\n');
    return;
  }

  // 5) Emisión de prueba: Factura B a Consumidor Final, neto 100 + IVA 21% = 121
  const numero = ultimo.nro + 1;
  const hoy = new Date().toISOString().slice(0, 10);
  const comprobante = {
    tipoId: 'FB', puntoVenta: ptoVta, fecha: hoy,
    neto: 100, alicuota: 21, iva: 21, total: 121,
    conceptoAfip: 2,                 // Servicios
    receptorCuit: '', receptorCondicion: 'CF', // Consumidor Final
  };
  const payload = feCaeSolicitarPayload(comprobante, { numero });
  log('\n5) FECAESolicitar (Factura B N° ' + numero + ', total $121)...');
  const r = await feCAESolicitar(ENV, auth, payload);
  if (r.obs?.length) log('   Observaciones: ' + r.obs.map(o => `[${o.code}] ${o.msg}`).join(' · '));
  if (r.errs?.length) log('   Errores: ' + bad(r.errs.map(e => `[${e.code}] ${e.msg}`).join(' · ')));
  if (r.resultado === 'A' && r.cae) {
    log('   Resultado: ' + ok('APROBADO') + '  CAE: ' + r.cae + '  vto: ' + r.caeVto);
    log('\n' + ok('✓✓ EMISIÓN COMPLETA — AFIP devolvió un CAE válido de homologación.') + '\n');
  } else {
    log('   Resultado: ' + bad(r.resultado || '(sin resultado)'));
    log('\n   Respuesta cruda (recortada):\n' + r.raw.slice(0, 1200) + '\n');
  }
}

main().catch(e => { console.error('\n' + bad('✗ ERROR: ') + (e.stack || e.message) + '\n'); process.exit(1); });
