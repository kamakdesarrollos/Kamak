// Documentos de contratistas (Régimen PADIC). Render de plantillas con variables
// + armado de las tablas (tareas/plan de pagos) desde un contrato de la pestaña
// "Contratos MO". Las plantillas viven en shared_data['crm_plantillas_contratistas']
// y son EDITABLES por el admin. Conquies (la razón social) va literal en el texto.

export const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Tipos de documento del set PADIC (por obra y por contratista).
export const TIPOS_DOC = [
  { id: 'carta_oferta',        nombre: 'Anexo I — Carta Oferta',                porColaborador: false },
  { id: 'aceptacion',          nombre: 'Anexo II — Aceptación de la Oferta',     porColaborador: false },
  { id: 'nomina_colaboradores',nombre: 'Anexo III — Nómina de Colaboradores',    porColaborador: false },
  { id: 'plan_trabajo',        nombre: 'Anexo IV — Plan de Trabajo con Costos',  porColaborador: false },
  { id: 'locacion_obra',       nombre: 'Contrato de Locación de Obra',           porColaborador: false },
  { id: 'locacion_servicios',  nombre: 'Contrato de Locación de Servicios',      porColaborador: true  },
];

// Clave de estado (checklist) de un documento dentro de un contrato.
// Para los docs porColaborador (locación de servicios) la clave incluye el id
// del colaborador, así cada copia tiene su propio estado de Confección/Firma.
export function docKeyFor(tipoId, colaboradorId = null) {
  return colaboradorId ? `${tipoId}:${colaboradorId}` : tipoId;
}

// Lista canónica de documentos a confeccionar para un contrato. La usan tanto el
// modal de Documentos (para listar/imprimir) como la tarjeta del contrato (para
// el resumen del checklist), de modo que el conteo coincida siempre.
// Cada item: { docKey, tipo, colaborador, sinColaboradores }.
export function docsListForContrato(contrato) {
  const colaboradores = Array.isArray(contrato?.colaboradores) ? contrato.colaboradores : [];
  const out = [];
  TIPOS_DOC.forEach(tipo => {
    if (tipo.porColaborador) {
      if (colaboradores.length === 0) {
        // Sin colaboradores no hay locación de servicios que emitir; el item
        // queda informativo (no cuenta para el checklist).
        out.push({ docKey: docKeyFor(tipo.id, null), tipo, colaborador: null, sinColaboradores: true });
      } else {
        colaboradores.forEach(co => {
          const coId = co.id || co.dni || co.cuit || co.nombre;
          out.push({ docKey: docKeyFor(tipo.id, coId), tipo, colaborador: co, sinColaboradores: false });
        });
      }
    } else {
      out.push({ docKey: docKeyFor(tipo.id, null), tipo, colaborador: null, sinColaboradores: false });
    }
  });
  return out;
}

// Resumen del checklist de un contrato: total de docs emitibles + cuántos están
// confeccionados / firmados según contrato.docsEstado.
// docsEstado = { [docKey]: { confeccion: bool, firma: bool } }.
export function resumenDocsEstado(contrato) {
  const docs = docsListForContrato(contrato).filter(d => !d.sinColaboradores);
  const estado = contrato?.docsEstado || {};
  let confeccion = 0, firma = 0;
  docs.forEach(d => {
    const e = estado[d.docKey] || {};
    if (e.confeccion) confeccion++;
    if (e.firma) firma++;
  });
  return { total: docs.length, confeccion, firma };
}

// Variables soportadas en las plantillas (las que NO son tabla se escapan).
export const PLACEHOLDERS = [
  'contratista.nombre', 'contratista.cuit', 'contratista.categoriaPADIC', 'contratista.domicilio',
  'obra.nombre', 'obra.direccion',
  'montoTotal', 'tareasResumen', 'tareasTabla', 'planPagosTabla', 'nominaTabla',
  'fechaInicio', 'plazo', 'fecha', 'lugar',
  'colaborador.nombre', 'colaborador.cuit', 'colaborador.domicilio', 'colaborador.montoDia',
];
// Estas variables son HTML (tablas) → se inyectan SIN escapar.
const RAW = new Set(['tareasTabla', 'planPagosTabla', 'nominaTabla']);

// Reemplaza {{variable}} por su valor. Escapa todo salvo las tablas (RAW).
export function renderDocContratista(html, valores) {
  return String(html || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = valores?.[key];
    if (v == null || v === '') return '';
    return RAW.has(key) ? String(v) : escapeHtml(String(v));
  });
}

