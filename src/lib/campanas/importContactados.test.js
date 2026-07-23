import { describe, it, expect } from 'vitest';
import { planImportContactados, fusionarPlanes } from './importContactados.js';

// Fixtures con la forma EXACTA que devuelve XLSX.utils.sheet_to_json sobre la
// hoja "Contactado Caro" real del Unificado: columnas GRUPO/EMPRESA · CONTACTO
// · VIA DE CONTACTO · BANDERA · TIENDA TIPO · COMENTARIOS (los headers reales
// traen espacios extra, ej. "CONTACTO "). Los valores de los tests son los de
// la planilla real (emails con typos, teléfonos crudos, multibanderas con '/').

const vacios = { operadores: [], estaciones: [], decisores: [] };

describe('planImportContactados — operadores', () => {
  it('crea el operador contactado: banderas por "/", multibandera, tienda_tipo, notas y señal de constructora', () => {
    const rows = [{
      'GRUPO/EMPRESA': 'PETROKOM ',
      'CONTACTO ': 'ADMINISTRACION',            // header real con espacio extra
      'VIA DE CONTACTO': 'admi.petrokom@gmailcom',
      'BANDERA': 'YPF/SHELL',
      'TIENDA TIPO': 'FULL',
      'COMENTARIOS': 'YA TIENEN CONSTRUCTORA ME DIJERON',
    }];
    const plan = planImportContactados(rows, { existentes: vacios });
    expect(plan.operadores).toHaveLength(1);
    expect(plan.operadores[0].accion).toBe('crear');
    expect(plan.operadores[0].data).toEqual({
      nombre: 'PETROKOM',
      nombre_norm: 'petrokom',
      banderas: ['YPF', 'Shell'],               // canónicas de BANDERAS
      multibandera: true,
      etapa_prospeccion: 'contactado',
      emails: ['admi.petrokom@gmail.com'],      // typo inequívoco reparado
      notas: 'YA TIENEN CONSTRUCTORA ME DIJERON',
      datos: {
        tienda_tipo: 'FULL',
        senal: 'no_interesa_constructora',      // solo el dato: la etapa no cambia
        email_original: 'admi.petrokom@gmailcom',
      },
    });
    // CONTACTO genérico → sin decisor; el shape del plan es el del Unificado
    expect(plan.decisores).toEqual([]);
    expect(plan.estaciones).toEqual([]);
    expect(plan.resumen.nuevos).toEqual({ operadores: 1, estaciones: 0, decisores: 0 });
    expect(plan.resumen.errores).toEqual([]);
  });

  it('bandera única → multibandera false; bandera fuera de la lista queda tal cual; headers con tilde tolerados', () => {
    const rows = [
      { 'GRUPO/EMPRESA': 'EST LUJAN', 'CONTACTO': '', 'VÍA DE CONTACTO': '', 'BANDERA': 'PUMA' },
      { 'GRUPO/EMPRESA': 'EST BLANCA', 'BANDERA': 'BLANCA/SHELL' },
    ];
    const plan = planImportContactados(rows, { existentes: vacios });
    expect(plan.operadores[0].data.banderas).toEqual(['Puma']);
    expect(plan.operadores[0].data.multibandera).toBe(false);
    expect(plan.operadores[1].data.banderas).toEqual(['BLANCA', 'Shell']);
    expect(plan.operadores[1].data.multibandera).toBe(true);
  });

  it('misma GRUPO/EMPRESA repetida en la hoja → UN solo operador (se fusiona, no se duplica)', () => {
    const rows = [
      { 'GRUPO/EMPRESA': 'EST PATAGONIA', 'CONTACTO': 'ADMINISTRACION', 'VIA DE CONTACTO': 'ventas@patagonia.com.ar' },
      { 'GRUPO/EMPRESA': 'est  patagonia', 'CONTACTO': 'ADMINISTRACION', 'VIA DE CONTACTO': 'compras@patagonia.com.ar', 'COMENTARIOS': 'llamar en agosto' },
    ];
    const plan = planImportContactados(rows, { existentes: vacios });
    expect(plan.operadores).toHaveLength(1);
    expect(plan.operadores[0].data.emails).toEqual(['ventas@patagonia.com.ar', 'compras@patagonia.com.ar']);
    expect(plan.operadores[0].data.notas).toBe('llamar en agosto');
  });

  it('fila sin GRUPO/EMPRESA → error con número de fila (encabezado = fila 1)', () => {
    const rows = [
      { 'GRUPO/EMPRESA': 'EST UNO', 'CONTACTO': 'ADMINISTRACION' },
      { 'CONTACTO': 'GINO GIAVENO', 'VIA DE CONTACTO': '2213514984' },
    ];
    const plan = planImportContactados(rows, { existentes: vacios });
    expect(plan.resumen.errores).toHaveLength(1);
    expect(plan.resumen.errores[0].fila).toBe(3);
    expect(plan.resumen.errores[0].motivo).toMatch(/GRUPO\/EMPRESA/i);
    expect(plan.operadores).toHaveLength(1);
  });
});

