import { it, expect, vi, afterEach } from 'vitest';
import { sync } from './meta_ads.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// Forma real de /act_<id>/insights?level=campaign — OJO: números como STRING.
const FIXTURE = {
  data: [{
    campaign_id: '238414960001234',
    campaign_name: 'WA — 4.070 estaciones',
    spend: '15423.87',
    impressions: '80211',
    clicks: '912',
    actions: [
      { action_type: 'link_click', value: '800' },
      { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '37' },
    ],
    date_start: '2026-07-21',
    date_stop: '2026-07-21',
  }],
  paging: { cursors: { before: 'x', after: 'y' } },
};

it('sin token o sin cuenta → skipped sin tocar la red', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  vi.stubEnv('META_SYSTEM_TOKEN', 'tok');
  vi.stubEnv('META_AD_ACCOUNT_ID', '');
  expect(await sync()).toEqual({ skipped: 'sin clave' });

  vi.stubEnv('META_SYSTEM_TOKEN', '');
  vi.stubEnv('META_AD_ACCOUNT_ID', '1234');
  expect(await sync()).toEqual({ skipped: 'sin clave' });

  expect(fetchMock).not.toHaveBeenCalled();
});

it('con claves: insights de ayer por campaña, números parseados (spend viene como string)', async () => {
  vi.stubEnv('META_SYSTEM_TOKEN', 'meta-tok');
  vi.stubEnv('META_AD_ACCOUNT_ID', '1234567890');
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => FIXTURE }));
  vi.stubGlobal('fetch', fetchMock);

  const { filas } = await sync();

  const [url, opts] = fetchMock.mock.calls[0];
  expect(url).toContain('https://graph.facebook.com/v21.0/act_1234567890/insights?');
  expect(url).toContain('level=campaign');
  expect(url).toContain('date_preset=yesterday');
  expect(url).not.toContain('meta-tok');                       // token por header, no en la URL
  expect(opts.headers.Authorization).toBe('Bearer meta-tok');

  expect(filas).toHaveLength(1);
  const f = filas[0];
  expect(f.fuente).toBe('meta_ads');
  expect(f.campana_ext_id).toBe('238414960001234');
  expect(f.campana_ext_nombre).toBe('WA — 4.070 estaciones');
  expect(f.fecha).toBe('2026-07-21');                          // date_start del insight
  expect(f.metricas).toEqual({
    gasto: 15423.87,          // number, no '15423.87'
    impresiones: 80211,
    clics: 912,
    conversaciones: 37,       // action_type onsite_conversion.messaging_conversation_started_7d
  });
});

it('normaliza la cuenta si YA viene con prefijo act_ (no duplica el prefijo)', async () => {
  vi.stubEnv('META_SYSTEM_TOKEN', 'tok');
  vi.stubEnv('META_AD_ACCOUNT_ID', 'act_999');
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }));
  vi.stubGlobal('fetch', fetchMock);
  await sync();
  expect(fetchMock.mock.calls[0][0]).toContain('/act_999/insights');
  expect(fetchMock.mock.calls[0][0]).not.toContain('act_act_');
});

it('campaña sin actions → conversaciones 0; HTTP no-ok → throw', async () => {
  vi.stubEnv('META_SYSTEM_TOKEN', 'tok');
  vi.stubEnv('META_AD_ACCOUNT_ID', '1234');
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: [{ campaign_id: '1', campaign_name: 'x', spend: '0', impressions: '10', clicks: '0', date_start: '2026-07-21' }] }),
  })));
  const { filas } = await sync();
  expect(filas[0].metricas.conversaciones).toBe(0);

  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, text: async () => 'token vencido' })));
  await expect(sync()).rejects.toThrow('Meta Ads 400');
});
