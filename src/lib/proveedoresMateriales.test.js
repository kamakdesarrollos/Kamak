import { describe, it, expect } from 'vitest';
import {
  PROVEEDORES,
  proveedorDeRubro,
  proveedorDeMaterial,
  labelProveedor,
  colorProveedor,
} from './proveedoresMateriales';

describe('PROVEEDORES — catálogo de proveedores tipo', () => {
  it('son 14 proveedores tipo', () => {
    expect(PROVEEDORES).toHaveLength(14);
  });
  it('cada uno tiene id (kebab-case), label y color distinto', () => {
    const ids = new Set();
    const colors = new Set();
    for (const p of PROVEEDORES) {
      expect(typeof p.id).toBe('string');
      expect(p.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/); // kebab-case estable
      expect(typeof p.label).toBe('string');
      expect(p.label.length).toBeGreaterThan(0);
      expect(typeof p.color).toBe('string');
      expect(p.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      ids.add(p.id);
      colors.add(p.color);
    }
    expect(ids.size).toBe(14); // ids únicos
    expect(colors.size).toBe(14); // colores únicos
  });
  it('incluye los 14 labels aprobados', () => {
    const labels = PROVEEDORES.map((p) => p.label);
    for (const l of [
      'Corralón de materiales',
      'Casa de electricidad',
      'Sanitarios / Plomería',
      'Casa de revestimientos',
      'Pinturería',
      'Aberturas',
      'Maderera / Carpintería',
      'Vidriería',
      'Marmolería',
      'Construcción en seco',
      'Climatización / Equipamiento',
      'Ferretería / Herrajes',
      'Mobiliario (San Francisco)',
      'Servicios / Otros',
    ]) {
      expect(labels).toContain(l);
    }
  });
});

describe('proveedorDeRubro — mapea rubro real → proveedor tipo', () => {
  it('Corralón de materiales (varios rubros reales)', () => {
    expect(proveedorDeRubro('Hierros, Mallas, Alambres, Tornillos, Clavos y Cercos.')).toBe('Corralón de materiales');
    expect(proveedorDeRubro('Aditivos, Impermeabilizaciones y Aislaciones')).toBe('Corralón de materiales');
    expect(proveedorDeRubro('Chapas, Tejas y Losas')).toBe('Corralón de materiales');
    expect(proveedorDeRubro('Ladrillos y Bloques')).toBe('Corralón de materiales');
    expect(proveedorDeRubro('Zingueria')).toBe('Corralón de materiales');
    expect(proveedorDeRubro('Agregados (Costos por m3)')).toBe('Corralón de materiales');
    expect(proveedorDeRubro('Tierra, Tosca y Suelos para Rellenos')).toBe('Corralón de materiales');
    expect(proveedorDeRubro('Yeseria')).toBe('Corralón de materiales');
  });
  it('Casa de electricidad', () => {
    expect(proveedorDeRubro('Instalaciones Eléctricas')).toBe('Casa de electricidad');
    expect(proveedorDeRubro('ELECTRICIDAD ALTERNATIVA')).toBe('Casa de electricidad');
    expect(proveedorDeRubro('Energías Renovables')).toBe('Casa de electricidad');
    expect(proveedorDeRubro('15 - Instalación eléctrica')).toBe('Casa de electricidad');
  });
  it('Sanitarios / Plomería', () => {
    expect(proveedorDeRubro('Instalaciones Sanitarias (Agua)')).toBe('Sanitarios / Plomería');
    expect(proveedorDeRubro('Instalaciones Sanitarias (Desagües)')).toBe('Sanitarios / Plomería');
    expect(proveedorDeRubro('Artefactos, Griferias y Accesorios Sanitarios')).toBe('Sanitarios / Plomería');
    expect(proveedorDeRubro('Instalaciones de Gas y Reguladores')).toBe('Sanitarios / Plomería');
  });
  it('Casa de revestimientos', () => {
    expect(proveedorDeRubro('Pisos y Revestimientos')).toBe('Casa de revestimientos');
    expect(proveedorDeRubro('Revestimientos Texturados')).toBe('Casa de revestimientos');
  });
  it('Pinturería', () => {
    expect(proveedorDeRubro('Pinturas')).toBe('Pinturería');
  });
  it('Aberturas', () => {
    expect(proveedorDeRubro('Carpinterías de Aluminio')).toBe('Aberturas');
    expect(proveedorDeRubro('Carpinterías de PVC')).toBe('Aberturas');
    expect(proveedorDeRubro('Carpinterías Metálicas')).toBe('Aberturas');
  });
  it('Maderera / Carpintería', () => {
    expect(proveedorDeRubro('Maderas')).toBe('Maderera / Carpintería');
    expect(proveedorDeRubro('Carpinterías de Madera')).toBe('Maderera / Carpintería');
  });
  it('Vidriería', () => {
    expect(proveedorDeRubro('Cristales, Vidrios y Espejos')).toBe('Vidriería');
  });
  it('Marmolería', () => {
    expect(proveedorDeRubro('Mármoles y Granitos')).toBe('Marmolería');
    expect(proveedorDeRubro('Piedras')).toBe('Marmolería');
  });
  it('Construcción en seco', () => {
    expect(proveedorDeRubro('Construcción en Seco y Steel Framing')).toBe('Construcción en seco');
  });
  it('Climatización / Equipamiento', () => {
    expect(proveedorDeRubro('Equipamiento')).toBe('Climatización / Equipamiento');
    expect(proveedorDeRubro('Sistemas de Calefacción')).toBe('Climatización / Equipamiento');
  });
  it('Ferretería / Herrajes', () => {
    expect(proveedorDeRubro('Herramientas (Ventas)')).toBe('Ferretería / Herrajes');
    expect(proveedorDeRubro('Herrajes')).toBe('Ferretería / Herrajes');
  });
  it('Mobiliario (San Francisco)', () => {
    expect(proveedorDeRubro('Mobiliario San Francisco')).toBe('Mobiliario (San Francisco)');
    expect(proveedorDeRubro('Mobiliario Super7')).toBe('Mobiliario (San Francisco)');
    expect(proveedorDeRubro('Mobiliario Shop Express')).toBe('Mobiliario (San Francisco)');
    expect(proveedorDeRubro('Amoblamiento para Cocinas, Placares y Vestidores')).toBe('Mobiliario (San Francisco)');
  });
  it('Servicios / Otros', () => {
    expect(proveedorDeRubro('Herramientas y Servicios (Alquiler)')).toBe('Servicios / Otros');
    expect(proveedorDeRubro('46 - GRAFICA')).toBe('Servicios / Otros');
    expect(proveedorDeRubro('47 - LOGISTICA')).toBe('Servicios / Otros');
  });

  it('tolera acentos/mayúsculas: "instalaciones electricas" === "Instalaciones Eléctricas"', () => {
    expect(proveedorDeRubro('instalaciones electricas')).toBe('Casa de electricidad');
    expect(proveedorDeRubro('INSTALACIONES ELÉCTRICAS')).toBe('Casa de electricidad');
    expect(proveedorDeRubro('marmoles y granitos')).toBe('Marmolería');
    expect(proveedorDeRubro('  Pinturas  ')).toBe('Pinturería'); // espacios sobrantes
  });

  it('rubro desconocido → Otros', () => {
    expect(proveedorDeRubro('Rubro que no existe')).toBe('Otros');
    expect(proveedorDeRubro('')).toBe('Otros');
    expect(proveedorDeRubro(null)).toBe('Otros');
    expect(proveedorDeRubro(undefined)).toBe('Otros');
  });

  it('el rubro MIXTO de cementos NO se resuelve por rubro solo', () => {
    // Sin material no se puede partir: cae al default del partidor (Corralón).
    expect(proveedorDeRubro('Cales, Cementos, Finos, Pegamentos, Pastina y Hormigones')).toBe('Corralón de materiales');
  });
});

describe('proveedorDeMaterial — usa material.rubro y parte el rubro mixto por nombre', () => {
  it('material normal usa su rubro', () => {
    expect(proveedorDeMaterial({ rubro: 'Pinturas', nombre: 'Látex interior x20L' })).toBe('Pinturería');
    expect(proveedorDeMaterial({ rubro: 'Instalaciones Eléctricas', nombre: 'Cable 2.5mm' })).toBe('Casa de electricidad');
  });

  it('rubro MIXTO de cementos: keywords de obra gruesa → Corralón de materiales', () => {
    const mixto = 'Cales, Cementos, Finos, Pegamentos, Pastina y Hormigones';
    expect(proveedorDeMaterial({ rubro: mixto, nombre: 'Cemento Portland x50kg' })).toBe('Corralón de materiales');
    expect(proveedorDeMaterial({ rubro: mixto, nombre: 'Cal hidratada x25kg' })).toBe('Corralón de materiales');
    expect(proveedorDeMaterial({ rubro: mixto, nombre: 'Hormigón elaborado H21' })).toBe('Corralón de materiales');
    expect(proveedorDeMaterial({ rubro: mixto, nombre: 'Mortero de asiento' })).toBe('Corralón de materiales');
  });

  it('rubro MIXTO de cementos: keywords de terminación → Casa de revestimientos', () => {
    const mixto = 'Cales, Cementos, Finos, Pegamentos, Pastina y Hormigones';
    expect(proveedorDeMaterial({ rubro: mixto, nombre: 'Pegamento Klaukol x30kg' })).toBe('Casa de revestimientos');
    expect(proveedorDeMaterial({ rubro: mixto, nombre: 'Pastina blanca x5kg' })).toBe('Casa de revestimientos');
    expect(proveedorDeMaterial({ rubro: mixto, nombre: 'Adhesivo para porcelanato' })).toBe('Casa de revestimientos');
    expect(proveedorDeMaterial({ rubro: mixto, nombre: 'Fino para enlucido' })).toBe('Casa de revestimientos');
  });

  it('rubro MIXTO sin keyword reconocible → default Corralón de materiales', () => {
    const mixto = 'Cales, Cementos, Finos, Pegamentos, Pastina y Hormigones';
    expect(proveedorDeMaterial({ rubro: mixto, nombre: 'Producto cualquiera' })).toBe('Corralón de materiales');
    expect(proveedorDeMaterial({ rubro: mixto, nombre: '' })).toBe('Corralón de materiales');
  });

  it('mixto tolera acentos en el rubro de entrada', () => {
    const mixtoMin = 'cales, cementos, finos, pegamentos, pastina y hormigones';
    expect(proveedorDeMaterial({ rubro: mixtoMin, nombre: 'Pegamento Klaukol' })).toBe('Casa de revestimientos');
    expect(proveedorDeMaterial({ rubro: mixtoMin, nombre: 'Cemento Portland' })).toBe('Corralón de materiales');
  });

  it('material de rubro desconocido → Otros', () => {
    expect(proveedorDeMaterial({ rubro: 'XYZ', nombre: 'algo' })).toBe('Otros');
  });

  it('tolera material null/sin rubro', () => {
    expect(proveedorDeMaterial(null)).toBe('Otros');
    expect(proveedorDeMaterial({})).toBe('Otros');
    expect(proveedorDeMaterial({ nombre: 'sin rubro' })).toBe('Otros');
  });
});

describe('proveedorDeMaterial — el grupo GUARDADO a mano gana sobre el rubro', () => {
  it('grupo guardado (label) pisa al rubro: rubro Pinturas pero grupo Aberturas → Aberturas', () => {
    // El rubro mapearía a Pinturería, pero el usuario eligió Aberturas a mano.
    expect(proveedorDeMaterial({ rubro: 'Pinturas', nombre: 'algo', grupo: 'Aberturas' })).toBe('Aberturas');
  });

  it('grupo guardado como id (kebab) → devuelve el label canónico', () => {
    // 'corralon' es el id; debe devolver el label 'Corralón de materiales'.
    expect(proveedorDeMaterial({ rubro: 'Pinturas', nombre: 'algo', grupo: 'corralon' })).toBe('Corralón de materiales');
    expect(proveedorDeMaterial({ rubro: 'Maderas', nombre: 'algo', grupo: 'sanitarios' })).toBe('Sanitarios / Plomería');
  });

  it('grupo guardado como label tolera acentos/mayúsculas y devuelve el canónico', () => {
    expect(proveedorDeMaterial({ rubro: 'Pinturas', nombre: 'algo', grupo: 'sanitarios / plomeria' })).toBe('Sanitarios / Plomería');
    expect(proveedorDeMaterial({ rubro: 'Pinturas', nombre: 'algo', grupo: '  Marmolería  ' })).toBe('Marmolería');
  });

  it('grupo guardado pisa incluso al rubro MIXTO de cementos', () => {
    const mixto = 'Cales, Cementos, Finos, Pegamentos, Pastina y Hormigones';
    // Sin grupo, "Cemento Portland" iría a Corralón; con grupo elegido manda el grupo.
    expect(proveedorDeMaterial({ rubro: mixto, nombre: 'Cemento Portland', grupo: 'Pinturería' })).toBe('Pinturería');
  });

  it('grupo guardado que NO es de los 14 pero es string no vacío → se respeta tal cual', () => {
    expect(proveedorDeMaterial({ rubro: 'Pinturas', nombre: 'algo', grupo: 'Proveedor a medida' })).toBe('Proveedor a medida');
  });

  it('grupo guardado funciona aunque el material NO tenga rubro', () => {
    expect(proveedorDeMaterial({ nombre: 'sin rubro', grupo: 'Vidriería' })).toBe('Vidriería');
    expect(proveedorDeMaterial({ grupo: 'vidrieria' })).toBe('Vidriería');
  });

  it('grupo vacío / no string → se ignora y se deriva del rubro (comportamiento actual)', () => {
    expect(proveedorDeMaterial({ rubro: 'Pinturas', nombre: 'algo', grupo: '' })).toBe('Pinturería');
    expect(proveedorDeMaterial({ rubro: 'Pinturas', nombre: 'algo', grupo: '   ' })).toBe('Pinturería');
    expect(proveedorDeMaterial({ rubro: 'Pinturas', nombre: 'algo', grupo: null })).toBe('Pinturería');
    expect(proveedorDeMaterial({ rubro: 'Pinturas', nombre: 'algo', grupo: undefined })).toBe('Pinturería');
  });

  it('sin grupo → deriva del rubro como hasta ahora (no rompe el comportamiento previo)', () => {
    expect(proveedorDeMaterial({ rubro: 'Instalaciones Eléctricas', nombre: 'Cable 2.5mm' })).toBe('Casa de electricidad');
    const mixto = 'Cales, Cementos, Finos, Pegamentos, Pastina y Hormigones';
    expect(proveedorDeMaterial({ rubro: mixto, nombre: 'Pegamento Klaukol' })).toBe('Casa de revestimientos');
  });
});

describe('helpers labelProveedor / colorProveedor', () => {
  it('labelProveedor(id) → label', () => {
    const p = PROVEEDORES[0];
    expect(labelProveedor(p.id)).toBe(p.label);
  });
  it('colorProveedor(label) → color del proveedor', () => {
    const p = PROVEEDORES.find((x) => x.label === 'Pinturería');
    expect(colorProveedor('Pinturería')).toBe(p.color);
  });
  it('colorProveedor acepta también id', () => {
    const p = PROVEEDORES.find((x) => x.label === 'Pinturería');
    expect(colorProveedor(p.id)).toBe(p.color);
  });
  it('label/color desconocido devuelven fallback estable (no rompen)', () => {
    expect(typeof colorProveedor('no-existe')).toBe('string');
    expect(colorProveedor('no-existe')).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(typeof labelProveedor('no-existe')).toBe('string');
  });
});