describe('planImportContactados — VIA DE CONTACTO: teléfonos', () => {
  it('teléfono crudo → normalizarTelefonoAR a datos.telefono_contacto con el original preservado', () => {
    const rows = [{ 'GRUPO/EMPRESA': 'EST A', 'CONTACTO': 'ADMINISTRACION', 'VIA DE CONTACTO': '2213514984' }];
    const plan = planImportContactados(rows, { existentes: vacios });
    expect(plan.operadores[0].data.datos).toEqual({
      telefono_contacto: '542213514984',
      telefono_contacto_original: '2213514984',
    });
    expect(plan.operadores[0].data.emails).toEqual([]);
  });

  it('teléfono con espacios y teléfono como NÚMERO del xlsx → normalizados igual', () => {
    const rows = [
      { 'GRUPO/EMPRESA': 'EST B', 'VIA DE CONTACTO': '3385 593411' },
      { 'GRUPO/EMPRESA': 'EST C', 'VIA DE CONTACTO': 1131978556 },
    ];
    const plan = planImportContactados(rows, { existentes: vacios });
    expect(plan.operadores[0].data.datos.telefono_contacto).toBe('543385593411');
    expect(plan.operadores[0].data.datos.telefono_contacto_original).toBe('3385 593411');
    expect(plan.operadores[1].data.datos.telefono_contacto).toBe('541131978556');
  });

  it('vía que no es email ni teléfono → se preserva en datos.via_contacto (no se pierde)', () => {
    const rows = [{ 'GRUPO/EMPRESA': 'EST D', 'VIA DE CONTACTO': 'LINKEDIN' }];
    const plan = planImportContactados(rows, { existentes: vacios });
    expect(plan.operadores[0].data.datos).toEqual({ via_contacto: 'LINKEDIN' });
  });
});

