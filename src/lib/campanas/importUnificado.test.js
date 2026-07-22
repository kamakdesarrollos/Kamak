import { describe, it, expect } from 'vitest';
import { planImportUnificado } from './importUnificado.js';

// Fixtures inline con la forma EXACTA que devuelve XLSX.utils.sheet_to_json
// sobre el Unificado real: columnas Bandera, Estacion, Direccion, Localidad,
// Provincia, Operador, Telefono, Email, Web, Decisor, Cargo, LinkedIn_decisor,
// LinkedIn_empresa, Confianza, APIES + columna de estado sucia con nombre variable.

const vacios = { operadores: [], estaciones: [], decisores: [] };

describe('planImportUnificado — agrupación y alta', () => {
  it('agrupa multi-estación de un operador (nombre con tildes/espacios distintos) y separa entidades', () => {
    const rows = [
      {
        Bandera: 'PUMA', Estacion: 'Estación Norte', Direccion: 'Ruta 2 km 10',
        Localidad: 'Dolores', Provincia: 'Buenos Aires', Operador: 'Grupo Pérez SRL',
        Telefono: '02262-15-530944', Email: 'ventas@perez.com', APIES: '1001',
        ESTADO: 'NO ATIENDE',
      },
      {
        Bandera: 'Puma', Estacion: 'Estación Sur', Direccion: 'Av. 2 nro 300',
        Localidad: 'Miramar', Provincia: 'Buenos Aires', Operador: 'grupo  perez srl',
        Telefono: '011 4444-5555', Email: 'admin@perez.com; ventas@perez.com',
        Web: 'https://perez.com', APIES: 1002,
        ESTADO: 'ME PASO EL MAIL',
      },
    ];
    const plan = planImportUnificado(rows, { existentes: vacios });
    expect(plan.operadores).toHaveLength(1);
    expect(plan.operadores[0].accion).toBe('crear');
    expect(plan.operadores[0].data).toEqual({
      nombre: 'Grupo Pérez SRL',
      emails: ['ventas@perez.com', 'admin@perez.com'],
      web: 'https://perez.com',
      linkedin_empresa: null,
    });
    expect(plan.estaciones).toHaveLength(2);
    expect(plan.estaciones.map((e) => e.operadorRef)).toEqual([0, 0]);
    expect(plan.estaciones[0].accion).toBe('crear');
    expect(plan.estaciones[0].data).toEqual({
      nombre: 'Estación Norte', bandera: 'Puma', direccion: 'Ruta 2 km 10',
      localidad: 'Dolores', provincia: 'Buenos Aires',
      telefono: '02262-15-530944', telefono_norm: '5492262530944', apies: '1001',
      estado_llamada: 'NO ATIENDE', estado_original: 'NO ATIENDE', telefono_fijo: false,
    });
    // estado sucio de Caro → canónico + original preservado tal cual
    expect(plan.estaciones[1].data.estado_llamada).toBe('PASÓ MAIL');
    expect(plan.estaciones[1].data.estado_original).toBe('ME PASO EL MAIL');
    // APIES numérico del xlsx → string
    expect(plan.estaciones[1].data.apies).toBe('1002');
    expect(plan.resumen.nuevos).toEqual({ operadores: 1, estaciones: 2, decisores: 0 });
    expect(plan.resumen.errores).toEqual([]);
  });

  it('fila con Estacion pero sin Operador → operador implícito con el nombre de la estación', () => {
    const rows = [
      { Bandera: 'Shell', Estacion: 'Shell Solita', Telefono: '2262530944' },
      { Bandera: 'La Trucha', Estacion: 'Otra Est', Operador: 'Op Z' },
    ];
    const plan = planImportUnificado(rows, { existentes: vacios });
    expect(plan.operadores[0].data.nombre).toBe('Shell Solita');
    expect(plan.estaciones[0].operadorRef).toBe(0);
    // bandera fuera de la lista canónica queda tal cual
    expect(plan.estaciones[1].data.bandera).toBe('La Trucha');
    expect(plan.resumen.errores).toEqual([]);
  });
});

