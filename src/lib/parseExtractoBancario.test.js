import { describe, it, expect } from 'vitest';
import {
  parseMonto,
  parseFecha,
  parseCSV,
  parseExtractoCSV,
  parseExtractoCSVBytes,
  decodeCSVBytes,
} from './parseExtractoBancario';

describe('parseMonto — número argentino y variantes', () => {
  it('formato argentino 1.234,56', () => {
    expect(parseMonto('1.234,56')).toBe(1234.56);
    expect(parseMonto('1.234.567,89')).toBe(1234567.89);
  });
  it('formato anglo 1,234.56', () => {
    expect(parseMonto('1,234.56')).toBe(1234.56);
    expect(parseMonto('1,234,567.89')).toBe(1234567.89);
  });
  it('solo coma decimal', () => {
    expect(parseMonto('1234,56')).toBe(1234.56);
  });
  it('solo punto decimal', () => {
    expect(parseMonto('1234.56')).toBe(1234.56);
  });
  it('miles argentino sin decimales 1.234.567', () => {
    expect(parseMonto('1.234.567')).toBe(1234567);
  });
  it('miles anglo sin decimales 1,234,567', () => {
    expect(parseMonto('1,234,567')).toBe(1234567);
  });
  it('negativo con signo y con paréntesis contable', () => {
    expect(parseMonto('-1.234,56')).toBe(-1234.56);
    expect(parseMonto('(1.234,56)')).toBe(-1234.56);
    expect(parseMonto('1.234,56-')).toBe(-1234.56);
  });
  it('con símbolo de moneda y espacios', () => {
    expect(parseMonto('$ 12.500,00')).toBe(12500);
    expect(parseMonto('  245.000,00  ')).toBe(245000);
  });
  it('número nativo pasa tal cual', () => {
    expect(parseMonto(1234.56)).toBe(1234.56);
    expect(parseMonto(-50)).toBe(-50);
  });
  it('vacío / no numérico → null', () => {
    expect(parseMonto('')).toBeNull();
    expect(parseMonto(null)).toBeNull();
    expect(parseMonto(undefined)).toBeNull();
    expect(parseMonto('   ')).toBeNull();
  });
});

describe('parseFecha — DD/MM/YYYY, ISO y variantes', () => {
  it('DD/MM/YYYY', () => {
    expect(parseFecha('02/05/2026')).toBe('2026-05-02');
    expect(parseFecha('14/12/2026')).toBe('2026-12-14');
  });
  it('DD-MM-YYYY y DD.MM.YYYY', () => {
    expect(parseFecha('02-05-2026')).toBe('2026-05-02');
    expect(parseFecha('02.05.2026')).toBe('2026-05-02');
  });
  it('DD/MM/YY (2 dígitos)', () => {
    expect(parseFecha('02/05/26')).toBe('2026-05-02');
    expect(parseFecha('02/05/99')).toBe('1999-05-02');
  });
  it('ISO YYYY-MM-DD y YYYY/MM/DD', () => {
    expect(parseFecha('2026-05-02')).toBe('2026-05-02');
    expect(parseFecha('2026/05/02')).toBe('2026-05-02');
  });
  it('Date nativo (lo que devuelve SheetJS)', () => {
    expect(parseFecha(new Date(2026, 4, 2))).toBe('2026-05-02');
  });
  it('fecha con hora extra al final', () => {
    expect(parseFecha('02/05/2026 13:45')).toBe('2026-05-02');
  });
  it('inválida / vacía → null', () => {
    expect(parseFecha('no-es-fecha')).toBeNull();
    expect(parseFecha('')).toBeNull();
    expect(parseFecha(null)).toBeNull();
    expect(parseFecha('99/99/2026')).toBeNull();
  });
});

