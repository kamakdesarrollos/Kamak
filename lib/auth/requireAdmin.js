// Autorización server-side para endpoints sensibles (/api).
//
// La app usa Supabase Auth (sesiones con JWT). El rol vive en la tabla `app_users`
// (fuente de verdad del servidor, NO el localStorage del front). Este helper calca
// la verificación de la edge function admin-users:
//   1. Toma el `Authorization: Bearer <access_token>` del request.
//   2. Valida el JWT contra Supabase Auth (/auth/v1/user) → identifica al usuario.
//   3. Chequea `app_users.rol === 'Admin'` con la SERVICE_KEY (bypasea RLS).
//
// Sin esto, cualquiera con la URL del endpoint podría dispararlo. Para /api/afip/emitir
// eso significaría emitir facturas fiscales REALES con el CUIT del emisor: inadmisible.

// Extrae el token "Bearer <x>" del header Authorization (tolera mayúsc/minúsc).
export function getBearerToken(req) {
  const h = req?.headers?.authorization || req?.headers?.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// Verifica sesión válida + rol Admin. Devuelve { ok:true, user } o
// { ok:false, status, error } con el código HTTP apropiado (401/403/500).
// `fetchImpl` se inyecta en los tests; en runtime usa el fetch global (Node 20+).
export async function verifyAdmin({ token, supabaseUrl, serviceKey, fetchImpl = fetch }) {
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, status: 500, error: 'Autenticación no configurada en el servidor' };
  }
  if (!token) {
    return { ok: false, status: 401, error: 'Falta el token de sesión (iniciá sesión de nuevo)' };
  }

  // 1) Validar el JWT contra Supabase Auth.
  let ures;
  try {
    ures = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, status: 502, error: 'No se pudo validar la sesión' };
  }
  if (!ures.ok) {
    return { ok: false, status: 401, error: 'Sesión inválida o expirada' };
  }
  const user = await ures.json().catch(() => null);
  const email = user?.email;
  if (!email) {
    return { ok: false, status: 401, error: 'No autorizado' };
  }

  // 2) Verificar rol Admin en app_users (mismo criterio que la edge function admin-users).
  let rres;
  try {
    rres = await fetchImpl(
      `${supabaseUrl}/rest/v1/app_users?email=eq.${encodeURIComponent(email)}&select=rol`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
  } catch {
    return { ok: false, status: 502, error: 'No se pudo verificar el rol' };
  }
  if (!rres.ok) {
    return { ok: false, status: 403, error: 'No se pudo verificar el rol del usuario' };
  }
  const rows = await rres.json().catch(() => []);
  const rol = Array.isArray(rows) && rows[0] ? rows[0].rol : null;
  if (rol !== 'Admin') {
    return { ok: false, status: 403, error: 'Esta acción requiere rol Admin' };
  }

  return { ok: true, user: { email, id: user?.id || null, rol } };
}

// Azúcar para endpoints: corre la verificación y, si falla, contesta el HTTP.
// Devuelve el user si pasa, o null si ya respondió (el caller debe `return`).
export async function requireAdmin(req, res, { supabaseUrl, serviceKey, fetchImpl } = {}) {
  const r = await verifyAdmin({ token: getBearerToken(req), supabaseUrl, serviceKey, fetchImpl });
  if (!r.ok) {
    res.status(r.status).json({ error: r.error });
    return null;
  }
  return r.user;
}
