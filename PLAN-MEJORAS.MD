# Plan de mejoras y recomendaciones — Kamak

> Una hoja de ruta priorizada para mejorar el proyecto. Pensada para que **sepas qué arreglar primero, qué después y por qué**.
> Basada en el análisis profundo de seguridad, arquitectura y calidad de código (ver `INFORME.BUGS`).

---

## Cómo usar este plan

Está dividido en **5 fases**. Cada una tiene:

- **Objetivo**: qué problema resuelve esta fase.
- **Esfuerzo total estimado**: en días-persona (si trabajás vos solo).
- **Items**: cada uno con su esfuerzo individual (S = pequeño <2hs, M = medio 2-8hs, L = grande >8hs).
- **Por qué ahora**: justifica el orden.

> No tenés que hacer todas las fases una atrás de la otra. Podés intercalar fases si una se vuelve urgente.

---

## 🚨 Fase 1 — Estabilizar y asegurar (semana 1)

**Objetivo**: cerrar agujeros de seguridad críticos y arreglar bugs que pueden corromper datos.

**Esfuerzo total**: 2-3 días.

**Por qué primero**: cualquier cosa que se construya encima de bugs críticos hereda los problemas. Resolver esto da una base estable para todo lo demás.

### 1.1 Permisos fail-closed (S) ⭐

Cambiar todos los `?? true` a `=== true` en chequeos de permisos.

**Archivos**: `src/pages/obra/ObraPresupuesto.jsx:132,133,379–382` y `src/pages/Obras.jsx:427`.

**Por qué**: con el default permisivo, cualquier usuario sin permisos explícitos los obtiene todos.

---

### 1.2 Redirect de admin en páginas sensibles (S) ⭐

Agregar `useEffect` que redirija a `/` si no es Admin, en:

- `src/pages/Clientes.jsx`
- `src/pages/ProveedorCC.jsx`
- `src/pages/Catalogos.jsx`
- `src/pages/Plantillas.jsx`
- `src/pages/Reportes.jsx`
- `src/pages/WhatsappBuzon.jsx`
- `src/pages/Conciliacion.jsx`
- `src/pages/Autorizaciones.jsx`

**Patrón a copiar** (de `Cheques.jsx:629–631`):

```jsx
useEffect(() => {
  if (currentUser && currentUser.rol !== 'Admin') navigate('/', { replace: true });
}, [currentUser, navigate]);
```

**Mejor todavía**: crear un componente `<AdminRoute>` en `App.jsx` para no repetir el patrón.

---

### 1.3 Endurecer RLS en Supabase (M) ⭐

**Esto NO se hace en código — se hace en Supabase Studio.**

Verificar y aplicar políticas de RLS estrictas:

- **`app_users`**: solo Admin puede INSERT/UPDATE/DELETE. Todos pueden SELECT su propio row.
- **`shared_data`** key `portal_tokens`: solo Admin puede SELECT/INSERT/UPDATE.
- **`shared_data`** key `whatsapp_pending`: solo Admin puede UPDATE.
- **`shared_data`** todas las otras keys: usuarios autenticados pueden SELECT/UPDATE (si la app es trusted multi-rol).

Sin esto, los hallazgos C3, C5, A9 son explotables.

---

### 1.4 Cerrar signup público (S) ⭐

En `src/pages/Login.jsx`:

- Ocultar el modo "register" del Login.
- Quitar el método `signUp` del `AuthProvider`.
- Crear usuarios SOLO desde Autorizaciones via `adminAction('createUser', ...)`.

Y en `src/store/UsuariosContext.jsx`:

- Eliminar el fallback Admin en `loginByEmail:194–198`.
- Eliminar `bootstrapAdmin` (hacer el bootstrap inicial manual con SQL).

---

### 1.5 Proteger `send-portal.js` (S) ⭐

`api/whatsapp/send-portal.js`: agregar validación de JWT en el header (mismo patrón de `adminAction`).

Sin esto, cualquiera en internet puede inyectar/borrar tokens.

---

### 1.6 Proteger ruta de portal cliente (M) ⭐

