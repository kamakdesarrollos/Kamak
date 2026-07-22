import { it, expect, vi, afterEach } from 'vitest';
import { sync } from './instantly.js';
import { hoyISO } from './comun.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// Forma real de GET /api/v2/campaigns (lista paginada {items}): trae TODAS las
// campañas, incluso borradores nunca lanzados (status 0) que analytics omite.
const LISTA = {
  items: [
    {
      id: '01980000-aaaa-7ab1-b1c2-000000000009',
      name: 'Estaciones 4070 — piloto',
      status: 0, // borrador: nunca lanzada → NO aparece en analytics
      timestamp_created: '2026-07-15T12:34:56.000Z',
    },
    {
      id: '01978f2d-a3f5-7ab1-b1c2-000000000001',
      name: 'Estaciones AMBA — tanda 1',
      status: 1, // activa: también está en analytics → merge
      timestamp_created: '2026-06-01T09:00:00.000Z',
    },
  ],
};

// Forma real de GET /api/v2/campaigns/analytics (acumulado por campaña).
const ANALYTICS = [{
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

// Mock de fetch que rutea por URL a los DOS endpoints (analytics primero:
// su path contiene /campaigns).
const mkFetch = ({ lista = LISTA, analytics = ANALYTICS } = {}) => vi.fn(async (url) => {
  const u = String(url);
  if (u.includes('/campaigns/analytics')) return { ok: true, json: async () => analytics };
  if (u.includes('/campaigns?')) return { ok: true, json: async () => lista };
  throw new Error('URL inesperada ' + u);
});

it('sin INSTANTLY_API_KEY → skipped sin tocar la red', async () => {
  vi.stubEnv('INSTANTLY_API_KEY', '');
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  expect(await sync()).toEqual({ skipped: 'sin clave' });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('con clave: pega a AMBOS endpoints con Bearer y arma una fila por campaña de la LISTA', async () => {
  vi.stubEnv('INSTANTLY_API_KEY', 'inst-key');
  const fetchMock = mkFetch();
  vi.stubGlobal('fetch', fetchMock);

  const r = await sync();

  const urls = fetchMock.mock.calls.map(([u]) => String(u));
  expect(urls).toEqual([
    'https://api.instantly.ai/api/v2/campaigns?limit=100',
    'https://api.instantly.ai/api/v2/campaigns/analytics',
  ]);
  for (const [, opts] of fetchMock.mock.calls) {
    expect(opts.headers.Authorization).toBe('Bearer inst-key');
  }

  // Summary: la lista manda (2 campañas), analytics enriquece (1 con datos).
  expect(r.ok).toBe(true);
  expect(r.campanas).toBe(2);
  expect(r.conAnalytics).toBe(1);
  expect(r.filas).toHaveLength(2);

  // Borrador nunca lanzado: SIN analytics, pero la fila existe igual — antes
  // el módulo solo miraba analytics y el dueño no veía nada.
  const draft = r.filas.find(f => f.campana_ext_id === '01980000-aaaa-7ab1-b1c2-000000000009');
  expect(draft.fuente).toBe('instantly');
  expect(draft.campana_ext_nombre).toBe('Estaciones 4070 — piloto');
  expect(draft.fecha).toBe(hoyISO());
  expect(draft.metricas).toEqual({ estado: 'borrador', creada: '2026-07-15T12:34:56.000Z' });

  // Campaña en AMBOS: estado/creada de la lista + analytics mergeadas.
  const activa = r.filas.find(f => f.campana_ext_id === '01978f2d-a3f5-7ab1-b1c2-000000000001');
  expect(activa.campana_ext_nombre).toBe('Estaciones AMBA — tanda 1');
  expect(activa.metricas.estado).toBe('activa');
  expect(activa.metricas.creada).toBe('2026-06-01T09:00:00.000Z');
  // Claves core traducidas…
  expect(activa.metricas.enviados).toBe(1200);
  expect(activa.metricas.abiertos).toBe(300);
  expect(activa.metricas.respondieron).toBe(25);
  expect(activa.metricas.bounces).toBe(12);
  // …y el resto de los campos de la API tal cual (jsonb flexible).
  expect(activa.metricas.leads_count).toBe(500);
  expect(activa.metricas.link_click_count).toBe(40);
  expect(activa.metricas.total_opportunities).toBe(4);
  // Los campos ya traducidos no se duplican, y la identidad no entra a metricas.
  expect('emails_sent_count' in activa.metricas).toBe(false);
  expect('campaign_id' in activa.metricas).toBe(false);
  expect('campaign_name' in activa.metricas).toBe(false);
});

it('status mapeado a texto; códigos desconocidos quedan como número', async () => {
  vi.stubEnv('INSTANTLY_API_KEY', 'inst-key');
  const lista = {
    items: [
      { id: 'a', name: 'A', status: 2, timestamp_created: '2026-01-01T00:00:00.000Z' },
      { id: 'b', name: 'B', status: 3, timestamp_created: '2026-01-02T00:00:00.000Z' },
      { id: 'c', name: 'C', status: 4, timestamp_created: '2026-01-03T00:00:00.000Z' },
      { id: 'd', name: 'D', status: -99, timestamp_created: '2026-01-04T00:00:00.000Z' },
    ],
  };
  vi.stubGlobal('fetch', mkFetch({ lista, analytics: [] }));
  const { filas } = await sync();
  expect(filas.map(f => f.metricas.estado)).toEqual(['pausada', 'completada', 'corriendo subsecuencias', -99]);
});

it('analytics vacío total (campañas nunca lanzadas) → las filas de la lista salen igual', async () => {
  vi.stubEnv('INSTANTLY_API_KEY', 'inst-key');
  vi.stubGlobal('fetch', mkFetch({ analytics: [] }));
  const r = await sync();
  expect(r).toMatchObject({ ok: true, campanas: 2, conAnalytics: 0 });
  expect(r.filas).toHaveLength(2);
  expect(r.filas.map(f => f.campana_ext_id)).toEqual(LISTA.items.map(i => i.id));
});

it('edge: campaña en analytics pero NO en la lista → fila igual, como antes', async () => {
  vi.stubEnv('INSTANTLY_API_KEY', 'inst-key');
  vi.stubGlobal('fetch', mkFetch({ lista: { items: [] } }));
  const r = await sync();
  expect(r).toMatchObject({ ok: true, campanas: 0, conAnalytics: 1 });
  expect(r.filas).toHaveLength(1);
  const f = r.filas[0];
  expect(f.campana_ext_id).toBe('01978f2d-a3f5-7ab1-b1c2-000000000001');
  expect(f.campana_ext_nombre).toBe('Estaciones AMBA — tanda 1');
  expect(f.metricas.enviados).toBe(1200);
  // Sin datos de lista no hay estado/creada.
  expect('estado' in f.metricas).toBe(false);
});

it('lista paginada: sigue el cursor next_starting_after y corta en el tope de 200', async () => {
  vi.stubEnv('INSTANTLY_API_KEY', 'inst-key');
  const pagina = (desde) => ({
    items: Array.from({ length: 100 }, (_, i) => ({
      id: `c${desde + i}`, name: `C ${desde + i}`, status: 1, timestamp_created: '2026-01-01T00:00:00.000Z',
    })),
    next_starting_after: `c${desde + 99}`, // SIEMPRE hay más → tiene que cortar el tope
  });
  const fetchMock = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/campaigns/analytics')) return { ok: true, json: async () => [] };
    if (u.includes('starting_after=c99')) return { ok: true, json: async () => pagina(100) };
    return { ok: true, json: async () => pagina(0) };
  });
  vi.stubGlobal('fetch', fetchMock);

  const r = await sync();

  const urlsLista = fetchMock.mock.calls.map(([u]) => String(u)).filter(u => u.includes('/campaigns?'));
  expect(urlsLista).toHaveLength(2); // 100 + 100 = tope, no pide una 3ra página
  expect(urlsLista[0]).not.toContain('starting_after');
  expect(urlsLista[1]).toContain('starting_after=c99');
  expect(r.campanas).toBe(200);
  expect(r.filas).toHaveLength(200);
});

it('HTTP no-ok en cualquiera de los dos endpoints → throw', async () => {
  vi.stubEnv('INSTANTLY_API_KEY', 'inst-key');
  // La lista falla → throw (es la primera llamada).
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => 'bad key' })));
  await expect(sync()).rejects.toThrow('Instantly 401');

  // La lista anda pero analytics falla → throw igual.
  vi.stubGlobal('fetch', vi.fn(async (url) => String(url).includes('/campaigns/analytics')
    ? { ok: false, status: 500, text: async () => 'caput' }
    : { ok: true, json: async () => LISTA }));
  await expect(sync()).rejects.toThrow('Instantly 500');
});
