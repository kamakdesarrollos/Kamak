import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Verificar que el caller está autenticado
  const token = req.headers.get('Authorization')?.split(' ')[1]
  if (!token) return new Response(JSON.stringify({ error: 'Sin token' }), { status: 401, headers: cors })

  const { data: { user } } = await admin.auth.getUser(token)
  if (!user) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: cors })

  // Verificar que el caller es Admin en app_users
  const { data: appUser } = await admin.from('app_users').select('rol').eq('email', user.email).single()
  if (appUser?.rol !== 'Admin') return new Response(JSON.stringify({ error: 'Prohibido' }), { status: 403, headers: cors })

  const { action, email, password } = await req.json()

  // Buscar usuario target por email
  const { data: { users } } = await admin.auth.admin.listUsers()
  const target = users.find((u: any) => u.email === email)

  if (action === 'createUser') {
    if (target) {
      // Ya existe en Auth, solo actualizamos la contraseña
      await admin.auth.admin.updateUserById(target.id, { password })
      return new Response(JSON.stringify({ error: null }), { headers: cors })
    }
    const { error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    })
    return new Response(JSON.stringify({ error: error?.message ?? null }), { headers: cors })
  }

  if (action === 'updatePassword') {
    if (!target) return new Response(JSON.stringify({ error: 'Usuario no encontrado' }), { headers: cors })
    const { error } = await admin.auth.admin.updateUserById(target.id, { password })
    return new Response(JSON.stringify({ error: error?.message ?? null }), { headers: cors })
  }

  if (action === 'deleteUser') {
    if (target) await admin.auth.admin.deleteUser(target.id)
    return new Response(JSON.stringify({ error: null }), { headers: cors })
  }

  return new Response(JSON.stringify({ error: 'Acción desconocida' }), { headers: cors })
})
