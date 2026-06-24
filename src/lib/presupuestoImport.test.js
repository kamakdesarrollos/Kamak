import { describe, it, expect } from 'vitest';
import { detectarColumnas, mapearColumnas, normalizarItems, itemsATareas, montoContrato, avanceContrato, matchProveedor, subtotalFila, tareasDeObra } from './presupuestoImport';

describe('detectarColumnas', () => {
  it('reconoce encabezados típicos en español', () => {
    const header = ['Descripción', 'Cant.', 'Precio Unitario', 'Unidad'];
    expect(detectarColumnas(header)).toEqual({ nombre: 0, cantidad: 1, costo: 2, unidad: 3 });
  });
  it('devuelve -1 para columnas que no encuentra', () => {
    const header = ['Item', 'Total'];
    const m = detectarColumnas(header);
    expect(m.nombre).toBe(0);
    expect(m.cantidad).toBe(-1);
    expect(m.unidad).toBe(-1);
  });
});

describe('mapearColumnas', () => {
  it('proyecta filas a items según el mapping', () => {
    const rows = [['Plancha Braf', '1', '185000', 'u'], ['Freidora Braf', '1', '210000', 'u']];
    const mapping = { nombre: 0, cantidad: 1, costo: 2, unidad: 3 };
    expect(mapearColumnas(rows, mapping)).toEqual([
      { nombre: 'Plancha Braf', cantidad: '1', costo: '185000', unidad: 'u' },
      { nombre: 'Freidora Braf', cantidad: '1', costo: '210000', unidad: 'u' },
    ]);
  });
  it('usa cadena vacía cuando un índice es -1', () => {
    const rows = [['Plancha', '185000']];
    const mapping = { nombre: 0, costo: 1, cantidad: -1, unidad: -1 };
    expect(mapearColumnas(rows, mapping)).toEqual([{ nombre: 'Plancha', costo: '185000', cantidad: '', unidad: '' }]);
  });
});

describe('normalizarItems', () => {
  it('coerce números, cantidad default 1, parsea miles AR', () => {
    const out = normalizarItems([{ nombre: 'Plancha', costo: '185.000', cantidad: '', unidad: 'u' }]);
    expect(out).toEqual([{ nombre: 'Plancha', costo: 185000, cantidad: 1, unidad: 'u' }]);
  });
  it('descarta filas sin nombre o sin costo > 0', () => {
    const out = normalizarItems([
      { nombre: '', costo: '100', cantidad: '1', unidad: '' },
      { nombre: 'Subtotal', costo: '0', cantidad: '1', unidad: '' },
      { nombre: 'Horno', costo: '50000', cantidad: '2', unidad: 'u' },
    ]);
    expect(out).toEqual([{ nombre: 'Horno', costo: 50000, cantidad: 2, unidad: 'u' }]);
  });
});

describe('itemsATareas', () => {
  it('mapea costo→costoSub, costoMat 0, linkea contratoId', () => {
    let n = 0;
    const tareas = itemsATareas(
      [{ nombre: 'Plancha', costo: 185000, cantidad: 1, unidad: 'u' }],
      { contratoId: 'ct-9', makeId: () => `id-${++n}` }
    );
    expect(tareas).toEqual([{
      id: 'id-1', codigo: '', nombre: 'Plancha', unidad: 'u', cantidad: 1,
      costoMat: 0, costoSub: 185000, contratoId: 'ct-9', fuente: 'Presupuesto',
      receta: { materiales: [] }, avance: 0,
    }]);
  });
});

const tareasMulti = [
  { id: 't1', contratoId: 'A', costoSub: 100, cantidad: 2, avance: 50 }, // 200, ejecutado 100
  { id: 't2', contratoId: 'A', costoSub: 50,  cantidad: 1, avance: 0 },  // 50,  ejecutado 0
  { id: 't3', contratoId: 'B', costoSub: 999, cantidad: 1, avance: 100 },// otro contrato
  { id: 't4', costoSub: 30, cantidad: 1, avance: 100 },                  // manual, sin contrato
];

