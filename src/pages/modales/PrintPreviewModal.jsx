import { useRef, useEffect, useState } from 'react';
import { T } from '../../theme';

// Modal full-screen que muestra un HTML en un iframe visible y permite
// imprimirlo desde el browser.
//
// Usamos Blob URL en vez de srcDoc: srcDoc tiene limites de tamano en
// algunos browsers y con el QR del cliente (PNG base64 grande) a veces
// truncaba el contenido y solo mostraba la portada.

export default function PrintPreviewModal({ html, title = 'Vista previa', onClose }) {
  const iframeRef = useRef(null);
  const [blobUrl, setBlobUrl] = useState(null);

  useEffect(() => {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [html]);

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
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginLeft: 6 }}>
            (scrolleá dentro del documento para ver todas las páginas)
          </span>
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

      {/* Iframe con el HTML — Blob URL para soportar QR grandes sin truncar */}
      {blobUrl && (
        <iframe
          ref={iframeRef}
          src={blobUrl}
          title={title}
          style={{
            flex: 1,
            width: '100%',
            border: 'none',
            background: '#555',
          }}
        />
      )}
    </div>
  );
}
