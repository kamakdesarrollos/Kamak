// Constantes globales del proyecto.
// Antes habia muchos magic numbers repetidos (1070 en 13 lugares, 800 en 10,
// 86400000 en 6, etc.). Centralizado aca para que tengan nombre y se cambien
// en un solo lado.

// ── Tiempo / intervalos ─────────────────────────────────────────────────────
export const MS_PER_DAY              = 24 * 60 * 60 * 1000;   // 86_400_000
export const SAVE_DEBOUNCE_MS        = 500;                    // debounce de saves a Supabase (medio: rapido para sincronizar portal pero sin generar spam de writes)
export const INACTIVITY_MS           = 15 * 60 * 1000;         // auto-logout
export const INACTIVITY_WARN_MS      = 60 * 1000;              // aviso 1min antes
export const DOLAR_REFRESH_MS        = 60 * 60 * 1000;         // refresh dolar BNA
export const POLL_PENDING_MS         = 20_000;                 // poll de pendings WA
export const POLL_VERIFICATION_MS    = 15_000;                 // poll de banner vinculacion WA
export const PORTAL_TOKEN_EXPIRY_MS  = 365 * MS_PER_DAY;       // expiracion token portal

// ── Dolar / cotizacion ──────────────────────────────────────────────────────
// Fallback solo se usa si el DolarContext aun no cargo o la API fallo.
// Lo correcto siempre es leer dolarVenta del DolarContext.
export const DOLAR_VENTA_FALLBACK  = 1070;
export const DOLAR_COMPRA_FALLBACK = 1060;

// ── Estados ─────────────────────────────────────────────────────────────────
export const ESTADOS_OBRA = ['en-presupuesto', 'activa', 'pausada', 'finalizada', 'archivada'];

// ── Embudo de ventas (módulo Comercial) ─────────────────────────────────
export const ETAPAS_VENTA = ['prospecto', 'cotizado', 'negociacion', 'ganado', 'perdido'];
// Probabilidad de cierre por etapa (para el pipeline ponderado de los KPIs).
export const PROBABILIDAD_POR_ETAPA = { prospecto: 0.10, cotizado: 0.40, negociacion: 0.70, ganado: 1.0, perdido: 0.0 };
// Meses sin obra/actividad para considerar a un cliente "inactivo" (Fase 2).
export const DEFAULT_MESES_INACTIVO = 6;

export const ESTADOS_CHEQUE = ['cartera', 'depositado', 'endosado', 'rechazado', 'anulado'];

// ── Roles ───────────────────────────────────────────────────────────────────
// Los permisos de cada rol viven en src/store/UsuariosContext.jsx (ROLES).
export const ROL_ADMIN          = 'Admin';
export const ROL_ADMINISTRACION = 'Administración';
export const ROL_COMPRADOR      = 'Comprador';
export const ROL_DIRECTOR_OBRA  = 'Director de obra';
export const ROL_CONTADOR       = 'Contador externo';

// ── WhatsApp ────────────────────────────────────────────────────────────────
// Numero del bot de WA Business de Kamak. Formato E.164 sin "+".
// Se lee del env var VITE_META_PHONE_NUMBER; si no esta seteado, fallback al
// numero conocido para que no rompa el build local.
// Guarda import.meta.env para que el archivo funcione también en Node ESM
// (los scripts de backfill importan lib puras que a su vez importan constants.js).
export const META_PHONE_NUMBER = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_META_PHONE_NUMBER) || '5492262223704';