describe('planImportContactados — VIA DE CONTACTO: reparación de emails', () => {
  const planDe = (via) => planImportContactados(
    [{ 'GRUPO/EMPRESA': 'EST X', 'CONTACTO': 'ADMINISTRACION', 'VIA DE CONTACTO': via }],
    { existentes: vacios },
  );

  it('repara @gmailcom → @gmail.com (inequívoco) y guarda el original', () => {
    const plan = planDe('admi.petrokom@gmailcom');
    expect(plan.operadores[0].data.emails).toEqual(['admi.petrokom@gmail.com']);
    expect(plan.operadores[0].data.datos.email_original).toBe('admi.petrokom@gmailcom');
    expect(plan.operadores[0].data.datos.email_sospechoso).toBeUndefined();
  });

  it('repara ..com → .com (inequívoco)', () => {
    const plan = planDe('estacion406@hotmail..com');
    expect(plan.operadores[0].data.emails).toEqual(['estacion406@hotmail.com']);
    expect(plan.operadores[0].data.datos.email_original).toBe('estacion406@hotmail..com');
  });

  it('repara @hotmailcom → @hotmail.com (inequívoco)', () => {
    const plan = planDe('pedidos@hotmailcom');
    expect(plan.operadores[0].data.emails).toEqual(['pedidos@hotmail.com']);
    expect(plan.operadores[0].data.datos.email_original).toBe('pedidos@hotmailcom');
  });

  it('@hmail.com es AMBIGUO (¿hotmail? ¿gmail?) → NO se toca + email_sospechoso', () => {
    const plan = planDe('ariescomcosrl@hmail.com');
    expect(plan.operadores[0].data.emails).toEqual(['ariescomcosrl@hmail.com']);
    expect(plan.operadores[0].data.datos.email_sospechoso).toBe(true);
    expect(plan.operadores[0].data.datos.email_original).toBeUndefined();
  });

  it('dominio raro con "com" pegado (adolfosartorisacom.ar) → NO se toca + email_sospechoso', () => {
    const plan = planDe('luisaguilar@adolfosartorisacom.ar');
    expect(plan.operadores[0].data.emails).toEqual(['luisaguilar@adolfosartorisacom.ar']);
    expect(plan.operadores[0].data.datos.email_sospechoso).toBe(true);
  });

  it('dominio sin punto que no es reparable inequívoco → sospechoso, preservado tal cual', () => {
    const plan = planDe('algo@yahoocom');
    expect(plan.operadores[0].data.emails).toEqual(['algo@yahoocom']);
    expect(plan.operadores[0].data.datos.email_sospechoso).toBe(true);
  });

  it('un .com.ar legítimo NO es sospechoso ni se repara', () => {
    const plan = planDe('ventas@estacioncentro.com.ar');
    expect(plan.operadores[0].data.emails).toEqual(['ventas@estacioncentro.com.ar']);
    expect(plan.operadores[0].data.datos).toEqual({});
  });
});

describe('planImportContactados — CONTACTO: decisores', () => {
  it('persona real con email → decisor en Title Case con email y fuente; el email NO va al operador', () => {
    const rows = [{
      'GRUPO/EMPRESA': 'ARIES COMCO SRL',
      'CONTACTO': 'GINO GIAVENO',
      'VIA DE CONTACTO': 'ariescomcosrl@hmail.com',
      'BANDERA': 'PUMA/AXION',
      'COMENTARIOS': 'ES EL ENCARGADO DE LAS ESTACIONES , TIENE LINKEDIN',
    }];
    const plan = planImportContactados(rows, { existentes: vacios });
    expect(plan.decisores).toHaveLength(1);
    expect(plan.decisores[0].accion).toBe('crear');
    expect(plan.decisores[0].operadorRef).toBe(0);
    expect(plan.decisores[0].data).toEqual({
      nombre: 'Gino Giaveno',
      email: 'ariescomcosrl@hmail.com',          // sospechoso: preservado tal cual
      fuente: 'Contactado Caro',
      datos: { email_sospechoso: true },         // el flag viaja con el decisor
    });
    expect(plan.operadores[0].data.emails).toEqual([]);
    expect(plan.operadores[0].data.banderas).toEqual(['Puma', 'Axion']);
    expect(plan.operadores[0].data.notas).toBe('ES EL ENCARGADO DE LAS ESTACIONES , TIENE LINKEDIN');
  });

  it('"SILVINA/JUAN" → UN solo decisor con ese nombre (no inventa dos)', () => {
    const rows = [{ 'GRUPO/EMPRESA': 'GRUPO SUR', 'CONTACTO': 'SILVINA/JUAN', 'VIA DE CONTACTO': 'gruposur@gmail.com' }];
    const plan = planImportContactados(rows, { existentes: vacios });
    expect(plan.decisores).toHaveLength(1);
    expect(plan.decisores[0].data.nombre).toBe('Silvina/Juan');
    expect(plan.decisores[0].data.email).toBe('gruposur@gmail.com');
  });

  it('ADMINISTRACION / ADMINISTRACIÓN / vacío → genérico: sin decisor, el email al operador', () => {
    const rows = [
      { 'GRUPO/EMPRESA': 'EST A', 'CONTACTO': 'ADMINISTRACIÓN', 'VIA DE CONTACTO': 'esta@gmail.com' },
      { 'GRUPO/EMPRESA': 'EST B', 'CONTACTO': '', 'VIA DE CONTACTO': 'estb@gmail.com' },
    ];
    const plan = planImportContactados(rows, { existentes: vacios });
    expect(plan.decisores).toEqual([]);
    expect(plan.operadores[0].data.emails).toEqual(['esta@gmail.com']);
    expect(plan.operadores[1].data.emails).toEqual(['estb@gmail.com']);
  });

  it('persona con vía teléfono → decisor sin email; el teléfono va al operador', () => {
    const rows = [{ 'GRUPO/EMPRESA': 'EST C', 'CONTACTO': 'LUIS AGUILAR', 'VIA DE CONTACTO': '2213514984' }];
    const plan = planImportContactados(rows, { existentes: vacios });
    expect(plan.decisores[0].data).toEqual({
      nombre: 'Luis Aguilar', email: null, fuente: 'Contactado Caro', datos: {},
    });
    expect(plan.operadores[0].data.datos.telefono_contacto).toBe('542213514984');
  });
});

