# Sistema de Notificaciones + Push — Fundación (Plan 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el motor de notificaciones (feed por rol + push web) y probarlo de punta a punta con 2 eventos piloto, en mobile, antes de instrumentar el resto (Plan 2).

**Architecture:** `notificaciones` y `push_subscriptions` viven en shared_data (patrón `useSyncedSharedData`). El cliente resuelve destinatarios con una función pura testeada y (a) agrega la notif al feed y (b) POSTea al endpoint de envío. El envío va consolidado como `?job=push` dentro de `api/whatsapp/jobs.js` (no se agrega function: Hobby = 12). El push usa un Service Worker **mínimo solo-push** (sin `fetch` handler → no puede romper la app como en Fase 1), registrado solo cuando el usuario lo activa, y whitelisteado en la purga de `main.jsx`.

**Tech Stack:** React 19, Vite 8, Supabase (shared_data + Auth), Vercel serverless, `web-push` (VAPID), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-24-sistema-notificaciones-push-design.md`

---

## File Structure

- Create `src/lib/notificaciones.js` — lógica pura: config `EVENTOS`, `resolverDestinatarios`, `noLeidaPara`.
- Create `src/lib/notificaciones.test.js` — tests de la lógica pura.
- Create `src/lib/push.js` — cliente: `activarPush`/`desactivarPush`/`pushSoportado`/`pushActivo`.
- Create `public/sw-push.js` — Service Worker mínimo (push + notificationclick).
- Create `src/store/NotificacionesContext.jsx` — store + `crearNotificacion`/`marcarLeida`/`marcarTodasLeidas`.
- Modify `src/App.jsx` — montar `NotificacionesProvider`.
- Modify `src/main.jsx` — whitelist del SW propio en `purgarServiceWorkersYCaches`.
- Modify `api/whatsapp/jobs.js` — agregar `?job=push` (envío con web-push).
- Modify `package.json` — dependencia `web-push`.
- Modify `src/components/layout/Topbar.jsx` — integrar el feed `notificaciones` + botón "Activar push" en el dropdown `showNotif` existente.
- Modify `src/store/SolicitudesContext.jsx` — disparar notif en `addSolicitud` (piloto A) y `resolveSolicitud` (piloto B).

---

## Task 1: Setup — VAPID + dependencia web-push

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Instalar web-push**

Run: `npm install web-push@^3.6.7`
Expected: `package.json` queda con `"web-push": "^3.6.7"` en `dependencies`; `npm install` OK.

- [ ] **Step 2: Generar las claves VAPID**

Run: `npx web-push generate-vapid-keys --json`
Expected: imprime `{ "publicKey": "...", "privateKey": "..." }`. **Guardá ambas** (no se commitean).

- [ ] **Step 3: Cargar las env vars en Vercel (los 2 proyectos: kamak y kamak1324)**

En el dashboard de Vercel → cada proyecto → Settings → Environment Variables (Production + Preview):
- `VAPID_PUBLIC_KEY` = publicKey
- `VAPID_PRIVATE_KEY` = privateKey
- `VAPID_SUBJECT` = `mailto:fgeespinoza@gmail.com`
- `VITE_VAPID_PUBLIC_KEY` = publicKey (la pública otra vez; Vite la hornea en el cliente)

Y para test local, agregá las mismas a `.env.production.local` (gitignoreado) si vas a probar el build localmente.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(notif): agrega web-push para el envío de notificaciones push"
```

---

## Task 2: Lógica pura — `notificaciones.js` (EVENTOS + resolverDestinatarios + noLeidaPara)

**Files:**
- Create: `src/lib/notificaciones.js`
- Test: `src/lib/notificaciones.test.js`

- [ ] **Step 1: Escribir el test que falla**

