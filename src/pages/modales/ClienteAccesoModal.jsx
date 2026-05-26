import { useEffect, useState } from 'react';
import Modal from '../../components/ui/Modal';
import { Btn } from '../../components/ui';
import { T } from '../../theme';
import { buildWaMeLink, buildClientePrimerMensaje, generateQrDataUrl } from '../../lib/clienteAcceso';

// Modal que muestra el QR + link wa.me con texto pre-armado para que el
// cliente se vincule al bot. Se accede desde la ficha de obra.
//
// El cliente puede:
// - Escanear el QR (si lo tiene impreso en el presupuesto)
// - Tocar el link (si recibe el link por mail/WhatsApp del equipo)
// - Copiar el link desde aca y pasarselo de cualquier forma

export default function ClienteAccesoModal({ obra, cliente, onClose }) {
  const [qrUrl, setQrUrl] = useState(null);
  const [copied, setCopied] = useState(false);

  const clienteNombre = cliente?.nombre || obra?.cliente || '';
  const obraNombre    = obra?.nombre || '';
  const link          = buildWaMeLink(clienteNombre, obraNombre);
  const textoPrimerMsg = buildClientePrimerMensaje(clienteNombre, obraNombre);

  useEffect(() => {
    let alive = true;
    generateQrDataUrl(link, 280).then(url => {
      if (alive) setQrUrl(url);
    });
    return () => { alive = false; };
  }, [link]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard no disponible */ }
  };

  const downloadQr = () => {
    if (!qrUrl) return;
    const a = document.createElement('a');
    a.href = qrUrl;
    a.download = `qr-${obraNombre.replace(/\s+/g, '-').toLowerCase()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <Modal
      title="Acceso del cliente al portal"
      subtitle={`${clienteNombre} · ${obraNombre}`}
      onClose={onClose}
      width={520}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Instrucciones */}
        <div style={{ fontSize: 12, color: T.ink2, lineHeight: 1.5 }}>
          Compartile este QR o link al cliente. Cuando lo escanee, se le abre WhatsApp
          con un mensaje listo para enviar. Al mandarlo, el bot lo vincula automáticamente
          y le devuelve un link directo al portal de su obra.
        </div>

        {/* QR */}
        <div style={{
          background: T.faint,
          border: `1.5px solid ${T.faint2}`,
          borderRadius: 8,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
        }}>
          {qrUrl ? (
            <img
              src={qrUrl}
              alt={`QR de acceso para ${clienteNombre}`}
              style={{ width: 240, height: 240, display: 'block' }}
            />
          ) : (
            <div style={{ width: 240, height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.ink3, fontSize: 12 }}>
              Generando QR…
            </div>
          )}
          <div style={{ fontSize: 11, color: T.ink3, textAlign: 'center', maxWidth: 280 }}>
            Mensaje pre-armado: <span style={{ fontWeight: 600, color: T.ink2 }}>"{textoPrimerMsg}"</span>
          </div>
        </div>

        {/* Link copiable */}
        <div>
          <div style={{ fontSize: 10, color: T.ink3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
            Link directo
          </div>
          <div style={{
            display: 'flex',
            gap: 6,
            alignItems: 'stretch',
          }}>
            <input
              readOnly
              value={link}
              onClick={e => e.target.select()}
              style={{
                flex: 1,
                padding: '8px 10px',
                border: `1.2px solid ${T.faint2}`,
                borderRadius: 4,
                fontSize: 11,
                fontFamily: T.fontMono,
                background: T.paper,
                color: T.ink,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            />
            <Btn sm onClick={copyLink} accent={copied}>
              {copied ? '✓ Copiado' : 'Copiar'}
            </Btn>
          </div>
        </div>

        {/* Acciones */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Btn sm onClick={downloadQr} disabled={!qrUrl}>
            ↓ Descargar QR (PNG)
          </Btn>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none' }}
          >
            <Btn sm fill>Abrir en WhatsApp</Btn>
          </a>
        </div>
      </div>
    </Modal>
  );
}
