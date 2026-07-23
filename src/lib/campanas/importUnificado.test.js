import { describe, it, expect } from 'vitest';
import { planImportUnificado, mapearFilasPosicionales, planImportListos } from './importUnificado.js';

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

describe('mapearFilasPosicionales — hoja "Todas las estaciones" sin encabezados (16 columnas posicionales)', () => {
  // Fila real: 1=Bandera · 2=etiqueta APIES · 3=Dirección · 4=Localidad ·
  // 5=Provincia · 6=Operador · 7=Teléfono · 8=Estado sucio · 9=Email (a veces
  // otro estado) · 10=libre · 11=Decisor · 12=Cargo · 13=LinkedIn_decisor ·
  // 14=LinkedIn_empresa · 15=Confianza · 16=APIES numérico.
  const filaCompleta = [
    'YPF', 'APIES 50014', 'Av. Mitre 1500', 'Avellaneda', 'Buenos Aires',
    'OPERADORA SUR S.A.', '011 4222-3344', 'FUERA DE SERVICIO', 'ventas@opsur.com.ar', '',
    'Juan Gómez', 'Gerente', 'https://linkedin.com/in/juangomez',
    'https://linkedin.com/company/opsur', 'alta', 50014,
  ];

  it('detecta el formato y mapea a las columnas nombradas que entiende planImportUnificado (Estacion = Dirección)', () => {
    const rows = mapearFilasPosicionales([filaCompleta]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      Bandera: 'YPF',
      Estacion: 'Av. Mitre 1500',       // no hay nombre de estación: es la dirección
      Direccion: 'Av. Mitre 1500',
      Localidad: 'Avellaneda',
      Provincia: 'Buenos Aires',
      Operador: 'OPERADORA SUR S.A.',
      Telefono: '011 4222-3344',
      Estado: 'FUERA DE SERVICIO',
      Email: 'ventas@opsur.com.ar',
      Decisor: 'Juan Gómez',
      Cargo: 'Gerente',
      LinkedIn_decisor: 'https://linkedin.com/in/juangomez',
      LinkedIn_empresa: 'https://linkedin.com/company/opsur',
      Confianza: 'alta',
      APIES: '50014',                   // col 16 numérica → string
    });
  });

  it('APIES: sin col 16 cae a extraer los dígitos de la etiqueta "APIES 50014" de la col 2', () => {
    const fila = ['Shell', 'APIES 88001', 'Ruta 2 km 30', 'La Plata', 'Buenos Aires', 'PETROSUR SRL'];
    const rows = mapearFilasPosicionales([fila]);
    expect(rows[0].APIES).toBe('88001');
    expect(rows[0].Bandera).toBe('Shell');
  });

  it('col 9 con un estado conocido NO es email: si la col 8 está vacía, es EL estado', () => {
    const fila = ['YPF', 'APIES 50020', 'Ruta 3 km 55', 'Cañuelas', 'Buenos Aires', 'OP X', '2262530944', '', 'VOLVER A LLAMAR '];
    const rows = mapearFilasPosicionales([fila]);
    expect(rows[0].Estado).toBe('VOLVER A LLAMAR');
    expect(rows[0].Email).toBe('');
  });

  it('col 9 con estado y col 8 ocupada → refuerza el original ("COL8 · COL9"), email vacío', () => {
    const fila = ['YPF', 'APIES 50021', 'Belgrano 200', 'Azul', 'Buenos Aires', 'OP Y', '', 'NUMERO EQUIVOCADO', 'VOLVER A LLAMAR '];
    const rows = mapearFilasPosicionales([fila]);
    expect(rows[0].Estado).toBe('NUMERO EQUIVOCADO · VOLVER A LLAMAR');
    expect(rows[0].Email).toBe('');
  });

  it('col 9 sin "@" (email inválido / nota suelta) → email vacío, crudo preservado en la columna de estado', () => {
    const fila = ['YPF', 'APIES 50022', 'Alsina 900', 'Bahía Blanca', 'Buenos Aires', 'OP Z', '', '', 'ventas.opz.com.ar'];
    const rows = mapearFilasPosicionales([fila]);
    expect(rows[0].Email).toBe('');
    expect(rows[0].Estado).toBe('ventas.opz.com.ar');
  });

  it('filas totalmente vacías se saltean sin error', () => {
    const rows = mapearFilasPosicionales([[], ['', '', ''], filaCompleta, [null, undefined, '']]);
    expect(rows).toHaveLength(1);
    expect(rows[0].Operador).toBe('OPERADORA SUR S.A.');
  });

  it('NO detecta (→ null): fila de encabezados, primera celda que no es bandera, o mezcla con headers conocidos', () => {
    expect(mapearFilasPosicionales([['Bandera', 'Estacion', 'Operador', 'Email']])).toBe(null);
    expect(mapearFilasPosicionales([['ACME SRL', 'APIES 1', 'Calle 1', 'X', 'Y', 'Op']])).toBe(null);
    expect(mapearFilasPosicionales([['YPF', 'Estacion', 'Direccion']])).toBe(null);
    expect(mapearFilasPosicionales([])).toBe(null);
    expect(mapearFilasPosicionales(null)).toBe(null);
  });

  it('detección case/tilde-insensitive de la bandera (la planilla trae "PUMA")', () => {
    const rows = mapearFilasPosicionales([['PUMA', 'APIES 7', 'Av. 2 nro 300', 'Miramar', 'Buenos Aires', 'GRUPO PÉREZ SRL']]);
    expect(rows).toHaveLength(1);
    expect(rows[0].Bandera).toBe('PUMA');
  });

  it('integración con planImportUnificado: estados canónicos + original completo + flag teléfono fijo + dedup por APIES', () => {
    const filas = [
      ['YPF', 'APIES 50014', 'Av. Mitre 1500', 'Avellaneda', 'Buenos Aires', 'OPERADORA SUR S.A.', '02262-15-530944', 'TELEFONO FIJO', '', '', 'Juan Gómez', 'Gerente', '', '', 'media', 50014],
      ['Shell', 'APIES 88001', 'Ruta 2 km 30', 'La Plata', 'Buenos Aires', 'PETROSUR SRL', '', 'NUMERO EQUIVOCADO', 'VOLVER A LLAMAR ', ''],
    ];
    const plan = planImportUnificado(mapearFilasPosicionales(filas), { existentes: vacios });
    expect(plan.resumen.errores).toEqual([]);
    expect(plan.resumen.nuevos).toEqual({ operadores: 2, estaciones: 2, decisores: 1 });
    expect(plan.estaciones[0].data.nombre).toBe('Av. Mitre 1500');
    expect(plan.estaciones[0].data.estado_llamada).toBe('SIN LLAMAR');
    expect(plan.estaciones[0].data.telefono_fijo).toBe(true);
    expect(plan.estaciones[0].data.apies).toBe('50014');
    expect(plan.estaciones[1].data.estado_llamada).toBe('FUERA DE SERVICIO');
    expect(plan.estaciones[1].data.estado_original).toBe('NUMERO EQUIVOCADO · VOLVER A LLAMAR');
    expect(plan.estaciones[1].data.apies).toBe('88001');
    expect(plan.decisores[0].data).toEqual({
      nombre: 'Juan Gómez', cargo: 'Gerente', linkedin_url: null, confianza: 'media',
    });
  });
});