Create `src/lib/notificaciones.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { EVENTOS, resolverDestinatarios, noLeidaPara } from './notificaciones';

describe('EVENTOS config', () => {
  it('todo tipo tiene roles (array), titulo(fn) y link', () => {
    for (const [tipo, cfg] of Object.entries(EVENTOS)) {
      expect(Array.isArray(cfg.roles), `${tipo}.roles`).toBe(true);
      expect(typeof cfg.titulo, `${tipo}.titulo`).toBe('function');
      expect(cfg.link, `${tipo}.link`).toBeTruthy();
    }
  });
  it('solicitud_eliminacion avisa a Admin', () => {
    expect(EVENTOS.solicitud_eliminacion.roles).toContain('Admin');
  });
});

describe('resolverDestinatarios', () => {
  const usuarios = [
    { id: 'u1', rol: 'Admin' },
    { id: 'u2', rol: 'Administración' },
    { id: 'u3', rol: 'Admin' },
    { id: 'u4', rol: 'Jefe de obra' },
  ];
  it('devuelve los userIds de los roles pedidos, sin duplicados', () => {
    expect(resolverDestinatarios({ roles: ['Admin'] }, usuarios, null).sort()).toEqual(['u1', 'u3']);
  });
  it('excluye al actor (no auto-notificar)', () => {
    expect(resolverDestinatarios({ roles: ['Admin'] }, usuarios, 'u1')).toEqual(['u3']);
  });
  it('soporta userIds explícitos además de roles', () => {
    expect(resolverDestinatarios({ roles: [], userIds: ['u4'] }, usuarios, null)).toEqual(['u4']);
  });
  it('dedup entre roles y userIds', () => {
    expect(resolverDestinatarios({ roles: ['Admin'], userIds: ['u1'] }, usuarios, null).sort()).toEqual(['u1', 'u3']);
  });
  it('lista vacía si no matchea nada', () => {
    expect(resolverDestinatarios({ roles: ['NoExiste'] }, usuarios, null)).toEqual([]);
  });
});

describe('noLeidaPara', () => {
  it('true si el userId no está en leidaPor', () => {
    expect(noLeidaPara({ leidaPor: ['u2'] }, 'u1')).toBe(true);
  });
  it('false si ya la leyó', () => {
    expect(noLeidaPara({ leidaPor: ['u1', 'u2'] }, 'u1')).toBe(false);
  });
  it('true si leidaPor falta', () => {
    expect(noLeidaPara({}, 'u1')).toBe(true);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/notificaciones.test.js`
Expected: FAIL — "Failed to resolve import './notificaciones'".

- [ ] **Step 3: Implementar el mínimo para pasar**

Create `src/lib/notificaciones.js`:

