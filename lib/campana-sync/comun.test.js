import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hoyISO, diasAtrasISO, clampFechaISO, upsertMetricas } from './comun.js';

const ISO_DIA = /^\d{4}-\d{2}-\d{2}$/;

describe('fechas', () => {
  it('hoyISO / diasAtrasISO devuelven yyyy-mm-dd y diasAtras es anterior a hoy', () => {
    expect(hoyISO()).toMatch(ISO_DIA);
    expect(diasAtrasISO(1)).toMatch(ISO_DIA);
    expect(diasAtrasISO(1) < hoyISO()).toBe(true);
    expect(diasAtrasISO(3) < diasAtrasISO(1)).toBe(true);
  });

  it('clampFechaISO: válida pasa, inválida cae al fallback, futura se clampea a hoy', () => {
    expect(clampFechaISO('2026-07-01', '2026-01-01')).toBe('2026-07-01');
    expect(clampFechaISO(undefined, '2026-01-01')).toBe('2026-01-01');
    expect(clampFechaISO('21/07/2026', '2026-01-01')).toBe('2026-01-01');
    expect(clampFechaISO('2999-01-01', '2026-01-01')).toBe(hoyISO());
    expect(clampFechaISO('nope')).toBe(hoyISO());        // fallback default = hoy
  });
});

describe('upsertMetricas', () => {
  let fetchMock;
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://demo.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'service-key-123');
    fetchMock = vi.fn(async () => ({ ok: true, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const fila = (extra = {}) => ({
    fuente: 'instantly', campana_ext_id: 'c-1', campana_ext_nombre: 'Camp', fecha: '2026-07-21',
    metricas: { enviados: 10 }, ...extra,
  });

  it('POSTea a camp_metricas con on_conflict de columnas y Prefer merge-duplicates + service key', async () => {
    const n = await upsertMetricas([fila()]);
    expect(n).toBe(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://demo.supabase.co/rest/v1/camp_metricas?on_conflict=fuente,campana_ext_id,fecha');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Prefer).toContain('resolution=merge-duplicates');
    expect(opts.headers.apikey).toBe('service-key-123');
    expect(opts.headers.Authorization).toBe('Bearer service-key-123');
  });

  it('normaliza campana_ext_id null/undefined → "" y manda SIEMPRE updated_at nuevo', async () => {
    await upsertMetricas([
      fila({ campana_ext_id: null }),
      fila({ campana_ext_id: undefined, fuente: 'gsc' }),
    ]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toHaveLength(2);
    for (const f of body) {
      expect(f.campana_ext_id).toBe('');
      expect(new Date(f.updated_at).toString()).not.toBe('Invalid Date');
    }
  });

  it('sin lista_id en ninguna fila NO manda la columna (no pisa links puestos a mano); con lista_id la manda', async () => {
    await upsertMetricas([fila()]);
    const sinLista = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect('lista_id' in sinLista[0]).toBe(false);

    await upsertMetricas([fila({ lista_id: 'lst-1' }), fila({ campana_ext_id: 'c-2' })]);
    const conLista = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(conLista[0].lista_id).toBe('lst-1');
    expect(conLista[1].lista_id).toBeNull();   // bulk insert: mismas keys en todas
  });

  it('deduplica dentro del batch por (fuente, campana_ext_id, fecha) — gana la última', async () => {
    const n = await upsertMetricas([
      fila({ metricas: { enviados: 1 } }),
      fila({ metricas: { enviados: 99 } }),      // misma key → pisaría 2 veces en el insert
    ]);
    expect(n).toBe(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toHaveLength(1);
    expect(body[0].metricas.enviados).toBe(99);
  });

  it('lista vacía → 0 sin tocar la red; filas sin fuente/fecha se saltean', async () => {
    expect(await upsertMetricas([])).toBe(0);
    expect(await upsertMetricas(undefined)).toBe(0);
    expect(await upsertMetricas([{ metricas: {} }])).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('HTTP no-ok → throw con status (el dispatcher lo anota como error de la fuente)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, text: async () => 'conflicto' });
    await expect(upsertMetricas([fila()])).rejects.toThrow('409');
  });

  it('sin SUPABASE_URL / SERVICE_KEY → throw claro', async () => {
    vi.stubEnv('SUPABASE_SERVICE_KEY', '');
    await expect(upsertMetricas([fila()])).rejects.toThrow(/Supabase sin configurar/);
  });
});
