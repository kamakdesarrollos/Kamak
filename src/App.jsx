import { useState, useRef, useCallback, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ObrasProvider } from './store/ObrasContext';
import { CatalogProvider } from './store/CatalogContext';
import { PlantillasProvider } from './store/PlantillasContext';
import { GastosFijosProvider } from './store/GastosFijosContext';
import { DolarProvider } from './store/DolarContext';
import { ProveedoresProvider } from './store/ProveedoresContext';
import { ClientesProvider } from './store/ClientesContext';
import { MovimientosProvider } from './store/MovimientosContext';
import { ChequesProvider } from './store/ChequesContext';
import { WhatsappPendingProvider } from './store/WhatsappPendingContext';
import { AlertasProvider } from './store/AlertasContext';
import { SolicitudesProvider } from './store/SolicitudesContext';
import { ConfiguracionProvider } from './store/ConfiguracionContext';
import { UsuariosProvider, useUsuarios } from './store/UsuariosContext';
import { AppLoadingProvider, useAppLoading } from './store/AppLoadingContext';

import { AuthProvider, useAuth } from './store/AuthContext';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Obras from './pages/Obras';
import ObraPresupuesto from './pages/obra/ObraPresupuesto';
import ObraGantt from './pages/obra/ObraGantt';
import Proveedores from './pages/Proveedores';
import Clientes from './pages/Clientes';
import ProveedorCC from './pages/ProveedorCC';
import Movimientos from './pages/Movimientos';
import Cajas from './pages/Cajas';
import Conciliacion from './pages/Conciliacion';
import Prorrateo from './pages/Prorrateo';
import Catalogos from './pages/Catalogos';
import Plantillas from './pages/Plantillas';
import Reportes from './pages/Reportes';
import Autorizaciones from './pages/Autorizaciones';
import Configuracion from './pages/Configuracion';
import Cheques from './pages/Cheques';
import WhatsappBuzon from './pages/WhatsappBuzon';
import WhatsappVerificationBanner from './components/WhatsappVerificationBanner';
import MobileComprador from './pages/mobile/MobileComprador';
import MobileDirector from './pages/mobile/MobileDirector';
import PortalCliente from './pages/portal/PortalCliente';
import PortalProveedor from './pages/portal/PortalProveedor';
import PortalAcceso from './pages/portal/PortalAcceso';

const INACTIVITY_MS = 15 * 60 * 1000; // 15 minutos
const WARN_MS       =  1 * 60 * 1000; // aviso 1 minuto antes