```js
// Lógica pura del sistema de notificaciones (sin React, sin red): qué evento
// avisa a qué rol, a quién le toca, y si una notif está sin leer para alguien.

// Catálogo de eventos. titulo(datos) arma el texto; link es la ruta destino.
// Plan 1 sólo CABLEA solicitud_eliminacion y solicitud_resuelta; el resto del
// catálogo se completa en Plan 2 (los call sites). Tener la config entera acá
// desde ya mantiene el routing en un solo lugar.
export const EVENTOS = {
  solicitud_eliminacion:   { roles: ['Admin'], titulo: (d) => `Solicitud de eliminación: ${d?.descripcion || 'un movimiento'}`, link: '/autorizaciones' },
  solicitud_resuelta:      { roles: [],        titulo: (d) => `Tu solicitud fue ${d?.estado || 'resuelta'}`, link: '/movimientos' },
  wa_factura_pendiente:    { roles: ['Admin'], titulo: () => 'Factura de WhatsApp para revisar', link: '/autorizaciones?origen=whatsapp' },
  wa_movimiento_pendiente: { roles: ['Admin'], titulo: () => 'Movimiento de WhatsApp para revisar', link: '/autorizaciones?origen=whatsapp' },
  cheque_por_vencer:       { roles: ['Admin', 'Administración'], titulo: (d) => `Cheque por vencer: ${d?.detalle || ''}`, link: '/cheques' },
  cuenta_por_vencer:       { roles: ['Administración'], titulo: (d) => `Cuenta por pagar próxima: ${d?.detalle || ''}`, link: '/ordenes-de-pago' },
  cobro_cliente_proximo:   { roles: ['Admin', 'Administración'], titulo: (d) => `Cobro próximo: ${d?.detalle || ''}`, link: '/clientes' },
  tarea_asignada:          { roles: [], titulo: (d) => `Te asignaron: ${d?.tarea || 'una tarea'}`, link: '/tareas' },
  presupuesto_adjuntado:   { roles: ['Jefe de obra', 'Admin'], titulo: (d) => `Presupuesto adjuntado en ${d?.obra || 'una obra'}`, link: '/obras' },
  movimiento_cargado:      { roles: ['Administración'], titulo: (d) => `Movimiento cargado: ${d?.descripcion || ''}`, link: '/movimientos' },
  orden_pago_creada:       { roles: ['Administración'], titulo: (d) => `Orden de pago creada: ${d?.detalle || ''}`, link: '/ordenes-de-pago' },
  cliente_firmo:           { roles: ['Admin', 'Administración'], titulo: (d) => `${d?.cliente || 'Un cliente'} firmó un documento`, link: '/clientes' },
  proveedor_firmo:         { roles: ['Admin', 'Administración'], titulo: (d) => `${d?.proveedor || 'Un proveedor'} firmó/subió algo`, link: '/proveedores' },
};

// destino = { roles:[...], userIds?:[...] }. Devuelve la lista de userIds a
// notificar: todos los usuarios con esos roles + los userIds explícitos,
// deduplicados y SIN el actor (no se auto-notifica).
export function resolverDestinatarios(destino, usuarios, actorUserId) {
  const roles = (destino && destino.roles) || [];
  const extra = (destino && destino.userIds) || [];
  const set = new Set(extra);
  for (const u of (usuarios || [])) {
    if (u && roles.includes(u.rol)) set.add(u.id);
  }
  if (actorUserId) set.delete(actorUserId);
  return [...set];
}

// Una notif está "no leída" para un usuario si su id no figura en leidaPor.
export function noLeidaPara(notif, userId) {
  return !((notif && notif.leidaPor) || []).includes(userId);
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/notificaciones.test.js`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/notificaciones.js src/lib/notificaciones.test.js
git commit -m "feat(notif): lógica pura — EVENTOS, resolverDestinatarios, noLeidaPara (TDD)"
```

---

## Task 3: NotificacionesContext (store + crearNotificacion + marcar leída)

**Files:**
- Create: `src/store/NotificacionesContext.jsx`
- Modify: `src/App.jsx` (montar el provider)

- [ ] **Step 1: Crear el contexto**

Create `src/store/NotificacionesContext.jsx`:

```jsx
import { createContext, useContext, useCallback, useMemo } from 'react';
import useSyncedSharedData from '../lib/useSyncedSharedData';
import { newId } from '../lib/id';
import { supabase } from '../lib/supabase';
import { EVENTOS, resolverDestinatarios, noLeidaPara } from '../lib/notificaciones';
import { useUsuarios } from './UsuariosContext';
import { useAuth } from './AuthContext';

const CTX = createContext(null);

