import { useEffect } from 'react';
import { T } from '../../theme';

// Modal generico con overlay, header oscuro y boton ✕.
// Maneja:
// - Cierre con click afuera (en el overlay)
// - Cierre con tecla Escape
// - stopPropagation del cuerpo
// - Body con scroll si supera maxHeight
//
// Mantiene las clases CSS 'k-modal-overlay' y 'k-modal' del index.css
// para que el styling existente (transiciones, sombras, z-index) siga
// aplicando.
//
// Las paginas que ya tienen su propio <div className="k-modal-overlay">
// siguen funcionando — esto NO obliga a migrarlas. Para modales nuevos
// (o cuando migres uno existente), usar este componente.

export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 500,
  maxHeight,
  headerBg,        // si se pasa, sobreescribe el dark default (ej: '#25803a' para "confirmar factura")
  headerColor,     // color del texto del header (default: paper)
  closeOnOverlay = true,
  closeOnEscape  = true,
}) {
  // Cerrar con Escape.
  useEffect(() => {
    if (!closeOnEscape) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeOnEscape, onClose]);

  const headerSt = {
    padding: '14px 18px',
    background: headerBg || T.dark,
    color: headerColor || T.paper,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexShrink: 0,
  };

  return (
    <div className="k-modal-overlay" onClick={closeOnOverlay ? onClose : undefined}>
      <div
        className="k-modal"
        style={{ width: `min(94vw, ${width}px)`, maxHeight, display: maxHeight ? 'flex' : undefined, flexDirection: maxHeight ? 'column' : undefined }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        {(title || subtitle || onClose) && (
          <div style={headerSt}>
            <div>
              {title    && <div style={{ fontWeight: 800, fontSize: 17, fontFamily: T.font }}>{title}</div>}
              {subtitle && <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{subtitle}</div>}
            </div>
            {onClose && (
              <button
                type="button"
                aria-label="Cerrar"
                onClick={onClose}
                style={{
                  cursor: 'pointer', fontSize: 20, opacity: 0.7,
                  userSelect: 'none', background: 'transparent',
                  border: 'none', color: 'inherit', padding: 0,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div style={{ padding: 18, overflowY: maxHeight ? 'auto' : undefined, flex: maxHeight ? 1 : undefined }}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div style={{
            padding: '10px 18px',
            borderTop: `1.5px solid ${T.faint2}`,
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            flexShrink: 0,
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
