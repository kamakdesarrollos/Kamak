import { describe, it, expect } from 'vitest';
import { patchItem, appendItem, removeItem, patchObjItem, appendObjItem, removeObjItem } from './catalogPatch';

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

// ── Mutación a nivel OBJETO (data = { coleccionA: [...], coleccionB: [...] }) ──
// Espejo exacto de patch_/append_/remove_shared_object_item. Estas funciones son
// el fallback read-modify-write de los helpers genéricos (patchObjectItem, etc.)
// para keys como 'proveedores' ({proveedores, ccEntries}) y 'movimientos'
// ({cajas, movimientos}). La propiedad CRÍTICA que prueban: tocar una colección
// NO pisa la otra — exactamente el bug PROV-CC-001 (la app pisaba los asientos de
// CC que el bot escribió atómicamente).
const obj = () => ({
  proveedores: [
    { id: 'p1', nombre: 'Leandro' },
    { id: 'p2', nombre: 'Don Luis' },
  ],
  ccEntries: [
    { id: 'cc1', proveedorId: 'p1', debe: 2500000, haber: 0 },
    { id: 'cc2', proveedorId: 'p1', debe: 0, haber: 500000 },
  ],
});

describe('catalogPatch — patchObjItem (objeto con colecciones)', () => {
  it('parchea el ítem de la colección por id y NO toca la otra colección', () => {
    const out = patchObjItem(obj(), 'proveedores', 'p1', { nombre: 'Leandro V.' });
    expect(out.proveedores.find(p => p.id === 'p1').nombre).toBe('Leandro V.');
    expect(out.proveedores.find(p => p.id === 'p2').nombre).toBe('Don Luis');
    expect(out.ccEntries).toHaveLength(2); // la CC quedó intacta
  });

  it('merge superficial: conserva las claves no incluidas', () => {
    const out = patchObjItem(obj(), 'ccEntries', 'cc1', { debe: 3000000 });
    const cc1 = out.ccEntries.find(e => e.id === 'cc1');
    expect(cc1.debe).toBe(3000000);
    expect(cc1.proveedorId).toBe('p1'); // no se tocó
  });

  it('no muta el objeto original', () => {
    const o = obj();
    patchObjItem(o, 'proveedores', 'p1', { nombre: 'X' });
    expect(o.proveedores.find(p => p.id === 'p1').nombre).toBe('Leandro');
  });

  it('tolera colección ausente (la crea vacía sin romper)', () => {
    const out = patchObjItem({ proveedores: [] }, 'ccEntries', 'cc1', { debe: 1 });
    expect(out.ccEntries).toEqual([]);
    expect(out.proveedores).toEqual([]);
  });
});

describe('catalogPatch — appendObjItem', () => {
  it('agrega a la colección indicada sin tocar la otra', () => {
    const out = appendObjItem(obj(), 'ccEntries', { id: 'cc3', debe: 100, haber: 0 });
    expect(out.ccEntries).toHaveLength(3);
    expect(out.ccEntries[2].id).toBe('cc3');
    expect(out.proveedores).toHaveLength(2); // intacta
  });
  it('arranca de [] si la colección no existía', () => {
    const out = appendObjItem({ proveedores: [] }, 'ccEntries', { id: 'cc1' });
    expect(out.ccEntries).toEqual([{ id: 'cc1' }]);
  });
});

describe('catalogPatch — removeObjItem', () => {
  it('saca el ítem por id de la colección, deja la otra intacta', () => {
    const out = removeObjItem(obj(), 'ccEntries', 'cc1');
    expect(out.ccEntries.map(e => e.id)).toEqual(['cc2']);
    expect(out.proveedores).toHaveLength(2);
  });
});

describe('catalogPatch — concurrencia app↔bot (PROV-CC-001)', () => {
  it('la app edita un proveedor mientras el bot agrega un asiento de CC: ambos sobreviven', () => {
    // Escenario real del bug: el bot cargó una certificación (cc3) atómicamente;
    // la app, con el objeto viejo en memoria, editaba un proveedor. Con el blob
    // entero, el save de la app pisaba cc3. Con mutación por colección, no.
    let server = obj();
    // BOT: append atómico de un asiento de CC (DEBE de una certificación).
    server = appendObjItem(server, 'ccEntries', { id: 'cc3', proveedorId: 'p2', debe: 625000, haber: 0 });
    // APP: edita el nombre de un proveedor (otra colección) — atómico por id.
    server = patchObjItem(server, 'proveedores', 'p1', { nombre: 'Leandro Vázquez' });
    // El asiento del bot NO se perdió y la edición de la app se aplicó.
    expect(server.ccEntries.find(e => e.id === 'cc3')).toBeTruthy();
    expect(server.proveedores.find(p => p.id === 'p1').nombre).toBe('Leandro Vázquez');

    // Orden inverso (app primero, bot después): mismo resultado.
    let server2 = obj();
    server2 = patchObjItem(server2, 'proveedores', 'p1', { nombre: 'Leandro Vázquez' });
    server2 = appendObjItem(server2, 'ccEntries', { id: 'cc3', proveedorId: 'p2', debe: 625000, haber: 0 });
    expect(server2.ccEntries.find(e => e.id === 'cc3')).toBeTruthy();
    expect(server2.proveedores.find(p => p.id === 'p1').nombre).toBe('Leandro Vázquez');
  });
});
