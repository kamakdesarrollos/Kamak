import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../../components/layout/PageLayout';
import PageHero from '../../components/ui/PageHero';
import { T } from '../../theme';
import { useUsuarios } from '../../store/UsuariosContext';

// Base de contactos (operadores → estaciones → decisores). STUB: se reemplaza
// en la fase de UI.

export default function CampContactos() {
  const { currentUser } = useUsuarios();
  const navigate = useNavigate();

  // Guard: solo Admin o usuarios con el permiso `campanas` (patrón Pipeline.jsx).
  const puede = currentUser?.rol === 'Admin' || !!currentUser?.permisos?.campanas;
  useEffect(() => { if (currentUser && !puede) navigate('/', { replace: true }); }, [currentUser, puede, navigate]);

  return (
    <PageLayout breadcrumb={[{ label: 'Inicio', to: '/' }, 'Campañas']} active="Campañas">
      <PageHero
        label="CAMPAÑAS"
        title="Contactos"
        subtitle="Operadores, estaciones y decisores de la campaña"
      />
      <div style={{ padding: '40px 0', textAlign: 'center', color: T.ink2, fontSize: 13 }}>
        🚧 En construcción
      </div>
    </PageLayout>
  );
}
