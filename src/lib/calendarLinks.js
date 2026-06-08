// Links para crear eventos en Google Calendar SIN backend: abren el calendario
// con el evento pre-cargado; el usuario confirma y queda en su Google Calendar
// (que el celular sincroniza). Cero costo de servidor.

const pad = (n) => String(n).padStart(2, '0');

// 'YYYY-MM-DD' -> 'YYYYMMDD'
const toCalDate = (iso) => (iso || '').slice(0, 10).replace(/-/g, '');

// día siguiente en 'YYYYMMDD' (fin exclusivo para evento de día completo).
const nextDay = (iso) => {
  const [y, m, d] = (iso || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return toCalDate(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
};

// 'YYYY-MM-DD' + 'HH:MM' -> 'YYYYMMDDTHHMMSS' (hora local, se fija la TZ con ctz).
const toCalDateTime = (iso, hora) => {
  const [h, m] = (hora || '00:00').split(':');
  return `${toCalDate(iso)}T${pad(Number(h) || 0)}${pad(Number(m) || 0)}00`;
};
// +1 hora (maneja rollover de día/mes/año vía Date.UTC, sólo aritmética).
const plusHour = (iso, hora) => {
  const [y, mo, d] = (iso || '').slice(0, 10).split('-').map(Number);
  const [h, m] = (hora || '00:00').split(':').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, (h || 0) + 1, m || 0));
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00`;
};

// Evento en Google Calendar. Con `hora` (HH:MM) es un evento con horario (1h);
// sin hora, es de día completo en `fecha` (YYYY-MM-DD). Devuelve null si no hay fecha.
// IMPORTANTE: el `dates` NO se construye con URLSearchParams porque encodea la '/'
// como %2F y el endpoint render de Google lo rechaza (el evento sale con fecha mal).
export function googleCalendarUrl({ titulo, fecha, hora = '', detalles = '', ubicacion = '' }) {
  if (!fecha) return null;
  const dates = hora
    ? `${toCalDateTime(fecha, hora)}/${plusHour(fecha, hora)}`
    : `${toCalDate(fecha)}/${nextDay(fecha)}`;
  const parts = [
    'action=TEMPLATE',
    `text=${encodeURIComponent(titulo || 'Recordatorio Kamak')}`,
    `dates=${dates}`,                       // slash literal a propósito
  ];
  if (detalles)  parts.push(`details=${encodeURIComponent(detalles)}`);
  if (ubicacion) parts.push(`location=${encodeURIComponent(ubicacion)}`);
  if (hora)      parts.push('ctz=America/Argentina/Buenos_Aires');
  return `https://calendar.google.com/calendar/render?${parts.join('&')}`;
}
