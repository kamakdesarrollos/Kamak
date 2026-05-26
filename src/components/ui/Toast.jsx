import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { T } from '../../theme';

// Sistema de notificaciones tipo toast.
//
// Antes muchos errores de la app se mostraban via console.error o alert()
// (uno bloqueante, el otro invisible). Esto centraliza un sistema de notif
// flotante no bloqueante que aparece en la esquina inferior derecha.
//
// USO:
//   const { showToast } = useToast();
//   showToast({ type: 'error', msg: 'No se pudo guardar' });
//   showToast({ type: 'ok', msg: 'Guardado' });
//   showToast({ type: 'info', msg: 'Sincronizando…' });
//   showToast({ type: 'warn', msg: 'Sin conexion' });
//
// Auto-cierre a los 4 segundos (configurable via duration).
// Click en el toast lo cierra.

const ToastContext = createContext({ showToast: () => {} });

const COLORS = {
  ok:    { bg: '#d1fae5', text: '#059669', border: '#059669' },
  error: { bg: '#fee2e2', text: '#dc2626', border: '#dc2626' },
  warn:  { bg: '#fef3c7', text: '#d97706', border: '#d97706' },
  info:  { bg: '#dbeafe', text: '#2563eb', border: '#2563eb' },
};

const ICONS = { ok: '✓', error: '✕', warn: '⚠', info: 'ℹ' };

let _idCounter = 0;
const nextId = () => ++_idCounter;

// Helper para disparar un toast desde codigo NO-React (ej: lib/dbHelpers.js
// que no puede usar el hook). Despacha un CustomEvent que el provider escucha.
export const fireToast = (detail) => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('kamak:toast', { detail }));
  }
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const tid = timers.current.get(id);
    if (tid) { clearTimeout(tid); timers.current.delete(id); }
  }, []);

  const showToast = useCallback(({ type = 'info', msg, duration = 4000 }) => {
    const id = nextId();
    setToasts(prev => [...prev, { id, type, msg }]);
    if (duration > 0) {
      const tid = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, tid);
    }
    return id;
  }, [dismiss]);

  // Cleanup todos los timers al desmontar.
  useEffect(() => () => {
    timers.current.forEach(tid => clearTimeout(tid));
    timers.current.clear();
  }, []);

  // Escuchar eventos disparados desde codigo no-React (lib/, etc.).
  useEffect(() => {
    const onEvent = (e) => showToast(e.detail || {});
    window.addEventListener('kamak:toast', onEvent);
    return () => window.removeEventListener('kamak:toast', onEvent);
  }, [showToast]);

  const value = useMemo(() => ({ showToast, dismiss }), [showToast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 10_000,
        display: 'flex', flexDirection: 'column', gap: 8,
        pointerEvents: 'none',
      }}>
        {toasts.map(t => {
          const c = COLORS[t.type] || COLORS.info;
          return (
            <div key={t.id} onClick={() => dismiss(t.id)}
              style={{
                minWidth: 260, maxWidth: 380,
                background: c.bg, color: c.text,
                border: `1.5px solid ${c.border}`,
                borderRadius: 6,
                padding: '10px 14px',
                fontFamily: T.font, fontSize: 13, fontWeight: 600,
                boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                display: 'flex', alignItems: 'center', gap: 10,
                cursor: 'pointer', userSelect: 'none',
                pointerEvents: 'auto',
                animation: 'kamak-toast-in 0.2s ease-out',
              }}>
              <span style={{ fontSize: 16, fontWeight: 800, flexShrink: 0 }}>{ICONS[t.type] || 'ℹ'}</span>
              <span style={{ flex: 1, lineHeight: 1.35 }}>{t.msg}</span>
              <span style={{ fontSize: 16, opacity: 0.5, flexShrink: 0 }}>×</span>
            </div>
          );
        })}
      </div>
      {/* Keyframes inyectadas inline para no crear un .css extra. */}
      <style>{`
        @keyframes kamak-toast-in {
          from { transform: translateX(20px); opacity: 0; }
          to   { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
