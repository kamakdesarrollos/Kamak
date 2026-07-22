import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('./supabaseRest.js', () => ({
  applyCors: vi.fn(() => true),
  loadSharedData: vi.fn(async () => ({
    obras: [
      { id: 'a', nombre: 'A', estado: 'finalizada', web: { publicar: true, orden: 1 } },
      { id: 'b', nombre: 'B', estado: 'finalizada', web: { publicar: false } },
      { id: 'c', nombre: 'C', estado: 'activa', web: { publicar: true } }, // no finalizada → excluida
    ],
  })),
  appendObjectItem: vi.fn(async () => true),
  appendItemInSharedArray: vi.fn(async () => true),
}));

const rest = await import('./supabaseRest.js');
const { obrasHandler, leadsHandler } = await import('./handlers.js');

function mockRes() {
  const res = { statusCode: 0, headers: {}, body: null };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}

describe('obrasHandler', () => {
  it('lista solo publicadas + finalizadas, sin exponer el flag', async () => {
    const res = mockRes();
    await obrasHandler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.obras[0].nombre).toBe('A');
    expect(JSON.stringify(res.body)).not.toContain('publicar');
  });
  it('slug publicado → la obra; inexistente → 404', async () => {
    const r1 = mockRes(); await obrasHandler({ method: 'GET', headers: {}, query: { slug: 'a' } }, r1);
    expect(r1.statusCode).toBe(200); expect(r1.body.obra.nombre).toBe('A');
    const r2 = mockRes(); await obrasHandler({ method: 'GET', headers: {}, query: { slug: 'b' } }, r2);
    expect(r2.statusCode).toBe(404);
  });
  it('método != GET → 405', async () => {
    const res = mockRes(); await obrasHandler({ method: 'POST', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(405);
  });
});

describe('leadsHandler', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('honeypot → 200 fingido y NO persiste', async () => {
    const res = mockRes();
    await leadsHandler({ method: 'POST', headers: {}, body: { _gotcha: 'x', nombre: 'Juan', email: 'a@b.c' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(rest.appendObjectItem).not.toHaveBeenCalled();
  });
  it('faltan datos → 400 sin persistir', async () => {
    const res = mockRes();
    await leadsHandler({ method: 'POST', headers: {}, body: { nombre: 'J' } }, res);
    expect(res.statusCode).toBe(400);
    expect(rest.appendObjectItem).not.toHaveBeenCalled();
  });
  it('lead válido → 201 y persiste como lead web', async () => {
    const res = mockRes();
    await leadsHandler({ method: 'POST', headers: {}, body: { nombre: 'Juan', telefono: '221', ubicacion: 'La Plata', tipoProyecto: 'Tienda' } }, res);
    expect(res.statusCode).toBe(201);
    expect(rest.appendObjectItem).toHaveBeenCalledWith('obras', 'obras', expect.objectContaining({ esLead: true, venta: expect.objectContaining({ origen: 'web' }) }));
  });
  it('método != POST → 405', async () => {
    const res = mockRes(); await leadsHandler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(405);
  });
});

// Cruce lead web ↔ campañas (QA #21): REST directo vía global fetch (el resto
// de la persistencia va por el mock de supabaseRest.js de arriba). Cada test usa
// una IP propia para no chocar con el rate limit module-level (5 POST/min).
describe('leadsHandler × cruce campañas', () => {
  const body = { nombre: 'Juan', telefono: '02262-15-400137', ubicacion: 'Necochea', tipoProyecto: 'Tienda' };
  let ipN = 0;
  const headers = () => ({ 'x-forwarded-for': `10.0.0.${++ipN}` });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SUPABASE_URL', 'https://sb.test');
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'sk-test');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('teléfono matchea → busca por telefono_norm, 1 actividad por operador único y PATCH acotado a etapas tempranas', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('/camp_estaciones')) {
        return { ok: true, json: async () => [
          { id: 'est-1', operador_id: 'op-1' },
          { id: 'est-2', operador_id: 'op-1' },   // mismo teléfono, mismo operador
          { id: 'est-3', operador_id: 'op-2' },
        ] };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = mockRes();
    await leadsHandler({ method: 'POST', headers: headers(), body }, res);
    expect(res.statusCode).toBe(201);

    const calls = fetchMock.mock.calls.map(([url, opts]) => [String(url), opts || {}]);
    // GET por el teléfono normalizado ('02262-15-400137' → 5492262400137)
    const get = calls.find(([u]) => u.includes('/camp_estaciones'));
    expect(get[0]).toContain('telefono_norm=eq.5492262400137');
    // Una actividad por operador ÚNICO (op-1 deduplicado), colgada de su 1ª estación
    const acts = calls.filter(([u]) => u.includes('/camp_actividades'));
    expect(acts).toHaveLength(2);
    const payloads = acts.map(([, o]) => JSON.parse(o.body));
    expect(payloads.map(p => p.operador_id)).toEqual(['op-1', 'op-2']);
    expect(payloads[0]).toMatchObject({ estacion_id: 'est-1', tipo: 'nota', canal: 'otro', usuario: 'sistema' });
    expect(payloads[0].texto).toContain(`(lead ${res.body.id})`);
    // PATCH a respondio SOLO desde sin_contactar|contactado (filtro en la URL)
    const patches = calls.filter(([, o]) => o.method === 'PATCH');
    expect(patches).toHaveLength(2);
    expect(patches[0][0]).toContain('id=eq.op-1');
    expect(patches[0][0]).toContain('etapa_prospeccion=in.(sin_contactar,contactado)');
    expect(JSON.parse(patches[0][1].body).etapa_prospeccion).toBe('respondio');
  });

  it('teléfono no normalizable → no consulta campañas', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = mockRes();
    await leadsHandler({ method: 'POST', headers: headers(), body: { ...body, telefono: '221' } }, res);
    expect(res.statusCode).toBe(201);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cruce roto (fetch explota) → el alta del lead igual devuelve 201', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
    const res = mockRes();
    await leadsHandler({ method: 'POST', headers: headers(), body }, res);
    expect(res.statusCode).toBe(201);
    expect(rest.appendObjectItem).toHaveBeenCalled();
  });
});
