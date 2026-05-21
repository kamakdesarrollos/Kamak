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
import { ConfiguracionProvider } from './store/ConfiguracionContext';
import { UsuariosProvider, useUsuarios } from './store/UsuariosContext';

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
import MobileComprador from './pages/mobile/MobileComprador';
import MobileDirector from './pages/mobile/MobileDirector';
import PortalCliente from './pages/portal/PortalCliente';
import PortalProveedor from './pages/portal/PortalProveedor';

const INACTIVITY_MS = 15 * 60 * 1000; // 15 minutos
const WARN_MS       =  1 * 60 * 1000; // aviso 1 minuto antes

function AuthGate({ children }) {
  const { currentUser, logout } = useUsuarios();
  const [secondsLeft, setSecondsLeft] = useState(null); // null = sin aviso
  const logoutTimer  = useRef(null);
  const warnTimer    = useRef(null);
  const countdown    = useRef(null);

  const reset = useCallback(() => {
    clearTimeout(logoutTimer.current);
    clearTimeout(warnTimer.current);
    clearInterval(countdown.current);
    setSecondsLeft(null);

    if (!currentUser) return;

    warnTimer.current = setTimeout(() => {
      setSecondsLeft(60);
      countdown.current = setInterval(() => {
        setSecondsLeft(s => {
          if (s <= 1) { clearInterval(countdown.current); return 0; }
          return s - 1;
        });
      }, 1000);
    }, INACTIVITY_MS - WARN_MS);

    logoutTimer.current = setTimeout(logout, INACTIVITY_MS);
  }, [currentUser, logout]);

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

  if (!currentUser) return <Login />;

  return (
    <>
      {children}
      {secondsLeft !== null && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#1a1a1e', color: '#fff', padding: '12px 20px', borderRadius: 8, boxShadow: '0 6px 28px rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', gap: 14, fontSize: 13, border: '1.5px solid #d97706', whiteSpace: 'nowrap' }}>
          <span style={{ color: '#d97706', fontSize: 16 }}>⚠</span>
          <span>Tu sesión se cerrará en <b style={{ fontVariantNumeric: 'tabular-nums' }}>{secondsLeft}s</b> por inactividad</span>
          <button onClick={reset}
            style={{ padding: '5px 14px', background: '#1a9b9c', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            Continuar
          </button>
        </div>
      )}
    </>
  );
}

export default function App() {
  return (
    <ConfiguracionProvider>
    <DolarProvider>
    <ObrasProvider>
    <CatalogProvider>
    <PlantillasProvider>
    <GastosFijosProvider>
    <ProveedoresProvider>
    <ClientesProvider>
    <MovimientosProvider>
    <UsuariosProvider>
      <AuthGate>
        <BrowserRouter>
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
            <Route path="/prorrateo" element={<Prorrateo />} />
            <Route path="/catalogos" element={<Catalogos />} />
            <Route path="/plantillas" element={<Plantillas />} />
            <Route path="/reportes" element={<Reportes />} />
            <Route path="/autorizaciones" element={<Autorizaciones />} />
            <Route path="/configuracion" element={<Configuracion />} />
            <Route path="/mobile/comprador" element={<MobileComprador />} />
            <Route path="/mobile/director" element={<MobileDirector />} />
            <Route path="/portal/cliente/:id" element={<PortalCliente />} />
            <Route path="/portal/proveedor" element={<PortalProveedor />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthGate>
    </UsuariosProvider>
    </MovimientosProvider>
    </ClientesProvider>
    </ProveedoresProvider>
    </GastosFijosProvider>
    </PlantillasProvider>
    </CatalogProvider>
    </ObrasProvider>
    </DolarProvider>
    </ConfiguracionProvider>
  );
}
