import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { loadSharedData, saveSharedData } from '../lib/dbHelpers';
import { onRemoteChange } from '../lib/syncBus';
import { useAppLoading } from './AppLoadingContext';

const CTX = createContext(null);
const LS_KEY = 'kamak_config_v1';

const DEFAULT = {
  empresa: {
    razonSocial: 'Conquies Soluciones Constructivas SA',
    nombreFantasia: 'Kamak',
    cuit: '30-71795385-8',
    condicionIVA: 'RI',           // Responsable Inscripto (emisor)
    puntoVenta: 1,                // punto de venta AFIP (ajustable)
    direccion: 'Calle 42 N°3703, Necochea (CP 7630)',
    iibbAlicuota: 3,              // % Ingresos Brutos (construcción Bs.As. ≈3, ajustable)
    email: 'admin@kamak.ar',
    telefono: '+54 11 4800-0000',
  },
  ejercicioInicio: '01/01',
  doubleCurrency: true,
  mediosDePago: ['Transferencia', 'Efectivo', 'Cheque', 'E-cheq', 'Débito', 'Tarjeta'],
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
    let cancelled = false;
    loadSharedData('config').then(data => {
      if (cancelled) return;
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
        if (cancelled || !d) return;
        fromRemote.current = true;
        const merged = { ...DEFAULT, ...d };
        setConfig(merged); persist(merged);
        setTimeout(() => { fromRemote.current = false; }, 0);
      });
    });
    return () => { cancelled = true; unsub(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingSaveRef = useRef(null);
  useEffect(() => {
    if (!sbLoaded.current || fromRemote.current) return;
    pendingSaveRef.current = config;
    const t = setTimeout(() => {
      saveSharedData('config', config);
      pendingSaveRef.current = null;
    }, 800);
    return () => clearTimeout(t);
  }, [config]);

  useEffect(() => () => {
    if (pendingSaveRef.current) saveSharedData('config', pendingSaveRef.current, { silent: true });
  }, []);

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

  const value = useMemo(
    () => ({ config, patchEmpresa, patchNotificaciones, patchSeguridad, patchApariencia, patchRoot }),
    [config, patchEmpresa, patchNotificaciones, patchSeguridad, patchApariencia, patchRoot]
  );

  return (
    <CTX.Provider value={value}>
      {children}
    </CTX.Provider>
  );
}

export const useConfiguracion = () => useContext(CTX);
