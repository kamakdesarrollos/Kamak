import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mockeamos dbHelpers para no tocar Supabase: solo nos interesa que los helpers
// de conciliaciones llamen a la vía ATÓMICA (append/patch por ítem) y propaguen
// éxito/falla correctamente.
vi.mock('./dbHelpers', () => ({
  loadSharedData: vi.fn(),
  appendItemInSharedArray: vi.fn(),
  patchItemInSharedArray: vi.fn(),
  removeItemInSharedArray: vi.fn(),
}));

import {
  appendItemInSharedArray,
  patchItemInSharedArray,
} from './dbHelpers';
import {
  crearConciliacion,
  normalizarLineaGuardada,
  guardarConciliacion,
  actualizarConciliacion,
  cerrarConciliacion,
  marcarMovimientoConciliado,
  desmarcarMovimiento,
  CONCILIACIONES_KEY,
} from './conciliaciones';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('crearConciliacion / normalizarLineaGuardada', () => {
  it('crea una conciliación abierta con id y normaliza las líneas', () => {
    const c = crearConciliacion({
      cajaId: 'cj-1', cajaNombre: 'Galicia',
      periodoDesde: '2026-05-01', periodoHasta: '2026-05-31',
      lineas: [{ descripcion: 'Comisión', monto: -1200 }],
    });
    expect(c.id).toMatch(/^conc/);
    expect(c.estado).toBe('abierta');
    expect(c.cajaId).toBe('cj-1');
    expect(c.lineas).toHaveLength(1);
    expect(c.lineas[0].id).toMatch(/^linc/);
    expect(c.lineas[0].descripcion).toBe('Comisión');
    expect(c.lineas[0].monto).toBe(-1200);
    expect(c.lineas[0].estado).toBe('no_coincide'); // default
  });

  it('normalizarLineaGuardada descarta runtime y asegura id', () => {
    const l = normalizarLineaGuardada({ descripcion: 'X', monto: 5, raw: ['a'], candidatos: [1] });
    expect(l.id).toMatch(/^linc/);
    expect(l.raw).toBeUndefined();
    expect(l.candidatos).toBeUndefined();
  });
});

describe('guardarConciliacion — append atómico', () => {
  it('llama a appendItemInSharedArray con la key y devuelve el objeto si se persistió', async () => {
    appendItemInSharedArray.mockResolvedValue(true);
    const conc = { id: 'conc-1', cajaId: 'cj-1' };
    const res = await guardarConciliacion(conc);
    expect(appendItemInSharedArray).toHaveBeenCalledWith(CONCILIACIONES_KEY, conc);
    expect(res).toBe(conc);
  });

  it('devuelve null si la persistencia falló (sin pisar el blob)', async () => {
    appendItemInSharedArray.mockResolvedValue(false);
    const res = await guardarConciliacion({ id: 'conc-2', cajaId: 'cj-1' });
    expect(res).toBeNull();
  });

  it('genera id si la conciliación no lo trae', async () => {
    appendItemInSharedArray.mockResolvedValue(true);
    const res = await guardarConciliacion({ cajaId: 'cj-1' });
    expect(res.id).toMatch(/^conc/);
  });
});

describe('actualizarConciliacion / cerrarConciliacion — patch atómico', () => {
  it('actualizarConciliacion patchea por id', async () => {
    patchItemInSharedArray.mockResolvedValue(true);
    await actualizarConciliacion('conc-1', { nota: 'ok' });
    expect(patchItemInSharedArray).toHaveBeenCalledWith(CONCILIACIONES_KEY, 'conc-1', { nota: 'ok' });
  });

  it('cerrarConciliacion marca estado cerrada con fecha', async () => {
    patchItemInSharedArray.mockResolvedValue(true);
    await cerrarConciliacion('conc-1', { fecha: '2026-06-01' });
    expect(patchItemInSharedArray).toHaveBeenCalledWith(
      CONCILIACIONES_KEY, 'conc-1', { estado: 'cerrada', fecha: '2026-06-01' }
    );
  });
});

describe('marca en el movimiento', () => {
  it('marcarMovimientoConciliado produce el shape de enlace', () => {
    expect(marcarMovimientoConciliado('conc-1', 'linc-9')).toEqual({
      conciliado: true, conciliacionId: 'conc-1', lineaExtractoId: 'linc-9',
    });
  });
  it('desmarcarMovimiento revierte la marca', () => {
    expect(desmarcarMovimiento()).toEqual({
      conciliado: false, conciliacionId: null, lineaExtractoId: null,
    });
  });
});
