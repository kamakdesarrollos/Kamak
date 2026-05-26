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
 * Abre una nueva ventana e inyecta HTML.
 * NO usa noopener porque en navegadores modernos eso hace que window.open
 * retorne null, perdiendo el handle de la ventana — lo necesitamos para
 * llamar w.focus() y w.print() despues. Usamos noreferrer para no
 * filtrar la URL actual.
 * Devuelve la ventana o null si el navegador la bloqueo (popup blocker).
 */
export const abrirHTML = (html, { width = 860, height = 1200 } = {}) => {
  const w = window.open(
    '',
    '_blank',
    `noreferrer,width=${width},height=${height},scrollbars=yes`
  );
  if (!w) return null;
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Defensa adicional anti-XSS: blanquear window.opener desde el lado del
  // hijo para que aunque el HTML contenga JS no pueda acceder al padre.
  // Esto sustituye al efecto de noopener sin perder el handle.
  try { w.opener = null; } catch { /* ignore */ }
  return w;
};
