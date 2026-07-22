import { it, expect, vi, afterEach } from 'vitest';
import { sync } from './clarity.js';
import { hoyISO } from './comun.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// Forma real de project-live-insights: array de {metricName, information[]}.
const FIXTURE = [
  { metricName: 'Traffic', information: [{ totalSessionCount: '412', totalBotSessionCount: '31', distinctUserCount: '388', pagesPerSessionPercentage: 1.8 }] },
  { metricName: 'EngagementTime', information: [{ totalTime: '52000', activeTime: '30500' }] },
  { metricName: 'DeadClickCount', information: [{ subTotal: '14', sessionsWithMetricPercentage: 3.2 }] },
];

it('sin CLARITY_TOKEN → skipped sin tocar la red', async () => {
  vi.stubEnv('CLARITY_TOKEN', '');
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  expect(await sync()).toEqual({ skipped: 'sin clave' });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('con token: UNA fila global (sin campaña) con las métricas crudas del día', async () => {
  vi.stubEnv('CLARITY_TOKEN', 'cl-tok');
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => FIXTURE }));
  vi.stubGlobal('fetch', fetchMock);

  const { filas } = await sync();

  const [url, opts] = fetchMock.mock.calls[0];
  expect(url).toBe('https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=1');
  expect(opts.headers.Authorization).toBe('Bearer cl-tok');

  expect(filas).toHaveLength(1);
  const f = filas[0];
  expect(f.fuente).toBe('clarity');
  expect(f.campana_ext_id).toBeNull();       // global → el upsert lo normaliza a ''
  expect(f.fecha).toBe(hoyISO());
  expect(f.metricas).toEqual({ insights: FIXTURE });   // array envuelto en objeto (jsonb)
});

it('HTTP no-ok → throw', async () => {
  vi.stubEnv('CLARITY_TOKEN', 'cl-tok');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, text: async () => 'forbidden' })));
  await expect(sync()).rejects.toThrow('Clarity 403');
});
