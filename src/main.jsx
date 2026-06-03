import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { startAutoReload } from './lib/autoReload'

// ── Manejo de chunk loading failures ─────────────────────────────────────
// Cuando hay un deploy nuevo, los chunks JS cambian de hash. Si el usuario
// tiene la app abierta hace rato e intenta navegar a una pagina, el chunk
// viejo ya no existe en el servidor (404) y la app crashea con pantalla
// en blanco. Para evitarlo: detectamos este error especifico y recargamos
// la app para que tome la version nueva.
//
// Solo recargamos UNA VEZ por sesion para evitar loops infinitos si por
// algun motivo el reload no soluciona.
const RELOAD_KEY = 'kamak_chunk_reload_done';
function handleChunkError(error) {
  const msg = error?.message || String(error);
  const isChunkError =
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Failed to load module script') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module') ||
    (msg.includes('ChunkLoadError'));
  if (!isChunkError) return false;
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) {
      console.warn('[chunk-reload] ya se intento recargar una vez; no entrar en loop.');
      return false;
    }
    sessionStorage.setItem(RELOAD_KEY, '1');
  } catch {}
  console.warn('[chunk-reload] chunk faltante (probablemente despues de un deploy). Recargando...');
  window.location.reload();
  return true;
}

window.addEventListener('error', (e) => {
  if (handleChunkError(e.error || { message: e.message })) e.preventDefault();
});
window.addEventListener('unhandledrejection', (e) => {
  if (handleChunkError(e.reason)) e.preventDefault();
});

// Limpiar la marca de reload si la app cargó sin problemas — la proxima vez
// que haya un chunk error, podemos reintentar.
setTimeout(() => {
  try { sessionStorage.removeItem(RELOAD_KEY); } catch {}
}, 4000);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Detecta deploys nuevos y actualiza las pestañas viejas solas (al volver a
// la pestaña), para que no queden corriendo código viejo que pise datos.
startAutoReload();
