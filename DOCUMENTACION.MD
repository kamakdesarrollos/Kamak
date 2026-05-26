# Documentación del proyecto Kamak

> Esta documentación está pensada para alguien **principiante en programación**. Si algún término no se entiende, está explicado al lado.

---

## 1. Qué es Kamak

**Kamak** es una aplicación web interna para **Kamak Desarrollos SRL**, una empresa constructora argentina. No es un producto que se venda a terceros — es la herramienta de gestión del día a día del negocio.

Sirve para:

- **Planificar obras**: cargar el presupuesto (rubros, tareas, materiales, mano de obra), estimar márgenes, ver avance.
- **Comprar y contratar**: gestionar proveedores, registrar facturas, controlar la cuenta corriente de cada uno.
- **Cobrar y pagar**: cuotas con el cliente, pagos a proveedores, cheques propios y de terceros, cajas en pesos y dólares.
- **Comunicar con campo**: bot de WhatsApp para que compradores y directores de obra suban fotos/facturas/avance desde el celular.
- **Mostrar al cliente**: portal web donde el cliente ve avance de su obra, plan de pagos, fotos, chatea con la empresa.

**Quiénes la usan**, definido en `src/store/UsuariosContext.jsx`:

| Rol | Qué puede hacer |
|---|---|
| **Admin** | Todo: caja, márgenes, presupuestos, usuarios, configuración |
| **Administración** | Costos y caja, carga gastos, aprueba pagos. No crea obras ni ve márgenes |
| **Comprador** | Ve costos, carga gastos. No ve caja, márgenes ni dashboard |
| **Director de obra** | Solo carga avance de tareas. No ve plata |
| **Contador externo** | Lectura de costos, caja, dashboard |

---

## 2. Tech stack (qué tecnologías usa)

### Frontend (lo que ve el usuario en el navegador)

| Tecnología | Versión | Para qué sirve |
|---|---|---|
| **React** | 19 | Librería principal para construir interfaces de usuario |
| **React Router** | 7 | Maneja la navegación entre páginas dentro del navegador |
| **Vite** | 8 | Servidor de desarrollo (`npm run dev`) + empaquetador para producción (`npm run build`) |
| **Supabase JS SDK** | 2.x | Cliente para hablar con la base de datos y la autenticación |
| **JSZip** | 3.x | Crea archivos ZIP en el navegador (para descargar comprobantes) |

### Backend (lo que corre en servidores)

| Tecnología | Para qué sirve |
|---|---|
| **Supabase** | Base de datos PostgreSQL + autenticación + storage de archivos + funciones server-side (Edge Functions) |
| **Vercel** | Hosting del frontend + servidor de las funciones serverless (`api/*.js`) |
| **Meta WhatsApp Cloud API** | Envío y recepción de mensajes de WhatsApp |
| **Anthropic Claude API** | Modelo de IA que interpreta los mensajes del bot de WhatsApp |
| **dolarapi.com** | Cotización del dólar oficial BNA (la app la consulta automáticamente) |

### Lo que NO usa

- **No tiene TypeScript** (lenguaje con tipos estrictos) — todo es JavaScript "a la antigua".
- **No tiene tests automáticos** (vitest/jest/playwright) — toda la prueba es manual.
- **No tiene Redux ni Zustand** — usa solo React Context para estado global.
- **No tiene un sistema de diseño tipo Tailwind o MUI** — los estilos están hechos a mano con CSS inline + algunas clases utilitarias en `src/index.css`.

### Comandos básicos

```bash
npm install      # Instala las dependencias (la primera vez)
npm run dev      # Levanta el servidor de desarrollo (http://localhost:5173)
npm run build    # Genera la build de producción en dist/
npm run lint     # Corre el linter (revisa estilo de código)
npm run preview  # Sirve el build local (para probar antes de deployar)
```

---

## 3. Cómo está organizado (carpetas y archivos)

