// Endpoint admin: actualiza una fila de app_users con la SERVICE KEY (bypasea RLS).
//
// Por qué existe: modificar app_users desde el navegador depende de la policy RLS
// `is_admin()`. Si esa función evalúa en falso para un admin legítimo (p.ej. un
// desajuste entre el email de Auth y el de app_users), el UPDATE afecta 0 filas
// EN SILENCIO (sin error) y el cambio —rol, cajas visibles, permisos, accesos—
// nunca se guarda. Eso hacía que "Guardar accesos" pareciera funcionar pero no
// persistiera nada (ej: asignar una caja a un no-admin y que no le figure).
//
// Acá el guardado lo hace el SERVIDOR: validamos el JWT del que llama, confirmamos
// con la service key que es Admin, y recién escribimos. No depende de RLS.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

const sbH = () => ({
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
});

// Mapea campos de la app (camelCase) a columnas de la tabla (snake_case). Solo se
// tocan las columnas presentes en `changes`, para no pisar nada de más.
function changesToColumns(changes = {}) {
  const out = {};
  if ('nombre'        in changes) out.nombre         = changes.nombre;
  if ('email'         in changes) out.email          = changes.email;
  if ('rol'           in changes) out.rol            = changes.rol;
  if ('permisos'      in changes) out.permisos       = changes.permisos;
  if ('obrasVisibles' in changes) out.obras_visibles = changes.obrasVisibles;
  if ('cajasVisibles' in changes) out.cajas_visibles = changes.cajasVisibles;
  if ('tabsOcultos'   in changes) out.tabs_ocultos   = changes.tabsOcultos;
  out.updated_at = new Date().toISOString();
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Servidor sin SUPABASE_URL / SUPABASE_SERVICE_KEY' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sin token de sesión' });

  try {
    // 1) Validar el JWT del que llama y obtener su email real (de Supabase Auth).
    const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!ures.ok) return res.status(401).json({ error: 'Sesión inválida o vencida' });
    const authUser = await ures.json();
    const callerEmail = (authUser?.email || '').toLowerCase();
    if (!callerEmail) return res.status(401).json({ error: 'No se pudo determinar tu email' });

    // 2) Confirmar que el que llama es Admin (service key → sin RLS). Match por
    //    email en minúsculas, así un desajuste de mayúsculas no lo deja afuera.
    const ar = await fetch(`${SUPABASE_URL}/rest/v1/app_users?select=email,rol`, { headers: sbH() });
    if (!ar.ok) return res.status(500).json({ error: 'No se pudo leer app_users' });
    const allUsers = await ar.json();
    const caller = (Array.isArray(allUsers) ? allUsers : []).find(
      u => (u.email || '').toLowerCase() === callerEmail
    );
    if (!caller || caller.rol !== 'Admin') {
      return res.status(403).json({ error: `Tu usuario (${callerEmail}) no figura como Admin en la base.` });
    }

    // 3) Aplicar el cambio al usuario destino.
    const { id, changes } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Falta id del usuario a editar' });
    const cols = changesToColumns(changes);

    const ur = await fetch(`${SUPABASE_URL}/rest/v1/app_users?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { ...sbH(), Prefer: 'return=representation' },
      body: JSON.stringify(cols),
    });
    if (!ur.ok) {
      const t = await ur.text();
      return res.status(500).json({ error: `Update falló (${ur.status}): ${t.slice(0, 200)}` });
    }
    const rows = await ur.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ error: `No se actualizó ninguna fila: el id no existe (${id})` });
    }
    return res.status(200).json({ user: rows[0] });
  } catch (e) {
    console.error('[admin/update-user] error:', e.message);
    return res.status(500).json({ error: e.message || 'Error interno' });
  }
}