`src/pages/portal/PortalAcceso.jsx` debe guardar el token validado en `sessionStorage`, y `src/pages/portal/PortalCliente.jsx` debe verificarlo en cada carga. Si no hay token válido para esa obra → "Sin acceso".

Sin esto, cualquiera con un link `/portal/cliente/baradero` ve la obra.

---

### 1.7 Fix `fetchBNA` NaN (S) ⭐

`src/store/DolarContext.jsx:73`: cambiar `json.compra` por la variable local `compra`. Validar con `Number.isFinite` antes de persistir.

Sin esto, una respuesta degradada de dolarapi puede romper todas las conversiones USD/ARS.

---

### 1.8 Fix `updateMovimiento` saldo de caja (M)

`src/store/MovimientosContext.jsx:141–147`: revertir el efecto del movimiento viejo antes de aplicar los cambios nuevos. O bloquear la edición de monto/cajaId desde la UI.

Sin esto, las cajas pueden quedar con plata "fantasma" al editar movimientos.

---

### 1.9 Fix endoso de cheque (M)

`src/pages/Cheques.jsx:697–722`: el endoso NO debe debitar la caja (el cheque nunca entró en efectivo). Cambiar a movimiento tipo "endoso" sin tocar saldo, o simplemente cambiar estado del cheque.

---

### 1.10 Sanitizar HTML en exports (M)

Crear `src/lib/html.js`:

```js
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
```

Y usarlo en TODAS las interpolaciones de:

- `src/pages/modales/ExportModal.jsx`
- `src/pages/modales/ContratoMOModal.jsx`
- `src/pages/obra/ObraPresupuesto.jsx` (funciones `generarHTMLResumen`, `exportarLista`)

También abrir `window.open` con `'noopener,noreferrer'` para que la ventana no tenga acceso al `window.opener`.

Sin esto, un nombre de cliente con HTML/JS se ejecuta al imprimir.

---

### 1.11 Ocultar venta en columnas Presupuesto (S)

`src/pages/obra/ObraPresupuesto.jsx:403–405`:

```js
ventaUnit: isAdmin ? colsUser.ventaUnit : false,
ventaTotal: isAdmin ? colsUser.ventaTotal : false,
```

Y filtrar también del selector de columnas: `if (c.key === 'ventaUnit' && !isAdmin) return false`.

---

### 1.12 Admin guard en WhatsappBuzon (S)

Agregar redirect de no-admin al inicio de `src/pages/WhatsappBuzon.jsx`.

Sin esto, cualquier usuario puede aprobar facturas del bot.

---

## ⚡ Fase 2 — Performance y experiencia (semanas 2-3)

**Objetivo**: app más rápida y responsiva, sobre todo al editar el presupuesto de una obra.

**Esfuerzo total**: 3-5 días.

**Por qué ahora**: estos cambios bajan la lentitud que ya se siente. El cambio 2.1 solo, vale meses de paciencia.

### 2.1 Memoizar `value={{...}}` en los 16 providers (S) ⭐

Cambio mecánico en cada `src/store/*.jsx`:

```jsx
const value = useMemo(
  () => ({ obras, addObra, updateObra, /* ... */ }),
  [obras, /* deps reales */]
);
return <ObrasContext.Provider value={value}>{children}</ObrasContext.Provider>;
```

Y envolver las funciones con `useCallback`.

**ROI gigante**: la app se va a sentir notoriamente más rápida sin tocar lógica.

---

### 2.2 Code splitting con `React.lazy` (S) ⭐

`src/App.jsx`: convertir los `import X from 'pages/X'` a:

```jsx
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ObraPresupuesto = lazy(() => import('./pages/obra/ObraPresupuesto'));
// ... etc
```

Y envolver `<Routes>` con `<Suspense fallback={<Cargando/>}>`.

Bundle inicial baja de **277 KB gz → ~100 KB gz**.

---