describe('montoContrato', () => {
  it('suma costoSub*cantidad solo de SU contrato (no se pisa con otros)', () => {
    expect(montoContrato('A', tareasMulti)).toBe(250);
    expect(montoContrato('B', tareasMulti)).toBe(999);
  });
});

describe('avanceContrato', () => {
  it('avance ponderado por costo de sus tareas', () => {
    expect(avanceContrato('A', tareasMulti)).toBe(40); // 100/250
  });
  it('0 si el contrato no tiene tareas', () => {
    expect(avanceContrato('Z', tareasMulti)).toBe(0);
  });
});

describe('subtotalFila', () => {
  it('multiplica costo por cantidad, parsea miles AR del costo', () => {
    // "185.000" en formato AR es 185000, no 185 → el subtotal con cantidad 2 es 370000.
    expect(subtotalFila({ costo: '185.000', cantidad: '2' })).toBe(370000);
  });
  it('cantidad vacía o inválida cuenta como 1', () => {
    expect(subtotalFila({ costo: '50000', cantidad: '' })).toBe(50000);
    expect(subtotalFila({ costo: '50000', cantidad: 'abc' })).toBe(50000);
  });
  it('0 si el costo no es numérico', () => {
    expect(subtotalFila({ costo: '', cantidad: '3' })).toBe(0);
  });
  it('acepta costo numérico ya parseado', () => {
    expect(subtotalFila({ costo: 1000, cantidad: 3 })).toBe(3000);
  });
});

describe('tareasDeObra', () => {
  it('aplana las tareas de todos los rubros del detalle', () => {
    const detalle = {
      rubros: [
        { id: 'r1', tareas: [{ id: 'a', contratoId: 'A' }, { id: 'b', contratoId: 'A' }] },
        { id: 'r2', tareas: [{ id: 'c', contratoId: 'B' }] },
        { id: 'r3' }, // rubro sin tareas
      ],
    };
    expect(tareasDeObra(detalle).map(t => t.id)).toEqual(['a', 'b', 'c']);
  });
  it('devuelve [] con detalle vacío o sin rubros', () => {
    expect(tareasDeObra(null)).toEqual([]);
    expect(tareasDeObra({})).toEqual([]);
  });
  it('2 adjuntos en el MISMO rubro → 2 contratos cuyo monto/avance NO se pisan', () => {
    // Escenario "Equipamiento gastronómico" de la spec: 1 rubro, 2 adjuntos
    // (2 proveedores) → 2 contratos. Las tareas viven anidadas en el rubro y se
    // distinguen sólo por contratoId. El monto/avance de cada contrato se deriva
    // SOLO de sus tareas.
    const detalle = {
      rubros: [{
        id: 'r1',
        tareas: [
          { id: 't1', contratoId: 'CT-A', costoSub: 185000, cantidad: 1, avance: 100 },
          { id: 't2', contratoId: 'CT-A', costoSub: 210000, cantidad: 1, avance: 0 },
          { id: 't3', contratoId: 'CT-B', costoSub: 50000,  cantidad: 2, avance: 50 },
        ],
      }],
    };
    const tareasObra = tareasDeObra(detalle);
    expect(montoContrato('CT-A', tareasObra)).toBe(395000);
    expect(montoContrato('CT-B', tareasObra)).toBe(100000);
    // CT-A: ejecutado 185000/395000 ≈ 47%
    expect(avanceContrato('CT-A', tareasObra)).toBe(47);
    // CT-B: una sola tarea al 50% → 50%
    expect(avanceContrato('CT-B', tareasObra)).toBe(50);
  });
});

describe('matchProveedor', () => {
  const provs = [
    { id: 'p1', nombre: 'Grupo Braf SA', cuit: '30-11111111-1' },
    { id: 'p2', nombre: 'Turbo Blender', cuit: '30-22222222-2' },
  ];
  it('matchea por CUIT exacto', () => {
    expect(matchProveedor('cualquier cosa', '30-22222222-2', provs)?.id).toBe('p2');
  });
  it('matchea por nombre normalizado si no hay CUIT', () => {
    expect(matchProveedor('grupo braf sa', null, provs)?.id).toBe('p1');
  });
  it('null si no encuentra', () => {
    expect(matchProveedor('Otro Proveedor', null, provs)).toBeNull();
  });
});