export function NotificacionesProvider({ children }) {
  const [notificaciones, setNotificaciones] = useSyncedSharedData('notificaciones', [], {
    lsKey: 'kamak_notificaciones_v1',
    skipMarkReady: true,
  });
  const { usuarios } = useUsuarios() ?? { usuarios: [] };
  const { currentUser } = useAuth() ?? {};
  const myId = currentUser?.id || null;

  // Crea una notificación: la agrega al feed (in-app, realtime) y dispara el
  // push (best-effort). datos alimenta titulo()/link y opcionalmente userIds.
  const crearNotificacion = useCallback((tipo, datos = {}) => {
    const cfg = EVENTOS[tipo];
    if (!cfg) { console.warn('[notif] tipo desconocido', tipo); return; }
    const destino = { roles: cfg.roles, userIds: datos.userIds || [] };
    const rolesDestino = cfg.roles;
    const titulo = cfg.titulo(datos);
    const cuerpo = datos.cuerpo || '';
    const link = datos.link || cfg.link;
    const notif = {
      id: newId('ntf'), tipo, titulo, cuerpo, link,
      rolesDestino, userIds: datos.userIds || [],
      actorId: myId, creadoAt: new Date().toISOString(), leidaPor: [],
    };
    setNotificaciones(prev => [notif, ...prev].slice(0, 500)); // cap defensivo
    // Push (best-effort): resolver a userIds y pedirle al server que envíe.
    try {
      const userIds = resolverDestinatarios(destino, usuarios, myId);
      if (userIds.length) {
        supabase.auth.getSession().then(({ data }) => {
          fetch('/api/whatsapp/jobs?job=push', {
            method: 'POST',
            headers: { 'content-type': 'application/json', Authorization: `Bearer ${data?.session?.access_token || ''}` },
            body: JSON.stringify({ userIds, titulo, cuerpo, link }),
          }).catch(() => {});
        });
      }
    } catch (e) { console.warn('[notif] push falló (no crítico)', e?.message); }
  }, [setNotificaciones, usuarios, myId]);

  const marcarLeida = useCallback((id) => {
    if (!myId) return;
    setNotificaciones(prev => prev.map(n =>
      n.id === id && noLeidaPara(n, myId) ? { ...n, leidaPor: [...(n.leidaPor || []), myId] } : n
    ));
  }, [setNotificaciones, myId]);

  const marcarTodasLeidas = useCallback(() => {
    if (!myId) return;
    setNotificaciones(prev => prev.map(n => noLeidaPara(n, myId) ? { ...n, leidaPor: [...(n.leidaPor || []), myId] } : n));
  }, [setNotificaciones, myId]);

  // Las que le tocan a MI rol (o a mi id) — para la campanita.
  const mias = useMemo(() => {
    const rol = currentUser?.rol;
    return (notificaciones || []).filter(n =>
      (n.rolesDestino || []).includes(rol) || (n.userIds || []).includes(myId)
    );
  }, [notificaciones, currentUser?.rol, myId]);

  const noLeidasCount = useMemo(() => mias.filter(n => noLeidaPara(n, myId)).length, [mias, myId]);

  const value = useMemo(
    () => ({ notificaciones: mias, noLeidasCount, crearNotificacion, marcarLeida, marcarTodasLeidas }),
    [mias, noLeidasCount, crearNotificacion, marcarLeida, marcarTodasLeidas]
  );

  return <CTX.Provider value={value}>{children}</CTX.Provider>;
}

export const useNotificaciones = () => useContext(CTX);
```

> **Antes de escribir:** confirmá los nombres reales de import abriendo `src/store/AuthContext.jsx` (que exponga `useAuth` y `currentUser` con `.id` y `.rol`) y `src/store/UsuariosContext.jsx` (que exponga `useUsuarios` y `usuarios`). Si difieren (p.ej. el provider de auth se llama distinto), ajustá los imports/desestructurados — el resto de la lógica no cambia.

- [ ] **Step 2: Montar el provider en App.jsx**

En `src/App.jsx`, dentro del árbol de DataProviders (junto a los demás stores como `SolicitudesProvider`), envolver con `<NotificacionesProvider>`. Debe quedar **dentro** de `UsuariosProvider` y `AuthProvider` (los consume) y **dentro** del ErrorBoundary de nivel superior. Agregar el import:

```jsx
import { NotificacionesProvider } from './store/NotificacionesContext';
```

y anidarlo entre los providers existentes (después de `UsuariosProvider`).

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: `✓ built` sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/store/NotificacionesContext.jsx src/App.jsx
git commit -m "feat(notif): NotificacionesContext (feed por rol + crearNotificacion + push best-effort)"
```

---

