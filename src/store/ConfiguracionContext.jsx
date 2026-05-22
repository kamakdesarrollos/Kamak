import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { loadSharedData, saveSharedData } from '../lib/dbHelpers';
import { onRemoteChange } from '../lib/syncBus';
import { useAppLoading } from './AppLoadingContext';

const CTX = createContext(null);
const LS_KEY = 'kamak_config_v1';

const DEFAULT = {
  empresa: {
    razonSocial: 'Kamak Desarrollos SRL',
    cuit: '30-71234567-8',
    direccion: 'Av. Corrientes 1234, CABA',
    email: 'admin@kamak.ar',
    telefono: '+54 11 4800-0000',
  },
  ejercicioInicio: '01/01',
  doubleCurrency: true,
  notificaciones: {
    pagosPendientes: true,
    avanceEmail: true,
    resumenSemanal: false,
    whatsappBot: true,
    stockBajo: false,
  },
  seguridad: {
    dosFactor: true,
    sesionesMultiples: false,
    logAuditoria: true,
    ipWhitelist: false,
  },
  apariencia: {
    idioma: 'Español (Argentina)',
    timezone: 'America/Buenos_Aires',
    formatoFecha: 'DD/MM/AAAA',
    formatoMoneda: '$ 1.234.567,00',
  },
};

function load() {
  try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(LS_KEY) || 'null') }; } catch { return DEFAULT; }
}

function persist(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
}

export function ConfiguracionProvider({ children }) {
  const [config, setConfig] = useState(load);
  const sbLoaded   = useRef(false);
  const fromRemote = useRef(false);
  const { markReady } = useAppLoading();

  useEffect(() => {
    loadSharedData('config').then(data => {
      if (data) {
        fromRemote.current = true;
        const merged = { ...DEFAULT, ...data }; setConfig(merged); persist(merged);
        setTimeout(() => { fromRemote.current = false; }, 0);
      } else saveSharedData('config', config); // eslint-disable-line react-hooks/exhaustive-deps
      sbLoaded.current = true;
      markReady();
    });

    const unsub = onRemoteChange('config', () => {
      loadSharedData('config').then(d => {
        if (!d) return;
        fromRemote.current = true;
        const merged = { ...DEFAULT, ...d };
        setConfig(merged); persist(merged);
        setTimeout(() => { fromRemote.current = false; }, 0);
      });
    });
    return () => unsub();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sbLoaded.current || fromRemote.current) return;
    const t = setTimeout(() => { saveSharedData('config', config); }, 800);
    return () => clearTimeout(t);
  }, [config]);

  const patch = useCallback((section, changes) => {
    setConfig(prev => {
      const next = section
        ? { ...prev, [section]: { ...prev[section], ...changes } }
        : { ...prev, ...changes };
      persist(next);
      return next;
    });
  }, []);

  const patchEmpresa       = useCallback((ch) => patch('empresa', ch), [patch]);
  const patchNotificaciones = useCallback((ch) => patch('notificaciones', ch), [patch]);
  const patchSeguridad     = useCallback((ch) => patch('seguridad', ch), [patch]);
  const patchApariencia    = useCallback((ch) => patch('apariencia', ch), [patch]);
  const patchRoot          = useCallback((ch) => patch(null, ch), [patch]);

  return (
    <CTX.Provider value={{ config, patchEmpresa, patchNotificaciones, patchSeguridad, patchApariencia, patchRoot }}>
      {children}
    </CTX.Provider>
  );
}

export const useConfiguracion = () => useContext(CTX);
