import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { T } from '../../theme';
import { useIsMobile } from '../../hooks/useMediaQuery';

// PortalAcceso: valida un token magico que el admin envia al cliente por WA.
// Si es valido, GUARDA el token en sessionStorage y redirige a /portal/cliente/:obraId.
// PortalCliente luego verifica esa sessionStorage antes de renderizar — sin
// esto, cualquiera con el ID de obra podia acceder al portal sin token.

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
        // Guardar el token validado para esa obra. PortalCliente lo lee y
        // re-valida en cada carga. sessionStorage (no localStorage) para que
        // se borre al cerrar la pestana.
        try {
          sessionStorage.setItem(`kamak_portal_${data.obraId}`, token);
        } catch { /* sessionStorage puede no estar disponible */ }
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
  const isMobile = useIsMobile();

  return (
    <div style={{ fontFamily: T.font, background: T.dark, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: isMobile ? 12 : 16 }}>
      <div style={{ fontSize: isMobile ? 40 : 56 }}>{icon}</div>
      <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, color: '#fff', whiteSpace: 'normal', maxWidth: '90vw', textAlign: 'center' }}>{title}</div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', textAlign: 'center', maxWidth: isMobile ? '92vw' : 360 }}>{sub}</div>
      <img src="/assets/kamak-logo-light.png" alt="Kamak" style={{ height: 28, opacity: 0.4, marginTop: isMobile ? 20 : 32 }} />
    </div>
  );
}
