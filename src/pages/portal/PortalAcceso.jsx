import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { T } from '../../theme';

export default function PortalAcceso() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [estado, setEstado] = useState('validando'); // validando | invalido | expirado

  useEffect(() => {
    if (!token) { setEstado('invalido'); return; }
    fetch(`/api/portal/validate-token?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error === 'expired') { setEstado('expirado'); return; }
        if (data.error || !data.obraId) { setEstado('invalido'); return; }
        navigate(`/portal/cliente/${data.obraId}`, { replace: true });
      })
      .catch(() => setEstado('invalido'));
  }, [token, navigate]);

  const msgs = {
    validando: { icon: '⏳', title: 'Validando acceso…', sub: 'Un momento por favor.' },
    invalido:  { icon: '🚫', title: 'Enlace inválido', sub: 'Este enlace de acceso no existe o ya fue usado. Solicitá uno nuevo al equipo de Kamak.' },
    expirado:  { icon: '⏰', title: 'Enlace expirado', sub: 'Este enlace de acceso ya no es válido. Solicitá uno nuevo al equipo de Kamak.' },
  };
  const { icon, title, sub } = msgs[estado] || msgs.invalido;

  return (
    <div style={{ fontFamily: T.font, background: T.dark, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <div style={{ fontSize: 56 }}>{icon}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>{title}</div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', textAlign: 'center', maxWidth: 360 }}>{sub}</div>
      <img src="/assets/kamak-logo-light.png" alt="Kamak" style={{ height: 28, opacity: 0.4, marginTop: 32 }} />
    </div>
  );
}
