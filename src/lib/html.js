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
 * Abre el HTML en una pestaña nueva. El usuario lo ve completo y usa
 * Ctrl+P del navegador para imprimir/guardar como PDF.
 *
 * NO disparamos print automatico porque Chrome a veces redirige el
 * iframe.print() a una pestaña separada con about:blank — comportamiento
 * inconsistente entre versiones del browser.
 *
 * Usamos Blob URL (no document.write) para evitar problemas de tamaño
 * y timing con HTML grande (presupuesto + QR puede ser >100KB).
 *
 * Devuelve la ventana o null si fue bloqueada por popup blocker.
 */
export const imprimirHTML = (html) => {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) {
    URL.revokeObjectURL(url);
    return null;
  }
  // Defensa anti-XSS: blanquear opener desde el padre.
  try { w.opener = null; } catch { /* ignore */ }
  // Liberar la URL despues de que la pestaña ya cargó (no inmediato
  // porque el browser todavia necesita la URL para renderizar).
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return w;
};

// Alias retro-compatible. Antes existian dos funciones con la misma
// implementacion; ahora ambos hacen lo mismo.
export const abrirHTML = (html) => imprimirHTML(html);
