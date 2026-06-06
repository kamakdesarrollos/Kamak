import { useState, useRef, useCallback, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ObrasProvider } from './store/ObrasContext';
import { CatalogProvider } from './store/CatalogContext';
import { PlantillasProvider } from './store/PlantillasContext';
import { GastosFijosProvider } from './store/GastosFijosContext';
import { DolarProvider } from './store/DolarContext';
import { IndicesProvider } from './store/IndicesContext';
import { ProveedoresProvider } from './store/ProveedoresContext';
import { ClientesProvider } from './store/ClientesContext';
import { ComprobantesProvider } from './store/ComprobantesContext';
import { FinancieroProvider } from './store/FinancieroContext';
import { MovimientosProvider } from './store/MovimientosContext';
import { ChequesProvider } from './store/ChequesContext';
import { WhatsappPendingProvider } from './store/WhatsappPendingContext';
import { AlertasProvider } from './store/AlertasContext';
import { SolicitudesProvider } from './store/SolicitudesContext';
import { TareasProvider } from './store/TareasContext';
import { ComercialProvider } from './store/ComercialContext';
import { ConfiguracionProvider } from './store/ConfiguracionContext';
import { UsuariosProvider, useUsuarios } from './store/UsuariosContext';
import { AppLoadingProvider, useAppLoading } from './store/AppLoadingContext';

import { AuthProvider, useAuth } from './store/AuthContext';

// Login se importa estatico — es lo primero que se ve si no hay sesion.
import Login from './pages/Login';
import WhatsappVerificationBanner from './components/WhatsappVerificationBanner';
import VentaSync from './components/VentaSync';
import { ToastProvider } from './components/ui/Toast';
import ErrorBoundary from './components/ErrorBoundary';

// Resto de paginas: lazy load para bajar el bundle inicial. Cada pagina
// se descarga solo cuando el usuario navega a ella.
const Dashboard          = lazy(() => import('./pages/Dashboard'));
const Obras              = lazy(() => import('./pages/Obras'));
const ObraPresupuesto    = lazy(() => import('./pages/obra/ObraPresupuesto'));
const ObraGantt          = lazy(() => import('./pages/obra/ObraGantt'));
const Proveedores        = lazy(() => import('./pages/Proveedores'));
const Clientes           = lazy(() => import('./pages/Clientes'));
const Pipeline           = lazy(() => import('./pages/comercial/Pipeline'));
const VentasReportes     = lazy(() => import('./pages/comercial/VentasReportes'));
const Facturacion        = lazy(() => import('./pages/Facturacion'));
const ProveedorCC        = lazy(() => import('./pages/ProveedorCC'));
const Movimientos        = lazy(() => import('./pages/Movimientos'));
const Cajas              = lazy(() => import('./pages/Cajas'));
const Conciliacion       = lazy(() => import('./pages/Conciliacion'));
const Prorrateo          = lazy(() => import('./pages/Prorrateo'));
const Catalogos          = lazy(() => import('./pages/Catalogos'));
const Plantillas         = lazy(() => import('./pages/Plantillas'));
const Reportes           = lazy(() => import('./pages/Reportes'));
const Autorizaciones     = lazy(() => import('./pages/Autorizaciones'));
const Tareas             = lazy(() => import('./pages/Tareas'));
const Usuarios           = lazy(() => import('./pages/Usuarios'));
const Configuracion      = lazy(() => import('./pages/Configuracion'));
const Perfil             = lazy(() => import('./pages/Perfil'));
const Cheques            = lazy(() => import('./pages/Cheques'));
const CuentasPorPagar    = lazy(() => import('./pages/CuentasPorPagar'));
// WhatsappBuzon eliminado — /whatsapp ahora redirige a /autorizaciones?origen=whatsapp.
const MobileComprador    = lazy(() => import('./pages/mobile/MobileComprador'));
const MobileDirector     = lazy(() => import('./pages/mobile/MobileDirector'));
const PortalCliente      = lazy(() => import('./pages/portal/PortalCliente'));
const PortalProveedor    = lazy(() => import('./pages/portal/PortalProveedor'));
const PortalAcceso       = lazy(() => import('./pages/portal/PortalAcceso'));

const RouteFallback = () => (
  <div style={{ minHeight: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 13 }}>
    Cargando…
  </div>
);

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

  // Rol Contador: solo puede ver /facturacion. Si entra a cualquier otra ruta
  // (o aterriza en "/" después del login), lo mandamos directo a su panel.
  const location = useLocation();
  const navigateRR = useNavigate();
  useEffect(() => {
    if (currentUser?.rol === 'Contador externo' && location.pathname !== '/facturacion') {
      navigateRR('/facturacion', { replace: true });
    }
  }, [currentUser?.rol, location.pathname, navigateRR]);

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