export const fmtMonto = (n) => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR');

const montoContrato = (contrato) =>
  Number(contrato?.monto) ||
  (contrato?.tareas || []).reduce((s, t) => s + (Number(t.cantidadContratada) || 0) * (Number(t.precioUnit) || 0), 0);

// Tabla del Plan de Trabajo (Anexo IV) — tareas con cantidad, p. unitario y total.
export function tareasTablaHtml(contrato) {
  const ts = contrato?.tareas || [];
  if (!ts.length) return '<p><i>(sin tareas cargadas en el contrato)</i></p>';
  const rows = ts.map(t => {
    const tot = (Number(t.cantidadContratada) || 0) * (Number(t.precioUnit) || 0);
    return `<tr><td>${escapeHtml(t.nombre || '')}</td><td style="text-align:center">${escapeHtml(t.unidad || '')}</td><td style="text-align:right">${Number(t.cantidadContratada) || 0}</td><td style="text-align:right">${fmtMonto(t.precioUnit)}</td><td style="text-align:right">${fmtMonto(tot)}</td></tr>`;
  }).join('');
  return `<table border="1" cellspacing="0" cellpadding="5" style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#eee"><th align="left">Tarea</th><th>Unidad</th><th>Cant.</th><th>P. unitario</th><th>Total</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="4" style="text-align:right;font-weight:bold">TOTAL</td><td style="text-align:right;font-weight:bold">${fmtMonto(montoContrato(contrato))}</td></tr></tfoot></table>`;
}

// Tabla del Plan de Pagos — concepto, % y monto.
export function planPagosTablaHtml(contrato) {
  const monto = montoContrato(contrato);
  const pp = contrato?.planPagos || [];
  if (!pp.length) return '';
  const rows = pp.map(c => `<tr><td>${escapeHtml(c.concepto || '')}</td><td style="text-align:right">${Number(c.pct) || 0}%</td><td style="text-align:right">${fmtMonto(monto * (Number(c.pct) || 0) / 100)}</td></tr>`).join('');
  return `<table border="1" cellspacing="0" cellpadding="5" style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#eee"><th align="left">Concepto</th><th>%</th><th>Monto</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// Tabla de la Nómina de Colaboradores (Anexo III).
export function nominaTablaHtml(contrato) {
  const cs = contrato?.colaboradores || [];
  if (!cs.length) return '<p><i>(sin colaboradores cargados)</i></p>';
  const rows = cs.map(c => `<tr><td>${escapeHtml(c.nombre || '')}</td><td>${escapeHtml(c.dni || '')}</td><td>${escapeHtml(c.cuit || '')}</td><td>${escapeHtml(c.domicilio || '')}</td></tr>`).join('');
  return `<table border="1" cellspacing="0" cellpadding="5" style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#eee"><th align="left">Nombre</th><th>DNI</th><th>CUIT</th><th>Domicilio</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// Arma el objeto de valores para una plantilla, desde el contrato + la obra
// (+ un colaborador, para el contrato de locación de servicios).
export function datosDocContratista(contrato, obra, colaborador = null, hoyISO = null) {
  const fecha = hoyISO ? hoyISO.slice(0, 10).split('-').reverse().join('/') : '';
  return {
    'contratista.nombre': contrato?.proveedor || '',
    'contratista.cuit': contrato?.cuit || '',
    'contratista.categoriaPADIC': contrato?.categoriaPADIC || '',
    'contratista.domicilio': contrato?.domicilio || '',
    'obra.nombre': obra?.nombre || '',
    'obra.direccion': obra?.direccion || '',
    'montoTotal': fmtMonto(montoContrato(contrato)),
    'tareasResumen': (contrato?.tareas || []).map(t => t.nombre).filter(Boolean).join(', '),
    'tareasTabla': tareasTablaHtml(contrato),
    'planPagosTabla': planPagosTablaHtml(contrato),
    'nominaTabla': nominaTablaHtml(contrato),
    'fechaInicio': contrato?.fechaInicio ? contrato.fechaInicio.slice(0, 10).split('-').reverse().join('/') : '',
    'plazo': '',
    'fecha': fecha,
    'lugar': 'Necochea',
    'colaborador.nombre': colaborador?.nombre || '',
    'colaborador.cuit': colaborador?.cuit || '',
    'colaborador.domicilio': colaborador?.domicilio || '',
    'colaborador.montoDia': colaborador ? fmtMonto(colaborador.montoDia) : '',
  };
}
