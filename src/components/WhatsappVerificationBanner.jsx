import { useState, useEffect } from 'react';
import { useUsuarios } from '../store/UsuariosContext';

// La verificación se consulta y confirma a través del endpoint serverless
// /api/whatsapp/link (que usa la SERVICE_KEY), porque el navegador NO puede
// leer whatsapp_verifications directo (está protegida con RLS).
export default function WhatsappVerificationBanner() {
  const { currentUser } = useUsuarios();
  const [verif, setVerif]       = useState(null);
  const [loading, setLoading]   = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!currentUser?.email || dismissed) return;
    let stop = false;
    const check = async () => {
      try {
        const res = await fetch(`/api/whatsapp/link?email=${encodeURIComponent(currentUser.email)}`);
        if (!res.ok) return;
        const json = await res.json();
        if (!stop) setVerif(json.pending || null);
      } catch (e) {
        console.warn('[WhatsappVerificationBanner] no se pudo consultar la vinculación:', e.message);
      }
    };
    check();
    const interval = setInterval(check, 15000);
    return () => { stop = true; clearInterval(interval); };
  }, [currentUser?.email, dismissed]);

  if (!verif || dismissed) return null;

  const confirm = async () => {
    setLoading(true);
    try {
      await fetch('/api/whatsapp/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm',
          email: currentUser.email,
          user_id: currentUser.id,
          user_name: currentUser.nombre,
          user_rol: currentUser.rol,
        }),
      });
    } catch (e) {
      console.warn('[WhatsappVerificationBanner] error confirmando:', e.message);
    }
    setVerif(null);
    setLoading(false);
  };

  const reject = async () => {
    try {
      await fetch('/api/whatsapp/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', email: currentUser.email }),
      });
    } catch (e) {
      console.warn('[WhatsappVerificationBanner] error rechazando:', e.message);
    }
    setVerif(null);
  };

  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: '#1a2e1a', color: '#fff', borderRadius: 10,
      boxShadow: '0 8px 32px rgba(0,0,0,0.45)', zIndex: 9998,
      padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 16,
      border: '1.5px solid #25803a', minWidth: 360, maxWidth: 520,
      fontFamily: 'Montserrat, system-ui, sans-serif', fontSize: 13,
    }}>
      <div style={{ fontSize: 22, flexShrink: 0 }}>📱</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, marginBottom: 3 }}>Solicitud de vinculación de WhatsApp</div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>
          El número <b>+{verif.phone}</b> quiere vincularse con tu cuenta.
          Confirmá solo si sos vos.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={reject}
          style={{ padding: '6px 12px', background: 'transparent', color: '#ff9999', border: '1px solid #ff9999', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          Rechazar
        </button>
        <button
          onClick={confirm}
          disabled={loading}
          style={{ padding: '6px 14px', background: '#25803a', color: '#fff', border: 'none', borderRadius: 5, cursor: loading ? 'default' : 'pointer', fontSize: 12, fontWeight: 700, opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Vinculando…' : 'Confirmar'}
        </button>
      </div>
    </div>
  );
}