describe('planImportUnificado — dedup de estaciones contra existentes', () => {
  const existentes = {
    operadores: [{
      id: 'op-1', nombre: 'Grupo Pérez SRL', emails: ['ventas@perez.com'],
      web: 'https://perez.com', linkedin_empresa: 'https://linkedin.com/company/perez',
    }],
    estaciones: [{
      id: 'est-1', operador_id: 'op-1', nombre: 'Estación Norte', bandera: 'Puma',
      direccion: '', localidad: 'Dolores', provincia: 'Buenos Aires',
      telefono_norm: '5492262530944', apies: '1001',
    }],
    decisores: [],
  };

  it('matchea por telefono_norm y actualiza SOLO los huecos (datos nuevos no vacíos)', () => {
    const rows = [{
      Bandera: 'Puma', Estacion: 'Estación Norte', Direccion: 'Ruta 2 km 10',
      Localidad: 'Dolores', Provincia: 'Buenos Aires', Operador: 'Grupo Pérez SRL',
      Telefono: '02262 15 530944', Email: 'ventas@perez.com', APIES: '1001',
    }];
    const plan = planImportUnificado(rows, { existentes });
    // el operador ya existe y no trae nada nuevo
    expect(plan.operadores[0].accion).toBe('saltear');
    expect(plan.operadores[0].motivo).toBeTruthy();
    expect(plan.estaciones).toHaveLength(1);
    expect(plan.estaciones[0].accion).toBe('actualizar');
    expect(plan.estaciones[0].id).toBe('est-1');
    expect(plan.estaciones[0].operadorRef).toBe('op-1');
    expect(plan.estaciones[0].data).toEqual({ direccion: 'Ruta 2 km 10' });
    expect(plan.resumen.actualizados.estaciones).toBe(1);
    expect(plan.resumen.salteados.operadores).toBe(1);
  });

  it('matchea por telefono_norm sin datos nuevos → saltear con motivo', () => {
    const rows = [{ Estacion: 'Estación Norte', Operador: 'Grupo Pérez SRL', Telefono: '02262-15-530944' }];
    const plan = planImportUnificado(rows, { existentes });
    expect(plan.estaciones[0].accion).toBe('saltear');
    expect(plan.estaciones[0].id).toBe('est-1');
    expect(plan.estaciones[0].motivo).toMatch(/sin datos nuevos/i);
    expect(plan.resumen.salteados.estaciones).toBe(1);
  });

  it('matchea por APIES (número del xlsx vs string en DB) y completa el teléfono faltante', () => {
    const ex = {
      operadores: [{ id: 'op-9', nombre: 'Operadora Centro SA', emails: [], web: '', linkedin_empresa: '' }],
      estaciones: [{
        id: 'est-9', operador_id: 'op-9', nombre: 'Shell Centro', bandera: 'Shell',
        direccion: 'San Martín 100', localidad: 'La Plata', provincia: 'Buenos Aires',
        telefono_norm: '', apies: '2002',
      }],
      decisores: [],
    };
    const rows = [{
      Bandera: 'Shell', Estacion: 'Shell Centro', Direccion: 'San Martín 100',
      Localidad: 'La Plata', Provincia: 'Buenos Aires', Operador: 'Operadora Centro SA',
      Telefono: '0221 444-5566', APIES: 2002,
    }];
    const plan = planImportUnificado(rows, { existentes: ex });
    expect(plan.estaciones[0].accion).toBe('actualizar');
    expect(plan.estaciones[0].id).toBe('est-9');
    expect(plan.estaciones[0].data).toEqual({ telefono: '0221 444-5566', telefono_norm: '542214445566' });
  });

  it('estación repetida dentro del archivo (mismo teléfono) → saltear como duplicada', () => {
    const rows = [
      { Estacion: 'YPF Uno', Operador: 'Op A', Telefono: '02262-15-530944' },
      { Estacion: 'YPF Uno bis', Operador: 'Op A', Telefono: '+549 2262 530944' },
    ];
    const plan = planImportUnificado(rows, { existentes: vacios });
    expect(plan.estaciones[0].accion).toBe('crear');
    expect(plan.estaciones[1].accion).toBe('saltear');
    expect(plan.estaciones[1].motivo).toMatch(/duplicada/i);
    expect(plan.resumen.nuevos.estaciones).toBe(1);
    expect(plan.resumen.salteados.estaciones).toBe(1);
  });
});