describe('planImportContactados — dedup contra existentes', () => {
  const existentes = {
    operadores: [
      {
        id: 'op-1', nombre: 'Petrokom', nombre_norm: 'petrokom', banderas: [],
        multibandera: null, etapa_prospeccion: 'sin_contactar', emails: [],
        notas: '', datos: {},
      },
      {
        id: 'op-2', nombre: 'Grupo Sur', nombre_norm: 'grupo sur', banderas: ['YPF'],
        multibandera: false, etapa_prospeccion: 'respondio',
        emails: ['gruposur@gmail.com'], notas: 'ya hablamos', datos: { tienda_tipo: 'FULL' },
      },
    ],
    estaciones: [],
    decisores: [],
  };

  it('existente en sin_contactar → actualizar con etapa contactado + huecos (banderas, notas, tienda_tipo, teléfono)', () => {
    const rows = [{
      'GRUPO/EMPRESA': 'PETROKOM', 'CONTACTO': 'ADMINISTRACION',
      'VIA DE CONTACTO': '2213514984', 'BANDERA': 'YPF',
      'TIENDA TIPO': 'FULL', 'COMENTARIOS': 'HABLAR EN AGOSTO',
    }];
    const plan = planImportContactados(rows, { existentes });
    expect(plan.operadores[0].accion).toBe('actualizar');
    expect(plan.operadores[0].id).toBe('op-1');
    expect(plan.operadores[0].data).toEqual({
      etapa_prospeccion: 'contactado',   // sin_contactar → contactado: YA fue contactado
      banderas: ['YPF'],
      multibandera: false,
      notas: 'HABLAR EN AGOSTO',
      datos: {
        tienda_tipo: 'FULL',
        telefono_contacto: '542213514984',
        telefono_contacto_original: '2213514984',
      },
    });
    expect(plan.resumen.actualizados.operadores).toBe(1);
  });

  it('etapa más avanzada NUNCA se degrada; sin datos nuevos → saltear', () => {
    const rows = [{
      'GRUPO/EMPRESA': 'GRUPO SUR', 'CONTACTO': 'ADMINISTRACION',
      'VIA DE CONTACTO': 'gruposur@gmail.com', 'TIENDA TIPO': 'MINI',
      'COMENTARIOS': 'nuevo comentario',
    }];
    const plan = planImportContactados(rows, { existentes });
    // respondio > contactado → la etapa no aparece en el delta; el resto ya
    // está lleno en la DB (llenar-huecos: nunca pisa) → no queda delta.
    expect(plan.operadores[0].accion).toBe('saltear');
    expect(plan.operadores[0].id).toBe('op-2');
    expect(plan.operadores[0].motivo).toMatch(/sin datos nuevos/i);
    expect(plan.resumen.salteados.operadores).toBe(1);
  });

  it('decisor existente (nombre+operador): llena el hueco de email → actualizar; sin datos nuevos → saltear', () => {
    const ex = {
      operadores: [{
        id: 'op-1', nombre: 'Aries Comco SRL', nombre_norm: 'aries comco srl',
        banderas: ['Puma'], multibandera: false, etapa_prospeccion: 'contactado',
        emails: [], notas: 'x', datos: {},
      }],
      estaciones: [],
      decisores: [
        { id: 'dec-1', operador_id: 'op-1', nombre: 'Gino Giaveno', email: '' },
      ],
    };
    const conEmail = planImportContactados(
      [{ 'GRUPO/EMPRESA': 'ARIES COMCO SRL', 'CONTACTO': 'GINO GIAVENO', 'VIA DE CONTACTO': 'gino@aries.com.ar' }],
      { existentes: ex },
    );
    expect(conEmail.decisores[0].accion).toBe('actualizar');
    expect(conEmail.decisores[0].id).toBe('dec-1');
    expect(conEmail.decisores[0].operadorRef).toBe('op-1');
    expect(conEmail.decisores[0].data).toEqual({ email: 'gino@aries.com.ar' });

    const sinNada = planImportContactados(
      [{ 'GRUPO/EMPRESA': 'ARIES COMCO SRL', 'CONTACTO': 'GINO GIAVENO' }],
      { existentes: ex },
    );
    expect(sinNada.decisores[0].accion).toBe('saltear');
    expect(sinNada.decisores[0].motivo).toMatch(/sin datos nuevos/i);
  });
});

