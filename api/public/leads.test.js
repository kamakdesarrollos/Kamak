import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../lib/web/supabaseRest.js', () => ({
  applyCors: vi.fn(() => true),
  appendObjectItem: vi.fn(async () => true),
  appendItemInSharedArray: vi.fn(async () => true),
}));

const rest = await import('../../lib/web/supabaseRest.js');
const { default: handler } = await import('./leads.js');

function mockRes() {
  const res = { statusCode: 0, headers: {}, body: null };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}

describe('POST /api/public/leads', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('honeypot → 200 fingido y NO persiste', async () => {
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, body: { _gotcha: 'x', nombre: 'Juan', email: 'a@b.c' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(rest.appendObjectItem).not.toHaveBeenCalled();
  });

  it('faltan datos → 400 sin persistir', async () => {
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, body: { nombre: 'J' } }, res);
    expect(res.statusCode).toBe(400);
    expect(rest.appendObjectItem).not.toHaveBeenCalled();
  });

  it('lead válido → 201 y persiste como lead web', async () => {
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, body: { nombre: 'Juan', telefono: '221', ubicacion: 'La Plata', tipoProyecto: 'Tienda' } }, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(rest.appendObjectItem).toHaveBeenCalledWith('obras', 'obras', expect.objectContaining({ esLead: true, estado: 'en-presupuesto', venta: expect.objectContaining({ origen: 'web' }) }));
    expect(rest.appendItemInSharedArray).toHaveBeenCalledWith('crm_actividades', expect.objectContaining({ tipo: 'nota' }));
  });

  it('método != POST → 405', async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(405);
  });
});