## Task 4: Endpoint de envío — `?job=push` en jobs.js (web-push)

**Files:**
- Modify: `api/whatsapp/jobs.js`

- [ ] **Step 1: Importar web-push y agregar el handler del job**

Al inicio de `api/whatsapp/jobs.js`, después de los `const ... = process.env...`, agregar:

```js
import webpush from 'web-push';

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:fgeespinoza@gmail.com';
if (VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
```

- [ ] **Step 2: Agregar la validación de sesión (Bearer) y el job de push**

Antes de `export default async function handler`, agregar:

```js
// Valida que el que llama sea un usuario logueado (cualquier app_user). El push
// lo dispara el cliente al crear una notif, con el token de sesión Supabase.
async function usuarioLogueado(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } });
  return r.ok;
}

// Envía un push web a todos los dispositivos de los userIds dados. Lee las
// subscriptions de shared_data 'push_subscriptions' y borra las muertas (404/410).
async function runPush(req, res) {
  if (!(await usuarioLogueado(req))) return res.status(403).json({ error: 'no autorizado' });
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return res.status(500).json({ error: 'VAPID no configurado' });
  const { userIds, titulo, cuerpo, link } = req.body || {};
  if (!Array.isArray(userIds) || !userIds.length || !titulo) return res.status(400).json({ error: 'falta userIds/titulo' });

  const subs = (await loadSharedData('push_subscriptions')) || [];
  const objetivo = subs.filter(s => userIds.includes(s.userId));
  const payload = JSON.stringify({ titulo, cuerpo: cuerpo || '', link: link || '/' });

  const muertas = [];
  await Promise.all(objetivo.map(async (s) => {
    try { await webpush.sendNotification(s.sub, payload); }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) muertas.push(s.id); }
  }));

  if (muertas.length) {
    const limpio = subs.filter(s => !muertas.includes(s.id));
    await saveSharedData('push_subscriptions', limpio);
  }
  return res.status(200).json({ ok: true, enviados: objetivo.length - muertas.length, limpiadas: muertas.length });
}
```

- [ ] **Step 3: Enrutar el job en el handler**

En `export default async function handler`, agregar la rama `push` (queda 3 jobs):

```js
export default async function handler(req, res) {
  const job = req.query.job;
  if (job === 'reminders') return runReminders(req, res);
  if (job === 'followups') return runFollowups(req, res);
  if (job === 'push') return runPush(req, res);
  return res.status(400).json({ error: 'job inválido (reminders|followups|push)' });
}
```

- [ ] **Step 4: Verificar sintaxis**

Run: `node --check api/whatsapp/jobs.js`
Expected: sin output (OK).

- [ ] **Step 5: Commit**

```bash
git add api/whatsapp/jobs.js
git commit -m "feat(notif): envío de push como ?job=push en jobs.js (web-push + VAPID, sin function nueva)"
```

---

## Task 5: Push cliente — `push.js` + `sw-push.js` + whitelist en main.jsx

**Files:**
- Create: `public/sw-push.js`
- Create: `src/lib/push.js`
- Modify: `src/main.jsx`

- [ ] **Step 1: Crear el Service Worker mínimo solo-push**

Create `public/sw-push.js`:

```js
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
```

- [ ] **Step 2: Crear el helper de cliente**

Create `src/lib/push.js`:

