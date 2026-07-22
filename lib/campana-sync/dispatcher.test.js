// Tests del dispatcher api/campana/sync.js: auth (CRON_SECRET o SYNC_SECRET),
// fuentes enchufables sin claves y aislamiento de errores entre fuentes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../../api/campana/sync.js';

const mkReq = ({ query = {}, headers = {} } = {}) => ({ query, headers });
const mkRes = () => {
  const res = {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
  };
  return res;
};

beforeEach(() => {
  // Base limpia: sin secrets ni claves de fuentes (los tests stubbean lo suyo).
  for (const k of ['CRON_SECRET', 'SYNC_SECRET', 'INSTANTLY_API_KEY', 'META_SYSTEM_TOKEN',
    'META_AD_ACCOUNT_ID', 'CLARITY_TOKEN', 'GA4_PROPERTY_ID', 'GOOGLE_SA_EMAIL', 'GOOGLE_SA_KEY',
    'SUPABASE_URL', 'SUPABASE_SERVICE_KEY']) vi.stubEnv(k, '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('auth', () => {
  it('sin secret dado → 401 (incluso sin ningún secret configurado: nunca abierto)', async () => {
    const res = mkRes();
    await handler(mkReq(), res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });

  it('secret que no matchea → 401', async () => {
    vi.stubEnv('CRON_SECRET', 'real');
    vi.stubEnv('SYNC_SECRET', 'otro-real');
    const res = mkRes();
    await handler(mkReq({ query: { secret: 'trucho' } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('CUALQUIERA de los dos secrets vale, por query, Bearer o x-cron-secret', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-s');
    vi.stubEnv('SYNC_SECRET', 'sync-s');
    for (const req of [
      mkReq({ query: { secret: 'sync-s' } }),
      mkReq({ headers: { authorization: 'Bearer cron-s' } }),
      mkReq({ headers: { 'x-cron-secret': 'sync-s' } }),
    ]) {
      const res = mkRes();
      await handler(req, res);
      expect(res.statusCode).toBe(200);
    }
  });
});

describe('fuentes enchufables', () => {
  beforeEach(() => vi.stubEnv('SYNC_SECRET', 's'));
  const req = (query = {}) => mkReq({ query: { secret: 's', ...query } });

  it('default all: sin ninguna clave → las 5 fuentes skipped, sin tocar la red, 200', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = mkRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.summary).toEqual({
      instantly: { skipped: 'sin clave' },
      meta_ads: { skipped: 'sin clave' },
      ga4: { skipped: 'sin clave' },
      gsc: { skipped: 'sin clave' },
      clarity: { skipped: 'sin clave' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('?src=gads (alias del reporte GA4) sin claves → skipped, no error', async () => {
    const res = mkRes();
    await handler(req({ src: 'gads' }), res);
    expect(res.body.summary).toEqual({ gads: { skipped: 'sin clave' } });
  });

  it('fuente desconocida → error en el summary, 200 igual', async () => {
    const res = mkRes();
    await handler(req({ src: 'tiktok' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.summary.tiktok).toEqual({ error: 'fuente desconocida' });
  });
});

describe('aislamiento de errores por fuente', () => {
  it('instantly explota (API 500) pero clarity sincroniza igual y sus filas se upsertean', async () => {
    vi.stubEnv('SYNC_SECRET', 's');
    vi.stubEnv('INSTANTLY_API_KEY', 'ik');
    vi.stubEnv('CLARITY_TOKEN', 'ct');
    vi.stubEnv('SUPABASE_URL', 'https://demo.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'sk');

    const fetchMock = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('instantly.ai')) return { ok: false, status: 500, text: async () => 'caput' };
      if (u.includes('clarity.ms')) return { ok: true, json: async () => [{ metricName: 'Traffic', information: [] }] };
      if (u.includes('demo.supabase.co')) return { ok: true, text: async () => '' };
      throw new Error('URL inesperada ' + u);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = mkRes();
    await handler(mkReq({ query: { secret: 's', src: 'instantly,clarity' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.summary.instantly.error).toMatch(/Instantly 500/);
    expect(res.body.summary.clarity).toEqual({ ok: true, filas: 1 });

    // La fila de clarity llegó a camp_metricas con el upsert idempotente.
    const upsert = fetchMock.mock.calls.find(([u]) => String(u).includes('camp_metricas'));
    expect(upsert[0]).toContain('on_conflict=fuente,campana_ext_id,fecha');
    const body = JSON.parse(upsert[1].body);
    expect(body[0].fuente).toBe('clarity');
    expect(body[0].campana_ext_id).toBe('');   // global normalizado a ''
  });

  it('la DB caída tampoco tumba a las demás fuentes (el error queda en la fuente)', async () => {
    vi.stubEnv('SYNC_SECRET', 's');
    vi.stubEnv('CLARITY_TOKEN', 'ct');
    // SUPABASE_URL vacío → upsertMetricas tira "Supabase sin configurar".
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));

    const res = mkRes();
    await handler(mkReq({ query: { secret: 's', src: 'clarity,instantly' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.summary.clarity.error).toMatch(/Supabase sin configurar/);
    expect(res.body.summary.instantly).toEqual({ skipped: 'sin clave' });
  });
});