// Envuelve los Providers de datos. Se remonta entero cuando cambia el usuario
// (vía key={user?.id} en AppShell) para que cada context refetcheee con la
// auth correcta y no quede estado del usuario anterior en memoria.
function DataProviders({ children }) {
  return (
    <AppLoadingProvider>
    <ConfiguracionProvider>
    <DolarProvider>
    <IndicesProvider>
    <ObrasProvider>
    <CatalogProvider>
    <PlantillasProvider>
    <GastosFijosProvider>
    <ProveedoresProvider>
    <ClientesProvider>
    <ComercialProvider>
    <ComprobantesProvider>
    <FinancieroProvider>
    <MovimientosProvider>
    <ChequesProvider>
    <WhatsappPendingProvider>
    <SolicitudesProvider>
    <TareasProvider>
    <AlertasProvider>
    <UsuariosProvider>
      {children}
    </UsuariosProvider>
    </AlertasProvider>
    </TareasProvider>
    </SolicitudesProvider>
    </WhatsappPendingProvider>
    </ChequesProvider>
    </MovimientosProvider>
    </FinancieroProvider>
    </ComprobantesProvider>
    </ComercialProvider>
    </ClientesProvider>
    </ProveedoresProvider>
    </GastosFijosProvider>
    </PlantillasProvider>
    </CatalogProvider>
    </ObrasProvider>
    </IndicesProvider>
    </DolarProvider>
    </ConfiguracionProvider>
    </AppLoadingProvider>
  );
}

function AppShell() {
  const { user } = useAuth();
  return (
    <DataProviders key={user?.id ?? 'anon'}>
      <BrowserRouter>
        {/* ErrorBoundary captura cualquier error de render para evitar
            pantalla en blanco. */}
        <ErrorBoundary>
        {/* Suspense para soportar lazy() de las paginas: muestra "Cargando"
            mientras descarga el chunk del componente. */}
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Rutas públicas — sin autenticación (portales para clientes/proveedores) */}
            <Route path="/portal/cliente/:id" element={<PortalCliente />} />
            <Route path="/portal/proveedor" element={<PortalProveedor />} />
            <Route path="/portal/acceso/:token" element={<PortalAcceso />} />

            {/* Rutas internas — requieren autenticación */}
            <Route path="*" element={
              <AuthGate>
                {/* Reconciliador global pago->Ganado: corre una vez, dentro de
                    los Providers de Obras/Movimientos/Dolar del area autenticada. */}
                <VentaSync />
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/obras" element={<Obras />} />
                  <Route path="/obras/:id/presupuesto" element={<ObraPresupuesto />} />
                  <Route path="/obras/:id/gantt" element={<ObraGantt />} />
                  <Route path="/proveedores" element={<Proveedores />} />
                  <Route path="/clientes" element={<Clientes />} />
                  <Route path="/comercial" element={<Pipeline />} />
                  <Route path="/comercial/reportes" element={<VentasReportes />} />
                  <Route path="/proveedores/:id" element={<ProveedorCC />} />
                  <Route path="/movimientos" element={<Movimientos />} />
                  <Route path="/cajas" element={<Cajas />} />
                  <Route path="/cajas/conciliacion" element={<Conciliacion />} />
                  <Route path="/cheques" element={<Cheques />} />
                  <Route path="/ordenes-de-pago" element={<CuentasPorPagar />} />
                  <Route path="/cuentas-por-pagar" element={<CuentasPorPagar />} />
                  <Route path="/facturacion" element={<Facturacion />} />
                  {/* /whatsapp queda como atajo a la seccion WhatsApp de /autorizaciones */}
                  <Route path="/whatsapp" element={<Navigate to="/autorizaciones?origen=whatsapp" replace />} />
                  <Route path="/prorrateo" element={<Prorrateo />} />
                  <Route path="/catalogos" element={<Catalogos />} />
                  <Route path="/plantillas" element={<Plantillas />} />
                  <Route path="/reportes" element={<Reportes />} />
                  <Route path="/autorizaciones" element={<Autorizaciones />} />
                  <Route path="/tareas" element={<Tareas />} />
                  <Route path="/usuarios" element={<Usuarios />} />
                  <Route path="/configuracion" element={<Configuracion />} />
                  <Route path="/perfil" element={<Perfil />} />
                  <Route path="/mobile/comprador" element={<MobileComprador />} />
                  <Route path="/mobile/director" element={<MobileDirector />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </AuthGate>
            } />
          </Routes>
        </Suspense>
        </ErrorBoundary>
      </BrowserRouter>
    </DataProviders>
  );
}

export default function App() {
  return (
    <ToastProvider>
    <AuthProvider>
      <AppShell />
    </AuthProvider>
    </ToastProvider>
  );
}