```
kamak/
├── api/                     # Funciones serverless (Vercel)
│   ├── portal/             # Validar tokens del portal cliente
│   ├── whatsapp/           # Webhook de WhatsApp + envío de portal
│   └── test.js             # Health-check
├── public/                  # Archivos estáticos (se sirven tal cual)
│   ├── assets/             # Logos
│   ├── favicon.svg
│   └── sismat_seed.json    # Catálogo de materiales pre-cargado (~4000 items)
├── scripts/                 # Scripts utilitarios (no se ejecutan en runtime)
│   └── import_sismat.js    # Subir catálogo Sismat a Supabase
├── src/                     # ⭐ Código de la app
│   ├── App.jsx             # Componente principal (rutas + providers)
│   ├── main.jsx            # Punto de arranque
│   ├── index.css           # Estilos globales
│   ├── theme.js            # Colores y fuentes
│   ├── components/         # Componentes reutilizables
│   │   ├── layout/         #   Sidebar, Topbar, PageLayout
│   │   ├── ui/             #   Botones, cajas, chips, etc.
│   │   ├── GlobalSearch.jsx
│   │   └── WhatsappVerificationBanner.jsx
│   ├── data/               # Datos semilla (proveedores muestra, legacy)
│   ├── lib/                # Helpers de bajo nivel
│   │   ├── supabase.js     #   Crea el cliente Supabase
│   │   ├── dbHelpers.js    #   Funciones load/save de datos
│   │   └── syncBus.js      #   Sincronización en tiempo real entre pestañas
│   ├── pages/              # ⭐ Cada página/pantalla principal
│   │   ├── Dashboard.jsx
│   │   ├── Obras.jsx
│   │   ├── obra/           #   Subpáginas de una obra (Presupuesto, Gantt)
│   │   ├── mobile/         #   Vistas mobile (mockups demo)
│   │   ├── portal/         #   Portales públicos cliente/proveedor
│   │   ├── modales/        #   Ventanas emergentes
│   │   └── ...
│   └── store/              # ⭐ Estado global (Contexts de React)
│       ├── AuthContext.jsx
│       ├── ObrasContext.jsx
│       └── ... (16 contexts)
├── supabase/
│   └── functions/
│       └── admin-users/    # Edge Function para gestión de usuarios
├── .env.local              # Variables de entorno locales (NO se commitea)
├── .env.production         # Variables de producción (NO se commitea)
├── .gitignore
├── eslint.config.js        # Config del linter
├── index.html              # HTML base
├── package.json            # Dependencias y scripts
├── vercel.json             # Config de deploy
└── vite.config.js          # Config del bundler
```

---

## 4. Cómo funciona la app (arquitectura general)

### Diagrama de flujo (cuando un usuario abre la app)

```
1. Usuario abre URL en el navegador
   ↓
2. Vercel sirve index.html + el JS de la app
   ↓
3. main.jsx arranca React y renderiza <App />
   ↓
4. <AuthProvider> escucha la sesión de Supabase (login)
   ↓
5. <AppShell> usa key={user.id} para que al cambiar de usuario
   se RE-MONTE toda la cadena de providers (limpieza de estado)
   ↓
6. <DataProviders> agrupa 15 Context providers en cascada
   (cada uno carga su data: obras, proveedores, cajas, etc.)
   ↓
7. <BrowserRouter> + <Routes> decide qué página mostrar según la URL
   ├─ Rutas /portal/* → públicas (sin login)
   └─ Resto → <AuthGate> verifica:
       • Hay sesión Supabase?
       • Está en la tabla app_users?
       • Hay datos cargados?
       ↓
8. <PageLayout>: Sidebar + Topbar + Contenido de la página
```

### Cómo se cargan los datos (3 niveles)

