// parseExtractoBancario — parser GENÉRICO de extractos bancarios (CSV + XLSX).
//
// Para la conciliación bancaria. Un extracto es una grilla con encabezado: una
// fila por movimiento del banco. NO hay un formato único (cada banco arma el
// suyo), así que esto NO está atado a ningún banco: auto-detecta las columnas
// por KEYWORDS del encabezado (tolerante a mayúsculas y acentos) y normaliza
// cada fila a un shape estable que la UI de conciliación pueda matchear contra
// los movimientos del sistema.
//
// Salida de parseExtracto(...) → {
//   lineas: [{ fecha:'YYYY-MM-DD', descripcion, monto (NÚMERO con signo:
//              + crédito/ingreso, − débito/gasto), saldo (número|null), raw }],
//   periodoDesde, periodoHasta,  // 'YYYY-MM-DD'|null (min/max de fechas)
//   saldoFinal,                  // último saldo leído, o null
//   banco,                       // string|undefined si se pudo inferir
//   errores: [string]            // filas que no se pudieron parsear, etc.
// }
//
// Convenciones del dominio (ver src/lib/caja.js): en Kamak el monto guardado es
// SIEMPRE positivo y el signo lo da el tipo (gasto/ingreso). Acá en cambio
// devolvemos el monto CON SIGNO porque es lo natural de un extracto y simplifica
// el match; la UI decide el tipo a partir del signo.

import { searchNorm } from './searchNorm';

// ───────────────────────── helpers de número/fecha ─────────────────────────

// Convierte un string de monto a NÚMERO. Maneja formato argentino (1.234,56),
// formato anglo (1,234.56), paréntesis para negativos (1.234,56) y signos.
// Devuelve null si no hay nada parseable.
export function parseMonto(valor) {
  if (valor == null) return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  let s = String(valor).trim();
  if (!s) return null;

  // Negativo por paréntesis contable: (1.234,56) → -1234.56
  let negativo = false;
  if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1).trim(); }

  // Signo explícito al principio o al final.
  if (/^-/.test(s) || /-$/.test(s)) { negativo = true; }
  if (/^\+/.test(s) || /\+$/.test(s)) { /* positivo */ }

  // Sacar todo lo que no sea dígito, coma, punto (símbolos $, espacios, signos…).
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;

  const tieneComa = s.includes(',');
  const tienePunto = s.includes('.');

  if (tieneComa && tienePunto) {
    // El separador DECIMAL es el último que aparece; el otro es de miles.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      // 1.234,56 (argentino) → quitar puntos, coma a punto.
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // 1,234.56 (anglo) → quitar comas.
      s = s.replace(/,/g, '');
    }
  } else if (tieneComa) {
    // Solo coma. Si parece miles (grupos de 3 sin decimales: 1,234,567) la
    // tratamos como separador de miles; sino, como decimal (1234,56).
    if (/^\d{1,3}(,\d{3})+$/.test(s)) {
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(',', '.');
    }
  } else if (tienePunto) {
    // Solo punto. Si parece miles argentino (1.234.567) lo sacamos; sino es decimal.
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '');
    }
    // else: 1234.56 ya es válido.
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negativo ? -Math.abs(n) : n;
}

// Convierte una fecha a 'YYYY-MM-DD'. Acepta DD/MM/YYYY, DD-MM-YYYY, DD/MM/YY,
// YYYY-MM-DD, YYYY/MM/DD y Date (lo que devuelve SheetJS con cellDates).
// Devuelve null si no se puede.
export function parseFecha(valor) {
  if (valor == null || valor === '') return null;

  // SheetJS puede devolver Date directamente.
  if (valor instanceof Date && !isNaN(valor)) {
    return toISO(valor.getFullYear(), valor.getMonth() + 1, valor.getDate());
  }

  const s = String(valor).trim();
  if (!s) return null;

  // YYYY-MM-DD o YYYY/MM/DD (ISO, año primero, 4 dígitos).
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return toISO(+m[1], +m[2], +m[3]);

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DD/MM/YY.
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let [, d, mo, y] = m;
    y = +y;
    if (y < 100) y += y < 70 ? 2000 : 1900; // 2 dígitos: 00-69→20xx, 70-99→19xx
    return toISO(y, +mo, +d);
  }

  return null;
}

