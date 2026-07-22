import { it, expect, vi, afterEach } from 'vitest';
import { sync } from './instantly.js';
import { hoyISO } from './comun.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// Forma real de GET /api/v2/campaigns/analytics (acumulado por campaña).
const FIXTURE = [{
  campaign_id: '01978f2d-a3f5-7ab1-b1c2-000000000001',
  campaign_name: 'Estaciones AMBA — tanda 1',
  campaign_status: 1,
  leads_count: 500,
  contacted_count: 480,
  emails_sent_count: 1200,
  open_count: 300,
  reply_count: 25,
  link_click_count: 40,
  bounced_count: 12,
  unsubscribed_count: 3,
  completed_count: 100,
  total_opportunities: 4,
}];

it('sin INSTANTLY_API_KEY → skipped sin tocar la red', async () => {
  vi.stubEnv('INSTANTLY_API_KEY', '');
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  expect(await sync()).toEqual({ skipped: 'sin clave' });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('con clave: pega con Bearer y arma una fila por campaña con fecha de HOY', async () => {
  vi.stubEnv('INSTANTLY_API_KEY', 'inst-key');
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => FIXTURE }));
  vi.stubGlobal('fetch', fetchMock);

  const { filas } = await sync();

  const [url, opts] = fetchMock.mock.calls[0];
  expect(url).toBe('https://api.instantly.ai/api/v2/campaigns/analytics');
  expect(opts.headers.Authorization).toBe('Bearer inst-key');

  expect(filas).toHaveLength(1);
  const f = filas[0];
  expect(f.fuente).toBe('instantly');
  expect(f.campana_ext_id).toBe('01978f2d-a3f5-7ab1-b1c2-000000000001');
  expect(f.campana_ext_nombre).toBe('Estaciones AMBA — tanda 1');
  expect(f.fecha).toBe(hoyISO());
  // Claves core traducidas…
  expect(f.metricas.enviados).toBe(1200);
  expect(f.metricas.abiertos).toBe(300);
  expect(f.metricas.respondieron).toBe(25);
  expect(f.metricas.bounces).toBe(12);
  // …y el resto de los campos de la API tal cual (jsonb flexible).
  expect(f.metricas.leads_count).toBe(500);
  expect(f.metricas.link_click_count).toBe(40);
  expect(f.metricas.total_opportunities).toBe(4);
  // Los campos ya traducidos no se duplican con su nombre original.
  expect('emails_sent_count' in f.metricas).toBe(false);
});

it('respuesta vacía → 0 filas; HTTP no-ok → throw', async () => {
  vi.stubEnv('INSTANTLY_API_KEY', 'inst-key');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
  expect((await sync()).filas).toEqual([]);

  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => 'bad key' })));
  await expect(sync()).rejects.toThrow('Instantly 401');
});
