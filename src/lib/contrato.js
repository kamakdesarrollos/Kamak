// node:crypto: real en Node (server `api/portal/firmar.js` + vitest), pero Vite lo
// POLYFILLEA a un módulo vacío ({}) en el bundle del browser. Por eso NO podemos
// asumir que `nodeCrypto.createHash` exista: lo chequeamos en runtime (abajo).
import nodeCrypto from 'node:crypto';

// Escapa valores antes de inyectarlos en el HTML del contrato (anti-XSS): la
// plantilla es de confianza (la edita el admin), pero los VALORES (nombre, cuit)
// vienen de datos y pueden traer HTML malicioso.
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Resuelve {{placeholder}} con los valores dados. Escapa todos los valores SALVO
// 'planCuotas' (que es HTML de tabla generado por nosotros, no input del usuario).
export function renderPlantilla(htmlPlantilla, valores) {
  return String(htmlPlantilla || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = valores[key];
    if (v == null) return '';
    return key === 'planCuotas' ? String(v) : escapeHtml(v);
  });
}

// SHA-256 hex SÍNCRONO del documento renderizado: ata la firma a ESTA versión
// exacta. Este helper corre en DOS entornos:
//   - Node (server `api/portal/firmar.js` + vitest): `nodeCrypto.createHash` existe
//     → usamos el SHA-256 nativo (síncrono).
//   - Browser (al "Generar contrato" en la app): Vite polyfillea node:crypto a {},
//     así que `nodeCrypto.createHash` es undefined. Web Crypto (crypto.subtle.digest)
//     existe pero es ASÍNCRONO, y este helper DEBE ser síncrono (lo usan callers
//     sincrónicos y el test compara strings, no Promises). Por eso el browser cae a
//     una implementación pura de SHA-256 en JS (abajo).
// AMBOS caminos producen el MISMO hex: el hash que genera el browser tiene que
// coincidir con el que recalcula el server en firmar.js (chequeo documento_cambiado).
export function hashDocumento(html) {
  const input = String(html);
  if (nodeCrypto && typeof nodeCrypto.createHash === 'function') {
    return nodeCrypto.createHash('sha256').update(input, 'utf8').digest('hex');
  }
  // Fallback browser: SHA-256 puro en JS sobre los bytes UTF-8 del documento.
  return sha256Hex(utf8Bytes(input));
}

// Construye la tabla HTML del plan de cuotas (USD) desde detalle.cuotas.
export function planCuotasHtml(cuotas, toUSD) {
  const filas = (cuotas || []).map(c =>
    `<tr><td>${escapeHtml(c.descripcion || ('Cuota ' + (c.n ?? '')))}</td><td style="text-align:right">U$S ${toUSD(c)}</td></tr>`
  ).join('');
  return `<table style="width:100%;border-collapse:collapse" border="1" cellpadding="4">${filas || '<tr><td>—</td></tr>'}</table>`;
}

// ───────────────────────────── SHA-256 puro (browser) ─────────────────────────────
// Implementación estándar de SHA-256 (FIPS 180-4) en JS, sin dependencias. Solo se
// usa en el browser, donde node:crypto no existe y crypto.subtle es asíncrono.
// Produce el mismo hex que crypto.createHash('sha256').

function utf8Bytes(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  // Fallback ultra-defensivo (entornos sin TextEncoder): encode manual UTF-8.
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
    else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = str.charCodeAt(++i);
      c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
  }
  return Uint8Array.from(out);
}

function sha256Hex(bytes) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const l = bytes.length;
  const bitLen = l * 8;
  // Padding: 0x80, ceros, y la longitud en bits como 64-bit big-endian.
  const withOne = l + 1;
  const k = (56 - (withOne % 64) + 64) % 64;
  const total = withOne + k + 8;
  const msg = new Uint8Array(total);
  msg.set(bytes);
  msg[l] = 0x80;
  // Longitud en bits (los 32 bits altos quedan en 0 para inputs < 512 MB).
  msg[total - 4] = (bitLen >>> 24) & 0xff;
  msg[total - 3] = (bitLen >>> 16) & 0xff;
  msg[total - 2] = (bitLen >>> 8) & 0xff;
  msg[total - 1] = bitLen & 0xff;

  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (msg[off + i * 4] << 24) | (msg[off + i * 4 + 1] << 16) | (msg[off + i * 4 + 2] << 8) | msg[off + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }

  const toHex = (x) => (x >>> 0).toString(16).padStart(8, '0');
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7);
}