### 2.3 Configurar `vite.config.js` (S)

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  esbuild: { drop: ['console', 'debugger'] }, // solo en prod build
});
```

---

### 2.4 Mover `InlineNum` fuera del render (S) ⭐

`src/pages/obra/ObraPresupuesto.jsx:774`: extraer `InlineNum` afuera del componente padre. Envolverlo con `React.memo`.

Sin esto, cada teclazo en un input del presupuesto desperdicia CPU.

---

### 2.5 `useMemo` para `calcObra` (S)

`src/pages/obra/ObraPresupuesto.jsx:134, 451, 1942, 2598, 3562`: envolver con `useMemo`:

```jsx
const obraData = useMemo(() => calcObra(detalle.rubros), [detalle.rubros]);
```

---

### 2.6 Realtime para `WhatsappPending` (M)

Reemplazar el polling cada 20s por suscripción `onRemoteChange('whatsapp_pending', reload)`. Pausar cuando `document.hidden`.

Misma idea para `WhatsappVerificationBanner` (15s).

---

### 2.7 Cancelar requests al remontar (M)

Cada `loadSharedData` en los providers debería usar un guard `cancelled`:

```jsx
useEffect(() => {
  let cancelled = false;
  loadSharedData('obras').then(data => {
    if (cancelled) return;
    setObras(data);
  });
  return () => { cancelled = true; };
}, []);
```

---

### 2.8 Broadcast no recibir mensajes propios (S)

`src/lib/syncBus.js:9`: agregar config `{ broadcast: { self: false } }`.

```js
_channel = supabase.channel('kamak-data-sync', {
  config: { broadcast: { self: false } }
});
```

---

### 2.9 Flushear el debounce al desmontar (S)

En cada provider con `setTimeout(save, 800)`, en el cleanup hacer un save inmediato del último valor:

```jsx
useEffect(() => {
  const t = setTimeout(() => saveSharedData(key, value), 800);
  return () => {
    clearTimeout(t);
    saveSharedData(key, refActual.current);
  };
}, [value]);
```

Sin esto, cambios fugaces se pierden al navegar rápido.

---

## 🧹 Fase 3 — Limpieza y consistencia (mes 2)

**Objetivo**: reducir código duplicado, magic numbers, código muerto. Hace que el código sea más fácil de leer y modificar.

**Esfuerzo total**: 3-4 días.

### 3.1 Crear `src/lib/format.js` (S) ⭐

Unificar todas las variantes de `fmtN`, `fmtM`, `fmtFecha`, `fmtUSD`, `fmtMonto`. Manejar correctamente:

- `null`/`undefined` → `'—'`
- `NaN` → `'—'`
- Signos (no abusar de `Math.abs`)
- Decimales para USD vs ARS

Importarlo en los ~15 archivos que los redefinen.

---

### 3.2 Crear `src/lib/id.js` y `src/lib/dates.js` (S)

- `id.js`: `newId(prefix)` único.
- `dates.js`: `diasHasta(fecha)`, `fmtFecha(iso)`, `mesActual()`.

---

### 3.3 Hook `useSyncedSharedData(key, initial)` (M) ⭐

Encapsular el patrón repetido de cada Context (loadShared + save + broadcast + sbLoaded + fromRemote + debounce). El hook devuelve `[state, setState]` y maneja todo internamente.

Reduce drásticamente el código de los 10+ providers.

---

### 3.4 Componente `<Modal>` genérico (M)

Casi todos los modales repiten: overlay oscuro, click outside cierra, header dark, botones Save/Cancel. Extraer a `src/components/ui/Modal.jsx`.

---

### 3.5 Constantes en `src/lib/constants.js` (S)

```js
export const DOLAR_FALLBACK = 1070;
export const SAVE_DEBOUNCE_MS = 800;
export const INACTIVITY_MS = 15 * 60 * 1000;
export const INACTIVITY_WARN_MS = 60 * 1000;
export const POLL_PENDING_MS = 20_000;
export const POLL_VERIFICATION_MS = 15_000;
export const MS_PER_DAY = 86_400_000;
export const PORTAL_TOKEN_EXPIRY_MS = 365 * MS_PER_DAY;

