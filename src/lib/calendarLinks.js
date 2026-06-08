// Links para crear eventos en Google Calendar SIN backend: abren el calendario
// con el evento pre-cargado; el usuario confirma y queda en su Google Calendar
// (que el celular sincroniza). Cero costo de servidor.

const pad = (n) => String(n).padStart(2, '0');

// 'YYYY-MM-DD' -> 'YYYYMMDD'
const toCalDate = (iso) => (iso || '').slice(0, 10).replace(/-/g, '');

// día siguiente en 'YYYYMMDD' (fin exclusivo para evento de día completo).
// Usa Date.UTC para que el rollover de mes/año sea correcto.
const nextDay = (iso) => {
  const [y, m, d] = (iso || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return toCalDate(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
};

// Evento de día completo en `fecha` (YYYY-MM-DD). Devuelve null si no hay fecha.
export function googleCalendarUrl({ titulo, fecha, detalles = '', ubicacion = '' }) {
  if (!fecha) return null;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: titulo || 'Recordatorio Kamak',
    dates: `${toCalDate(fecha)}/${nextDay(fecha)}`,
  });
  if (detalles) params.set('details', detalles);
  if (ubicacion) params.set('location', ubicacion);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
