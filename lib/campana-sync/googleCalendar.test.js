import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { crearEvento, crearEventoLlamada, parsearInicio } from './googleCalendar.js';
import handler from '../../api/campana/[kind].js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// El calendar id trae '@' a propósito: verifica el encodeURIComponent en la URL.
const CAL_ID = 'abc123@group.calendar.google.com';

const stubEnvCalendar = () => {
  vi.stubEnv('GOOGLE_CALENDAR_ID', CAL_ID);
  vi.stubEnv('GOOGLE_SA_EMAIL', 'sync@kamak.iam.gserviceaccount.com');
  vi.stubEnv('GOOGLE_SA_KEY', String(PEM));
};

// fetch ruteado: token endpoint → access_token; Calendar API → evento creado.
const stubFetchCalendar = (evento = { id: 'evt123', htmlLink: 'https://www.google.com/calendar/event?eid=abc' }) => {
  const fetchMock = vi.fn(async (url) => {
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: 'ya29.cal' }) };
    }
    return { ok: true, json: async () => evento };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

// ---------------------------------------------------------------------------
// parsearInicio
// ---------------------------------------------------------------------------

describe('parsearInicio', () => {
  it('ISO naive (sin Z ni offset) → se asume hora argentina (UTC-3 fijo)', () => {
    expect(parsearInicio('2026-07-23T15:00:00').toISOString()).toBe('2026-07-23T18:00:00.000Z');
    expect(parsearInicio('2026-07-23T15:00').toISOString()).toBe('2026-07-23T18:00:00.000Z');
  });

  it('con Z u offset explícito se respeta el instante tal cual', () => {
    expect(parsearInicio('2026-07-23T18:00:00Z').toISOString()).toBe('2026-07-23T18:00:00.000Z');
    expect(parsearInicio('2026-07-23T15:00:00-03:00').toISOString()).toBe('2026-07-23T18:00:00.000Z');
    expect(parsearInicio('2026-07-23T20:00:00+02:00').toISOString()).toBe('2026-07-23T18:00:00.000Z');
  });

  it('fecha inválida (o solo fecha, sin hora) → lanza', () => {
    expect(() => parsearInicio('mañana a las 3')).toThrow('inválida');
    expect(() => parsearInicio('2026-07-23')).toThrow('inválida'); // "2026-07-23-03:00" no parsea
    expect(() => parsearInicio(undefined)).toThrow('inválida');
  });
});

// ---------------------------------------------------------------------------
// crearEventoLlamada
// ---------------------------------------------------------------------------

