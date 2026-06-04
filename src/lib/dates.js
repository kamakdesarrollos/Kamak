// Helpers de fechas.
import { MS_PER_DAY } from './constants';

/**
 * Devuelve la fecha de hoy en formato ISO 'YYYY-MM-DD', usando los componentes
 * de fecha LOCALES (no UTC). Con toISOString() un movimiento/cheque/tarea cargado
 * a las 22:00 en Argentina (UTC-3) quedaba fechado al día siguiente → saltaba de
 * mes y descuadraba cierres y Libro IVA. Acá tomamos el día local real.
 */
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Cantidad de dias desde hoy hasta una fecha ISO.
 * - Positivo: la fecha es futura.
 * - 0: la fecha es hoy.
 * - Negativo: la fecha ya paso.
 * - null si no hay fecha.
 */
export const diasHasta = (iso) => {
  if (!iso) return null;
  const hoy = today();
  const a = new Date(hoy);
  const b = new Date(iso);
  if (isNaN(b.getTime())) return null;
  return Math.round((b - a) / MS_PER_DAY);
};

/**
 * Igual que diasHasta pero negativo si ya paso (mejor expresividad).
 * Alias mantenido por compatibilidad. Devuelve el mismo numero que diasHasta.
 */
export const diasDesde = (iso) => {
  const d = diasHasta(iso);
  return d == null ? null : -d;
};

/**
 * Devuelve el primer dia del mes actual en formato ISO 'YYYY-MM-01'.
 */
export const inicioMes = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

/**
 * Devuelve la fecha N dias antes (negativo) o despues (positivo) de hoy.
 */
export const fechaRelativa = (dias) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  // GLB-02: componentes LOCALES (no toISOString/UTC) para no fechar al día
  // siguiente después de las 21:00 ARG (saltaba de mes en vencimientos/cheques).
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