describe('planImportListos — hoja "LISTOS PARA ENVIAR" (con encabezados)', () => {
  const filaSartori = {
    Email: 'ADOLFO@SARTORI.COM.AR',
    Bandera_segmento: 'YPF una estación',
    'Operador/Decisor': 'ADOLFO SARTORI S.A.',
    Localidad: 'Venado Tuerto',
    Provincia: 'Santa Fe',
    'Tamaño_operador': 'chico',
    Origen: 'Todas las estaciones',
    Estado_envio: 'ENVIADO',
  };

  it('crea el operador: email lowercase, bandera extraída del segmento, datos completos y etapa contactado (ya enviado)', () => {
    const plan = planImportListos([filaSartori], { existentes: vacios });
    expect(plan.operadores).toHaveLength(1);
    expect(plan.operadores[0].accion).toBe('crear');
    expect(plan.operadores[0].data).toEqual({
      nombre: 'ADOLFO SARTORI S.A.',
      nombre_norm: 'adolfo sartori s.a.',
      banderas: ['YPF'],
      multibandera: false,
      etapa_prospeccion: 'contactado',
      emails: ['adolfo@sartori.com.ar'],
      notas: null,
      datos: {
        segmento: 'YPF una estación',
        tamano_operador: 'chico',
        origen: 'Todas las estaciones',
        estado_envio: 'ENVIADO',
        localidad: 'Venado Tuerto',
        provincia: 'Santa Fe',
      },
    });
    expect(plan.estaciones).toEqual([]);
    expect(plan.decisores).toEqual([]);
    expect(plan.resumen.nuevos).toEqual({ operadores: 1, estaciones: 0, decisores: 0 });
    expect(plan.resumen.errores).toEqual([]);
  });

  it('"Banderas nuevas" → sin bandera conocida; Estado_envio vacío o "pendiente" → sin_contactar', () => {
    const plan = planImportListos([
      { Email: 'a@b.com', Bandera_segmento: 'Banderas nuevas', 'Operador/Decisor': 'OP UNO', Estado_envio: '' },
      { Email: 'c@d.com', Bandera_segmento: 'Shell dos estaciones', 'Operador/Decisor': 'OP DOS', Estado_envio: 'Pendiente' },
    ], { existentes: vacios });
    expect(plan.operadores[0].data.banderas).toBe(null);
    expect(plan.operadores[0].data.etapa_prospeccion).toBe('sin_contactar');
    expect(plan.operadores[1].data.banderas).toEqual(['Shell']);
    expect(plan.operadores[1].data.etapa_prospeccion).toBe('sin_contactar');
  });

  it('nombre de PERSONA en Operador/Decisor va igual como operador (la planilla los mezcla: no se adivina)', () => {
    const plan = planImportListos(
      [{ Email: 'gino@aries.com.ar', 'Operador/Decisor': 'GINO GIAVENO', Bandera_segmento: 'Puma una estación', Estado_envio: 'ENVIADO' }],
      { existentes: vacios },
    );
    expect(plan.operadores[0].data.nombre).toBe('GINO GIAVENO');
    expect(plan.operadores[0].data.banderas).toEqual(['Puma']);
    expect(plan.decisores).toEqual([]);
  });

  it('typos de email: misma reparación/flag que Contactados (repararEmail compartida)', () => {
    const plan = planImportListos([
      { Email: 'admi.petrokom@gmailcom', 'Operador/Decisor': 'PETROKOM' },
      { Email: 'ariescomcosrl@hmail.com', 'Operador/Decisor': 'ARIES COMCO SRL' },
    ], { existentes: vacios });
    expect(plan.operadores[0].data.emails).toEqual(['admi.petrokom@gmail.com']);
    expect(plan.operadores[0].data.datos.email_original).toBe('admi.petrokom@gmailcom');
    expect(plan.operadores[1].data.emails).toEqual(['ariescomcosrl@hmail.com']);
    expect(plan.operadores[1].data.datos.email_sospechoso).toBe(true);
  });

  it('headers tolerantes: mayúsculas, espacios en vez de "_", sin tilde en Tamaño, espacios alrededor de "/"', () => {
    const plan = planImportListos([{
      'EMAIL': 'x@y.com', 'BANDERA SEGMENTO': 'YPF una estación', 'Operador / Decisor': 'OP T',
      'Tamano_operador': 'grande', 'ESTADO ENVIO': 'Enviado',
    }], { existentes: vacios });
    expect(plan.operadores[0].data.nombre).toBe('OP T');
    expect(plan.operadores[0].data.emails).toEqual(['x@y.com']);
    expect(plan.operadores[0].data.banderas).toEqual(['YPF']);
    expect(plan.operadores[0].data.etapa_prospeccion).toBe('contactado');
    expect(plan.operadores[0].data.datos.tamano_operador).toBe('grande');
  });

  it('dedup interno: mismo operador repetido en la hoja → uno solo, emails unidos, etapa más avanzada', () => {
    const plan = planImportListos([
      { Email: 'a@sartori.com.ar', 'Operador/Decisor': 'ADOLFO SARTORI S.A.', Estado_envio: '' },
      { Email: 'b@sartori.com.ar', 'Operador/Decisor': 'adolfo  sartori s.a.', Estado_envio: 'ENVIADO' },
    ], { existentes: vacios });
    expect(plan.operadores).toHaveLength(1);
    expect(plan.operadores[0].data.emails).toEqual(['a@sartori.com.ar', 'b@sartori.com.ar']);
    expect(plan.operadores[0].data.etapa_prospeccion).toBe('contactado');
  });

  it('dedup contra existentes por nombre_norm: llena huecos, sube sin_contactar → contactado y JAMÁS degrada', () => {
    const existentes = {
      operadores: [
        { id: 'op-1', nombre: 'Petrokom', nombre_norm: 'petrokom', banderas: [], multibandera: null, etapa_prospeccion: 'sin_contactar', emails: [], notas: '', datos: {} },
        { id: 'op-2', nombre: 'Grupo Sur', nombre_norm: 'grupo sur', banderas: ['YPF'], multibandera: false, etapa_prospeccion: 'respondio', emails: ['gruposur@gmail.com'], notas: '', datos: { segmento: 'YPF una estación', estado_envio: 'ENVIADO' } },
      ],
      estaciones: [], decisores: [],
    };
    const plan = planImportListos([
      { Email: 'admi@petrokom.com.ar', Bandera_segmento: 'YPF una estación', 'Operador/Decisor': 'PETROKOM', Estado_envio: 'ENVIADO' },
      { Email: 'gruposur@gmail.com', Bandera_segmento: 'YPF una estación', 'Operador/Decisor': 'GRUPO SUR', Estado_envio: 'ENVIADO' },
    ], { existentes });
    // op-1: sube la etapa y llena huecos
    expect(plan.operadores[0].accion).toBe('actualizar');
    expect(plan.operadores[0].id).toBe('op-1');
    expect(plan.operadores[0].data.etapa_prospeccion).toBe('contactado');
    expect(plan.operadores[0].data.emails).toEqual(['admi@petrokom.com.ar']);
    expect(plan.operadores[0].data.banderas).toEqual(['YPF']);
    expect(plan.operadores[0].data.datos).toEqual({ segmento: 'YPF una estación', estado_envio: 'ENVIADO' });
    // op-2: respondio > contactado (no se degrada) y todo lo demás ya está → saltear
    expect(plan.operadores[1].accion).toBe('saltear');
    expect(plan.operadores[1].id).toBe('op-2');
    expect(plan.operadores[1].motivo).toMatch(/sin datos nuevos/i);
    expect(plan.resumen.actualizados.operadores).toBe(1);
    expect(plan.resumen.salteados.operadores).toBe(1);
  });

  it('fila sin Operador/Decisor → error con número de fila (encabezado = fila 1)', () => {
    const plan = planImportListos([
      { Email: 'x@y.com', 'Operador/Decisor': 'OP UNO' },
      { Email: 'solo@email.com', Bandera_segmento: 'YPF una estación' },
    ], { existentes: vacios });
    expect(plan.resumen.errores).toHaveLength(1);
    expect(plan.resumen.errores[0].fila).toBe(3);
    expect(plan.resumen.errores[0].motivo).toMatch(/Operador\/Decisor/i);
    expect(plan.operadores).toHaveLength(1);
  });
});