```
┌──────────────────────────────────────────────────────┐
│                    SUPABASE                          │
│  - Tabla shared_data (JSON blobs por key)            │  ← Fuente de verdad
│  - Tabla app_users                                    │
│  - Storage de fotos (bucket kamak-fotos)              │
└──────────────────────────────────────────────────────┘
                        ↑↓
            load/save por loadSharedData/saveSharedData
            broadcast via syncBus (Supabase Realtime)
                        ↑↓
┌──────────────────────────────────────────────────────┐
│              REACT CONTEXT (16)                       │
│  Estado global en memoria                             │  ← La app trabaja acá
│  Cada context cubre un dominio (obras, cajas, etc.)   │
└──────────────────────────────────────────────────────┘
                        ↑↓
                  useContext()
                        ↑↓
┌──────────────────────────────────────────────────────┐
│                PÁGINAS / COMPONENTES                  │
│  Leen estado, lo muestran, disparan acciones          │  ← Lo que ve el usuario
└──────────────────────────────────────────────────────┘
                        ↑↓
                   localStorage
              (cache para arranque rápido,
              key pattern: kamak_<nombre>_v1)
```

**Patrón resumido**: cada Context arranca leyendo lo que tiene en localStorage (instantáneo), después busca lo último en Supabase. Cuando el usuario hace un cambio, se actualiza el estado local y a los 800ms se guarda en Supabase. Si otro usuario también modifica desde otro tab/dispositivo, los demás se enteran por el canal de tiempo real (`syncBus`).

---

## 5. Mapa de páginas (rutas)

### Rutas públicas (sin login)

| URL | Página | Para qué |
|---|---|---|
| `/portal/cliente/:id` | PortalCliente | El cliente entra y ve SU obra (avance, cuotas, fotos, chat) |
| `/portal/proveedor` | PortalProveedor | Demo de portal para proveedores (mockup, no funcional) |
| `/portal/acceso/:token` | PortalAcceso | Valida un link mágico y redirige al portal cliente |

### Rutas internas (requieren login)

| URL | Página | Acceso | Para qué |
|---|---|---|---|
| `/` | Dashboard | Todos (admin ve completo) | Vista general: posición consolidada, alertas, cashflow, KPIs |
| `/obras` | Obras | Todos | Listado de obras por estado (activa, en presupuesto, finalizada, etc.) |
| `/obras/:id/presupuesto` | ObraPresupuesto | Todos (con tabs filtrados) | Expediente completo de una obra (10 sub-tabs) |
| `/obras/:id/gantt` | ObraGantt | Comprador / Director / Admin | Diagrama de Gantt de la obra |
| `/proveedores` | Proveedores | Todos (con columnas filtradas) | Listado de proveedores |
| `/proveedores/:id` | ProveedorCC | Todos (debería ser solo Admin) | Cuenta corriente del proveedor |
| `/clientes` | Clientes | Solo Admin | ABM de clientes |
| `/movimientos` | Movimientos | Todos (con filtros por caja) | Listado de ingresos/gastos/traspasos |
| `/cajas` | Cajas | Permiso `verCaja` | Saldos por caja (efectivo, banco, USD, etc.) |
| `/cajas/conciliacion` | Conciliacion | Permiso `verCaja` | Conciliación bancaria (mockup demo) |
| `/cheques` | Cheques | Solo Admin | Cheques en cartera, depositados, etc. |
| `/whatsapp` | WhatsappBuzon | Solo Admin (debería) | Aprobaciones de facturas/movs del bot |
| `/prorrateo` | Prorrateo | Solo Admin / Administración | Distribución de gastos fijos entre obras |
| `/catalogos` | Catalogos | Solo Admin | Catálogo maestro de precios (APU) |
| `/plantillas` | Plantillas | Solo Admin | Plantillas reutilizables de presupuesto |
| `/reportes` | Reportes | Solo Admin | Reportes analíticos (YTD, top proveedores, etc.) |
| `/autorizaciones` | Autorizaciones | Todos (admin gestiona; resto ve sus solicitudes) | Gestión de usuarios + solicitudes pendientes |
| `/configuracion` | Configuracion | Todos (no-admin solo "Mi cuenta") | Settings de empresa + perfil |
| `/mobile/comprador` | MobileComprador | Todos | Mockup mobile (no integrado a data real) |
| `/mobile/director` | MobileDirector | Todos | Mockup mobile (no integrado a data real) |

---

## 6. Estado global (los 16 Contexts)

Un **Context** en React es un "cajón compartido" de datos al que todas las páginas pueden acceder sin pasar props por toda la cadena.

