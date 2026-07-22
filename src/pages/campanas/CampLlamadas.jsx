import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../../components/layout/PageLayout';
import PageHero from '../../components/ui/PageHero';
import { T } from '../../theme';
import { useUsuarios } from '../../store/UsuariosContext';

// Modo llamadas mobile (cola del día para Carolina). STUB: se reemplaza en la
// fase de UI.

export default function CampLlamadas() {
  const { currentUser } = useUsuarios();
  const navigate = useNavigate();

  // Guard: solo Admin o usuarios con el permiso `campanas` (patrón Pipeline.jsx).
  const puede = currentUser?.rol === 'Admin' || !!currentUser?.permisos?.campanas;
  useEffect(() => { if (currentUser && !puede) navigate('/', { replace: true }); }, [currentUser, puede, navigate]);

  return (
    <PageLayout breadcrumb={[{ label: 'Inicio', to: '/' }, 'Campañas']} active="Campañas">
      <PageHero
        label="CAMPAÑAS"
        title="Modo llamadas"
        subtitle="Cola de llamadas del día, registro de resultado en 2 taps"
      />
      <div style={{ padding: '40px 0', textAlign: 'center', color: T.ink2, fontSize: 13 }}>
        🚧 En construcción
      </div>
    </PageLayout>
  );
}
