import { useRef } from 'react';
import { T } from '../../theme';

// Modal full-screen que muestra un HTML en un iframe visible y permite
// imprimirlo desde el browser. Reemplaza el approach de "abrir pestaña
// nueva con window.open" que Chrome bloqueaba o renderizaba en blanco.
//
// El iframe usa srcDoc (no document.write, no Blob URL) — es la forma
// mas directa y confiable de inyectar HTML en un iframe.

export default function PrintPreviewModal({ html, title = 'Vista previa', onClose }) {
  const iframeRef = useRef(null);

  const handlePrint = () => {
    try {
      const cw = iframeRef.current?.contentWindow;
      if (!cw) return;
      cw.focus();
      cw.print();
    } catch (e) {
      console.warn('[PrintPreviewModal] print error:', e);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(20,18,15,0.85)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Barra superior */}
      <div style={{
        padding: '10px 16px',
        background: T.dark,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            onClick={onClose}
            style={{ cursor: 'pointer', fontSize: 14, color: 'rgba(255,255,255,0.75)', userSelect: 'none' }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.75)'}
          >
            ← Cerrar
          </span>
          <span style={{ fontWeight: 700, fontSize: 13 }}>{title}</span>
        </div>
        <button
          onClick={handlePrint}
          style={{
            background: T.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '8px 18px',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: T.font,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          🖨 Imprimir / Guardar PDF
        </button>
      </div>

      {/* Iframe con el HTML — visible y full-size */}
      <iframe
        ref={iframeRef}
        srcDoc={html}
        title={title}
        style={{
          flex: 1,
          width: '100%',
          border: 'none',
          background: '#555',
        }}
      />
    </div>
  );
}