| Context | Para qué | Datos que guarda |
|---|---|---|
| **AuthContext** | Sesión de Supabase | `user`, `loading` |
| **AppLoadingContext** | Splash inicial | Contador 0–11 (espera que carguen 11 providers) |
| **ConfiguracionContext** | Settings empresa | empresa, notificaciones, seguridad, apariencia, medios de pago |
| **DolarContext** | Cotización USD | venta, compra, manual/auto |
| **ObrasContext** | Obras + sus detalles | obras (array), detalles (mapa obraId → {rubros, tareas, movs, cuotas, contratos, etc.}) |
| **CatalogContext** | Catálogo APU | rubros, materiales, mo, generales, subcontratos, tareas |
| **PlantillasContext** | Plantillas | 7 plantillas seed (Estación, Vivienda, Panadería, etc.) |
| **GastosFijosContext** | Gastos fijos mensuales | alquiler, salarios, servicios, etc. |
| **ProveedoresContext** | Proveedores + cuenta corriente | proveedores, ccEntries |
| **ClientesContext** | Clientes | array de clientes |
| **MovimientosContext** | Cajas + movimientos | cajas, movimientos |
| **ChequesContext** | Cheques | array (con estados cartera/depositado/endosado/etc.) |
| **WhatsappPendingContext** | Pendientes WhatsApp | items esperando aprobación |
| **SolicitudesContext** | Solicitudes de eliminación | pendientes/aprobadas/rechazadas |
| **AlertasContext** | Alertas del bot | array (excesos, proveedor faltante, etc.) |
| **UsuariosContext** | Usuarios de la app | usuarios, currentUser, roles configurables |

> **Detalle técnico importante**: estos 16 providers están envueltos por `<AppShell key={user?.id}>`. Cuando el usuario cambia, el `key` cambia y React desmonta y vuelve a montar TODO. Eso garantiza que los datos del usuario anterior no queden colgados en memoria. (Cambio reciente: commit `887f04c`.)

---

## 7. Backend (lo que corre en servidores)

### `api/` — Funciones serverless de Vercel (Node.js)

| Archivo | Para qué |
|---|---|
| `api/test.js` | Health-check trivial. Útil para verificar que Vercel responde. |
| `api/portal/validate-token.js` | Valida un token de portal cliente y devuelve el `obraId` asociado. Lo usa `PortalAcceso.jsx`. |
| `api/whatsapp/webhook.js` | El corazón del bot de WhatsApp. Recibe mensajes de Meta, los procesa con Claude, crea movimientos/avances pendientes. 1252 líneas. |
| `api/whatsapp/send-portal.js` | Crea un token de portal y se lo envía al cliente por WhatsApp. |

### `supabase/functions/admin-users/` — Edge Function (Deno)

Función server-side de Supabase que ejecuta operaciones admin (crear usuario, actualizar contraseña, eliminar usuario) verificando que quien llama sea Admin. Se despliega manualmente con:

```bash
supabase functions deploy admin-users
```

---

## 8. Modelo de datos (Supabase)

### Tablas principales

**`app_users`** — Usuarios de la aplicación

| Columna | Tipo | Para qué |
|---|---|---|
| `id` | uuid | ID único |
| `nombre` | text | Nombre del usuario |
| `email` | text | Email (debe coincidir con Auth) |
| `rol` | text | 'Admin', 'Administración', 'Comprador', 'Director de obra', 'Contador externo' |
| `permisos` | jsonb | `{verCostos, verMargenes, verCaja, cargarGastos, cargarAvance, editarPresu, aprobarPagos, crearObra, verDashboard}` |
| `obras_visibles` | jsonb | `'*'` o `[obraId, ...]` |
| `cajas_visibles` | jsonb | `'*'` o `[cajaId, ...]` |
| `tabs_ocultos` | jsonb | `[tabName, ...]` |
| `updated_at` | timestamp | |

**`shared_data`** — Datos globales compartidos (clave/valor JSON)

| Columna | Tipo |
|---|---|
| `key` | text PRIMARY KEY |
| `data` | jsonb |
| `updated_at` | timestamp |