function AuthGate({ children }) {
  const { user, loading: authLoading, signOut } = useAuth();
  const { currentUser, loginByEmail, bootstrapAdmin, usuarios, loading: usuariosLoading } = useUsuarios();
  const { allReady } = useAppLoading();
  const loading = authLoading || usuariosLoading;
  const [secondsLeft, setSecondsLeft] = useState(null);

  // Sincronizar sesión Supabase con UsuariosContext
  useEffect(() => {
    if (user) loginByEmail(user.email);
  }, [user, loginByEmail]);

  // Si la tabla app_users está vacía, insertar al usuario actual como Admin
  useEffect(() => {
    if (user && !loading && usuarios.length === 0) {
      bootstrapAdmin(user.email, user.user_metadata?.nombre || user.email.split('@')[0]);
    }
  }, [user, loading, usuarios, bootstrapAdmin]);
  const logoutTimer = useRef(null);
  const warnTimer   = useRef(null);
  const countdown   = useRef(null);

  const reset = useCallback(() => {
    clearTimeout(logoutTimer.current);
    clearTimeout(warnTimer.current);
    clearInterval(countdown.current);
    setSecondsLeft(null);
    if (!user) return;
    warnTimer.current = setTimeout(() => {
      setSecondsLeft(60);
      countdown.current = setInterval(() => {
        setSecondsLeft(s => { if (s <= 1) { clearInterval(countdown.current); return 0; } return s - 1; });
      }, 1000);
    }, INACTIVITY_MS - WARN_MS);
    logoutTimer.current = setTimeout(signOut, INACTIVITY_MS);
  }, [user, signOut]);

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(e => document.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach(e => document.removeEventListener(e, reset));
      clearTimeout(logoutTimer.current);
      clearTimeout(warnTimer.current);
      clearInterval(countdown.current);
    };
  }, [reset]);

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0ece0', fontFamily: 'sans-serif', color: '#666', fontSize: 14 }}>
      Cargando…
    </div>
  );

  if (!user) return <Login />;

  if (!allReady) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0ece0', fontFamily: 'sans-serif', color: '#666', fontSize: 14 }}>
      Cargando datos…
    </div>
  );

  if (!loading && !currentUser) return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f0ece0', fontFamily: 'sans-serif', gap: 12 }}>
      <div style={{ fontSize: 48 }}>🚫</div>
      <div style={{ fontWeight: 700, fontSize: 18, color: '#1a1a1e' }}>Sin acceso</div>
      <div style={{ fontSize: 13, color: '#666', textAlign: 'center', maxWidth: 320 }}>
        Tu cuenta <b>{user.email}</b> no tiene acceso a esta aplicación.<br />Contactá al administrador.
      </div>
      <button onClick={signOut} style={{ marginTop: 8, padding: '8px 20px', background: '#1a9b9c', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Cerrar sesión</button>
    </div>
  );

  return (
    <>
      {children}
      <WhatsappVerificationBanner />
      {secondsLeft !== null && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#1a1a1e', color: '#fff', padding: '12px 20px', borderRadius: 8, boxShadow: '0 6px 28px rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', gap: 14, fontSize: 13, border: '1.5px solid #d97706', whiteSpace: 'nowrap' }}>
          <span style={{ color: '#d97706', fontSize: 16 }}>⚠</span>
          <span>Tu sesión se cerrará en <b style={{ fontVariantNumeric: 'tabular-nums' }}>{secondsLeft}s</b> por inactividad</span>
          <button onClick={reset} style={{ padding: '5px 14px', background: '#1a9b9c', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Continuar</button>
        </div>
      )}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
    <AppLoadingProvider>
    <ConfiguracionProvider>
    <DolarProvider>
    <ObrasProvider>
    <CatalogProvider>
    <PlantillasProvider>
    <GastosFijosProvider>
    <ProveedoresProvider>
    <ClientesProvider>
    <MovimientosProvider>
    <ChequesProvider>
    <WhatsappPendingProvider>
    <SolicitudesProvider>
    <AlertasProvider>
    <UsuariosProvider>
      <BrowserRouter>
        <Routes>
          {/* Rutas públicas — sin autenticación (portales para clientes/proveedores) */}
          <Route path="/portal/cliente/:id" element={<PortalCliente />} />
          <Route path="/portal/proveedor" element={<PortalProveedor />} />
          <Route path="/portal/acceso/:token" element={<PortalAcceso />} />

          {/* Rutas internas — requieren autenticación */}
          <Route path="*" element={
            <AuthGate>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/obras" element={<Obras />} />
                <Route path="/obras/:id/presupuesto" element={<ObraPresupuesto />} />
                <Route path="/obras/:id/gantt" element={<ObraGantt />} />
                <Route path="/proveedores" element={<Proveedores />} />
                <Route path="/clientes" element={<Clientes />} />
                <Route path="/proveedores/:id" element={<ProveedorCC />} />
                <Route path="/movimientos" element={<Movimientos />} />
                <Route path="/cajas" element={<Cajas />} />
                <Route path="/cajas/conciliacion" element={<Conciliacion />} />
                <Route path="/cheques" element={<Cheques />} />
                <Route path="/whatsapp" element={<WhatsappBuzon />} />
                <Route path="/prorrateo" element={<Prorrateo />} />
                <Route path="/catalogos" element={<Catalogos />} />
                <Route path="/plantillas" element={<Plantillas />} />
                <Route path="/reportes" element={<Reportes />} />
                <Route path="/autorizaciones" element={<Autorizaciones />} />
                <Route path="/configuracion" element={<Configuracion />} />
                <Route path="/mobile/comprador" element={<MobileComprador />} />
                <Route path="/mobile/director" element={<MobileDirector />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AuthGate>
          } />
        </Routes>
      </BrowserRouter>
    </UsuariosProvider>
    </AlertasProvider>
    </SolicitudesProvider>
    </WhatsappPendingProvider>
    </ChequesProvider>
    </MovimientosProvider>
    </ClientesProvider>
    </ProveedoresProvider>
    </GastosFijosProvider>
    </PlantillasProvider>
    </CatalogProvider>
    </ObrasProvider>
    </DolarProvider>
    </ConfiguracionProvider>
    </AppLoadingProvider>
    </AuthProvider>
  );
}