export const ESTADOS_OBRA = ['en-presupuesto', 'activa', 'pausada', 'finalizada', 'archivada'];
export const ESTADOS_CHEQUE = ['cartera', 'depositado', 'endosado', 'rechazado', 'anulado'];
```

Y reemplazar los magic numbers por imports.

---

### 3.6 Helper `escapeHtml` (S)

Ya está priorizado en Fase 1 (1.10).

---

### 3.7 Borrar código muerto (S)

- `src/App.css` (template Vite, sin uso real).
- `src/data/proveedores.js` (legacy).
- `Stat` y `PROVEEDORES` imports no usados en `Dashboard`, `Reportes`, `ObraPresupuesto`.
- Rama `if (nuevoEstado === 'eliminar')` en `Obras.jsx:469`.
- `useState(isAdmin ? 'solicitudes' : 'solicitudes')` en `Autorizaciones.jsx:318`.
- `handleAcreditar` en `Cheques.jsx:683–695` (duplicado de `handleDepositar`).
- Verificar uso de `BarChart`, `StackedBars`, `Toggle`, `GanttBar`, `Diamond`, `loadUserData`.

---

### 3.8 Unificar fuente de movimientos (M) ⭐

Decidir: TODOS los movimientos viven en `MovimientosContext`. Eliminar `detalle.movimientos` (incluyendo de `EMPTY_DETALLE`).

Migrar:

- `Reportes.jsx`: cambiar `allMovsYTD` a filtrar desde `MovimientosContext`.
- `Obras.jsx`: cambiar `computeStats` para usar movimientos del context.
- `Prorrateo.jsx`: cambiar `confirmar` para llamar `addMovimiento`.
- `ObraPresupuesto.jsx:3563`: revisar el panel financiero.

Después de esto, los números van a coincidir en toda la app.

---

### 3.9 Filtros null-safe (S)

`src/pages/Obras.jsx:461–464`: `(o.cliente || '').toLowerCase()` etc. Aplicar el mismo guard en otros filtros.

---

### 3.10 Limpiar localStorage al logout (S)

`src/store/UsuariosContext.jsx:206–209`: en `logout`:

```js
Object.keys(localStorage).filter(k => k.startsWith('kamak_')).forEach(k => localStorage.removeItem(k));
```

---

## 🏗 Fase 4 — Refactor estructural (meses 3-4)

**Objetivo**: dividir lo monolítico, hacer el código testeable, aliviar acoplamientos.

**Esfuerzo total**: 5-8 días.

### 4.1 Dividir `ObraPresupuesto.jsx` (L)

Mover cada `Tab*` a su archivo propio:

```
src/pages/obra/
├── ObraPresupuesto.jsx        # solo el shell con tabs
└── tabs/
    ├── TabResumen.jsx
    ├── TabPresupuesto.jsx
    ├── TabMateriales.jsx
    ├── TabAdicionales.jsx
    ├── TabMovimientos.jsx
    ├── TabCuentaCliente.jsx
    ├── TabContratosMO.jsx
    ├── TabFinanciacion.jsx
    ├── TabDocumentos.jsx
    └── TabFotos.jsx
```

Cada uno puede ser `lazy()`. Beneficios: HMR rápido, fácil de testear, fácil de navegar.

---

### 4.2 Dividir páginas grandes (M)

- `Movimientos.jsx` (1155 líneas): extraer `QuickAddForm`, `ComprobantesPanel`, `SolicitarEliminacionModal` a archivos propios.
- `Catalogos.jsx` (1158): un archivo por tab.
- `Plantillas.jsx` (956), `ObraGantt.jsx` (896), `Cheques.jsx` (809).

---

### 4.3 Selectores granulares con hooks (M) ⭐

En vez de hacer `useObras()` en todas las páginas, crear hooks que devuelvan solo lo necesario:

```jsx
export const useObraById = (id) => {
  const { obras } = useObras();
  return useMemo(() => obras.find(o => o.id === id), [obras, id]);
};