function toISO(y, mo, d) {
  if (!y || !mo || !d) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${y}-${pad(mo)}-${pad(d)}`;
}

// ───────────────────────── detección de columnas ─────────────────────────

// Cada campo lógico con sus keywords (ya normalizadas: sin acentos, minúsc).
// El orden importa: se evalúa de más específico a más genérico.
const COLUMNAS = {
  fecha:       ['fecha valor', 'fecha mov', 'fecha', 'date', 'dia'],
  debito:      ['debitos', 'debito', 'debe', 'cargo', 'egreso', 'salida', 'retiro'],
  credito:     ['creditos', 'credito', 'haber', 'abono', 'ingreso', 'deposito', 'entrada'],
  importe:     ['importe', 'monto', 'valor', 'amount'],
  saldo:       ['saldo', 'balance'],
  descripcion: ['descripcion', 'concepto', 'detalle', 'movimiento', 'referencia',
                'leyenda', 'observacion', 'observaciones', 'glosa', 'transaccion'],
};

// Dada una fila de encabezados (array de strings), devuelve un mapa
// { campo: índiceDeColumna }. Una misma columna no se asigna a dos campos.
function detectarColumnas(headers) {
  const norm = headers.map((h) => searchNorm(h).trim());
  const mapa = {};
  const usadas = new Set();

  for (const [campo, keywords] of Object.entries(COLUMNAS)) {
    for (const kw of keywords) {
      // Buscar primero match EXACTO (encabezado = keyword), luego "incluye".
      let idx = norm.findIndex((h, i) => !usadas.has(i) && h === kw);
      if (idx === -1) idx = norm.findIndex((h, i) => !usadas.has(i) && h.includes(kw));
      if (idx !== -1) { mapa[campo] = idx; usadas.add(idx); break; }
    }
  }
  return mapa;
}

// ¿Esta fila (array) parece el encabezado? Heurística: contiene al menos una
// keyword de fecha y al menos una de monto/débito/crédito/importe.
function pareceEncabezado(fila) {
  const norm = fila.map((c) => searchNorm(c));
  const tiene = (lista) => norm.some((h) => h && lista.some((kw) => h.includes(kw)));
  const tieneFecha = tiene(COLUMNAS.fecha);
  const tieneMonto =
    tiene(COLUMNAS.debito) || tiene(COLUMNAS.credito) || tiene(COLUMNAS.importe);
  return tieneFecha && tieneMonto;
}

// ───────────────────────── CSV nativo ─────────────────────────

// Detecta el delimitador más probable (',' o ';' o tab) mirando la primera
// línea no vacía: el que más aparece fuera de comillas.
function detectarDelimitador(texto) {
  const primera = texto.split(/\r?\n/).find((l) => l.trim()) || '';
  const candidatos = [';', ',', '\t', '|'];
  let mejor = ',';
  let max = -1;
  for (const d of candidatos) {
    const n = contarFuera(primera, d);
    if (n > max) { max = n; mejor = d; }
  }
  return mejor;
}

function contarFuera(linea, delim) {
  let n = 0, enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') enComillas = !enComillas;
    else if (c === delim && !enComillas) n++;
  }
  return n;
}

// Parser CSV mínimo pero correcto: respeta comillas, comillas escapadas ("")
// y campos multi-línea dentro de comillas. Devuelve array de filas (array de
// strings).
export function parseCSV(texto, delim) {
  const d = delim || detectarDelimitador(texto);
  // Sacar BOM si lo hay.
  const t = texto.replace(/^﻿/, '');
  const filas = [];
  let fila = [];
  let campo = '';
  let enComillas = false;

  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (enComillas) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; } // comilla escapada
        else enComillas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      enComillas = true;
    } else if (c === d) {
      fila.push(campo); campo = '';
    } else if (c === '\n') {
      fila.push(campo); campo = '';
      filas.push(fila); fila = [];
    } else if (c === '\r') {
      // ignorar (se cierra la fila en el \n que suele seguir, o al final)
    } else {
      campo += c;
    }
  }
  // último campo/fila si el archivo no termina en salto de línea
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }

  // Limpiar filas totalmente vacías.
  return filas
    .map((f) => f.map((c) => c.trim()))
    .filter((f) => f.some((c) => c !== ''));
}

// ───────────────────────── XLSX vía SheetJS ─────────────────────────

// Lee un ArrayBuffer/Uint8Array XLSX a matriz de filas (array de array).
// Import dinámico para no cargar SheetJS hasta que realmente se importe un .xlsx.
async function xlsxToMatriz(buffer) {
  const mod = await import('xlsx');
  const XLSX = mod.read ? mod : mod.default; // tolera default/namespace
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  // header:1 → matriz cruda; raw:false formatea, pero pedimos las celdas tal cual
  // donde se pueda. defval:'' para no perder columnas.
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
}

// ───────────────────────── núcleo: matriz → resultado ─────────────────────────

// Toma una matriz de filas (array de array de celdas) y la normaliza.
function procesarMatriz(matriz) {
  const errores = [];
  const lineas = [];

  // Filtrar filas completamente vacías.
  const filas = (matriz || []).filter(
    (f) => Array.isArray(f) && f.some((c) => c != null && String(c).trim() !== '')
  );

  if (!filas.length) {
    return { lineas, periodoDesde: null, periodoHasta: null, saldoFinal: null, errores: ['El archivo está vacío.'] };
  }

  // Buscar la fila de encabezado dentro de las primeras ~15 (algunos extractos
  // traen título/razón social/CBU antes de la grilla).
  let headerIdx = -1;
  for (let i = 0; i < Math.min(filas.length, 15); i++) {
    if (pareceEncabezado(filas[i])) { headerIdx = i; break; }
  }
  if (headerIdx === -1) {
    return {
      lineas, periodoDesde: null, periodoHasta: null, saldoFinal: null,
      errores: ['No se encontró un encabezado reconocible (se buscan columnas de fecha y de monto/débito/crédito).'],
    };
  }

  // Inferir nombre del banco de las filas previas al encabezado, si hay texto.
  let banco;
  for (let i = 0; i < headerIdx; i++) {
    const texto = filas[i].map((c) => String(c ?? '').trim()).filter(Boolean).join(' ');
    const n = searchNorm(texto);
    const hit = ['galicia', 'santander', 'nacion', 'bbva', 'macro', 'provincia',
      'icbc', 'hsbc', 'supervielle', 'patagonia', 'credicoop', 'comafi',
      'brubank', 'mercado pago', 'uala', 'ualá', 'naranja'].find((b) => n.includes(b));
    if (hit) { banco = texto; break; }
  }

  const headers = filas[headerIdx].map((c) => String(c ?? ''));
  const cols = detectarColumnas(headers);

  if (cols.fecha == null) {
    errores.push('No se detectó la columna de fecha.');
  }
  const tieneDebCred = cols.debito != null || cols.credito != null;
  if (cols.importe == null && !tieneDebCred) {
    errores.push('No se detectó columna de importe ni de débito/crédito.');
  }

  const fechas = [];
  let saldoFinal = null;

  for (let r = headerIdx + 1; r < filas.length; r++) {
    const fila = filas[r];
    const cell = (i) => (i == null ? '' : fila[i]);

    const fecha = parseFecha(cell(cols.fecha));
    const descripcion = String(cell(cols.descripcion) ?? '').trim();

    // Monto con signo:
    let monto = null;
    if (tieneDebCred) {
      const deb = parseMonto(cell(cols.debito));
      const cred = parseMonto(cell(cols.credito));
      // Débito = gasto (−), crédito = ingreso (+). Usamos valor absoluto por las
      // dudas que el extracto ya traiga el débito en negativo.
      if (deb != null && deb !== 0) monto = -Math.abs(deb);
      else if (cred != null && cred !== 0) monto = Math.abs(cred);
      else if (deb === 0 && cred != null && cred !== 0) monto = Math.abs(cred);
      else if (cred === 0 && deb != null && deb !== 0) monto = -Math.abs(deb);
    } else if (cols.importe != null) {
      monto = parseMonto(cell(cols.importe)); // ya viene con signo
    }

    const saldo = cols.saldo != null ? parseMonto(cell(cols.saldo)) : null;

    // Una fila es válida si tiene fecha Y algún monto. Las que solo traen saldo
    // (líneas de "saldo anterior"/"saldo final") no son movimientos: igual
    // actualizan saldoFinal pero no entran como línea.
    const esMovimiento = fecha != null && monto != null;

    if (saldo != null) saldoFinal = saldo;

    if (!esMovimiento) {
      // Si la fila tenía contenido real pero no pudimos sacar fecha+monto, la
      // reportamos como error (salvo que sea claramente una línea de saldo).
      const tieneAlgo = fila.some((c) => c != null && String(c).trim() !== '');
      const soloSaldo = fecha == null && monto == null && saldo != null;
      if (tieneAlgo && !soloSaldo) {
        errores.push(`Fila ${r + 1}: no se pudo interpretar (fecha="${cell(cols.fecha)}", monto sin valor).`);
      }
      continue;
    }

    fechas.push(fecha);
    lineas.push({
      fecha,
      descripcion,
      monto: redondear(monto),
      saldo: saldo != null ? redondear(saldo) : null,
      raw: fila.map((c) => (c == null ? '' : String(c).trim())),
    });
  }

  fechas.sort();
  return {
    lineas,
    periodoDesde: fechas[0] ?? null,
    periodoHasta: fechas[fechas.length - 1] ?? null,
    saldoFinal,
    banco,
    errores,
  };
}

// Redondea a 2 decimales (evita 12345.6700000001 de floats).
function redondear(n) {
  return Math.round(n * 100) / 100;
}

// ───────────────────────── API pública ─────────────────────────

// Parsea un extracto desde TEXTO CSV ya leído.
export function parseExtractoCSV(texto) {
  try {
    const matriz = parseCSV(texto);
    return procesarMatriz(matriz);
  } catch (e) {
    return { lineas: [], periodoDesde: null, periodoHasta: null, saldoFinal: null, errores: ['Error al leer el CSV: ' + (e?.message || e)] };
  }
}

// Parsea un extracto desde un ArrayBuffer/Uint8Array XLSX.
export async function parseExtractoXLSX(buffer) {
  try {
    const matriz = await xlsxToMatriz(buffer);
    return procesarMatriz(matriz);
  } catch (e) {
    return { lineas: [], periodoDesde: null, periodoHasta: null, saldoFinal: null, errores: ['Error al leer el XLSX: ' + (e?.message || e)] };
  }
}

// Entrada principal desde la UI: recibe un File (input type=file) y decide
// CSV vs XLSX por extensión / contenido. Devuelve el resultado normalizado.
export async function parseExtractoFile(file) {
  if (!file) {
    return { lineas: [], periodoDesde: null, periodoHasta: null, saldoFinal: null, errores: ['No se recibió ningún archivo.'] };
  }
  const nombre = (file.name || '').toLowerCase();
  const esXlsx = /\.(xlsx|xlsm|xls)$/.test(nombre);

  if (esXlsx) {
    const buffer = await file.arrayBuffer();
    return parseExtractoXLSX(buffer);
  }
  // Por defecto, CSV / texto.
  const texto = await file.text();
  return parseExtractoCSV(texto);
}
