import { vi, describe, it, expect, beforeEach } from 'vitest';

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