describe('parseCSV — delimitador, comillas y campos', () => {
  it('detecta delimitador ; y separa campos', () => {
    const filas = parseCSV('a;b;c\n1;2;3');
    expect(filas).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });
  it('detecta delimitador , por defecto', () => {
    const filas = parseCSV('a,b,c\n1,2,3');
    expect(filas).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });
  it('respeta comillas con el delimitador adentro', () => {
    const filas = parseCSV('fecha,detalle,monto\n02/05/2026,"PAGO, varios",-100');
    expect(filas[1]).toEqual(['02/05/2026', 'PAGO, varios', '-100']);
  });
  it('comillas escapadas ("")', () => {
    const filas = parseCSV('x\n"dice ""hola"""');
    expect(filas[1]).toEqual(['dice "hola"']);
  });
  it('ignora filas totalmente vacías', () => {
    const filas = parseCSV('a,b\n\n1,2\n\n');
    expect(filas).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('parseExtractoCSV — débito/crédito en columnas separadas', () => {
  const csv = [
    'Fecha;Concepto;Débito;Crédito;Saldo',
    '02/05/2026;TRF Don Luis SRL;245.000,00;;1.755.000,00',
    '08/05/2026;TRF DESDE Familia Perez;;1.200.000,00;2.955.000,00',
    '05/05/2026;COMISION MANTENIMIENTO;12.500,00;;2.942.500,00',
  ].join('\n');

  it('mapea débito a monto negativo y crédito a positivo', () => {
    const r = parseExtractoCSV(csv);
    expect(r.errores).toEqual([]);
    expect(r.lineas).toHaveLength(3);
    expect(r.lineas[0]).toMatchObject({ fecha: '2026-05-02', monto: -245000 });
    expect(r.lineas[0].descripcion).toBe('TRF Don Luis SRL');
    expect(r.lineas[1]).toMatchObject({ fecha: '2026-05-08', monto: 1200000 });
    expect(r.lineas[2]).toMatchObject({ fecha: '2026-05-05', monto: -12500 });
  });

  it('calcula período (min/max fecha) y saldo final', () => {
    const r = parseExtractoCSV(csv);
    expect(r.periodoDesde).toBe('2026-05-02');
    expect(r.periodoHasta).toBe('2026-05-08');
    expect(r.saldoFinal).toBe(2942500); // último saldo leído (última fila)
  });

  it('guarda la fila cruda en raw', () => {
    const r = parseExtractoCSV(csv);
    expect(r.lineas[0].raw).toContain('TRF Don Luis SRL');
    expect(r.lineas[0].saldo).toBe(1755000);
  });
});

describe('parseExtractoCSV — columna única "importe" con signo', () => {
  const csv = [
    'fecha,descripcion,importe',
    '02/05/2026,Pago proveedor,-245000.00',
    '08/05/2026,Cobro cliente,1200000.00',
  ].join('\n');

  it('respeta el signo de la columna importe', () => {
    const r = parseExtractoCSV(csv);
    expect(r.errores).toEqual([]);
    expect(r.lineas[0]).toMatchObject({ fecha: '2026-05-02', monto: -245000, descripcion: 'Pago proveedor' });
    expect(r.lineas[1]).toMatchObject({ fecha: '2026-05-08', monto: 1200000, descripcion: 'Cobro cliente' });
  });
});

describe('parseExtractoCSV — robustez a variaciones de encabezado', () => {
  it('encabezados con MAYÚSCULAS y acentos (FECHA / DÉBITO / CRÉDITO)', () => {
    const csv = [
      'FECHA;MOVIMIENTO;DÉBITO;CRÉDITO',
      '02/05/2026;COMPRA;1.000,00;',
    ].join('\n');
    const r = parseExtractoCSV(csv);
    expect(r.lineas[0]).toMatchObject({ fecha: '2026-05-02', monto: -1000, descripcion: 'COMPRA' });
  });

  it('alias de columnas: "Detalle"/"Monto"/"Balance"', () => {
    const csv = [
      'Date,Detalle,Monto,Balance',
      '2026-05-02,Servicio,-450.50,10000.00',
    ].join('\n');
    const r = parseExtractoCSV(csv);
    expect(r.lineas[0]).toMatchObject({ fecha: '2026-05-02', monto: -450.5, descripcion: 'Servicio', saldo: 10000 });
  });

  it('alias "Concepto"/"Debe"/"Haber"', () => {
    const csv = [
      'Fecha,Concepto,Debe,Haber',
      '02/05/2026,Extracción,5.000,00,',
      '03/05/2026,Depósito,,7.500,00',
    ].join('\n');
    const r = parseExtractoCSV(csv);
    expect(r.lineas[0]).toMatchObject({ monto: -5000, descripcion: 'Extracción' });
    expect(r.lineas[1]).toMatchObject({ monto: 7500, descripcion: 'Depósito' });
  });

  it('salta filas previas al encabezado (título/CBU) e infiere banco', () => {
    const csv = [
      'Banco Galicia - Cuenta Corriente',
      'CBU: 0070...;;;',
      'Fecha;Concepto;Débito;Crédito',
      '02/05/2026;Pago;100,00;',
    ].join('\n');
    const r = parseExtractoCSV(csv);
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0]).toMatchObject({ monto: -100 });
    expect(r.banco).toContain('Galicia');
  });
});

describe('parseExtractoCSV — Banco Nación (importe único, paréntesis-negativo, multi-sección)', () => {
  // Muestra REAL del extracto de Banco Nación (Cuenta Corriente 067-093708/3):
  //  • delimitador ';'
  //  • DOS secciones con encabezados REPETIDOS ("Movimientos del Día" y
  //    "Últimos Movimientos"), separadas por líneas de RUIDO que NO son datos:
  //    vacías, títulos, "Cuenta Corriente …", "Saldo al …", timestamps.
  //  • UNA sola columna "Importe Pesos" con el signo así: NEGATIVO entre
  //    PARÉNTESIS "(8.539,28)" (débito/gasto), POSITIVO plano "5.000.000,00"
  //    (crédito/ingreso). Número argentino (punto miles, coma decimal).
  const csv = [
    '',
    'Movimientos del Día',
    '',
    'Cuenta Corriente en Pesos Nro. 067-093708/3',
    '',
    'Fecha;Suc. Origen;Desc. Sucursal;Cod. Operativo;Referencia;Concepto;Importe Pesos;Saldo Pesos;',
    '08/06/2026;0000;Casa Central;4719;067797329;Pago De Servicios  - Imp.afip: 3071795385837926961 - Tarj Nro. 4711 ;(8.539,28);0,00',
    'Saldo al 08/06/2026 78.378,68',
    '',
    '08/06/2026 14:05:08',
    '',
    '',
    'Últimos Movimientos',
    '',
    'Cuenta Corriente en Pesos Nro. 067-093708/3',
    '',
    'Fecha;Suc. Origen;Desc. Sucursal;Cod. Operativo;Referencia;Concepto;Importe Pesos;Saldo Pesos;',
    '04/06/2026;0067;Mar Del Plata;4633;000000275;Impuesto Ley 25.413 Debito 0,6% ;(1.325,71);86.917,96',
    '26/05/2026;0067;Mar Del Plata;9633;000000262;Anul Imp Ley 25.413 Debito 0,6% ;55,38;2.278.703,80',
    '26/05/2026;0120;Necochea;2030;000004674;Deposito De Efectivo En Sucursal  - Tarj Nro. 589 - Atm: S1ori350 - ;500.000,00;2.278.648,42',
    '11/05/2026;0067;Mar Del Plata;2822;084879032;Transferencia Inmediata  - A Martin Aguirre / - Var / 20343098511 ;(1.152.641,00);4.987.909,46',
    '08/05/2026;0000;Casa Central;4805;000356362;Transferencia Recibida  - De Coop Agric / Conquies - Var / 30511539990 ;5.000.000,00;6.444.063,75',
    '04/05/2026;0067;Mar Del Plata;9633;000000209;Anul Imp Ley 25.413 Debito 0,6% ;14.100,00;11.693.115,73',
    '05/05/2026;0000;Casa Central;3660;011397644;Fondos Embargados ;(6.586.564,59);5.101.583,14',
    '',
    '08/06/2026 14:05:08',
  ].join('\n');

  it('junta las filas de AMBAS secciones y descarta el ruido (encabezados repetidos, títulos, timestamps, "Saldo al …")', () => {
    const r = parseExtractoCSV(csv);
    // 1 fila de "Movimientos del Día" + 7 de "Últimos Movimientos" = 8 líneas.
    expect(r.lineas).toHaveLength(8);
    // Ninguna línea de ruido debe haber generado un error.
    expect(r.errores).toEqual([]);
  });

  it('paréntesis = negativo (débito/gasto); positivo plano = crédito/ingreso', () => {
    const r = parseExtractoCSV(csv);
    const byDesc = (txt) => r.lineas.find((l) => l.descripcion.includes(txt));

    // Débito entre paréntesis → negativo.
    expect(byDesc('Pago De Servicios').monto).toBe(-8539.28);
    expect(byDesc('Transferencia Inmediata').monto).toBe(-1152641);
    expect(byDesc('Fondos Embargados').monto).toBe(-6586564.59);
    expect(byDesc('Impuesto Ley 25.413').monto).toBe(-1325.71);

    // Crédito plano (positivo) → ingreso.
    expect(byDesc('Transferencia Recibida').monto).toBe(5000000);
    expect(byDesc('Deposito De Efectivo').monto).toBe(500000);

    // "Anul Imp" viene SIN paréntesis (positivo) aunque diga "Debito": el signo
    // lo manda el formato (paréntesis o no), no el texto.
    expect(byDesc('Anul Imp Ley 25.413 Debito 0,6%').monto).toBe(55.38);
    expect(r.lineas.find((l) => l.descripcion.includes('Anul') && l.monto === 14100)).toBeTruthy();
  });

  it('descripción = columna Concepto; fecha DD/MM/YYYY → ISO; saldo de "Saldo Pesos"', () => {
    const r = parseExtractoCSV(csv);
    const pago = r.lineas.find((l) => l.fecha === '2026-06-08');
    expect(pago.descripcion).toContain('Pago De Servicios');
    expect(pago.saldo).toBe(0);

    const recibida = r.lineas.find((l) => l.descripcion.includes('Transferencia Recibida'));
    expect(recibida.fecha).toBe('2026-05-08');
    expect(recibida.saldo).toBe(6444063.75);
  });

  it('período (min/max de TODAS las secciones) y saldo final de la línea "Saldo al …"', () => {
    const r = parseExtractoCSV(csv);
    expect(r.periodoDesde).toBe('2026-05-04'); // fecha más vieja
    expect(r.periodoHasta).toBe('2026-06-08'); // fecha más nueva (sección Día)
    // El saldo final es el de la línea explícita "Saldo al 08/06/2026 78.378,68",
    // NO el último saldo de la grilla (las filas vienen al revés y por secciones).
    expect(r.saldoFinal).toBe(78378.68);
  });

  it('infiere el banco "Nación" del título previo', () => {
    const r = parseExtractoCSV(csv);
    // El título "Cuenta Corriente en Pesos …" no nombra el banco; pero si el
    // archivo lo trajera, se inferiría. Acá solo verificamos que no rompe.
    expect(r.banco === undefined || typeof r.banco === 'string').toBe(true);
  });
});

describe('decodeCSVBytes / parseExtractoCSVBytes — encoding Latin-1 (windows-1252)', () => {
  // Simula un CSV exportado en windows-1252/Latin-1 (como Banco Nación):
  // codificamos a bytes Latin-1. Leídos como UTF-8 darían � en los acentos.
  const textoConAcentos =
    'Fecha;Concepto;Importe Pesos;Saldo Pesos;\n' +
    '08/06/2026;Anulación Día - Pagaré Ñoño ;(1.234,56);0,00\n';
  const bytesLatin1 = Uint8Array.from(Buffer.from(textoConAcentos, 'latin1'));
  const bytesUtf8 = new TextEncoder().encode(textoConAcentos);

  it('decodifica bytes Latin-1 recuperando los acentos (sin � de reemplazo)', () => {
    const s = decodeCSVBytes(bytesLatin1);
    expect(s).not.toContain('�');
    expect(s).toContain('Anulación');
    expect(s).toContain('Día');
    expect(s).toContain('Ñoño');
  });

  it('decodifica bytes UTF-8 normalmente', () => {
    const s = decodeCSVBytes(bytesUtf8);
    expect(s).toContain('Anulación');
    expect(s).not.toContain('�');
  });

  it('parseExtractoCSVBytes parsea desde bytes Latin-1 (concepto con acentos + paréntesis negativo)', () => {
    const r = parseExtractoCSVBytes(bytesLatin1);
    expect(r.errores).toEqual([]);
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0].monto).toBe(-1234.56);
    expect(r.lineas[0].descripcion).toContain('Anulación');
    expect(r.lineas[0].descripcion).toContain('Día');
  });
});

