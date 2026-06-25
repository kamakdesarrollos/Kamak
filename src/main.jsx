import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { startAutoReload } from './lib/autoReload'
import { isChunkError, tryReloadForChunk, clearChunkReloadMark } from './lib/chunkReload'

// ── Manejo de chunk loading failures ─────────────────────────────────────
// Tras un deploy nuevo los chunks JS cambian de hash; una pestaña vieja pide
// un chunk que ya no existe y la app crashearia. Detectamos ese error y
// recargamos (con reintentos acotados, ver lib/chunkReload). Devuelve true si
// manejó el error (para preventDefault y no mostrar el crash).
function handleChunkError(error) {
  if (!isChunkError(error)) return false;
  return tryReloadForChunk();
}

window.addEventListener('error', (e) => {
  if (handleChunkError(e.error || { message: e.message })) e.preventDefault();
});
window.addEventListener('unhandledrejection', (e) => {
  if (handleChunkError(e.reason)) e.preventDefault();
});
// Evento oficial de Vite cuando falla el preload de un módulo dinámico (la señal
// más confiable de "chunk viejo tras deploy"). Lo atajamos antes que nada.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  tryReloadForChunk();
});

// Si la app cargó bien, limpiamos el contador de reintentos (un futuro deploy
// vuelve a tener sus reintentos completos).
setTimeout(clearChunkReloadMark, 5000);

// ── Auto-sanado de Service Workers / caches viejos ────────────────────────
// Esta app NUNCA registra un Service Worker. Si quedó uno (de una versión vieja,
// una extensión, o el hosting), intercepta los pedidos y sirve chunks viejos →
// rompe la app (lazy module undefined / chunk 404) y NO se va borrando "imágenes
// y archivos en caché". Lo desregistramos + borramos las CacheStorage y, si había
// algo, recargamos UNA vez para tomar todo fresco. Inofensivo si no hay nada (no
// recarga). Guard en sessionStorage para no entrar en loop.
async function purgarServiceWorkersYCaches() {
  let limpio = false;
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) {
        const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || '';
        if (url.includes('sw-push')) continue; // NO desregistrar nuestro SW de push
        try { await r.unregister(); limpio = true; } catch { /* noop */ }
      }
    }
  } catch { /* noop */ }
  try {
    if (window.caches && caches.keys) {
      const keys = await caches.keys();
      for (const k of keys) { try { await caches.delete(k); limpio = true; } catch { /* noop */ } }
    }
  } catch { /* noop */ }
  if (limpio) {
    try {
      if (sessionStorage.getItem('kamak_sw_purgado')) return;
      sessionStorage.setItem('kamak_sw_purgado', '1');
    } catch { /* sin sessionStorage */ }
    console.warn('[purga] Service Worker/caches viejos eliminados. Recargando limpio…');
    window.location.reload();
  }
}
purgarServiceWorkersYCaches();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Detecta deploys nuevos y actualiza las pestañas viejas solas (al volver a
// la pestaña), para que no queden corriendo código viejo que pise datos.
startAutoReload();