describe('planImportUnificado — dedup de decisores', () => {
  it('mismo LinkedIn con distinto case, trailing slash y query params → UN decisor con datos fusionados', () => {
    const rows = [
      {
        Estacion: 'Puma Norte', Operador: 'Grupo Pérez SRL', APIES: '1001',
        Decisor: 'Juan Pérez', Cargo: 'Dueño',
        LinkedIn_decisor: 'https://www.linkedin.com/in/juan-perez/',
      },
      {
        Estacion: 'Puma Sur', Operador: 'Grupo Pérez SRL', APIES: '1002',
        Decisor: 'Juan Pérez', Confianza: 'Alta',
        LinkedIn_decisor: 'HTTPS://www.LinkedIn.com/in/Juan-Perez?utm_source=share',
      },
    ];
    const plan = planImportUnificado(rows, { existentes: vacios });
    expect(plan.decisores).toHaveLength(1);
    expect(plan.decisores[0].accion).toBe('crear');
    expect(plan.decisores[0].operadorRef).toBe(0);
    expect(plan.decisores[0].data).toEqual({
      nombre: 'Juan Pérez', cargo: 'Dueño',
      linkedin_url: 'https://www.linkedin.com/in/juan-perez/', confianza: 'alta',
    });
    expect(plan.resumen.nuevos.decisores).toBe(1);
  });

  it('contra existentes: match por LinkedIn normalizada → actualizar huecos; fallback nombre+operador → saltear', () => {
    const existentes = {
      operadores: [{ id: 'op-1', nombre: 'Grupo Pérez SRL', emails: [], web: '', linkedin_empresa: '' }],
      estaciones: [],
      decisores: [
        { id: 'dec-1', operador_id: 'op-1', nombre: 'Ana López', cargo: '', linkedin_url: 'https://www.linkedin.com/in/ana-lopez', confianza: 'media' },
        { id: 'dec-2', operador_id: 'op-1', nombre: 'Carlos Ruiz', cargo: 'Encargado', linkedin_url: '', confianza: null },
      ],
    };
    const rows = [
      {
        Estacion: 'Puma Norte', Operador: 'Grupo Pérez SRL',
        Decisor: 'Ana López', Cargo: 'Gerenta',
        LinkedIn_decisor: 'https://www.linkedin.com/in/Ana-Lopez/?utm_source=share',
      },
      { Estacion: 'Puma Sur', Operador: 'Grupo Pérez SRL', Decisor: 'carlos  ruiz' },
    ];
    const plan = planImportUnificado(rows, { existentes });
    expect(plan.decisores[0].accion).toBe('actualizar');
    expect(plan.decisores[0].id).toBe('dec-1');
    expect(plan.decisores[0].data).toEqual({ cargo: 'Gerenta' });
    expect(plan.decisores[1].accion).toBe('saltear');
    expect(plan.decisores[1].id).toBe('dec-2');
    expect(plan.resumen.actualizados.decisores).toBe(1);
    expect(plan.resumen.salteados.decisores).toBe(1);
  });

  it('normaliza Confianza a alta|media|baja|null', () => {
    const rows = [
      { Estacion: 'A', Operador: 'Op A', Decisor: 'D Uno', Confianza: 'Alta' },
      { Estacion: 'B', Operador: 'Op B', Decisor: 'D Dos', Confianza: ' MEDIA ' },
      { Estacion: 'C', Operador: 'Op C', Decisor: 'D Tres', Confianza: 're alta' },
    ];
    const plan = planImportUnificado(rows, { existentes: vacios });
    expect(plan.decisores.map((d) => d.data.confianza)).toEqual(['alta', 'media', null]);
  });
});

describe('planImportUnificado — emails, errores y columna de estado', () => {
  it('emails multivaluados con ";" → array limpio (trim, lowercase, sin vacíos ni repetidos)', () => {
    const rows = [{ Estacion: 'X', Operador: 'Op X', Email: ' Info@OpX.com ; ventas@opx.com;; info@opx.com ' }];
    const plan = planImportUnificado(rows, { existentes: vacios });
    expect(plan.operadores[0].data.emails).toEqual(['info@opx.com', 'ventas@opx.com']);
  });

  it('fila sin Operador NI Estacion → error con número de fila (encabezado = fila 1)', () => {
    const rows = [
      { Estacion: 'YPF Uno', Operador: 'Op A' },
      { Bandera: 'Shell', Telefono: '123456789' },
    ];
    const plan = planImportUnificado(rows, { existentes: vacios });
    expect(plan.resumen.errores).toHaveLength(1);
    expect(plan.resumen.errores[0].fila).toBe(3);
    expect(plan.resumen.errores[0].motivo).toMatch(/Operador ni Estacion/i);
    expect(plan.operadores).toHaveLength(1);
    expect(plan.estaciones).toHaveLength(1);
  });

  it('detecta la columna de estado por heurística de valores (COMENTARIOS le gana a Notas de texto libre)', () => {
    const rows = [
      { Estacion: 'YPF Ruta 3', Operador: 'Op A', COMENTARIOS: 'ME PASO EL MAIL', Notas: 'llamar en enero' },
      { Estacion: 'YPF Ruta 5', Operador: 'Op B', COMENTARIOS: 'telefono fijo', Notas: 'ver mail' },
    ];
    const plan = planImportUnificado(rows, { existentes: vacios });
    expect(plan.estaciones[0].data.estado_llamada).toBe('PASÓ MAIL');
    expect(plan.estaciones[0].data.estado_original).toBe('ME PASO EL MAIL');
    // 'telefono fijo' es atributo: estado SIN LLAMAR + flag + original preservado
    expect(plan.estaciones[1].data.estado_llamada).toBe('SIN LLAMAR');
    expect(plan.estaciones[1].data.estado_original).toBe('telefono fijo');
    expect(plan.estaciones[1].data.telefono_fijo).toBe(true);
  });

  it('sin columna de estado → SIN LLAMAR con original null', () => {
    const rows = [{ Estacion: 'YPF Ruta 3', Operador: 'Op A' }];
    const plan = planImportUnificado(rows, { existentes: vacios });
    expect(plan.estaciones[0].data.estado_llamada).toBe('SIN LLAMAR');
    expect(plan.estaciones[0].data.estado_original).toBe(null);
  });
});
