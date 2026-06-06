import crypto from 'node:crypto';

// Escapa valores antes de inyectarlos en el HTML del contrato (anti-XSS): la
// plantilla es de confianza (la edita el admin), pero los VALORES (nombre, cuit)
// vienen de datos y pueden traer HTML malicioso.
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Resuelve {{placeholder}} con los valores dados. Escapa todos los valores SALVO
// 'planCuotas' (que es HTML de tabla generado por nosotros, no input del usuario).
export function renderPlantilla(htmlPlantilla, valores) {
  return String(htmlPlantilla || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = valores[key];
    if (v == null) return '';
    return key === 'planCuotas' ? String(v) : escapeHtml(v);
  });
}

// SHA-256 hex del documento renderizado: ata la firma a ESTA versión exacta.
export function hashDocumento(html) {
  return crypto.createHash('sha256').update(String(html), 'utf8').digest('hex');
}

// Construye la tabla HTML del plan de cuotas (USD) desde detalle.cuotas.
export function planCuotasHtml(cuotas, toUSD) {
  const filas = (cuotas || []).map(c =>
    `<tr><td>${escapeHtml(c.descripcion || ('Cuota ' + (c.n ?? '')))}</td><td style="text-align:right">U$S ${toUSD(c)}</td></tr>`
  ).join('');
  return `<table style="width:100%;border-collapse:collapse" border="1" cellpadding="4">${filas || '<tr><td>—</td></tr>'}</table>`;
}