Las claves usadas son:

- `config` (configuración de empresa)
- `dolar` (cotización)
- `obras` (todas las obras con sus detalles)
- `catalog` (catálogo APU)
- `plantillas`
- `gastos_fijos`
- `proveedores` (con cuenta corriente)
- `clientes`
- `movimientos` (con cajas)
- `cheques`
- `whatsapp_pending`
- `solicitudes`
- `alertas`
- `portal_tokens` (los links mágicos del portal cliente)

**`user_data`** — Datos privados por usuario (uso limitado actualmente)

**`whatsapp_users`** — Vinculación entre número de WhatsApp y usuario de la app

**`whatsapp_verifications`** — Códigos de vinculación temporales (15 min)

**`whatsapp_conversations`** — Estado de cada conversación con el bot

**Storage bucket `kamak-fotos`** — Fotos subidas por WhatsApp (actualmente público).

### Característica importante

**La app es single-tenant**: todos los usuarios comparten la misma `shared_data`. No es un SaaS multi-empresa — está hecho para Kamak Desarrollos solo.

---

## 9. Variables de entorno

### Frontend (`.env.local` en raíz del proyecto, prefijo `VITE_` obligatorio)

```
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJI...
```

Estas dos son las que necesitás para que la app local conecte a Supabase. Sin ellas, ves "Failed to fetch" al intentar loguear.

### Backend (en Vercel → Settings → Environment Variables; SIN prefijo `VITE_`)

```
SUPABASE_URL
SUPABASE_SERVICE_KEY            # ⚠ SECRETO — solo server-side
META_ACCESS_TOKEN               # WhatsApp Cloud API token
META_PHONE_NUMBER_ID
META_VERIFY_TOKEN
ANTHROPIC_API_KEY               # ⚠ SECRETO — Claude
```

### Edge Function de Supabase

Supabase inyecta automáticamente `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` cuando se deploya la función.

---

## 10. Cómo se hace deploy

### Flujo automático (lo normal)

```
1. Editar código localmente
2. npm run dev → probar en http://localhost:5173
3. git commit
4. git push origin main
5. Vercel detecta el push → arranca build → deploya en 1-2 minutos
6. La app actualizada queda en producción
```

### Lo que NO se deploya automático

- **`supabase/functions/admin-users/`** → requiere `supabase functions deploy admin-users` manual.
- **Cambios de schema en Supabase** (nuevas tablas, RLS) → se hacen desde Supabase Studio.
- **Variables de entorno** → se configuran en el dashboard de Vercel y Supabase (no en el código).

### Repositorio

GitHub: `https://github.com/kamakdesarrollos/Kamak.git`
Branch principal: `main` (cada push deploya).

### `vercel.json`

```json
{
  "rewrites": [{"source": "/(.*)", "destination": "/index.html"}],
  "headers": [
    {"source": "/(.*)", "headers": [{"key":"Cache-Control","value":"no-cache, no-store, must-revalidate"}]},
    {"source": "/assets/(.*)", "headers": [{"key":"Cache-Control","value":"public, max-age=31536000, immutable"}]}
  ]
}
```

- **Rewrites**: cualquier URL desconocida se entrega `index.html`. React Router decide qué mostrar.
- **Cache**: el HTML siempre fresco, los assets versionados (con hash) cacheados 1 año.

---

## 11. Convenciones del proyecto

### Nombres de archivo

- **Componentes**: `PascalCase.jsx` (ej: `ObraPresupuesto.jsx`, `RegistrarPagoModal.jsx`)
- **Helpers / utils**: `camelCase.js` (ej: `syncBus.js`, `dbHelpers.js`)
- **Estilos**: `kebab-case.css` (ej: `App.css`, `index.css`)

### Estilo de código

- **UI**: 100% en español argentino (textos, labels, mensajes).
- **Identificadores**: mezcla inglés/español (`addObra`, `useObras`, `handleSubmit`, `proveedoresActivos`).
- **Estilos**: principalmente inline (`style={{...}}`) más algunas clases utilitarias en `index.css` con prefijo `k-` (`k-tab`, `k-btn`, `k-box`).
- **Paleta**: estética "papel cálido" (beige, tinta negra, acento teal). Definida en `src/theme.js` y exportada como `T`.

