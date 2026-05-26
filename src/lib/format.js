// Helpers de formato de numeros, montos y fechas.
// Antes habia ~6 variantes de fmtN/fmtM/fmtFecha redefinidas en cada archivo
// (con bugs sutiles: algunos abs, otros no; algunos manejan NaN, otros no).
// Centralizado aca para consistencia.

/**
 * Convierte cualquier valor a numero finito o devuelve 0.
 * Evita el clasico bug de Math.round(NaN) = NaN -> "NaN" en pantalla.
 */
const safe = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

/**
 * Formatea un numero entero con separador de miles (es-AR).
 * Preserva el signo. fmtN(1234567) -> "1.234.567"; fmtN(-100) -> "-100".
 */
export const fmtN = (n) => Math.round(safe(n)).toLocaleString('es-AR');

/**
 * Formatea un numero con valor absoluto (sin signo). Util para totales
 * donde el signo se muestra aparte (ej: "-$ 100" con el "-" antes).
 */
export const fmtNAbs = (n) => Math.round(Math.abs(safe(n))).toLocaleString('es-AR');

/**
 * Formatea un monto con simbolo de moneda. moneda='USD' -> "U$S 1.234".
 * Cualquier otra -> "$ 1.234".
 */
export const fmtMoney = (n, moneda) =>
  moneda === 'USD' ? `U$S ${fmtN(n)}` : `$ ${fmtN(n)}`;

/**
 * Igual que fmtMoney pero con valor absoluto.
 */
export const fmtMoneyAbs = (n, moneda) =>
  moneda === 'USD' ? `U$S ${fmtNAbs(n)}` : `$ ${fmtNAbs(n)}`;

/**
 * Formatea cantidades fraccionarias (ej: m2 con decimales). Hasta 3 decimales.
 * fmtQ(12.5) -> "12,5"; fmtQ(0) -> "0".
 */
export const fmtQ = (n) => {
  const v = safe(n);
  if (v === 0) return '0';
  const r = Math.round(v * 1000) / 1000;
  return r.toLocaleString('es-AR', { maximumFractionDigits: 3 });
};

/**
 * Formatea fecha ISO "YYYY-MM-DD" a "DD/MM/YYYY".
 * Si la fecha es null/vacia/invalida, devuelve '—'.
 */
export const fmtFecha = (iso) => {
  if (!iso || typeof iso !== 'string') return '—';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
};

/**
 * Formato corto: "DD/MM/YY".
 */
export const fmtFechaCorta = (iso) => {
  if (!iso || typeof iso !== 'string') return '—';
  const [y, m, d] = iso.split('-');
  if (!d) return iso;
  return `${d}/${m}/${(y || '').slice(2)}`;
};

/**
 * Formatea fecha + hora a "DD/MM/YYYY HH:MM" en es-AR.
 */
export const fmtDatetime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
       + ' '
       + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};

/**
 * Formatea numero como porcentaje (0-100). fmtPct(25) -> "25%".
 */
export const fmtPct = (n) => `${Math.round(safe(n))}%`;