describe('fusionarPlanes', () => {
  const planA = {
    operadores: [
      { accion: 'crear', data: { nombre: 'Op Uno' } },
      { accion: 'saltear', id: 'op-9', data: {}, motivo: 'sin datos nuevos' },
    ],
    estaciones: [{ accion: 'crear', operadorRef: 0, data: { nombre: 'Est Uno' } }],
    decisores: [{ accion: 'crear', operadorRef: 'op-9', data: { nombre: 'Dec Ex' } }],
    resumen: {
      nuevos: { operadores: 1, estaciones: 1, decisores: 1 },
      actualizados: { operadores: 0, estaciones: 0, decisores: 0 },
      salteados: { operadores: 1, estaciones: 0, decisores: 0 },
      errores: [{ fila: 4, motivo: 'fila sin Operador ni Estacion' }],
    },
  };
  const planB = {
    operadores: [{ accion: 'crear', data: { nombre: 'Op Contactado' } }],
    estaciones: [],
    decisores: [
      { accion: 'crear', operadorRef: 0, data: { nombre: 'Gino Giaveno' } },
      { accion: 'actualizar', id: 'dec-1', operadorRef: 'op-1', data: { email: 'a@b.com' } },
    ],
    resumen: {
      nuevos: { operadores: 1, estaciones: 0, decisores: 1 },
      actualizados: { operadores: 0, estaciones: 0, decisores: 1 },
      salteados: { operadores: 0, estaciones: 0, decisores: 0 },
      errores: [{ fila: 2, motivo: 'fila sin GRUPO/EMPRESA' }],
    },
  };

  it('concatena entidades re-basando los operadorRef numéricos de B (+ cantidad de operadores de A)', () => {
    const fusion = fusionarPlanes(planA, planB);
    expect(fusion.operadores).toHaveLength(3);
    expect(fusion.operadores[2].data.nombre).toBe('Op Contactado');
    // refs de A intactos
    expect(fusion.estaciones[0].operadorRef).toBe(0);
    expect(fusion.decisores[0].operadorRef).toBe('op-9');
    // ref numérico de B re-basado: 0 + 2 operadores de A = 2; los string (ids) no se tocan
    expect(fusion.decisores[1].operadorRef).toBe(2);
    expect(fusion.decisores[2].operadorRef).toBe('op-1');
  });

  it('suma los resúmenes por entidad y concatena los errores', () => {
    const fusion = fusionarPlanes(planA, planB);
    expect(fusion.resumen.nuevos).toEqual({ operadores: 2, estaciones: 1, decisores: 2 });
    expect(fusion.resumen.actualizados).toEqual({ operadores: 0, estaciones: 0, decisores: 1 });
    expect(fusion.resumen.salteados).toEqual({ operadores: 1, estaciones: 0, decisores: 0 });
    expect(fusion.resumen.errores).toEqual([
      { fila: 4, motivo: 'fila sin Operador ni Estacion' },
      { fila: 2, motivo: 'fila sin GRUPO/EMPRESA' },
    ]);
  });

  it('sin plan B (o A) devuelve el otro intacto', () => {
    expect(fusionarPlanes(planA, null)).toEqual(planA);
    expect(fusionarPlanes(null, planB)).toEqual(planB);
  });

  it('no muta los planes de entrada', () => {
    const antesB = JSON.parse(JSON.stringify(planB));
    fusionarPlanes(planA, planB);
    expect(planB).toEqual(antesB);
  });
});