export const useMovimientosByObra = (obraId) => {
  const { movimientos } = useMovimientos();
  return useMemo(() => movimientos.filter(m => m.obraId === obraId), [movimientos, obraId]);
};
```

Beneficio: componentes re-renderizan solo cuando su sub-data cambia.

---

### 4.4 Migrar `shared_data` a tablas relacionales (L) ⭐

**Esto es lo más ambicioso del plan**, pero soluciona varios problemas a la vez:

- Multi-usuario seguro (no más "último gana").
- Updates por entidad (no más reescribir 2MB cuando cambia 1 obra).
- Postgres puede filtrar, buscar, joinear, paginar.
- RLS por fila protege datos.
- Realtime nativo de Supabase reemplaza el `syncBus` manual.

Empezar por `obras` (la más grande), después `movimientos`, después `proveedores`. El resto puede quedar como `shared_data`.

Requiere:
- Diseñar schema en Supabase.
- Migrar data existente.
- Reescribir cada Context para hacer queries específicas en vez de cargar el blob entero.
- Configurar RLS por tabla.

Pesado pero el sistema queda preparado para crecer.

---

### 4.5 Toast / feedback de errores (M)

Crear un sistema global de toast (`useToast()` hook + componente `<ToastContainer>`). Mostrar:

- Errores de red ("Sin conexión, cambios pendientes").
- Saves exitosos ("Guardado").
- Errores de validación.

Reemplazar los `console.error` silenciosos por toasts visibles.

---

### 4.6 Indicador "Sincronizando..." en Topbar (S)

Cuando hay un save en vuelo o un fetch reciente, mostrar un pequeño spinner en el Topbar. Da confianza al usuario de que sus cambios viajaron.

---

## 🧪 Fase 5 — Robustez a largo plazo (continuo)

**Objetivo**: tener red de seguridad para hacer cambios sin miedo. Mejorar accesibilidad y observabilidad.

**Esfuerzo total**: 5-10 días repartidos en meses.

### 5.1 Tests con Vitest (M) ⭐

Empezar con tests unitarios de funciones puras (donde menos riesgo y más valor):

- `calcObra`, `calcRubro`, `tareaVentaUnit` (cálculos del presupuesto).
- `cuotaMontoFn`, `cuotaCobrado`, `cuotaEstadoCalc` (cuotas/cobros).
- `addMovimiento`, `removeMovimiento`, `updateMovimiento` (saldos de caja).
- `DolarContext.fetchBNA` (cotización).

Configurar Vitest:

```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

```js
// vite.config.js
test: { environment: 'jsdom', globals: true }
```

Meta: 50 tests en 1 mes. No buscar 100% de coverage — buscar cubrir las funciones que tocan dinero.

---

### 5.2 Migración gradual a TypeScript (L)

No migrar todo de golpe. Empezar con:

1. Renombrar `src/lib/dbHelpers.js` → `dbHelpers.ts` + agregar tipos.
2. Tipar las shapes principales (Obra, Movimiento, Cheque, Usuario, etc.) en `src/types.ts`.
3. Migrar 1 Context a TypeScript.
4. Migrar 1 página por semana.

Vite ya soporta TypeScript sin config extra. `allowJs: true` permite convivir.

---

### 5.3 Migrar a tablas relacionales + RLS por fila (L)

Ver 4.4. Esto desbloquea seguridad real multi-usuario.

---

### 5.4 Observabilidad (M)

- **Sentry** o similar para capturar errores de producción.
- Activar source maps en build (`sourcemap: 'hidden'`) y subirlos a Sentry.
- Métricas básicas: cuántos usuarios activos, qué páginas más usadas.

---

### 5.5 Accesibilidad (a11y) (M)

- Inputs con `<label htmlFor>` consistente.
- Botones con solo emoji: agregar `aria-label`.
- Contraste de colores: verificar AA con herramientas.
- Navegación por teclado completa.
- Imágenes con `alt` descriptivo (o `alt=""` si son decorativas).

---

### 5.6 i18n (L)

Por ahora no hace falta (la app es para Argentina), pero si en el futuro se vende o se expande, conviene extraer todos los strings de UI a archivos `es-AR.json`. Empezar a usar `react-i18next`.

---

### 5.7 PWA / Offline-first (L)

La app hoy depende mucho de la conexión. Convertirla en PWA permitiría:

- Instalación en mobile (especialmente para `MobileComprador`/`MobileDirector`).
- Funcionalidad offline básica (ver datos cacheados).
- Service worker que sincroniza cuando vuelve la conexión.