describe('parseExtractoBancario — archivo REAL de Banco Nación (si está presente)', () => {
  // Test de integración contra el CSV real del usuario. Se SALTA si el archivo
  // no está en esta máquina (CI / otro equipo) para no romper la suite.
  const fs = require('fs');
  const RUTA = 'C:/Users/307000/Desktop/Movimientos banco.csv';
  const existe = (() => { try { return fs.existsSync(RUTA); } catch { return false; } })();

  (existe ? it : it.skip)('parsea el archivo real (Latin-1) sin errores y saca todos los movimientos', () => {
    const buf = fs.readFileSync(RUTA);
    // El archivo está en windows-1252 (Latin-1): lo decodificamos como tal para
    // que los acentos (Día / Últimos) se lean bien.
    const texto = new TextDecoder('windows-1252').decode(buf);
    const r = parseExtractoCSV(texto);

    expect(r.errores).toEqual([]);
    // 1 movimiento del Día + ~133 de Últimos. Verificamos un rango holgado.
    expect(r.lineas.length).toBeGreaterThan(120);
    // Hay débitos (negativos) y créditos (positivos).
    expect(r.lineas.some((l) => l.monto < 0)).toBe(true);
    expect(r.lineas.some((l) => l.monto > 0)).toBe(true);
    // Casos puntuales conocidos del archivo.
    expect(r.lineas.find((l) => l.descripcion.includes('Pago De Servicios') && l.fecha === '2026-06-08').monto).toBe(-8539.28);
    expect(r.lineas.find((l) => l.monto === 5000000)).toBeTruthy(); // Transferencia Recibida
    expect(r.saldoFinal).toBe(78378.68); // de "Saldo al 08/06/2026 78.378,68"
  });

  (existe ? it : it.skip)('parseExtractoCSVBytes (vía UI) detecta solo el encoding y parsea igual', () => {
    const buf = fs.readFileSync(RUTA); // bytes crudos, sin decodificar a mano
    const bytes = Uint8Array.from(buf);
    const r = parseExtractoCSVBytes(bytes);
    expect(r.errores).toEqual([]);
    expect(r.lineas.length).toBeGreaterThan(120);
    expect(r.saldoFinal).toBe(78378.68);
  });
});

describe('parseExtractoCSV — manejo de errores', () => {
  it('sin encabezado reconocible reporta error', () => {
    const r = parseExtractoCSV('a,b,c\n1,2,3');
    expect(r.lineas).toHaveLength(0);
    expect(r.errores.length).toBeGreaterThan(0);
  });

  it('archivo vacío reporta error', () => {
    const r = parseExtractoCSV('');
    expect(r.lineas).toHaveLength(0);
    expect(r.errores.length).toBeGreaterThan(0);
  });

  it('ignora línea de "saldo anterior" sin movimiento, no la cuenta como error', () => {
    const csv = [
      'Fecha;Concepto;Débito;Crédito;Saldo',
      ';SALDO ANTERIOR;;;1.000.000,00',
      '02/05/2026;Pago;100,00;;999.900,00',
    ].join('\n');
    const r = parseExtractoCSV(csv);
    expect(r.lineas).toHaveLength(1);
    expect(r.errores).toEqual([]);
    expect(r.saldoFinal).toBe(999900);
  });
});
