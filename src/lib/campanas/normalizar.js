// Normalización de datos sucios de la campaña (planilla real de Caro).
// Lógica PURA sin React, testeable y reusable desde scripts Node.
// - normalizarEstado: estado sucio → canónico + original SIEMPRE preservado.
// - normalizarTelefonoAR: teléfono argentino → E.164 sin '+' (clave de dedup).

// Clave de comparación: sin tildes, MAYÚSCULAS, espacios colapsados.
function clave(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Mapa clave-normalizada → { estado canónico, flags }. Incluye los 9 canónicos
// (su propia clave sin tilde: 'PASO MAIL' ya cubre 'PASÓ MAIL') + las variantes
// reales vistas en la planilla.
const MAPA_ESTADOS = {};
function registrar(textos, estado, flags) {
  for (const t of textos) MAPA_ESTADOS[clave(t)] = { estado, flags: flags || {} };
}
registrar(['SIN LLAMAR'], 'SIN LLAMAR');
registrar(['FUERA DE SERVICIO', 'NUMERO EQUIVOCADO'], 'FUERA DE SERVICIO');
registrar(['NO ATIENDE'], 'NO ATIENDE');
registrar(['VOLVER A LLAMAR'], 'VOLVER A LLAMAR');
registrar(['PASÓ MAIL', 'PASO EL MAIL', 'ME PASO MAIL', 'ME PASO EL MAIL'], 'PASÓ MAIL');
registrar(['PASÓ WHATSAPP', 'PASO EL WHATSAPP', 'ME PASO WHATSAPP', 'ME PASO EL WHATSAPP'], 'PASÓ WHATSAPP');
registrar(['DECISOR IDENTIFICADO'], 'DECISOR IDENTIFICADO');
registrar(['NO INTERESA'], 'NO INTERESA');
registrar(['LEAD CALIENTE'], 'LEAD CALIENTE');
// 'TELEFONO FIJO' es un atributo del número, no un estado: queda SIN LLAMAR
// con flag para que el modo llamadas lo sepa.
registrar(['TELEFONO FIJO'], 'SIN LLAMAR', { telefonoFijo: true });

// ¿El texto matchea un estado conocido (canónico o variante)? Lo usa la
// heurística de detección de columna de estado del import.
export function esEstadoConocido(raw) {
  return Boolean(MAPA_ESTADOS[clave(raw)]);
}

// Estado sucio → { estado (canónico), original (crudo tal cual), flags }.
// Vacío/null → SIN LLAMAR. Desconocido no-vacío → SIN LLAMAR + original.
// Crudo compuesto 'ESTADO · refuerzo' (el mapeo posicional del Unificado junta
// el estado de la col 8 con el refuerzo que Caro escribió en la col de email):
// canoniza el PRIMER segmento y preserva el original ENTERO.
export function normalizarEstado(raw) {
  const original = raw == null ? null : String(raw);
  let hit = MAPA_ESTADOS[clave(raw)];
  if (!hit && original != null && original.includes('·')) {
    hit = MAPA_ESTADOS[clave(original.split('·')[0])];
  }
  if (hit) return { estado: hit.estado, original, flags: { ...hit.flags } };
  return { estado: 'SIN LLAMAR', original, flags: {} };
}

// Email sucio de la planilla → { email, reparado, sospechoso }. Reusada por
// importContactados e importUnificado (planImportListos).
// - Normaliza trim + lowercase (eso NO cuenta como reparación).
// - Repara SOLO typos inequívocos: puntos repetidos ('..') y proveedores
//   conocidos con el '.com' pegado (@gmailcom, @hotmailcom).
// - Lo dudoso queda TAL CUAL (email = crudo lowercase) + sospechoso:
//   · dominio sin punto (ej. @yahoocom): no hay reparación inequívoca.
//   · hmail.com: ¿hotmail o gmail? ambiguo.
//   · 'com' pegado antes del TLD (adolfosartorisacom.ar): falta un punto pero
//     no sabemos dónde ('.com.ar' legítimo NO matchea).
export function repararEmail(raw) {
  const original = String(raw ?? '').trim().toLowerCase();
  const arreglado = original
    .replace(/\.{2,}/g, '.')
    .replace(/@gmailcom$/, '@gmail.com')
    .replace(/@hotmailcom$/, '@hotmail.com');
  const dominio = arreglado.split('@')[1] || '';
  const sospechoso = !dominio.includes('.')
    || dominio === 'hmail.com'
    || (/com\.ar$/.test(dominio) && !/\.com\.ar$/.test(dominio));
  if (sospechoso) return { email: original, reparado: false, sospechoso: true };
  return { email: arreglado, reparado: arreglado !== original, sospechoso: false };
}

// Teléfono argentino → E.164 sin '+' ('5492262530944') o null.
// Reglas: sacar no-dígitos; sacar prefijo internacional 54/+54 y el 0 de
// discado nacional; el '15' después del código de área (2-4 dígitos) marca
// celular y se elimina (549 + área + número); sin marcas de celular → fijo
// (54 + área + número). El núcleo área+número debe quedar en 10 dígitos.
export function normalizarTelefonoAR(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let d = s.replace(/\D/g, '');
  if (d.length < 8) return null; // basura / demasiado corto
  let celular = false;
  // Prefijo internacional (con '+' explícito, o largo que solo lo explica el 54).
  if (d.startsWith('0054')) d = d.slice(4);
  else if (d.startsWith('54') && (s.startsWith('+') || d.length >= 12)) d = d.slice(2);
  // '9' de celular en formato internacional (549...).
  if (d.startsWith('9') && d.length >= 11) { celular = true; d = d.slice(1); }
  // '0' de discado nacional.
  if (d.startsWith('0')) d = d.slice(1);
  // '15' después del código de área (área de 2 a 4 dígitos) → celular.
  if (d.length === 12) {
    for (const n of [2, 3, 4]) {
      if (d.slice(n, n + 2) === '15') {
        d = d.slice(0, n) + d.slice(n + 2);
        celular = true;
        break;
      }
    }
  }
  if (d.length !== 10) return null; // no se pudo armar área+número
  return (celular ? '549' : '54') + d;
}