```js
// Activación/desactivación del push web desde el cliente. Registra el SW propio
// SÓLO cuando el usuario lo pide (no en cada carga). Guarda la subscription en
// shared_data 'push_subscriptions' vía el client de Supabase (sin endpoint).
import { supabase } from './supabase';

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export function pushSoportado() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function leerSubs() {
  const { data } = await supabase.from('shared_data').select('data').eq('key', 'push_subscriptions').maybeSingle();
  return Array.isArray(data?.data) ? data.data : [];
}
async function guardarSubs(subs) {
  await supabase.from('shared_data').upsert({ key: 'push_subscriptions', data: subs }, { onConflict: 'key' });
}

export async function pushActivo() {
  if (!pushSoportado()) return false;
  const reg = await navigator.serviceWorker.getRegistration('/sw-push.js');
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

export async function activarPush(userId) {
  if (!pushSoportado()) throw new Error('Este dispositivo no soporta notificaciones push.');
  if (!VAPID_PUBLIC) throw new Error('Falta VITE_VAPID_PUBLIC_KEY.');
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') throw new Error('No diste permiso de notificaciones.');
  const reg = await navigator.serviceWorker.register('/sw-push.js');
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) });
  const subs = await leerSubs();
  const endpoint = sub.endpoint;
  const sinEsta = subs.filter(s => s.sub?.endpoint !== endpoint);
  sinEsta.push({ id: `sub-${Date.now()}`, userId, sub: sub.toJSON(), device: navigator.userAgent.slice(0, 80), creadoAt: new Date().toISOString() });
  await guardarSubs(sinEsta);
  return true;
}

export async function desactivarPush() {
  const reg = await navigator.serviceWorker.getRegistration('/sw-push.js');
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    const subs = await leerSubs();
    await guardarSubs(subs.filter(s => s.sub?.endpoint !== sub.endpoint));
    await sub.unsubscribe();
  }
}
```

- [ ] **Step 3: Whitelistear el SW propio en main.jsx**

En `src/main.jsx`, dentro de `purgarServiceWorkersYCaches`, cambiar el loop de unregister para **NO** matar el SW de push:

```js
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) {
        const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || '';
        if (url.includes('sw-push')) continue; // NO desregistrar nuestro SW de push
        try { await r.unregister(); limpio = true; } catch { /* noop */ }
      }
```

(Reemplaza el `for (const r of regs) { ... }` actual.)

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: `✓ built`; `dist/sw-push.js` existe (`ls dist/sw-push.js`).

- [ ] **Step 5: Commit**

```bash
git add public/sw-push.js src/lib/push.js src/main.jsx
git commit -m "feat(notif): push cliente — SW mínimo solo-push + activar/desactivar + whitelist en la purga"
```

---

## Task 6: Campanita — integrar el feed + "Activar push" en el dropdown de Topbar

**Files:**
- Modify: `src/components/layout/Topbar.jsx`

- [ ] **Step 1: Leer el dropdown actual**

Abrí `src/components/layout/Topbar.jsx` y localizá el bloque `{showNotif && ( ... )}` (el dropdown que ya muestra alertas derivadas: solicitudes, cheques, cuotas, WA). Ahí se integra el feed nuevo.

- [ ] **Step 2: Importar el hook y el push**

Agregar imports:

```jsx
import { useNotificaciones } from '../../store/NotificacionesContext';
import { activarPush, desactivarPush, pushActivo, pushSoportado } from '../../lib/push';
```

y en el cuerpo del componente:

```jsx
  const { notificaciones: misNotifs, noLeidasCount, marcarLeida, marcarTodasLeidas } = useNotificaciones() ?? { notificaciones: [], noLeidasCount: 0 };
  const [pushOn, setPushOn] = useState(false);
  useEffect(() => { pushActivo().then(setPushOn).catch(() => {}); }, []);
  const togglePush = async () => {
    try {
      if (pushOn) { await desactivarPush(); setPushOn(false); }
      else { await activarPush(currentUser?.id); setPushOn(true); }
    } catch (e) { window.alert(e.message); }
  };
```

- [ ] **Step 3: Sumar el contador al badge de la campanita**

El badge actual del ícono de campana suma alertas derivadas; sumarle `noLeidasCount`. Buscar dónde se calcula el total del badge (p.ej. `pendientesWA + chequesUrgentes.length + ...`) y agregar `+ noLeidasCount`.

- [ ] **Step 4: Renderizar el feed + el toggle dentro del dropdown**

Dentro del `{showNotif && (...)}`, al inicio del contenido del panel, agregar una sección:

