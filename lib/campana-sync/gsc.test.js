import { it, expect, vi, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { sync } from './gsc.js';
import { diasAtrasISO } from './comun.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const HACE3 = diasAtrasISO(3);

const stubEnvGSC = () => {
  vi.stubEnv('GSC_SITE_URL', 'sc-domain:kamak.com.ar');
  vi.stubEnv('GOOGLE_SA_EMAIL', 'sync@kamak.iam.gserviceaccount.com');
  vi.stubEnv('GOOGLE_SA_KEY', String(PEM));
};

it('sin cualquiera de las claves → skipped sin tocar la red', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  for (const faltante of ['GSC_SITE_URL', 'GOOGLE_SA_EMAIL', 'GOOGLE_SA_KEY']) {
    stubEnvGSC();
    vi.stubEnv(faltante, '');
    expect(await sync()).toEqual({ skipped: 'sin clave' });
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

it('con claves: pide el día de hace 3 (lag de GSC) y arma la fila global de ese día', async () => {
  stubEnvGSC();
  const fetchMock = vi.fn(async (url) => {
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: 'ya29.gsc' }) };
    }
    // Forma real de searchAnalytics/query con dimensions:['date'].
    return { ok: true, json: async () => ({ rows: [{ keys: [HACE3], clicks: 12, impressions: 340, ctr: 0.0353, position: 8.4 }], responseAggregationType: 'byProperty' }) };
  });
  vi.stubGlobal('fetch', fetchMock);

  const { filas } = await sync();

  const llamadaQuery = fetchMock.mock.calls.find(([u]) => String(u).includes('searchAnalytics/query'));
  // El site va URL-encodeado en el path (sc-domain: tiene ':').
  expect(llamadaQuery[0]).toBe('https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Akamak.com.ar/searchAnalytics/query');
  expect(llamadaQuery[1].headers.Authorization).toBe('Bearer ya29.gsc');
  expect(JSON.parse(llamadaQuery[1].body)).toEqual({ startDate: HACE3, endDate: HACE3, dimensions: ['date'] });

  expect(filas).toHaveLength(1);
  const f = filas[0];
  expect(f.fuente).toBe('gsc');
  expect(f.campana_ext_id).toBeNull();       // global → el upsert lo normaliza a ''
  expect(f.fecha).toBe(HACE3);
  expect(f.metricas).toEqual({ clicks: 12, impressions: 340, ctr: 0.0353, position: 8.4 });
});

it('GSC todavía sin datos de ese día (sin rows) → 0 filas; HTTP no-ok → throw', async () => {
  stubEnvGSC();
  vi.stubGlobal('fetch', vi.fn(async (url) => (
    String(url).includes('oauth2.googleapis.com/token')
      ? { ok: true, json: async () => ({ access_token: 't' }) }
      : { ok: true, json: async () => ({ responseAggregationType: 'byProperty' }) }
  )));
  expect((await sync()).filas).toEqual([]);

  vi.stubGlobal('fetch', vi.fn(async (url) => (
    String(url).includes('oauth2.googleapis.com/token')
      ? { ok: true, json: async () => ({ access_token: 't' }) }
      : { ok: false, status: 403, text: async () => 'sin permiso al site' }
  )));
  await expect(sync()).rejects.toThrow('Search Console 403');
});
