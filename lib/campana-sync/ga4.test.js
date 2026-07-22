import { it, expect, vi, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { sync } from './ga4.js';
import { diasAtrasISO } from './comun.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// Forma real de properties/<id>:runReport (métricas como string en value).
const FIXTURE = {
  dimensionHeaders: [{ name: 'sessionCampaignName' }, { name: 'sessionSource' }],
  metricHeaders: [
    { name: 'sessions', type: 'TYPE_INTEGER' },
    { name: 'advertiserAdCost', type: 'TYPE_CURRENCY' },
    { name: 'advertiserAdClicks', type: 'TYPE_INTEGER' },
  ],
  rows: [
    { dimensionValues: [{ value: 'wa-estaciones' }, { value: 'google' }], metricValues: [{ value: '40' }, { value: '2500.5' }, { value: '35' }] },
    { dimensionValues: [{ value: 'wa-estaciones' }, { value: 'ig' }], metricValues: [{ value: '10' }, { value: '0' }, { value: '0' }] },
    { dimensionValues: [{ value: '(not set)' }, { value: '(direct)' }], metricValues: [{ value: '7' }, { value: '0' }, { value: '0' }] },
  ],
  rowCount: 3,
  kind: 'analyticsData#runReport',
};

const stubEnvGA4 = () => {
  vi.stubEnv('GA4_PROPERTY_ID', '498765432');
  vi.stubEnv('GOOGLE_SA_EMAIL', 'sync@kamak.iam.gserviceaccount.com');
  vi.stubEnv('GOOGLE_SA_KEY', String(PEM));
};

// fetch ruteado: token endpoint → access_token; Analytics Data API → fixture.
const stubFetchGA4 = (reporte = FIXTURE) => {
  const fetchMock = vi.fn(async (url) => {
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: 'ya29.ga4' }) };
    }
    return { ok: true, json: async () => reporte };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

it('sin cualquiera de las 3 claves → skipped sin tocar la red', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  for (const faltante of ['GA4_PROPERTY_ID', 'GOOGLE_SA_EMAIL', 'GOOGLE_SA_KEY']) {
    stubEnvGA4();
    vi.stubEnv(faltante, '');
    expect(await sync()).toEqual({ skipped: 'sin clave' });
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

it('con claves: token de SA → runReport de ayer → filas ga4 AGREGADAS por campaña + gads si costo > 0', async () => {
  stubEnvGA4();
  const fetchMock = stubFetchGA4();

  const { filas } = await sync();

  // runReport: property correcta, Bearer del token, dimensiones y métricas pedidas.
  const llamadaReporte = fetchMock.mock.calls.find(([u]) => String(u).includes(':runReport'));
  expect(llamadaReporte[0]).toBe('https://analyticsdata.googleapis.com/v1beta/properties/498765432:runReport');
  expect(llamadaReporte[1].headers.Authorization).toBe('Bearer ya29.ga4');
  const body = JSON.parse(llamadaReporte[1].body);
  expect(body.dateRanges).toEqual([{ startDate: 'yesterday', endDate: 'yesterday' }]);
  expect(body.dimensions).toEqual([{ name: 'sessionCampaignName' }, { name: 'sessionSource' }]);
  expect(body.metrics).toEqual([{ name: 'sessions' }, { name: 'advertiserAdCost' }, { name: 'advertiserAdClicks' }]);

  // 2 campañas ga4 + 1 gads (solo la de costo > 0) = 3 filas, todas con fecha de ayer.
  const ayer = diasAtrasISO(1);
  expect(filas).toHaveLength(3);
  expect(filas.every(f => f.fecha === ayer)).toBe(true);

  const ga4Wa = filas.find(f => f.fuente === 'ga4' && f.campana_ext_id === 'wa-estaciones');
  expect(ga4Wa.metricas).toEqual({
    sesiones: 50,                                  // 40 google + 10 ig (agregado por campaña)
    costo: 2500.5,
    clicsPago: 35,
    porFuente: { google: 40, ig: 10 },
  });

  const ga4NotSet = filas.find(f => f.fuente === 'ga4' && f.campana_ext_id === '(not set)');
  expect(ga4NotSet.metricas.sesiones).toBe(7);

  const gads = filas.filter(f => f.fuente === 'gads');
  expect(gads).toHaveLength(1);                    // '(not set)' no tiene costo → sin fila gads
  expect(gads[0].campana_ext_id).toBe('wa-estaciones');
  expect(gads[0].metricas).toEqual({ costo: 2500.5, clics: 35, sesiones: 50 });
});

it('reporte sin rows (día sin tráfico) → 0 filas; runReport no-ok → throw', async () => {
  stubEnvGA4();
  stubFetchGA4({ rowCount: 0, kind: 'analyticsData#runReport' });
  expect((await sync()).filas).toEqual([]);

  vi.stubGlobal('fetch', vi.fn(async (url) => (
    String(url).includes('oauth2.googleapis.com/token')
      ? { ok: true, json: async () => ({ access_token: 't' }) }
      : { ok: false, status: 403, text: async () => 'no access' }
  )));
  await expect(sync()).rejects.toThrow('GA4 403');
});
