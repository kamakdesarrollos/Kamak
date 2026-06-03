// autoReload.js — Detecta un deploy nuevo (cambió el hash del bundle index) y
// recarga la pestaña para que NO quede corriendo código viejo. Esto importa
// porque una pestaña vieja puede pisar datos de otra (patrón de guardado anterior).
//
// Recarga en el momento SEGURO: cuando la pestaña vuelve a estar visible (no
// mientras estás tipeando en ella). Mientras tanto, avisa con un toast.
// En dev no hace nada (no hay bundle hasheado → runningHash() === null).

const INDEX_RE = /assets\/index-([A-Za-z0-9_-]+)\.js/;

function runningHash() {
  for (const s of document.querySelectorAll('script[src]')) {
    const m = (s.getAttribute('src') || '').match(INDEX_RE);
    if (m) return m[1];
  }
  return null;
}

export function startAutoReload({ intervalMs = 4 * 60 * 1000 } = {}) {
  const current = runningHash();
  if (!current) return; // dev / no se encontró el bundle → no-op

  let newAvailable = false;
  let reloaded = false;

  const fetchLatestHash = async () => {
    try {
      const res = await fetch('/?_v=' + Date.now(), { cache: 'no-store' });
      const html = await res.text();
      const m = html.match(INDEX_RE);
      return m ? m[1] : null;
    } catch { return null; }
  };

  const check = async () => {
    if (reloaded || newAvailable) return;
    const latest = await fetchLatestHash();
    if (latest && latest !== current) {
      newAvailable = true;
      try {
        window.dispatchEvent(new CustomEvent('kamak:toast', {
          detail: { type: 'info', msg: 'Hay una versión nueva — se va a actualizar sola al volver a esta pestaña.' },
        }));
      } catch { /* sin window/toast */ }
    }
  };

  const reloadIfSafe = () => {
    if (newAvailable && !reloaded && !document.hidden) {
      reloaded = true;
      window.location.reload();
    }
  };

  setInterval(check, intervalMs);
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    if (!newAvailable) await check();
    reloadIfSafe();
  });
  // Primer chequeo a los 30s del arranque (no apenas carga).
  setTimeout(check, 30000);
}
