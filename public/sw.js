// SW de LIMPIEZA (kill-switch). La app ya NO registra ningún service worker; este
// archivo existe solo para que los dispositivos que quedaron con un SW viejo
// registrado (de la PWA revertida) lo eliminen: cuando el navegador chequea
// /sw.js para actualizar, recibe esto → desregistra el SW y borra TODOS los
// caches. NO recarga la página (a propósito: recargar generaba un loop).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) { /* noop */ }
    try {
      await self.registration.unregister();
    } catch (e) { /* noop */ }
  })());
});
