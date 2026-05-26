// Constantes globales del proyecto.
// Antes habia muchos magic numbers repetidos (1070 en 13 lugares, 800 en 10,
// 86400000 en 6, etc.). Centralizado aca para que tengan nombre y se cambien
// en un solo lado.

// ── Tiempo / intervalos ─────────────────────────────────────────────────────
export const MS_PER_DAY              = 24 * 60 * 60 * 1000;   // 86_400_000
export const SAVE_DEBOUNCE_MS        = 800;                    // debounce de saves a Supabase
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

export const ESTADOS_CHEQUE = ['cartera', 'depositado', 'endosado', 'rechazado', 'anulado'];

// ── Roles ───────────────────────────────────────────────────────────────────
// Los permisos de cada rol viven en src/store/UsuariosContext.jsx (ROLES).
export const ROL_ADMIN          = 'Admin';
export const ROL_ADMINISTRACION = 'Administración';
export const ROL_COMPRADOR      = 'Comprador';
export const ROL_DIRECTOR_OBRA  = 'Director de obra';
export const ROL_CONTADOR       = 'Contador externo';
