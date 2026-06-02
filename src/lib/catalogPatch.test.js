import { describe, it, expect } from 'vitest';
import { patchItem, appendItem, removeItem } from './catalogPatch';

// Estas funciones puras son el ESPEJO exacto de lo que hacen las RPC atómicas
// de Supabase (patch_shared_object_item / append_shared_object_item /
// remove_shared_object_item). Probar acá la semántica de merge prueba la
// corrección del fix sin depender de la base.

const base = () => ([
  { id: 't1', nombre: 'Demolición de mampostería de hormigón', materiales: [] },
  { id: 't2', nombre: 'Contrapisos', materiales: [{ nombre: 'Arena', precio: 100 }] },
  { id: 't3', nombre: 'Pintura', materiales: [] },
]);

describe('catalogPatch — patchItem (merge por id)', () => {
  it('mergea el patch en el ítem que matchea por id y deja los demás intactos', () => {
    const out = patchItem(base(), 't1', { materiales: [{ nombre: 'Membrana', precio: 500 }] });
    expect(out.find(t => t.id === 't1').materiales).toEqual([{ nombre: 'Membrana', precio: 500 }]);
    expect(out.find(t => t.id === 't2').materiales).toEqual([{ nombre: 'Arena', precio: 100 }]);
  });

  it('es un merge superficial: conserva las claves no incluidas en el patch', () => {
    const out = patchItem(base(), 't1', { nombre: 'Demolición X' });
    const t1 = out.find(t => t.id === 't1');
    expect(t1.nombre).toBe('Demolición X');
    expect(t1.materiales).toEqual([]); // no se tocó
  });

  it('no muta el array original (inmutable)', () => {
    const arr = base();
    patchItem(arr, 't1', { nombre: 'X' });
    expect(arr.find(t => t.id === 't1').nombre).toBe('Demolición de mampostería de hormigón');
  });

  it('si el id no existe, devuelve la lista igual (no-op)', () => {
    const out = patchItem(base(), 'nope', { nombre: 'X' });
    expect(out).toHaveLength(3);
    expect(out.map(t => t.nombre)).toEqual(base().map(t => t.nombre));
  });

  it('tolera lista vacía o no-array', () => {
    expect(patchItem([], 't1', { a: 1 })).toEqual([]);
    expect(patchItem(undefined, 't1', { a: 1 })).toEqual([]);
  });
});

describe('catalogPatch — appendItem', () => {
  it('agrega el ítem al final', () => {
    const out = appendItem(base(), { id: 't9', nombre: 'Nueva' });
    expect(out).toHaveLength(4);
    expect(out[3].id).toBe('t9');
  });
  it('no muta el original', () => {
    const arr = base();
    appendItem(arr, { id: 't9' });
    expect(arr).toHaveLength(3);
  });
  it('arranca de [] si la lista es null/undefined', () => {
    expect(appendItem(undefined, { id: 't9' })).toEqual([{ id: 't9' }]);
  });
});

describe('catalogPatch — removeItem', () => {
  it('saca el ítem por id', () => {
    const out = removeItem(base(), 't2');
    expect(out.map(t => t.id)).toEqual(['t1', 't3']);
  });
  it('no muta el original', () => {
    const arr = base();
    removeItem(arr, 't2');
    expect(arr).toHaveLength(3);
  });
});

describe('catalogPatch — propiedad de concurrencia (el bug original)', () => {
  it('dos ediciones concurrentes a tareas DISTINTAS ambas sobreviven (cualquier orden)', () => {
    // Mismo escenario que hoy pierde datos con el save del blob entero.
    let server = base();
    // A parchea t1, B parchea t3 — aplicados como patches atómicos.
    server = patchItem(server, 't1', { materiales: [{ nombre: 'Membrana', precio: 500 }] });
    server = patchItem(server, 't3', { materiales: [{ nombre: 'Látex', precio: 800 }] });
    expect(server.find(t => t.id === 't1').materiales).toHaveLength(1);
    expect(server.find(t => t.id === 't3').materiales).toHaveLength(1);

    // Orden inverso: mismo resultado.
    let server2 = base();
    server2 = patchItem(server2, 't3', { materiales: [{ nombre: 'Látex', precio: 800 }] });
    server2 = patchItem(server2, 't1', { materiales: [{ nombre: 'Membrana', precio: 500 }] });
    expect(server2.find(t => t.id === 't1').materiales).toHaveLength(1);
    expect(server2.find(t => t.id === 't3').materiales).toHaveLength(1);
  });
});
