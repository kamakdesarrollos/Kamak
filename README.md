# Kamak

Sistema interno de gestión de obras de construcción para **Kamak Desarrollos SRL**.

Web app que cubre:
- Planificación de obras (rubros, tareas, materiales, mano de obra).
- Gestión de proveedores y clientes con cuenta corriente.
- Movimientos, cajas (efectivo / banco / USD), cheques, e-cheqs.
- Plan de cuotas y financiación al cliente.
- Bot de WhatsApp (con IA Claude) para subir facturas y avance desde el campo.
- Portales públicos para clientes y proveedores.

## Tecnologías

- **Frontend**: React 19, Vite 8, React Router 7
- **Backend**: Supabase (auth + Postgres + storage + edge functions), Vercel (hosting + serverless functions)
- **IA**: Anthropic Claude (API)
- **Mensajería**: Meta WhatsApp Cloud API
- **Sin TypeScript** (JavaScript puro)

## Setup local

```bash
git clone https://github.com/kamakdesarrollos/Kamak.git
cd Kamak
npm install

# Crear .env.local con las credenciales de Supabase
echo "VITE_SUPABASE_URL=https://tu-proyecto.supabase.co" > .env.local
echo "VITE_SUPABASE_ANON_KEY=eyJ..." >> .env.local

npm run dev
# Abre http://localhost:5173
```

## Scripts

```bash
npm run dev         # servidor de desarrollo (HMR)
npm run build       # build de producción a dist/
npm run preview     # sirve el build local
npm run lint        # ESLint
npm test            # corre tests Vitest una vez
npm run test:watch  # tests en modo watch
```

## Variables de entorno

### Frontend (`.env.local`)

| Variable | Para qué |
|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clave anónima pública |
| `VITE_META_PHONE_NUMBER` | Número del bot WA (ej. `5492262223704`). Usado para generar QR y links wa.me que dirigen al cliente al bot. |

### Backend (panel de Vercel → Environment Variables, sin prefijo `VITE_`)

| Variable | Para qué |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Acceso server-side (bypasea RLS) |
| `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`, `META_VERIFY_TOKEN` | WhatsApp Cloud API |
| `META_PHONE_NUMBER` | Número del bot WA en formato E.164 sin "+" (mismo valor que en frontend) |
| `ANTHROPIC_API_KEY` | Claude (para el bot WA) |

## Estructura

```
kamak/
├── api/                    # Funciones serverless (Vercel)
│   ├── portal/             # validate-token
│   └── whatsapp/           # webhook bot
├── docs/                   # Especificaciones, guías
│   └── specs/              # design docs de features
├── public/                 # assets estáticos (favicon, logos, seed Sismat)
├── scripts/                # utilidades (import_sismat, etc.)
├── src/
│   ├── App.jsx             # rutas + providers
│   ├── main.jsx            # punto de entrada
│   ├── theme.js            # colores, fuentes
│   ├── index.css           # estilos globales
│   ├── components/
│   │   ├── layout/         # Sidebar, Topbar, PageLayout
│   │   ├── ui/             # Box, Btn, Chip, Modal, Toast, …
│   │   └── *.jsx           # GlobalSearch, WhatsappVerificationBanner
│   ├── lib/                # helpers low-level
│   │   ├── supabase.js, dbHelpers.js, syncBus.js
│   │   ├── format.js, dates.js, id.js, constants.js, html.js
│   │   └── useSyncedSharedData.js
│   ├── pages/              # una página por ruta
│   │   ├── obra/           # ObraPresupuesto, ObraGantt
│   │   ├── mobile/         # mockups mobile
│   │   ├── portal/         # portales públicos
│   │   └── modales/        # ventanas emergentes
│   └── store/              # 14 Context providers (estado global)
├── supabase/
│   └── functions/
│       └── admin-users/    # Edge function para CRUD usuarios
└── vercel.json             # config de hosting (SPA rewrites + cache)
```

## Despliegue

- **Repo**: https://github.com/kamakdesarrollos/Kamak.git
- **Branch principal**: `main` (push automático → deploy a Vercel)
- **Hosting**: Vercel (frontend + funciones serverless)
- **Tiempo de deploy**: ~1-2 minutos por push

**Tablas Supabase**: configuración manual (no hay migrations versionadas).
**Edge function `admin-users`**: deploy manual con `supabase functions deploy admin-users`.

## Documentación

- **`docs/DOCUMENTACION.MD`** o **`DOCUMENTACION.MD`** — Mapa completo del proyecto.
- **`INFORME.BUGS`** — Inventario de bugs y deuda técnica (priorizado por severidad).
- **`PLAN-MEJORAS.MD`** — Hoja de ruta de mejoras en fases.
- **`docs/RLS-SETUP.md`** — Guía paso a paso para configurar Row-Level Security en Supabase.
- **`docs/specs/*.md`** — Diseños y specs de features.

## Convenciones

- Componentes: `PascalCase.jsx`. Helpers: `camelCase.js`.
- UI 100% en español argentino. Identificadores de código en inglés/español mezclado.
- LocalStorage: `kamak_<nombre>_v<version>`.
- IDs locales: `prefix-timestamp-random` (ver `src/lib/id.js`).
- Estados de obra: `en-presupuesto | activa | pausada | finalizada | archivada`.

## Reglas operativas

- **Nunca commitear** archivos `.env.local` o claves de API.
- **Push a `main` = deploy a producción**. Probar con `npm run dev` antes.
- **Tests** (`npm test`) deben pasar antes de commit/push.
- **No commitear** `scripts/` salvo que se hayan limpiado credenciales hardcoded.

## Roles (definidos en `src/store/UsuariosContext.jsx`)

| Rol | Acceso |
|---|---|
| **Admin** | Todo |
| **Administración** | Costos, caja, gastos, pagos. No crea obras ni ve márgenes |
| **Comprador** | Costos, carga gastos. Sin caja ni márgenes |
| **Director de obra** | Solo carga avance |
| **Contador externo** | Lectura (costos, caja, dashboard) |
