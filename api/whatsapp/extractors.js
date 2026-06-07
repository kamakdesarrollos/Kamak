// Pre-extractor de slots para mensajes del bot WhatsApp.
//
// Filosofía: antes de llamar a Claude (caro y lento), corremos regex y fuzzy
// matching para extraer todo lo posible del mensaje. El resultado se mergea
// en `conv.data.slots`. Si después de mergear están todos los slots requeridos
// por la intent, salteamos Claude entero y vamos directo a confirmación.
//
// Esto resuelve el problema típico: user escribe
//   "AGENDA AVANCE DE OBRA 25 MTS2 DE COLOCACION DE PISOS"
// y antes de este módulo, el bot preguntaba (uno por uno) intent, cantidad,
// unidad, tarea, etc. Ahora todo se extrae en una pasada.

// ── Normalización ────────────────────────────────────────────────────────────
export function normalizar(s) {
  if (!s) return '';
  return s.toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Intent ───────────────────────────────────────────────────────────────────
const INTENT_KEYWORDS = {
  // Cuenta por pagar: alta de factura pendiente SIN tocar caja. DEBE chequearse
  // ANTES de 'gasto' (que matchea 'factura'/'comprobante' y se la comería).
  cargar_factura: ['cargar factura', 'factura pendiente', 'nueva factura', 'orden de pago', 'le debo a', 'debo pagar a'],
  gasto:      ['gasto', 'gaste', 'gasté', 'compre', 'compré', 'pague', 'pagué', 'pagar', 'factura', 'comprobante'],
  ingreso:    ['ingreso', 'cobro', 'cobré', 'cobre', 'cobrar', 'recibi', 'recibí', 'me transfirieron', 'me pagaron', 'me deposito', 'me depositó'],
  avance:     ['avance', 'avanc', 'avancé', 'hice', 'terminé', 'termine', 'completé', 'complete', 'progreso', 'agenda avance', 'agendar avance', 'registrar avance', 'cargar avance'],
  cheque:     ['cheque', 'echeq', 'e-cheq'],
  tarea:      ['nueva tarea', 'crear tarea', 'creale tarea', 'creale una tarea', 'asigname una tarea', 'asigname tarea', 'agendá tarea', 'agendar tarea'],
  // Comercial — alta de oportunidad. Específicos ('prospecto') para no chocar con 'gasto'.
  crear_prospecto: ['nuevo prospecto', 'prospecto nuevo', 'nueva oportunidad', 'oportunidad nueva', 'cargar prospecto', 'crear prospecto', 'nuevo lead'],
  // Comercial — mover de etapa en el embudo. 'a ganado'/'a perdido' son señales fuertes.
  mover_etapa: ['a ganado', 'a perdido', 'a negociacion', 'a negociación', 'a cotizado', 'pasa a', 'pasá a', 'pasar a', 'pasalo a', 'mover a', 'moverla a', 'cambiar etapa', 'cambiar de etapa'],
  traspaso:   ['traspaso', 'pasar de', 'pasá de', 'pasame', 'mover de', 'transferir de'],
  consulta:   ['como va', 'cómo va', 'estado de', 'resumen de', 'saldo de', 'cuanto', 'cuánto'],
};

export function extractIntent(text) {
  const t = normalizar(text);
  // Orden: chequeo más específicos primero para que "agenda avance" no matchee "tarea".
  // 'crear_prospecto'/'mover_etapa' antes de 'traspaso'/'ingreso'/'gasto' para que
  // "pasá Shell a ganado" o "nuevo prospecto" no se confundan con traspaso/gasto.
  // 'cargar_factura' va ANTES de 'gasto': "cargar factura"/"orden de pago"/"le debo
  // a" son facturas pendientes (cuentas por pagar), no gastos de caja.
  const orden = ['avance', 'cheque', 'tarea', 'crear_prospecto', 'mover_etapa', 'cargar_factura', 'traspaso', 'ingreso', 'gasto', 'consulta'];
  for (const intent of orden) {
    for (const kw of INTENT_KEYWORDS[intent]) {
      if (t.includes(kw)) return intent;
    }
  }
  return null;
}

// ── Monto (gastos / ingresos) ────────────────────────────────────────────────
// Matchea: $50.000, 50000, 50 mil, 50k, 50K, $50k, $50.5k, 50.5 mil, 2M, etc.
export function extractMonto(text) {
  if (!text) return null;
  // Buscamos patrones tipo: [$|usd|u$s]? NUMBER [k|mil|m|millon|millones]?
  const re = /(?:\$|usd|u\$s|ars)?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(k|mil|m|millon|millones|mm)?/gi;
  let best = null;
  let m;
  while ((m = re.exec(text)) !== null) {
    let numStr = m[1];
    const sufijo = (m[2] || '').toLowerCase();
    // Normalizar separadores: si hay punto y coma, asumimos punto como miles y coma como decimal.
    // Si solo hay puntos, asumimos miles (típico argentino) salvo que haya 1-2 dígitos después.
    let n;
    const hasComma = numStr.includes(',');
    const hasDot   = numStr.includes('.');
    if (hasComma && hasDot) {
      numStr = numStr.replace(/\./g, '').replace(',', '.');
    } else if (hasDot && !hasComma) {
      // Si el último grupo después del punto tiene 3 dígitos → miles. Sino, decimal.
      const parts = numStr.split('.');
      const last = parts[parts.length - 1];
      if (last.length === 3 && parts.length > 1) numStr = numStr.replace(/\./g, '');
      // si no, queda como decimal
    } else if (hasComma) {
      // Coma como decimal (formato argentino: 50,5)
      numStr = numStr.replace(',', '.');
    }
    n = parseFloat(numStr);
    if (isNaN(n)) continue;
    if (sufijo === 'k' || sufijo === 'mil') n *= 1000;
    else if (sufijo === 'm' || sufijo === 'mm' || sufijo === 'millon' || sufijo === 'millones') n *= 1000000;
    // Solo aceptamos montos plausibles (> 100). Esto descarta "25 m²" o años.
    if (n >= 100 && (!best || n > best)) best = n;
  }
  return best;
}

// ── Cantidad + unidad (avances de obra) ──────────────────────────────────────
// Matchea: 25 m², 25 mts2, 25 m2, 30 ml, 50%, 100 kg, 5 u, 5 unidades.
const UNIDAD_ALIASES = {
  'm2': 'm²', 'm²': 'm²', 'mts2': 'm²', 'mts²': 'm²', 'metros2': 'm²', 'metroscuadrados': 'm²',
  'm3': 'm³', 'm³': 'm³', 'mts3': 'm³',
  'ml': 'ml', 'metroslineales': 'ml',
  '%': '%', 'porciento': '%', 'porcentaje': '%',
  'kg': 'kg', 'kilos': 'kg', 'kilo': 'kg',
  'u': 'u', 'unidad': 'u', 'unidades': 'u',
  'gl': 'gl', 'global': 'gl',
};

export function extractCantidadUnidad(text) {
  if (!text) return null;
  const t = normalizar(text);
  // Buscar: NUMERO + (opcional espacio) + UNIDAD
  const re = /(\d+(?:[.,]\d+)?)\s*(m[2²³]?|mts[2²³]?|ml|metros?\s*(?:cuadrados|lineales)?|%|porciento|porcentaje|kg|kilos?|u|unidades?|unidad|gl|global)\b/gi;
  let m;
  let best = null;
  while ((m = re.exec(t)) !== null) {
    const cantStr = m[1].replace(',', '.');
    const cantidad = parseFloat(cantStr);
    if (isNaN(cantidad) || cantidad <= 0 || cantidad > 100000) continue;
    const rawUnit = m[2].replace(/\s/g, '');
    const unidad = UNIDAD_ALIASES[rawUnit] || UNIDAD_ALIASES[rawUnit.replace(/s$/, '')] || rawUnit;
    // Preferimos el match con unidad m²/m³/ml/% (avance típico) sobre kg/u.
    const prioridad = ['m²', 'm³', 'ml', '%'].includes(unidad) ? 2 : 1;
    if (!best || prioridad > best.prioridad) best = { cantidad, unidad, prioridad };
  }
  return best ? { cantidad: best.cantidad, unidad: best.unidad } : null;
}

// ── Matcher fuzzy por nombre ─────────────────────────────────────────────────
// Devuelve el item cuyo nombre matchea mejor con el texto. Estrategia:
// 1) Match exacto (nombre completo aparece en el texto) → score alto.
// 2) Match por palabras significativas (cualquier palabra >3 chars que aparezca).
// 3) Si hay un único match, lo devuelve aunque sea débil.
function matchPorNombre(text, items, getNombre = i => i.nombre) {
  if (!items || items.length === 0) return null;
  const t = normalizar(text);
  const scored = items.map(item => {
    const nombre = normalizar(getNombre(item));
    if (!nombre) return { item, score: 0 };
    if (t.includes(nombre)) return { item, score: 100 + nombre.length };
    // Por palabras significativas
    const palabras = nombre.split(/[\s,.\-/()]+/).filter(p => p.length > 3);
    let score = 0;
    for (const p of palabras) {
      if (t.includes(p)) score += p.length;
    }
    return { item, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.score === 0) return null;
  // Si el segundo está muy cerca (ambigüedad) y ninguno fue exact match, no decidimos.
  const second = scored[1];
  if (second && top.score < 100 && second.score >= top.score * 0.85) return null;
  return top.item;
}

// ── Obra ─────────────────────────────────────────────────────────────────────
export function extractObra(text, obras) {
  return matchPorNombre(text, obras || []);
}

// ── Comercial: etapa destino del embudo ──────────────────────────────────────
// Detecta a qué etapa quiere mover la oportunidad. Devuelve la etapa canónica
// ('prospecto'|'cotizado'|'negociacion'|'ganado'|'perdido') o null.
const ETAPA_ALIASES = {
  prospecto: 'prospecto', prospect: 'prospecto', lead: 'prospecto',
  cotizado: 'cotizado', cotizacion: 'cotizado', cotizada: 'cotizado', presupuestado: 'cotizado', presupuestada: 'cotizado',
  negociacion: 'negociacion', negociando: 'negociacion', negociar: 'negociacion',
  ganado: 'ganado', ganada: 'ganado', ganamos: 'ganado', cerrado: 'ganado', cerrada: 'ganado',
  perdido: 'perdido', perdida: 'perdido', perdimos: 'perdido', caido: 'perdido', caida: 'perdido', descartado: 'perdido', descartada: 'perdido',
};
export function extractEtapaDestino(text) {
  const t = normalizar(text);
  for (const [alias, etapa] of Object.entries(ETAPA_ALIASES)) {
    // Match por palabra (con frontera) para no confundir 'ganado' dentro de otra palabra.
    if (new RegExp(`\\b${alias}\\b`).test(t)) return etapa;
  }
  return null;
}

// ── Comercial: nombre de obra y cliente para un prospecto nuevo ───────────────
// Parsea "nuevo prospecto <obra> cliente <cliente>" (cliente opcional).
// Devuelve { obraNombre, clienteNombre } con lo que se pudo extraer.
const RE_PROSPECTO_PREFIJO = /^\s*(nuev[oa]\s+prospecto|prospecto\s+nuev[oa]|nueva\s+oportunidad|oportunidad\s+nueva|cargar\s+prospecto|crear\s+prospecto|nuevo\s+lead)\s*:?\s*/i;
const RE_CLIENTE_SPLIT = /\s+(?:cliente|para|de)\s+/i;
export function extractProspectoSlots(text) {
  if (!text) return {};
  if (!RE_PROSPECTO_PREFIJO.test(text)) return {};
  let cuerpo = text.replace(RE_PROSPECTO_PREFIJO, '').trim();
  if (!cuerpo) return {};
  let clienteNombre = null;
  const m = cuerpo.split(RE_CLIENTE_SPLIT);
  let obraNombre = (m[0] || '').trim();
  if (m.length > 1) clienteNombre = m.slice(1).join(' ').trim() || null;
  return { obraNombre: obraNombre || null, clienteNombre };
}

// ── Medio de pago ────────────────────────────────────────────────────────────
// Detecta cómo se pagó. Devuelve { medio, hint } donde hint es una palabra
// para matchear la caja por nombre ('mercado', 'tarjeta', 'banco') o null.
export function extractMedioPago(text) {
  const t = normalizar(text);
  if (/\b(mercado\s*pago|mercadopago|\bmp\b)\b/.test(t)) return { medio: 'Mercado Pago', hint: 'mercado' };
  if (/\b(tarjeta|debito|credito|visa|master|mastercard)\b/.test(t)) return { medio: 'Tarjeta', hint: 'tarjeta' };
  if (/\b(transferencia|transferi|transfer|deposito|deposite)\b/.test(t)) return { medio: 'Transferencia', hint: 'banco' };
  if (/\b(efectivo|cash|en\s*mano|en\s*efectivo)\b/.test(t)) return { medio: 'Efectivo', hint: 'efectivo' };
  return null;
}

// ── Caja ─────────────────────────────────────────────────────────────────────
export function extractCaja(text, cajas) {
  if (!cajas || cajas.length === 0) return null;
  // 1) Si menciona un medio (MP/tarjeta/banco), buscar caja por ese hint.
  const mp = extractMedioPago(text);
  if (mp?.hint && mp.hint !== 'efectivo') {
    const porMedio = cajas.find(c =>
      normalizar(c.nombre).includes(mp.hint) ||
      (mp.hint === 'banco' && c.tipo === 'banco') ||
      (mp.hint === 'tarjeta' && (c.tipo === 'banco' || normalizar(c.nombre).includes('tarjeta')))
    );
    if (porMedio) return porMedio;
  }
  // 2) Matching por nombre explícito ("caja franco", "galicia").
  return matchPorNombre(text, cajas);
}

// ── Proveedor ────────────────────────────────────────────────────────────────
export function extractProveedor(text, proveedores) {
  return matchPorNombre(text, proveedores || []);
}

// ── Rubro (dentro de una obra) ───────────────────────────────────────────────
export function extractRubro(text, obraId, detalles) {
  if (!obraId || !detalles?.[obraId]?.rubros) return null;
  const rubros = detalles[obraId].rubros.filter(r => r.tipo !== 'seccion');
  return matchPorNombre(text, rubros);
}

// ── Tarea (dentro de una obra) ───────────────────────────────────────────────
// Si no se pasa obraId, busca en todas las obras y devuelve la primera tarea
// que matchee bien (con su obra/rubro).
export function extractTarea(text, obraId, detalles, todasLasObras = null) {
  if (obraId && detalles?.[obraId]?.rubros) {
    for (const rubro of detalles[obraId].rubros) {
      const tareas = (rubro.tareas || []).filter(t => t.tipo !== 'seccion');
      const match = matchPorNombre(text, tareas);
      if (match) return { ...match, _obraId: obraId, _rubroId: rubro.id };
    }
  }
  // Si no se encontró en la obra contextual, buscar en todas.
  if (todasLasObras && detalles) {
    for (const obra of todasLasObras) {
      const rubros = detalles[obra.id]?.rubros || [];
      for (const rubro of rubros) {
        const tareas = (rubro.tareas || []).filter(t => t.tipo !== 'seccion');
        const match = matchPorNombre(text, tareas);
        if (match) return { ...match, _obraId: obra.id, _rubroId: rubro.id };
      }
    }
  }
  return null;
}

// ── extractSlots: orquestador ────────────────────────────────────────────────
// Devuelve un objeto con TODOS los slots que se pudieron extraer.
// El caller hace merge en conv.data.slots.
export function extractSlots(text, ctx) {
  const slots = {};
  if (!text) return slots;

  // Intent
  const intent = extractIntent(text);
  if (intent) slots.intent = intent;

  // Monto (gastos/ingresos/traspasos)
  const monto = extractMonto(text);
  if (monto != null) slots.monto = monto;

  // Cantidad + unidad (avances)
  const cantUnit = extractCantidadUnidad(text);
  if (cantUnit) {
    slots.cantidad = cantUnit.cantidad;
    slots.unidad = cantUnit.unidad;
  }

  // Obra
  const obra = extractObra(text, ctx?.obras);
  if (obra) {
    slots.obraId = obra.id;
    slots.obraNombre = obra.nombre;
  }

  // Caja + medio de pago
  const caja = extractCaja(text, ctx?.cajas);
  if (caja) {
    slots.cajaId = caja.id;
    slots.cajaNombre = caja.nombre;
  }
  const mp = extractMedioPago(text);
  if (mp) slots.medioPago = mp.medio;

  // Proveedor
  const prov = extractProveedor(text, ctx?.proveedores);
  if (prov) {
    slots.proveedorId = prov.id;
    slots.proveedorNombre = prov.nombre;
  }

  // Tarea (necesita obra: usá la encontrada o la del contexto del slot previo)
  const obraIdParaTarea = slots.obraId || ctx?.defaults?.lastObraId;
  if (obraIdParaTarea || ctx?.obras) {
    const tarea = extractTarea(text, obraIdParaTarea, ctx?.detalles, ctx?.obras);
    if (tarea) {
      slots.tareaId = tarea.id;
      slots.tareaNombre = tarea.nombre;
      slots.rubroId = tarea._rubroId;
      // Si la tarea está en otra obra distinta de la detectada, priorizamos la de la tarea.
      if (!slots.obraId && tarea._obraId) {
        slots.obraId = tarea._obraId;
        const o = ctx?.obras?.find(x => x.id === tarea._obraId);
        if (o) slots.obraNombre = o.nombre;
      }
    }
  }

  // Rubro (si tenemos obra pero no tarea ni rubro aún)
  if (slots.obraId && !slots.rubroId) {
    const rubro = extractRubro(text, slots.obraId, ctx?.detalles);
    if (rubro) {
      slots.rubroId = rubro.id;
      slots.rubroNombre = rubro.nombre;
    }
  }

  // ── Comercial ──────────────────────────────────────────────────────────────
  // Crear prospecto: obra + cliente del texto (no de la lista, la obra es nueva).
  if (slots.intent === 'crear_prospecto') {
    const p = extractProspectoSlots(text);
    if (p.obraNombre) slots.obraNombre = p.obraNombre;
    if (p.clienteNombre) slots.clienteNombre = p.clienteNombre;
  }
  // Mover etapa: etapa destino (obra ya matcheada arriba por nombre, si existía).
  if (slots.intent === 'mover_etapa') {
    const etapa = extractEtapaDestino(text);
    if (etapa) slots.etapaNueva = etapa;
  }

  return slots;
}

// ── Helper: chequea si tenemos lo suficiente para confirmar la intent ────────
// Devuelve {ok: boolean, faltan: ['monto', 'obraId', ...]}
export function slotsCompletosPara(intent, slots) {
  const requeridos = {
    gasto:    ['monto', 'obraId'],
    ingreso:  ['monto', 'obraId'],
    avance:   ['cantidad', 'unidad', 'tareaId'],
    traspaso: ['monto', 'cajaId', 'cajaDestinoId'],
    cheque:   ['monto'],
    tarea:    ['titulo'],
  };
  const req = requeridos[intent] || [];
  const faltan = req.filter(k => slots[k] == null || slots[k] === '');
  return { ok: faltan.length === 0, faltan };
}

// ── Merge inteligente de slots ───────────────────────────────────────────────
// Solo sobreescribe slots si el nuevo valor es no-null/undefined.
export function mergeSlots(prev = {}, next = {}) {
  const out = { ...prev };
  for (const [k, v] of Object.entries(next)) {
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

// ── Modo dictado: gastos múltiples en un mensaje ─────────────────────────────
// Detecta mensajes tipo:
//   "cargá: 50k cemento baradero, 12k flete, 3k almuerzo"
//   "anotar gastos: 30000 arena, 5000 nafta"
// Devuelve { items: [{ monto, descripcion, obraId, obraNombre }] } o null.
//
// Cada item: extrae el monto y, del resto del texto, intenta matchear obra.
// Lo que sobra (sin monto ni nombre de obra) queda como descripción.
const RE_DICTADO_PREFIJO = /^\s*(carg[aá]r?|anot[aá]r?|gastos?)\s*:?\s*/i;

export function parseDictado(text, ctx) {
  if (!text) return null;
  if (!RE_DICTADO_PREFIJO.test(text)) return null;
  const cuerpo = text.replace(RE_DICTADO_PREFIJO, '').trim();
  if (!cuerpo) return null;

  // Separadores: coma, salto de línea, " y " entre items.
  const partes = cuerpo
    .split(/[,;\n]+|\s+y\s+/i)
    .map(s => s.trim())
    .filter(Boolean);
  if (partes.length === 0) return null;

  const items = [];
  for (const parte of partes) {
    const monto = extractMonto(parte);
    if (monto == null) continue; // sin monto no es un gasto válido
    const obra = extractObra(parte, ctx?.obras);
    // Descripción: el texto sin el monto y sin el nombre de obra.
    let desc = parte;
    if (obra) {
      const reObra = new RegExp(normalizar(obra.nombre).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      desc = desc.replace(reObra, '');
    }
    // Sacar el monto del texto de descripción
    desc = desc.replace(/(?:\$|usd|u\$s|ars)?\s*\d[\d.,]*\s*(k|mil|m|millones?)?/i, '').trim();
    desc = desc.replace(/\s{2,}/g, ' ').replace(/^[\s\-–·]+|[\s\-–·]+$/g, '');
    items.push({
      monto,
      descripcion: desc || 'Gasto',
      obraId:     obra?.id || null,
      obraNombre: obra?.nombre || null,
    });
  }
  return items.length > 0 ? { items } : null;
}