### Estados de obra

`'en-presupuesto'`, `'activa'`, `'pausada'`, `'finalizada'`, `'archivada'`.

### Estados de cheque

`'cartera'`, `'depositado'`, `'endosado'`, `'rechazado'`, `'anulado'`.

### Moneda

`'ARS'` o `'USD'`. Conversión vía `dolarVenta` del `DolarContext`. Fallback `1070` cuando la cotización no está disponible (constante repetida en muchos lugares — pendiente de refactorizar).

### Formato visual de números

`toLocaleString('es-AR')` → `$ 1.234.567` (separador de miles con punto, decimales con coma).

### IDs generados local

Patrón `<prefijo>-<timestamp>-<random>` (ej: `obra-1716831234567`, `mov-1716831234567-x4f`).

### LocalStorage keys

Patrón `kamak_<nombre>_v<n>` (ej: `kamak_obras_v1`, `kamak_catalog_v4`). El número de versión permite romper el cache cuando cambia el formato.

---

## 12. Cómo levantar el proyecto desde cero (setup)

```bash
# 1. Clonar el repo
git clone https://github.com/kamakdesarrollos/Kamak.git
cd Kamak

# 2. Instalar dependencias
npm install

# 3. Crear .env.local con las variables de Supabase
# (pedirlas al admin o ver en Vercel Settings)
echo "VITE_SUPABASE_URL=https://xxx.supabase.co" > .env.local
echo "VITE_SUPABASE_ANON_KEY=eyJ..." >> .env.local

# 4. Levantar el dev server
npm run dev
# Se abre http://localhost:5173
```

---

## 13. Cosas a tener en cuenta

### Lo que está funcionando bien

- Autenticación con Supabase + auto-logout por inactividad (15 min).
- Sincronización en tiempo real entre pestañas (canal `syncBus`).
- Bot de WhatsApp con IA que extrae datos de fotos de facturas.
- Plantillas de presupuesto reutilizables.
- Catálogo APU con ~4000 materiales argentinos pre-cargados (Sismat).
- Cuenta corriente automática por proveedor por obra.

### Lo que es prototipo / mock

- **Vistas mobile** (`MobileComprador`, `MobileDirector`): solo diseño, no conectadas.
- **PortalProveedor**: mockup demo.
- **Conciliacion** bancaria: pantalla con datos hardcoded.
- **Toggles de seguridad** en Configuracion (2FA, IP whitelist, etc.): no hacen nada real.

### Limitaciones conocidas

- **No es multi-empresa**: hecho para Kamak Desarrollos solo.
- **No tiene tests automáticos**: cada cambio requiere prueba manual.
- **Sin TypeScript**: refactors grandes son arriesgados.
- **Bundle pesado**: 1.15 MB de JavaScript en el primer load (se puede mejorar mucho con code splitting).
- **Datos compartidos como blobs grandes**: cada guardado reescribe la colección entera (no escala bien a >5 usuarios concurrentes).

> Para detalles de bugs y mejoras pendientes, ver `INFORME.BUGS` y `PLAN-MEJORAS.MD`.

---

## 14. Para profundizar

- **Código de la app principal**: `src/App.jsx` (rutas y providers).
- **El componente más grande**: `src/pages/obra/ObraPresupuesto.jsx` (3.762 líneas, 10 sub-tabs).
- **Lógica del bot WhatsApp**: `api/whatsapp/webhook.js` (1.252 líneas).
- **Cómo se hablan los providers**: `src/store/AppLoadingContext.jsx` + cada provider llama `markReady()` al cargar.

Si querés entender una página específica, abrila en orden:
1. Mirá las primeras 50 líneas (imports + funciones helper).
2. Buscá `export default function` — eso es el componente principal.
3. Cada hook (`useObras`, `useUsuarios`, etc.) trae datos del context global.
4. El `return` al final tiene el JSX que se renderiza.
