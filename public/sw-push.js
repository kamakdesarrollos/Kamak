/* SW MÍNIMO SOLO-PUSH de Kamak. NO tiene 'fetch' handler ni precache → no
   intercepta pedidos de la app → no puede romper navegación ni servir chunks
   viejos (la causa del lío de la PWA Fase 1). Sólo push + click. */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const titulo = data.titulo || 'Kamak';
  const opciones = {
    body: data.cuerpo || '',
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    data: { link: data.link || '/' },
  };
  event.waitUntil(self.registration.showNotification(titulo, opciones));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil((async () => {
    const todas = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of todas) { if ('focus' in c) { c.navigate(link); return c.focus(); } }
    if (clients.openWindow) return clients.openWindow(link);
  })());
});
