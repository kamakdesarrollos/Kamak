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
 * Imprime un HTML usando un iframe oculto en la pagina actual.
 *
 * Por que iframe en vez de window.open:
 * - window.open con noopener retorna null en navegadores modernos.
 * - Sin noopener, document.write tiene limites de tamano y timing.
 * - Blob URL puede ser bloqueado por algunos navegadores.
 * - Popup blocker bloquea ventanas nuevas frecuentemente.
 *
 * iframe oculto:
 * - No requiere popup permission.
 * - onload es confiable (espera fuentes + imagenes).
 * - El navegador renderea el HTML del iframe normalmente, incluyendo
 *   data URLs largos (QR).
 * - El dialogo de print del iframe abre el sistema de impresion del
 *   browser igual que window.print().
 *
 * Despues de imprimir, el iframe se remueve.
 */
export const imprimirHTML = (html) => {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(iframe);

    const cleanup = () => {
      // Esperar un poco antes de remover para que el browser tenga
      // tiempo de mostrar el dialogo de print.
      setTimeout(() => {
        try { document.body.removeChild(iframe); } catch {}
      }, 1500);
    };

    const triggerPrint = () => {
      try {
        const cw = iframe.contentWindow;
        if (!cw) {
          reject(new Error('iframe.contentWindow no disponible'));
          return;
        }
        cw.focus();
        cw.print();
        cleanup();
        resolve();
      } catch (e) {
        cleanup();
        reject(e);
      }
    };

    iframe.onload = () => {
      // Pequeno delay para que fuentes/imagenes terminen de pintarse.
      setTimeout(triggerPrint, 400);
    };
    iframe.onerror = (e) => {
      cleanup();
      reject(new Error('Error cargando HTML en iframe: ' + e));
    };

    // Inyectar HTML via document.write del iframe (no bloqueado por popup).
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) throw new Error('iframe.contentDocument no disponible');
      doc.open();
      doc.write(html);
      doc.close();
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
};

// Alias retro-compatible con el nombre anterior. Si algun caller espera
// el handle de la ventana, ahora devuelve null (no aplica con iframe).
export const abrirHTML = (html) => {
  imprimirHTML(html).catch(e => console.error('[abrirHTML/imprimirHTML]', e));
  return null;
};
