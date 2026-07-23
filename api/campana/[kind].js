// Endpoints de campaña que llaman USUARIOS del ERP (no crons). Una sola Vercel
// function despacha por el segmento de ruta (mismo criterio que
// api/public/[kind].js para no superar el límite de funciones del plan Hobby):
//   POST /api/campana/agendar → agenda un seguimiento (llamada/email/linkedin/
//   whatsapp/reunión/otro, según `canal` del body) en Google Calendar.
//
// Auth: Bearer token de Supabase Auth verificado SERVER-SIDE contra
// /auth/v1/user (patrón de api/admin/update-user.js). A diferencia de ese
// endpoint acá NO se exige Admin: alcanza con ser usuario autenticado del ERP.
//
// agendar: crea el evento vía lib/campana-sync/googleCalendar.js (service
// account + GOOGLE_CALENDAR_ID) y registra la actividad en camp_actividades
// con la SERVICE KEY (server-side, bypasea RLS) — SOLO si el body referencia
// un operador o una estación de la campaña (ver comentario en el insert). Si
// falta la config del calendario responde 200 {skipped} — la UI muestra un
// aviso, no un error.

import { crearEventoLlamada, parsearInicio } from '../../lib/campana-sync/googleCalendar.js';

const TZ = 'America/Argentina/Buenos_Aires';

// Canales válidos de un seguimiento; cualquier otro valor (o ausencia) cae al
// default 'llamada'.
const CANALES = ['llamada', 'email', 'linkedin', 'whatsapp', 'reunion', 'otro'];

// "23/07/2026, 15:00" hora argentina — para el texto legible de la actividad.
const fechaLegibleAR = (d) => new Intl.DateTimeFormat('es-AR', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ,
}).format(d);

export default async function handler(req, res) {
  const kind = req.query?.kind;
  if (kind === 'agendar') return agendarHandler(req, res);
  return res.status(404).json({ error: 'not_found' });
}

async function agendarHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Env leído EN CADA LLAMADA (no al importar) para que los tests lo stubbeen.
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Servidor sin SUPABASE_URL / SUPABASE_SERVICE_KEY' });
  }

  const authHeader = req.headers?.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sin token de sesión' });

  try {
    // Validar el JWT del que llama contra Supabase Auth (server-side).
    const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!ures.ok) return res.status(401).json({ error: 'Sesión inválida o vencida' });

    const {
      titulo, descripcion, fechaHoraISO, duracionMin, recordatorioMin,
      operadorId, estacionId, usuario,
    } = req.body || {};
    if (!titulo || !fechaHoraISO) return res.status(400).json({ error: 'Faltan titulo y/o fechaHoraISO' });
    const canal = CANALES.includes(req.body?.canal) ? req.body.canal : 'llamada';

    let inicio;
    try {
      inicio = parsearInicio(fechaHoraISO);
    } catch {
      return res.status(400).json({ error: `fechaHoraISO inválida: ${fechaHoraISO}` });
    }

    const evento = await crearEventoLlamada({
      titulo,
      descripcion,
      inicioISO: fechaHoraISO,
      ...(duracionMin != null ? { duracionMin: Number(duracionMin) } : {}),
      ...(recordatorioMin != null ? { recordatorioMin: Number(recordatorioMin) } : {}),
    });
    if (evento.skipped) return res.status(200).json({ skipped: evento.skipped });

    // Registrar la actividad (trazabilidad de la campaña) SOLO si el
    // seguimiento referencia a un operador o estación de la campaña. Sin refs
    // NO se inserta nada: la agenda comercial de CLIENTES usa este mismo
    // endpoint y su actividad ya la registra el módulo comercial en
    // crm_actividades por su lado. El evento YA existe en Calendar: si el
    // insert falla no devolvemos error (un retry del cliente duplicaría el
    // evento) — se loguea y se avisa en la respuesta.
    if (operadorId || estacionId) {
      const ir = await fetch(`${SUPABASE_URL}/rest/v1/camp_actividades`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          tipo: 'agenda',
          canal,
          texto: `Seguimiento agendado (${canal}): ${titulo} — ${fechaLegibleAR(inicio)}`,
          usuario: usuario ?? null,
          operador_id: operadorId ?? null,
          estacion_id: estacionId ?? null,
          datos: { eventoId: evento.id, htmlLink: evento.htmlLink, fechaHoraISO },
        }),
      });
      if (!ir.ok) {
        console.error('[campana/agendar] camp_actividades falló:', ir.status, (await ir.text()).slice(0, 200));
        return res.status(200).json({ ok: true, htmlLink: evento.htmlLink, warning: 'evento creado pero la actividad no se registró' });
      }
    }
    return res.status(200).json({ ok: true, htmlLink: evento.htmlLink });
  } catch (e) {
    console.error('[campana/agendar] error:', e.message);
    return res.status(500).json({ error: e.message || 'Error interno' });
  }
}
