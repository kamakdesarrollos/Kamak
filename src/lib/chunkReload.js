// Manejo de "chunk faltante" tras un deploy. Cuando sale una versión nueva, los
// archivos JS cambian de hash; una pestaña abierta con el index viejo pide un
// chunk que ya no existe (404) → "Failed to fetch dynamically imported module".
// No es un error real: hay que recargar para tomar la versión nueva. Este helper
// se usa tanto en el window.onerror (main.jsx) como en el ErrorBoundary, con un
// contador compartido para reintentar unas pocas veces (el CDN puede tardar <1s
// en propagar el index nuevo) sin entrar en loop infinito.

const KEY = 'kamak_chunk_reload_count';
const MAX_RELOADS = 2;

export function isChunkError(error) {
  const msg = (error && (error.message || error)) ? String(error.message || error) : '';
  return /Failed to fetch dynamically imported module|Failed to load module script|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|dynamically imported module/i.test(msg);
}

// Dispara un reload (con un pequeño delay para que el CDN propague el index
// nuevo) si todavía quedan reintentos. Devuelve true si va a recargar, false si
// ya se agotaron (el caller debería mostrar una pantalla amable de "recargá").
export function tryReloadForChunk() {
  let count = 0;
  try { count = parseInt(sessionStorage.getItem(KEY) || '0', 10) || 0; } catch { /* sin sessionStorage */ }
  if (count >= MAX_RELOADS) return false;
  try { sessionStorage.setItem(KEY, String(count + 1)); } catch { /* noop */ }
  console.warn(`[chunk-reload] chunk faltante (deploy nuevo). Recargando… (intento ${count + 1}/${MAX_RELOADS})`);
  setTimeout(() => { window.location.reload(); }, 800);
  return true;
}

// Limpia el contador cuando la app cargó bien (así un futuro deploy vuelve a
// tener sus reintentos completos).
export function clearChunkReloadMark() {
  try { sessionStorage.removeItem(KEY); } catch { /* noop */ }
}
