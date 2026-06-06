import { useState } from 'react';
import { Btn, Chip, Label, Note } from '../../components/ui';
import { T } from '../../theme';

const OBRAS = [
  { name: 'Baradero', code: 'BARA', color: '#fae6e0', pending: 3 },
  { name: 'San Isidro', code: 'SANI', color: '#f6efd9', pending: 1 },
  { name: 'Tigre', code: 'TIGR', color: T.accentSoft, pending: 0 },
  { name: 'Pilar', code: 'PILA', color: '#f0ede3', pending: 2 },
];

const COLA = [
  { obra: 'Baradero', proveedor: 'Don Luis SRL', monto: '$ 12.400', estado: 'procesando', ts: '10:32' },
  { obra: 'Pilar', proveedor: 'Easy Construccion', monto: '$ 8.900', estado: 'pendiente', ts: '09:15' },
  { obra: 'San Isidro', proveedor: 'Ferrería Norte', monto: '$ 3.200', estado: 'subido', ts: 'ayer' },
];

function Screen({ title, children, onBack }) {
  return (
    <div style={{ maxWidth: 390, margin: '0 auto', background: T.paper, minHeight: '100vh', display: 'flex', flexDirection: 'column', fontFamily: T.font }}>
      <div style={{ background: '#fff7ed', color: '#b45309', padding: '7px 14px', fontSize: 11, fontWeight: 600, textAlign: 'center' }}>
        🚧 Maqueta — no persiste datos reales
      </div>
      <div style={{ background: T.dark, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        {onBack && <span style={{ color: T.paper, cursor: 'pointer', fontSize: 20 }} onClick={onBack}>←</span>}
        <div style={{ color: T.paper, fontWeight: 800, fontSize: 'clamp(14px, 4vw, 17px)' }}>{title}</div>
      </div>
      {children}
    </div>
  );
}

function HomeScreen({ onCamera, onCola }) {
  return (
    <Screen title="Kamak · Comprador">
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Quick capture */}
        <div style={{ background: T.accent, borderRadius: 12, padding: '20px 16px', display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }} onClick={onCamera}>
          <div style={{ fontSize: 40 }}>📷</div>
          <div style={{ color: 'white', minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 18 }}>Foto de factura</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Capturá o elegí de galería</div>
          </div>
        </div>

        {/* Obras activas */}
        <div>
          <Label style={{ fontSize: 13, marginBottom: 8 }}>Mis obras</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {OBRAS.map((o, i) => (
              <div key={i} style={{ background: o.color, borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</div>
                  <div style={{ fontSize: 11, color: T.ink2 }}>{o.code}</div>
                </div>
                {o.pending > 0 && <Chip accent style={{ fontSize: 10 }}>{o.pending} pendientes</Chip>}
              </div>
            ))}
          </div>
        </div>

        {/* Cola */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <Label style={{ fontSize: 13 }}>Cola offline</Label>
            <span style={{ fontSize: 11, color: T.accent, cursor: 'pointer' }} onClick={onCola}>Ver todo →</span>
          </div>
          <div style={{ background: T.faint, borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>2 facturas pendientes de subir</span>
            <Chip warn style={{ fontSize: 10, flexShrink: 0 }}>offline</Chip>
          </div>
        </div>

        {/* WhatsApp */}
        <div style={{ background: '#e7f7e9', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
          <div style={{ fontSize: 28, flexShrink: 0 }}>💬</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Bot WhatsApp activo</div>
            <div style={{ fontSize: 11, color: T.ink2, overflowWrap: 'break-word', wordBreak: 'break-word' }}>Enviá +54 9 11 XXXX "FACTURA BARA" para cargar</div>
          </div>
        </div>
      </div>
    </Screen>
  );
}

function CameraScreen({ onBack }) {
  const [step, setStep] = useState('capture'); // capture | review | datos | ok

  if (step === 'ok') return (
    <Screen title="Factura enviada" onBack={onBack}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
        <div style={{ fontSize: 64 }}>✅</div>
        <div style={{ fontWeight: 800, fontSize: 20, textAlign: 'center' }}>¡Factura enviada!</div>
        <div style={{ fontSize: 13, color: T.ink2, textAlign: 'center' }}>El OCR procesará los datos. Recibirás una notificación cuando esté lista para confirmar.</div>
        <Btn sm accent onClick={onBack} style={{ marginTop: 12 }}>Volver al inicio</Btn>
      </div>
    </Screen>
  );

  if (step === 'datos') return (
    <Screen title="Revisar datos OCR" onBack={() => setStep('review')}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ background: '#e7f7e9', borderRadius: 6, padding: '8px 12px', fontSize: 12, wordBreak: 'break-word', overflowWrap: 'break-word' }}>
          <b>OCR detectó:</b> Factura B · Don Luis SRL · CUIT 30-71589456-2
        </div>
        {[
          ['Proveedor', 'Don Luis SRL'],
          ['CUIT', '30-71589456-2'],
          ['N° Factura', 'B 0001-00312'],
          ['Fecha', '15/05/2026'],
          ['Monto', '$ 12.400'],
          ['IVA', '$ 2.604'],
        ].map(([l, v], i) => (
          <div key={i}>
            <div style={{ fontSize: 10, color: T.ink2, marginBottom: 3 }}>{l}</div>
            <div style={{ background: 'white', border: `1.5px solid ${T.faint2}`, borderRadius: 4, padding: '7px 10px', fontSize: 13 }}>{v}</div>
          </div>
        ))}
        <div>
          <div style={{ fontSize: 10, color: T.ink2, marginBottom: 3 }}>Obra</div>
          <div style={{ background: 'white', border: `1.5px solid ${T.accent}`, borderRadius: 4, padding: '7px 10px', fontSize: 13, color: T.accent, fontWeight: 700 }}>Baradero ▾</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: T.ink2, marginBottom: 3 }}>Rubro</div>
          <div style={{ background: 'white', border: `1.5px solid ${T.faint2}`, borderRadius: 4, padding: '7px 10px', fontSize: 13 }}>Materiales ▾</div>
        </div>
        <Btn sm accent style={{ marginTop: 8 }} onClick={() => setStep('ok')}>Confirmar y enviar</Btn>
      </div>
    </Screen>
  );

  if (step === 'review') return (
    <Screen title="Revisar foto" onBack={() => setStep('capture')}>
      <div style={{ background: '#222', height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 13 }}>
        [Foto de factura]
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: T.ink2 }}>¿La foto es legible? El OCR extraerá los datos automáticamente.</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn sm style={{ flex: 1 }} onClick={() => setStep('capture')}>Repetir</Btn>
          <Btn sm accent style={{ flex: 1 }} onClick={() => setStep('datos')}>Usar esta →</Btn>
        </div>
      </div>
    </Screen>
  );

  return (
    <Screen title="Foto de factura" onBack={onBack}>
      <div style={{ background: '#111', flex: 1, minHeight: 380, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div style={{ border: '2px dashed rgba(255,255,255,0.3)', width: 260, height: 200, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
          Encuadrar factura
        </div>
      </div>
      <div style={{ padding: 16, background: '#1a1a1a', display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
        <span style={{ fontSize: 28, cursor: 'pointer' }}>🖼️</span>
        <div style={{ width: 64, height: 64, borderRadius: 32, background: 'white', border: '4px solid #555', cursor: 'pointer' }} onClick={() => setStep('review')} />
        <span style={{ fontSize: 28, cursor: 'pointer' }}>⚡</span>
      </div>
    </Screen>
  );
}

function ColaScreen({ onBack }) {
  return (
    <Screen title="Cola offline" onBack={onBack}>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, color: T.ink2, marginBottom: 4 }}>Las facturas se suben automáticamente al recuperar conexión.</div>
        {COLA.map((c, i) => (
          <div key={i} style={{ background: 'white', border: `1.5px solid ${T.faint2}`, borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ fontSize: 28 }}>🧾</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.proveedor}</div>
              <div style={{ fontSize: 11, color: T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.obra} · {c.monto} · {c.ts}</div>
            </div>
            <Chip style={{ fontSize: 9 }} ok={c.estado === 'subido'} warn={c.estado === 'pendiente'} accent={c.estado === 'procesando'}>{c.estado}</Chip>
          </div>
        ))}
        <div style={{ background: T.accentSoft, borderRadius: 8, padding: '10px 14px', textAlign: 'center', fontSize: 12, color: T.accent, fontWeight: 700, cursor: 'pointer', marginTop: 4 }}>
          ↑ Forzar sincronización
        </div>
      </div>
    </Screen>
  );
}

export default function MobileComprador() {
  const [screen, setScreen] = useState('home');

  if (screen === 'camera') return <CameraScreen onBack={() => setScreen('home')} />;
  if (screen === 'cola') return <ColaScreen onBack={() => setScreen('home')} />;
  return <HomeScreen onCamera={() => setScreen('camera')} onCola={() => setScreen('cola')} />;
}
