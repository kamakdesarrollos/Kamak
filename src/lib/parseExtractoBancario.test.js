import { describe, it, expect } from 'vitest';
import {
  parseMonto,
  parseFecha,
  parseCSV,
  parseExtractoCSV,
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
