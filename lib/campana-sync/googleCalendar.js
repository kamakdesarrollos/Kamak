// Google Calendar: agendar llamadas de la campaña desde el ERP.
//
// La service account (GOOGLE_SA_EMAIL/GOOGLE_SA_KEY, la misma de ga4/gsc)
// ESCRIBE eventos en un calendario que Franco comparte con ella; el ID del
// calendario llega por env GOOGLE_CALENDAR_ID. Enchufable sin claves (patrón
// de todo lib/campana-sync): sin calendario o sin SA configurada devuelve
// {skipped:'sin calendario configurado'} sin tocar la red.
//
// API: POST calendar/v3/calendars/<id>/events con start/end en timezone AR y
// recordatorio popup propio (useDefault:false). Devuelve {id, htmlLink} del
// evento creado, o lanza si Google responde error.

import { tokenGoogle } from './googleAuth.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar';
const TZ = 'America/Argentina/Buenos_Aires';

// ISO "naive" (sin Z ni offset, ej. "2026-07-23T15:00") → se asume hora
// argentina: Argentina no tiene DST (UTC-3 fijo), así que basta con anexar
// -03:00. Con Z u offset explícito se respeta el instante tal cual. Lanza si
// la fecha no parsea. Exportada para que el endpoint formatee la MISMA fecha
// que va al evento (y valide antes de llamar a Google).
export function parsearInicio(inicioISO) {
  const s = String(inicioISO ?? '');
  // Exigir forma ISO con fecha Y hora antes de parsear: el parser legacy de
  // Date es demasiado laxo ("mañana a las 3-03:00" → marzo de 2001).
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) throw new Error(`fecha/hora inválida: ${inicioISO}`);
  const conOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s);
  const d = new Date(conOffset ? s : `${s}-03:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`fecha/hora inválida: ${inicioISO}`);
  return d;
}

// Evento genérico de vencimiento (lo usa el cron runCalendario de
// api/whatsapp/jobs.js): combina fecha 'YYYY-MM-DD' + hora local argentina en
// el inicioISO naive que espera crearEventoLlamada (misma llamada a Google por
// dentro — mismo contrato: {skipped} sin env, {id, htmlLink} al crear, throw si
// Google falla). Acepta fechaISO con hora/offset de yapa: se recorta a la fecha.
export async function crearEvento({ titulo, descripcion, fechaISO, horaLocal = '09:00', duracionMin = 30, recordatorioMin = 60 }) {
  const fecha = String(fechaISO ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error(`fecha inválida: ${fechaISO}`);
  return crearEventoLlamada({ titulo, descripcion, inicioISO: `${fecha}T${horaLocal}`, duracionMin, recordatorioMin });
}

export async function crearEventoLlamada({ titulo, descripcion, inicioISO, duracionMin = 30, recordatorioMin = 10 }) {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  const email = process.env.GOOGLE_SA_EMAIL;
  const key = process.env.GOOGLE_SA_KEY;
  if (!calendarId || !email || !key) return { skipped: 'sin calendario configurado' };

  const inicio = parsearInicio(inicioISO);
  const fin = new Date(inicio.getTime() + duracionMin * 60_000);

  const token = await tokenGoogle({ email, key, scope: SCOPE });
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: titulo,
      description: descripcion || '',
      start: { dateTime: inicio.toISOString(), timeZone: TZ },
      end: { dateTime: fin.toISOString(), timeZone: TZ },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: recordatorioMin }] },
    }),
  });
  if (!r.ok) throw new Error(`Calendar ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return { id: j.id, htmlLink: j.htmlLink };
}