describe('crearEventoLlamada', () => {
  it('sin cualquiera de las 3 env → skipped sin tocar la red', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const faltante of ['GOOGLE_CALENDAR_ID', 'GOOGLE_SA_EMAIL', 'GOOGLE_SA_KEY']) {
      stubEnvCalendar();
      vi.stubEnv(faltante, '');
      expect(await crearEventoLlamada({ titulo: 'x', inicioISO: '2026-07-23T15:00:00' }))
        .toEqual({ skipped: 'sin calendario configurado' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('evento bien formado: URL con calendar id encodeado, Bearer, timezone AR, 30 min default y reminder popup', async () => {
    stubEnvCalendar();
    const fetchMock = stubFetchCalendar();

    const out = await crearEventoLlamada({
      titulo: 'Llamada PU515',
      descripcion: 'Repasar presupuesto',
      inicioISO: '2026-07-23T15:00:00-03:00',
    });

    const llamada = fetchMock.mock.calls.find(([u]) => String(u).includes('/calendar/'));
    expect(llamada[0]).toBe(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CAL_ID)}/events`);
    expect(llamada[0]).toContain('abc123%40group.calendar.google.com');
    expect(llamada[1].method).toBe('POST');
    expect(llamada[1].headers.Authorization).toBe('Bearer ya29.cal');

    const body = JSON.parse(llamada[1].body);
    expect(body.summary).toBe('Llamada PU515');
    expect(body.description).toBe('Repasar presupuesto');
    expect(body.start).toEqual({ dateTime: '2026-07-23T18:00:00.000Z', timeZone: 'America/Argentina/Buenos_Aires' });
    expect(body.end).toEqual({ dateTime: '2026-07-23T18:30:00.000Z', timeZone: 'America/Argentina/Buenos_Aires' }); // +30 min default
    expect(body.reminders).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] });

    expect(out).toEqual({ id: 'evt123', htmlLink: 'https://www.google.com/calendar/event?eid=abc' });
  });

  it('duracionMin y recordatorioMin custom se respetan', async () => {
    stubEnvCalendar();
    const fetchMock = stubFetchCalendar();
    await crearEventoLlamada({
      titulo: 'Llamada larga',
      inicioISO: '2026-07-23T15:00:00-03:00',
      duracionMin: 45,
      recordatorioMin: 60,
    });
    const body = JSON.parse(fetchMock.mock.calls.find(([u]) => String(u).includes('/calendar/'))[1].body);
    expect(body.end.dateTime).toBe('2026-07-23T18:45:00.000Z');
    expect(body.reminders.overrides).toEqual([{ method: 'popup', minutes: 60 }]);
  });

  it('Calendar no-ok → throw con status; fecha inválida → throw sin red', async () => {
    stubEnvCalendar();
    vi.stubGlobal('fetch', vi.fn(async (url) => (
      String(url).includes('oauth2.googleapis.com/token')
        ? { ok: true, json: async () => ({ access_token: 't' }) }
        : { ok: false, status: 403, text: async () => 'forbidden' }
    )));
    await expect(crearEventoLlamada({ titulo: 'x', inicioISO: '2026-07-23T15:00:00' }))
      .rejects.toThrow('Calendar 403');

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(crearEventoLlamada({ titulo: 'x', inicioISO: 'nunca' })).rejects.toThrow('inválida');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// crearEvento (wrapper fecha + hora local → crearEventoLlamada; lo usa el cron
// runCalendario de api/whatsapp/jobs.js para los vencimientos)
// ---------------------------------------------------------------------------

describe('crearEvento', () => {
  it('combina fechaISO + horaLocal default 09:00 AR; 30 min y reminder 60 por default', async () => {
    stubEnvCalendar();
    const fetchMock = stubFetchCalendar();

    const out = await crearEvento({
      titulo: '💰 Cobrar cuota 2 — Quilmes S7 — U$S 5.000',
      descripcion: 'Cliente: Mancini · Estado: impaga',
      fechaISO: '2026-07-28',
    });

    const llamada = fetchMock.mock.calls.find(([u]) => String(u).includes('/calendar/'));
    const body = JSON.parse(llamada[1].body);
    expect(body.summary).toBe('💰 Cobrar cuota 2 — Quilmes S7 — U$S 5.000');
    expect(body.description).toBe('Cliente: Mancini · Estado: impaga');
    // 09:00 hora argentina = 12:00Z; fin +30 min; popup 60 min antes.
    expect(body.start).toEqual({ dateTime: '2026-07-28T12:00:00.000Z', timeZone: 'America/Argentina/Buenos_Aires' });
    expect(body.end.dateTime).toBe('2026-07-28T12:30:00.000Z');
    expect(body.reminders).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 60 }] });
    expect(out).toEqual({ id: 'evt123', htmlLink: 'https://www.google.com/calendar/event?eid=abc' });
  });

  it('horaLocal/duracionMin/recordatorioMin custom; fechaISO con hora extra se recorta a la fecha', async () => {
    stubEnvCalendar();
    const fetchMock = stubFetchCalendar();
    await crearEvento({
      titulo: 'x',
      fechaISO: '2026-07-28T23:59:00Z', // la parte horaria sobra: manda horaLocal
      horaLocal: '14:30',
      duracionMin: 60,
      recordatorioMin: 15,
    });
    const body = JSON.parse(fetchMock.mock.calls.find(([u]) => String(u).includes('/calendar/'))[1].body);
    expect(body.start.dateTime).toBe('2026-07-28T17:30:00.000Z'); // 14:30 AR
    expect(body.end.dateTime).toBe('2026-07-28T18:30:00.000Z');
    expect(body.reminders.overrides).toEqual([{ method: 'popup', minutes: 15 }]);
  });

  it('sin env → {skipped} sin red; fechaISO inválida → throw sin red', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    stubEnvCalendar();
    vi.stubEnv('GOOGLE_CALENDAR_ID', '');
    expect(await crearEvento({ titulo: 'x', fechaISO: '2026-07-28' }))
      .toEqual({ skipped: 'sin calendario configurado' });

    stubEnvCalendar();
    await expect(crearEvento({ titulo: 'x', fechaISO: '28/07/2026' })).rejects.toThrow('inválida');
    await expect(crearEvento({ titulo: 'x', fechaISO: undefined })).rejects.toThrow('inválida');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Handler POST /api/campana/agendar (auth de usuario + inserción de actividad)
// ---------------------------------------------------------------------------

function mockRes() {
  const res = { statusCode: null, body: null, headers: {}, ended: false };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

const reqAgendar = (over = {}) => ({
  method: 'POST',
  query: { kind: 'agendar' },
  headers: { authorization: 'Bearer jwt-del-usuario' },
  body: {
    titulo: 'Llamada PU515',
    descripcion: 'Repasar presupuesto',
    fechaHoraISO: '2026-07-23T15:00:00',
    operadorId: 'op-1',
    estacionId: 'est-9',
    usuario: 'Franco',
  },
  ...over,
});

const stubEnvHandler = () => {
  stubEnvCalendar();
  vi.stubEnv('SUPABASE_URL', 'https://fake.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'service-key-123');
};

// fetch ruteado del flujo completo: Supabase Auth → token Google → Calendar → REST insert.
const stubFetchHandler = ({ authOk = true } = {}) => {
  const fetchMock = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) {
      return authOk
        ? { ok: true, json: async () => ({ email: 'vendedor@kamak.com.ar' }) }
        : { ok: false, status: 401 };
    }
    if (u.includes('oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: 'ya29.cal' }) };
    }
    if (u.includes('googleapis.com/calendar/')) {
      return { ok: true, json: async () => ({ id: 'evt123', htmlLink: 'https://www.google.com/calendar/event?eid=abc' }) };
    }
    if (u.includes('/rest/v1/camp_actividades')) {
      return { ok: true, text: async () => '' };
    }
    throw new Error(`fetch inesperado: ${u}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('handler /api/campana/[kind]', () => {
  it('es una function y con kind desconocido responde 404', async () => {
    expect(typeof handler).toBe('function');
    const res = mockRes();
    await handler({ method: 'POST', query: { kind: 'otra-cosa' }, headers: {} }, res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  it('agendar sin token → 401 sin tocar la red; OPTIONS → 200; GET → 405', async () => {
    stubEnvHandler();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res401 = mockRes();
    await handler(reqAgendar({ headers: {} }), res401);
    expect(res401.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();

    const resOpt = mockRes();
    await handler(reqAgendar({ method: 'OPTIONS' }), resOpt);
    expect(resOpt.statusCode).toBe(200);

    const resGet = mockRes();
    await handler(reqAgendar({ method: 'GET' }), resGet);
    expect(resGet.statusCode).toBe(405);
  });

  it('token que Supabase Auth rechaza → 401', async () => {
    stubEnvHandler();
    stubFetchHandler({ authOk: false });
    const res = mockRes();
    await handler(reqAgendar(), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/Sesión inválida/);
  });

  it('body sin titulo/fechaHoraISO o con fecha inválida → 400 (sin llamar a Google)', async () => {
    stubEnvHandler();
    const fetchMock = stubFetchHandler();

    const resFaltan = mockRes();
    await handler(reqAgendar({ body: { descripcion: 'sin lo obligatorio' } }), resFaltan);
    expect(resFaltan.statusCode).toBe(400);

    const resFecha = mockRes();
    await handler(reqAgendar({ body: { ...reqAgendar().body, fechaHoraISO: 'el jueves' } }), resFecha);
    expect(resFecha.statusCode).toBe(400);
    expect(resFecha.body.error).toMatch(/fechaHoraISO inválida/);

    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('googleapis.com'))).toBe(false);
  });

  it('flujo completo: valida sesión, crea evento y registra camp_actividades → 200 {ok, htmlLink}', async () => {
    stubEnvHandler();
    const fetchMock = stubFetchHandler();
    const res = mockRes();
    await handler(reqAgendar(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, htmlLink: 'https://www.google.com/calendar/event?eid=abc' });

    // Verificó la sesión con la service key como apikey y el JWT del usuario.
    const auth = fetchMock.mock.calls.find(([u]) => String(u).includes('/auth/v1/user'));
    expect(auth[1].headers.Authorization).toBe('Bearer jwt-del-usuario');
    expect(auth[1].headers.apikey).toBe('service-key-123');

    // Insert de la actividad con service key, tipo/canal/texto/datos correctos.
    const ins = fetchMock.mock.calls.find(([u]) => String(u).includes('/rest/v1/camp_actividades'));
    expect(ins[0]).toBe('https://fake.supabase.co/rest/v1/camp_actividades');
    expect(ins[1].headers.Authorization).toBe('Bearer service-key-123');
    const fila = JSON.parse(ins[1].body);
    expect(fila.tipo).toBe('agenda');
    expect(fila.canal).toBe('llamada'); // sin canal en el body → default
    expect(fila.usuario).toBe('Franco');
    expect(fila.operador_id).toBe('op-1');
    expect(fila.estacion_id).toBe('est-9');
    // 15:00 naive = 15:00 hora argentina en el texto legible.
    expect(fila.texto).toMatch(/^Seguimiento agendado \(llamada\): Llamada PU515 — 23\/07\/2026.*15:00$/);
    expect(fila.datos).toEqual({
      eventoId: 'evt123',
      htmlLink: 'https://www.google.com/calendar/event?eid=abc',
      fechaHoraISO: '2026-07-23T15:00:00',
    });
  });

  it('canal del body llega al insert; canal fuera de la lista cae al default llamada', async () => {
    stubEnvHandler();
    const fetchMock = stubFetchHandler();

    const res = mockRes();
    await handler(reqAgendar({ body: { ...reqAgendar().body, canal: 'whatsapp' } }), res);
    expect(res.statusCode).toBe(200);
    let fila = JSON.parse(fetchMock.mock.calls.find(([u]) => String(u).includes('camp_actividades'))[1].body);
    expect(fila.canal).toBe('whatsapp');
    expect(fila.texto).toMatch(/^Seguimiento agendado \(whatsapp\): Llamada PU515 — /);

    fetchMock.mockClear();
    await handler(reqAgendar({ body: { ...reqAgendar().body, canal: 'paloma mensajera' } }), mockRes());
    fila = JSON.parse(fetchMock.mock.calls.find(([u]) => String(u).includes('camp_actividades'))[1].body);
    expect(fila.canal).toBe('llamada');
  });

  it('sin operadorId ni estacionId → crea el evento pero CERO inserts en camp_actividades (agenda de clientes: crm_actividades la registra el módulo comercial)', async () => {
    stubEnvHandler();
    const fetchMock = stubFetchHandler();
    const body = { ...reqAgendar().body };
    delete body.operadorId;
    delete body.estacionId;

    const res = mockRes();
    await handler(reqAgendar({ body }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, htmlLink: 'https://www.google.com/calendar/event?eid=abc' });
    // El evento sí se creó...
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('googleapis.com/calendar/'))).toBe(true);
    // ...pero no se tocó camp_actividades.
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('camp_actividades'))).toBe(false);
  });

  it('sin GOOGLE_CALENDAR_ID → 200 {skipped} y NO registra actividad', async () => {
    stubEnvHandler();
    vi.stubEnv('GOOGLE_CALENDAR_ID', '');
    const fetchMock = stubFetchHandler();
    const res = mockRes();
    await handler(reqAgendar(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ skipped: 'sin calendario configurado' });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('camp_actividades'))).toBe(false);
  });
});
