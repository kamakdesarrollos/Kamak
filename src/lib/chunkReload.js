// Manejo de "chunk faltante" tras un deploy. Cuando sale una versión nueva, los
// archivos JS cambian de hash; una pestaña abierta con el index viejo pide un
// chunk que ya no existe (404) → "Failed to fetch dynamically imported module".
// No es un error real: hay que recargar para tomar la versión nueva. Este helper
// se usa tanto en el window.onerror (main.jsx) como en el ErrorBoundary, con un
// contador compartido para reintentar unas pocas veces (el CDN puede tardar <1s
// en propagar el index nuevo) sin entrar en loop infinito.

const KEY = 'kamak_chunk_reload_count';
const PARAM = '_cr';
const MAX_RELOADS = 2;

// Lee el contador de reintentos. Prioriza sessionStorage; si falla (iOS en modo
// PRIVADO: sessionStorage lanza / no persiste), cae al contador en la URL, que
// sobrevive las recargas → evita el LOOP de recarga infinito ante un chunk error
// persistente cuando no hay storage.
function readCount() {
  try { const s = sessionStorage.getItem(KEY); if (s != null) return parseInt(s, 10) || 0; } catch { /* sin storage */ }
  try { return parseInt(new URLSearchParams(window.location.search).get(PARAM) || '0', 10) || 0; } catch { return 0; }
}

export function isChunkError(error) {
  const msg = (error && (error.message || error)) ? String(error.message || error) : '';
  return /Failed to fetch dynamically imported module|Failed to load module script|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|dynamically imported module/i.test(msg);
}

// Dispara un reload (con un pequeño delay para que el CDN propague el index
// nuevo) si todavía quedan reintentos. Devuelve true si va a recargar, false si
// ya se agotaron (el caller debería mostrar una pantalla amable de "recargá").
export function tryReloadForChunk() {
  const count = readCount();
  if (count >= MAX_RELOADS) return false;
  const next = count + 1;
  let stored = false;
  try { sessionStorage.setItem(KEY, String(next)); stored = true; } catch { /* sin storage */ }
  console.warn(`[chunk-reload] chunk faltante (deploy nuevo). Recargando… (intento ${next}/${MAX_RELOADS})`);
  setTimeout(() => {
    if (stored) { window.location.reload(); return; }
    // Sin sessionStorage (iOS privado): el contador va por la URL para que
    // sobreviva la recarga y se respete el tope (sin esto = loop infinito).
    try {
      const u = new URL(window.location.href);
      u.searchParams.set(PARAM, String(next));
      window.location.replace(u.toString());
    } catch { window.location.reload(); }
  }, 800);
  return true;
}

// Limpia el contador cuando la app cargó bien (así un futuro deploy vuelve a
// tener sus reintentos completos).
export function clearChunkReloadMark() {
  try { sessionStorage.removeItem(KEY); } catch { /* noop */ }
  // Limpiar el contador de la URL si quedó (fallback iOS privado) — así no
  // aparece en la barra ni cuenta de más en un próximo chunk error.
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.has(PARAM)) { u.searchParams.delete(PARAM); window.history.replaceState(null, '', u.toString()); }
  } catch { /* noop */ }
}
