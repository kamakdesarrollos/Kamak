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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Detecta deploys nuevos y actualiza las pestañas viejas solas (al volver a
// la pestaña), para que no queden corriendo código viejo que pise datos.
startAutoReload();
