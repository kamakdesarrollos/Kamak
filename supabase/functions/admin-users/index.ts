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

  const token = req.headers.get('Authorization')?.split(' ')[1]
  if (!token) return new Response(JSON.stringify({ error: 'Sin token' }), { status: 401, headers: cors })

  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: cors })

  const { data: appUser } = await admin.from('app_users').select('rol').eq('email', user.email).single()
  if (appUser?.rol !== 'Admin') return new Response(JSON.stringify({ error: 'Prohibido' }), { status: 403, headers: cors })

  const body = await req.json()
  const { action, email, password } = body

  console.log('admin-users action:', action, 'email:', email)

  if (action === 'createUser') {
    // Intentar crear directo; si ya existe, actualizar contraseña
    const { data, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (createErr) {
      console.log('createUser error:', createErr.message)
      // Si ya existe, buscarlo y actualizar contraseña
      if (createErr.message.toLowerCase().includes('already') || createErr.status === 422) {
        const { data: list } = await admin.auth.admin.listUsers()
        const target = list?.users?.find((u: any) => u.email === email)
        if (target) {
          const { error: updErr } = await admin.auth.admin.updateUserById(target.id, { password, email_confirm: true })
          return new Response(JSON.stringify({ error: updErr?.message ?? null }), { headers: cors })
        }
      }
      return new Response(JSON.stringify({ error: createErr.message }), { headers: cors })
    }

    console.log('createUser ok, id:', data?.user?.id)
    return new Response(JSON.stringify({ error: null }), { headers: cors })
  }

  if (action === 'updatePassword') {
    const { data: list } = await admin.auth.admin.listUsers()
    const target = list?.users?.find((u: any) => u.email === email)
    if (!target) return new Response(JSON.stringify({ error: 'Usuario no encontrado en Auth' }), { headers: cors })
    const { error } = await admin.auth.admin.updateUserById(target.id, { password, email_confirm: true })
    return new Response(JSON.stringify({ error: error?.message ?? null }), { headers: cors })
  }

  if (action === 'deleteUser') {
    const { data: list } = await admin.auth.admin.listUsers()
    const target = list?.users?.find((u: any) => u.email === email)
    if (target) {
      const { error } = await admin.auth.admin.deleteUser(target.id)
      if (error) console.log('deleteUser error:', error.message)
    }
    return new Response(JSON.stringify({ error: null }), { headers: cors })
  }

  return new Response(JSON.stringify({ error: 'Acción desconocida: ' + action }), { headers: cors })
})