Pero esto requiere arreglar primero el problema del "último guarda gana" (4.4).

---

### 5.8 Documentación de API (S)

Documentar:

- Schema de cada tabla Supabase.
- Endpoints de `api/` y sus contratos.
- Edge functions y su uso.
- Formato del payload del bot WhatsApp.

Si en el futuro vienen colaboradores, esto les ahorra horas.

---

## 📅 Calendario sugerido

| Semana | Foco |
|---|---|
| 1 | Fase 1 completa (estabilizar + seguridad crítica) |
| 2-3 | Fase 2 (performance) |
| 4-7 | Fase 3 (limpieza, en paralelo a Fase 4) |
| 4-10 | Fase 4 (refactor estructural, en parallel) |
| 5+ | Fase 5 (continuo, sin urgencia) |

Si trabajás solo, esto es un plan de **~3-4 meses de mejoras continuas**. Si dedicás 2-3 horas por día.

---

## 💡 Quick wins (cosas chiquitas con mucho impacto)

Si solo tenés 1 día libre, hacé estas (en este orden):

1. **Cambiar `?? true` por `=== true`** en permisos (1.1) — 30 minutos.
2. **Memoizar value en providers** (2.1) — 2 horas. App más rápida.
3. **Configurar `vite.config.js`** (2.3) — 10 minutos.
4. **Borrar código muerto** (3.7) — 30 minutos. Limpieza mental.
5. **Crear `src/lib/format.js`** (3.1) — 1 hora. Base para refactor.
6. **Mover `InlineNum` fuera** (2.4) — 30 minutos. Inputs más fluidos.
7. **Fix `fetchBNA` NaN** (1.7) — 5 minutos.
8. **Fix filtro null en Obras** (3.9) — 5 minutos.
9. **Code splitting con `lazy`** (2.2) — 1 hora. Primer load mucho más rápido.

En total: ~7 horas, gran impacto visible.

---

## 🚫 Lo que NO recomiendo hacer (al menos por ahora)

- **No migrar a Next.js/Remix**. La app es chica, el cambio sería mayor al beneficio.
- **No migrar a otro framework de estado** (Zustand, Redux) sin antes hacer las fases 2 y 3. Primero memoizar lo que ya hay.
- **No agregar más Contexts.** Ya hay 16. Crecer en esa dirección empeora el problema.
- **No agregar tests E2E pesados** (Playwright/Cypress) antes que tests unitarios. Más mantenimiento, menos cobertura útil.
- **No reescribir el bot de WhatsApp** salvo bugs específicos. Es complejo y crítico — trabajar incrementalmente.

---

## 📞 Preguntas que conviene responderte antes de arrancar

1. **¿Cuántos usuarios concurrentes van a usar la app?** Si son >5 al mismo tiempo, urge la migración a tablas relacionales (4.4).
2. **¿Quiénes tienen acceso al panel de Supabase?** Si solo vos, podés cambiar RLS con confianza. Si hay otros, coordinar.
3. **¿Querés mantener WhatsApp como vía principal?** Si sí, conviene invertir en hardening del webhook (HMAC + rate limit). Si no, podés priorizar mobile real.
4. **¿La app va a venderse a otras constructoras alguna vez?** Si sí, empezar a pensar multi-tenant desde ahora.

Estas decisiones afectan qué fases priorizar.

---

## Resumen

| Fase | Esfuerzo | Beneficio principal |
|---|---|---|
| 1 — Estabilizar | 2-3 días | Cerrar agujeros críticos, no perder datos |
| 2 — Performance | 3-5 días | App más rápida y responsiva |
| 3 — Limpieza | 3-4 días | Código más fácil de mantener |
| 4 — Refactor | 5-8 días | Base sólida para crecer |
| 5 — Robustez | 5-10 días (continuo) | Red de seguridad a largo plazo |

**Total estimado para tener la app en buen estado**: ~3-4 meses de mejoras continuas.

> **Recordatorio**: ningún plan sobrevive intacto al primer mes. Adaptá. Lo importante es: **arrancá por la Fase 1.**
