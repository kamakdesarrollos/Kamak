import { vi, describe, it, expect } from 'vitest';

vi.mock('../../lib/web/supabaseRest.js', () => ({
  applyCors: vi.fn(() => true),
  loadSharedData: vi.fn(async () => ({
    obras: [
      { id: 'a', nombre: 'A', estado: 'finalizada', web: { publicar: true, orden: 1 } },
      { id: 'b', nombre: 'B', estado: 'finalizada', web: { publicar: false } },
      { id: 'c', nombre: 'C', estado: 'activa', web: { publicar: true } }, // no finalizada → excluida
      { id: 'd', nombre: 'D' },
    ],
  })),
}));

const { default: handler } = await import('./obras.js');

function mockRes() {
  const res = { statusCode: 0, headers: {}, body: null };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}

describe('GET /api/public/obras', () => {
  it('lista solo las publicadas y no expone el flag interno', async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.obras[0].nombre).toBe('A');
    expect(JSON.stringify(res.body)).not.toContain('publicar');
  });

  it('slug publicado → devuelve la obra', async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: {}, query: { slug: 'a' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.obra.nombre).toBe('A');
  });

  it('slug inexistente / no publicado → 404', async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: {}, query: { slug: 'b' } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('método != GET → 405', async () => {
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(405);
  });
});