```jsx
            {/* Notificaciones del sistema (feed por rol) */}
            <div style={{ padding: '8px 12px', borderBottom: `1px solid ${T.faint2}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 12 }}>Notificaciones{noLeidasCount ? ` (${noLeidasCount})` : ''}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                {noLeidasCount > 0 && <button onClick={marcarTodasLeidas} style={{ fontSize: 10, cursor: 'pointer', background: 'none', border: 'none', color: T.accent }}>marcar leídas</button>}
                {pushSoportado() && <button onClick={togglePush} style={{ fontSize: 10, cursor: 'pointer', background: 'none', border: 'none', color: pushOn ? T.ink3 : T.accent }}>{pushOn ? '🔔 push on' : '🔔 activar push'}</button>}
              </div>
            </div>
            {misNotifs.slice(0, 15).map(n => (
              <div key={n.id} onClick={() => { marcarLeida(n.id); setShowNotif(false); navigate(n.link); }}
                style={{ padding: '8px 12px', borderBottom: `1px solid ${T.faint2}`, cursor: 'pointer', background: (n.leidaPor || []).includes(currentUser?.id) ? 'transparent' : '#fff7ed' }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{n.titulo}</div>
                {n.cuerpo && <div style={{ fontSize: 11, color: T.ink2 }}>{n.cuerpo}</div>}
                <div style={{ fontSize: 10, color: T.ink3, fontFamily: T.fontMono }}>{new Date(n.creadoAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            ))}
```

> Confirmá que `useState`, `useEffect`, `navigate`, `setShowNotif`, `T` y `currentUser` ya están en scope en Topbar (lo están, por lo visto en el archivo). Si el panel tiene un "no hay alertas" condicionado a que todo esté vacío, sumá `misNotifs.length` a esa condición.

- [ ] **Step 5: Verificar build**

Run: `npm run build`
Expected: `✓ built` sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/Topbar.jsx
git commit -m "feat(notif): campanita — feed de notificaciones + toggle de push en el dropdown de Topbar"
```

---

## Task 7: Evento piloto A — `solicitud_eliminacion` (al crear una solicitud)

**Files:**
- Modify: `src/store/SolicitudesContext.jsx`

- [ ] **Step 1: Inyectar crearNotificacion en addSolicitud**

En `src/store/SolicitudesContext.jsx`, importar y usar el motor. Como `NotificacionesProvider` envuelve a `SolicitudesProvider`, este puede consumir `useNotificaciones`:

```jsx
import { useNotificaciones } from './NotificacionesContext';
```

Dentro de `SolicitudesProvider`, antes de `addSolicitud`:

```jsx
  const { crearNotificacion } = useNotificaciones() ?? {};
```

Modificar `addSolicitud` para avisar tras crear:

```jsx
  const addSolicitud = useCallback((data) => {
    const nueva = {
      ...data,
      id: newId('sol'),
      estado: 'pendiente',
      creadoAt: new Date().toISOString(),
    };
    setSolicitudes(prev => [nueva, ...prev]);
    crearNotificacion?.('solicitud_eliminacion', { descripcion: data?.movimiento?.descripcion || data?.motivo || '' });
    return nueva.id;
  }, [setSolicitudes, crearNotificacion]);
```

> **Orden de providers (verificar en App.jsx):** `NotificacionesProvider` debe envolver a `SolicitudesProvider`. Si el lint/render se queja de que `useNotificaciones` es null, reordenar en App.jsx para que Notificaciones quede por fuera (más arriba) que Solicitudes.

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add src/store/SolicitudesContext.jsx src/App.jsx
git commit -m "feat(notif): piloto A — avisar a Admin cuando se crea una solicitud de eliminación"
```

---

## Task 8: Evento piloto B — `solicitud_resuelta` (al aprobar/rechazar)

**Files:**
- Modify: `src/store/SolicitudesContext.jsx`

- [ ] **Step 1: Avisar al solicitante en resolveSolicitud**

La solicitud guarda quién la pidió. Confirmá el campo abriendo dónde se llama `addSolicitud` (en `Movimientos.jsx`): suele guardar `solicitadoPor: { id, nombre }`. Modificar `resolveSolicitud`:

```jsx
  const resolveSolicitud = useCallback((id, estado, resolvedBy) => {
    let solicitante = null;
    setSolicitudes(prev => prev.map(s => {
      if (s.id !== id) return s;
      solicitante = s.solicitadoPor?.id || s.solicitadoPor || null;
      return { ...s, estado, resolvedBy, resolvedAt: new Date().toISOString() };
    }));
    if (solicitante) crearNotificacion?.('solicitud_resuelta', { estado, userIds: [solicitante] });
  }, [setSolicitudes, crearNotificacion]);
```

> Si `solicitadoPor` no guarda el `id` del usuario (sólo el nombre), agregá el `id` en el call site de `addSolicitud` en `Movimientos.jsx` (pasar `solicitadoPor: { id: currentUser.id, nombre: currentUser.nombre }`) — un cambio chico que habilita el ruteo por userId.

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 3: Correr toda la suite**

Run: `npx vitest run`
Expected: PASS (todos; los nuevos tests de `notificaciones.test.js` incluidos).

- [ ] **Step 4: Commit**

```bash
git add src/store/SolicitudesContext.jsx src/pages/Movimientos.jsx
git commit -m "feat(notif): piloto B — avisar al solicitante cuando su solicitud se resuelve"
```

---

## Task 9: Prueba real en mobile (deploy PREVIEW, ANTES de main)

> Esta tarea NO es automatizable — es la lección de la Fase 1: **probar el SW en mobile real antes de mergear a main.** No mergees sin completar el checklist.

- [ ] **Step 1: Deploy preview**

Push de la rama `feat/notificaciones-push` (no a main). Vercel genera una URL de **preview**. Abrila en:
- **iPhone:** Safari → agregar a inicio → abrir desde el ícono (instalada).
- **Android:** Chrome.

- [ ] **Step 2: Checklist e2e (marcar cada uno)**

- [ ] La app **carga normal** en iPhone y Android (sin pantalla blanca — el SW no debe romper nada).
- [ ] Tocar "🔔 activar push" → pide permiso → queda "push on".
- [ ] Generar una `solicitud_eliminacion` (con otro usuario no-admin) → al Admin le **llega push con la app cerrada**.
- [ ] Tocar el push → abre/enfoca la app en `/autorizaciones`.
- [ ] La campanita muestra la notif (no leída → resaltada) y al clickearla queda leída.
- [ ] Resolver la solicitud → al solicitante le llega `solicitud_resuelta`.
- [ ] "Desactivar push" (toggle) → deja de llegar.
- [ ] Recargar 2-3 veces: la app sigue OK (la purga no mata el SW de push; no hay loop).

- [ ] **Step 3: Si todo OK → finishing-a-development-branch**

Recién con el checklist completo: usar `superpowers:finishing-a-development-branch` para mergear a main. Si algo falla en mobile, NO mergear: volver a `superpowers:systematic-debugging`.

---

## Notas para Plan 2 (no implementar acá)

- **Eventos restantes** (2,3,5,6,7,8,9,10,11,12,13): cablear `crearNotificacion(tipo, datos)` en cada call site.
- **CRON de vencimientos:** Hobby limita a 2 crons (ya usados: `jobs?job=reminders` + `sync-sanfrancisco`). Para `cheque_por_vencer`/`cuenta_por_vencer`/`cobro_cliente_proximo`, **NO agregar un 3er cron** → integrar el cálculo (`itemsPorVencer`, pura + TDD) dentro de `runReminders` (que ya corre diario) y crear las notifs + push ahí, con marca de idempotencia en shared_data `notif_cron_sent`.
- **Resolución de roles server-side** (para el cron): leer `app_users(id,rol)` con `sbGet` y resolver userIds ahí (el cron no tiene cliente).
