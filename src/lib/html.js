// Helpers para construir HTML de exports/impresion de forma segura.
//
// Por que existe esto:
// Los modulos ExportModal, ContratoMOModal y las funciones generarHTML* en
// ObraPresupuesto.jsx arman documentos HTML con template literals e
// interpolan datos del usuario (nombre de cliente, notas, formaPago, etc.).
// Si esos datos contienen <script> o atributos como onerror=, se ejecuta
// JavaScript en la ventana abierta — el clasico XSS.
//
// La pagina abierta hereda el origen y puede leer localStorage (token de
// Supabase), por eso es importante:
//   1) escapar cualquier valor de usuario antes de pegarlo en el HTML; y
//   2) abrir la ventana con 'noopener,noreferrer' para que la nueva pestana
//      no tenga acceso a window.opener.

/**
 * Escapa caracteres HTML peligrosos. Usar en TODA interpolacion de datos
 * dinamicos dentro de template literals que se inyectan via innerHTML
 * o document.write.
 *
 * Acepta string, number, null o undefined.
 */
export const esc = (v) => {
  if (v == null) return '';
  return String(v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
};

/**
 * Abre una nueva ventana con HTML.
 *
 * Usa Blob URL en lugar de document.write porque:
 * - document.write tiene limites de tamano en algunos navegadores
 *   (el HTML del presupuesto con QR puede ser >100KB).
 * - El timing es impredecible: w.print() puede dispararse antes de que
 *   las fuentes y el QR carguen, resultando en una pestaña en blanco.
 * - Con Blob URL, el navegador trata el HTML como una pagina real con
 *   evento onload confiable.
 *
 * Devuelve la ventana o null si el navegador la bloqueo (popup blocker).
 */
export const abrirHTML = (html, { width = 860, height = 1200 } = {}) => {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const w = window.open(
    url,
    '_blank',
    `noreferrer,width=${width},height=${height},scrollbars=yes`
  );
  if (!w) {
    URL.revokeObjectURL(url);
    return null;
  }
  // Defensa anti-XSS desde el padre. Como abrimos con Blob URL del mismo
  // origin, opener sigue conectado — sin esto, el HTML podria tocar
  // window.opener.
  try { w.opener = null; } catch { /* ignore */ }
  // Liberar el blob despues de un rato (no inmediato, el browser todavia
  // necesita la URL hasta que la pestana cargue).
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return w;
};