describe('fusionarPlanes — dedup CRUZADO entre planes (el mismo operador está en varias hojas)', () => {
  // Caso real: ADOLFO SARTORI S.A. aparece en "Todas las estaciones", en
  // "LISTOS PARA ENVIAR" y en "Contactado Caro" del mismo archivo.
  const ceros = { operadores: 0, estaciones: 0, decisores: 0 };
  const planEstaciones = {
    operadores: [
      { accion: 'crear', data: { nombre: 'ADOLFO SARTORI S.A.', emails: ['a@sartori.com.ar'], web: 'https://sartori.com.ar', linkedin_empresa: null } },
      { accion: 'crear', data: { nombre: 'OTRO OP', emails: [], web: null, linkedin_empresa: null } },
    ],
    estaciones: [
      { accion: 'crear', operadorRef: 0, data: { nombre: 'Ruta 8 km 365' } },
      { accion: 'crear', operadorRef: 1, data: { nombre: 'Calle 2 nro 40' } },
    ],
    decisores: [
      { accion: 'crear', operadorRef: 0, data: { nombre: 'Luis Aguilar', cargo: 'Gerente', linkedin_url: null, confianza: null } },
    ],
    resumen: { nuevos: { operadores: 2, estaciones: 2, decisores: 1 }, actualizados: ceros, salteados: ceros, errores: [] },
  };
  const planListos = {
    operadores: [
      {
        accion: 'crear',
        data: {
          nombre: 'Adolfo  Sartori S.A.', nombre_norm: 'adolfo sartori s.a.',
          banderas: ['YPF'], multibandera: false, etapa_prospeccion: 'contactado',
          emails: ['b@sartori.com.ar', 'a@sartori.com.ar'], notas: null,
          datos: { segmento: 'YPF una estación' },
        },
      },
      {
        accion: 'crear',
        data: {
          nombre: 'OP SOLO LISTOS', nombre_norm: 'op solo listos', banderas: null,
          multibandera: false, etapa_prospeccion: 'sin_contactar', emails: [], notas: null, datos: {},
        },
      },
    ],
    estaciones: [],
    decisores: [
      { accion: 'crear', operadorRef: 0, data: { nombre: 'Luis  Aguilar', email: 'luis@sartori.com.ar', fuente: 'Contactado Caro', datos: {} } },
      { accion: 'crear', operadorRef: 1, data: { nombre: 'Otra Persona', email: null, fuente: 'Contactado Caro', datos: {} } },
    ],
    resumen: { nuevos: { operadores: 2, estaciones: 0, decisores: 2 }, actualizados: ceros, salteados: ceros, errores: [] },
  };

  it('operador "crear" duplicado → UNO fusionado: huecos llenados, emails = unión sin duplicados, etapa de B', () => {
    const fusion = fusionarPlanes(planEstaciones, planListos);
    expect(fusion.operadores).toHaveLength(3); // Sartori fusionado + OTRO OP + OP SOLO LISTOS
    const sartori = fusion.operadores[0];
    expect(sartori.accion).toBe('crear');
    expect(sartori.data.nombre).toBe('ADOLFO SARTORI S.A.');    // A gana el conflicto
    expect(sartori.data.emails).toEqual(['a@sartori.com.ar', 'b@sartori.com.ar']);
    expect(sartori.data.web).toBe('https://sartori.com.ar');
    expect(sartori.data.nombre_norm).toBe('adolfo sartori s.a.'); // hueco llenado desde B
    expect(sartori.data.banderas).toEqual(['YPF']);
    expect(sartori.data.etapa_prospeccion).toBe('contactado');    // A no tenía etapa
    expect(sartori.data.datos).toEqual({ segmento: 'YPF una estación' });
    expect(fusion.operadores[1].data.nombre).toBe('OTRO OP');
    expect(fusion.operadores[2].data.nombre).toBe('OP SOLO LISTOS');
  });

  it('re-mapea los refs de B: al índice de A si se fusionó, al índice corrido si es nuevo; los de A quedan intactos', () => {
    const fusion = fusionarPlanes(planEstaciones, planListos);
    expect(fusion.estaciones.map((e) => e.operadorRef)).toEqual([0, 1]); // los de A no se tocan
    // decisor "Otra Persona" apuntaba al op 1 de B (OP SOLO LISTOS) → ahora índice 2
    const otra = fusion.decisores.find((d) => d.data.nombre === 'Otra Persona');
    expect(otra.operadorRef).toBe(2);
  });

  it('decisores "crear" duplicados (mismo nombre + mismo operador destino) → fusionados con hueco-llenado', () => {
    const fusion = fusionarPlanes(planEstaciones, planListos);
    expect(fusion.decisores).toHaveLength(2); // Luis fusionado + Otra Persona
    const luis = fusion.decisores[0];
    expect(luis.operadorRef).toBe(0);
    expect(luis.data.nombre).toBe('Luis Aguilar');
    expect(luis.data.cargo).toBe('Gerente');                  // lo de A se conserva
    expect(luis.data.email).toBe('luis@sartori.com.ar');      // hueco llenado desde B
    expect(luis.data.fuente).toBe('Contactado Caro');
  });

  it('el resumen se RECALCULA del plan fusionado (no suma a ciegas)', () => {
    const fusion = fusionarPlanes(planEstaciones, planListos);
    expect(fusion.resumen.nuevos).toEqual({ operadores: 3, estaciones: 2, decisores: 2 });
    expect(fusion.resumen.actualizados).toEqual(ceros);
    expect(fusion.resumen.salteados).toEqual(ceros);
    expect(fusion.resumen.errores).toEqual([]);
  });

  it('la etapa más avanzada gana (en los dos sentidos), notas con " · " si difieren, en datos gana A, banderas = unión', () => {
    const armar = (nombre, etapa, notas, datos, banderas) => ({
      operadores: [{
        accion: 'crear',
        data: { nombre, nombre_norm: 'grupo sur', banderas, multibandera: false, etapa_prospeccion: etapa, emails: [], notas, datos },
      }],
      estaciones: [], decisores: [],
      resumen: { nuevos: { operadores: 1, estaciones: 0, decisores: 0 }, actualizados: ceros, salteados: ceros, errores: [] },
    });
    const a = armar('GRUPO SUR', 'respondio', 'ya hablamos', { tienda_tipo: 'FULL' }, ['YPF']);
    const b = armar('grupo  sur', 'contactado', 'llamar en agosto', { tienda_tipo: 'MINI', segmento: 'x' }, ['Shell']);
    const f = fusionarPlanes(a, b);
    expect(f.operadores).toHaveLength(1);
    expect(f.operadores[0].data.etapa_prospeccion).toBe('respondio');   // no se degrada
    expect(f.operadores[0].data.notas).toBe('ya hablamos · llamar en agosto');
    expect(f.operadores[0].data.datos).toEqual({ tienda_tipo: 'FULL', segmento: 'x' });
    expect(f.operadores[0].data.banderas).toEqual(['YPF', 'Shell']);
    expect(f.operadores[0].data.multibandera).toBe(true);               // recalculada de la unión
    // al revés la etapa avanzada también gana, y notas iguales no se duplican
    const f2 = fusionarPlanes(armar('GRUPO SUR', 'contactado', 'ya hablamos', {}, null), a);
    expect(f2.operadores[0].data.etapa_prospeccion).toBe('respondio');
    expect(f2.operadores[0].data.notas).toBe('ya hablamos');
  });

  it('la fusión no muta los planes de entrada', () => {
    const antesA = JSON.parse(JSON.stringify(planEstaciones));
    const antesB = JSON.parse(JSON.stringify(planListos));
    fusionarPlanes(planEstaciones, planListos);
    expect(planEstaciones).toEqual(antesA);
    expect(planListos).toEqual(antesB);
  });
});
