# Configuración de RLS en Supabase — Kamak

> Guía paso a paso para endurecer la seguridad de las tablas de Supabase.
> Fecha: 2026-05-26.
> **Importante:** Estos cambios NO se hacen desde el código de la app, se hacen en el panel de Supabase Studio. Aplican al instante (no requieren deploy).

---

## Por qué hacer esto

La app tiene chequeos de permisos en el frontend (Comprador no puede X, etc.), pero **eso solo controla la UI**. Cualquier usuario autenticado puede abrir las DevTools del navegador y ejecutar comandos SQL directos contra Supabase usando la sesión que ya tiene.

**Ejemplo concreto del problema actual:**

```js
// Un Comprador logueado abre la consola y escribe:
await supabase.from('app_users').update({ rol: 'Admin' }).eq('id', miPropioId);
// → Si la RLS no lo bloquea, se vuelve Admin. Game over.
```

RLS (Row-Level Security) es lo que impide esto **del lado del servidor**, sin importar lo que haga el cliente.

---

## Cómo aplicar las políticas

Tenés dos formas de hacerlo:

### Opción A — SQL Editor (recomendado para principiantes en RLS)

1. Abrí Supabase Studio: https://supabase.com/dashboard
2. Seleccioná tu proyecto Kamak.
3. En el menú izquierdo: **SQL Editor**.
4. Click **+ New query**.
5. Pegá los SQL de abajo (uno por sección), apretá **Run**.

### Opción B — Authentication > Policies (interfaz visual)

1. Menú izquierdo: **Authentication** → **Policies**.
2. Elegí la tabla → **+ New policy**.
3. Configurá manualmente (más tedioso).

**Usá Opción A.** Te paso los SQL listos.

---

## 1. Tabla `app_users`

**Riesgo actual:** un Comprador puede `UPDATE app_users SET rol = 'Admin' WHERE id = miId` desde consola.

**Políticas a aplicar:**

```sql
-- 1. Activar RLS en la tabla (si no lo está)
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

-- 2. Limpiar políticas viejas (por si existían)
DROP POLICY IF EXISTS "app_users_select_all"   ON app_users;
DROP POLICY IF EXISTS "app_users_select_own"   ON app_users;
DROP POLICY IF EXISTS "app_users_insert"       ON app_users;
DROP POLICY IF EXISTS "app_users_update"       ON app_users;
DROP POLICY IF EXISTS "app_users_delete"       ON app_users;
DROP POLICY IF EXISTS "app_users_admin_all"    ON app_users;
DROP POLICY IF EXISTS "app_users_admin_modify" ON app_users;

-- 3. SELECT: cualquier usuario autenticado puede leer la tabla
-- (necesario para que la app cargue la lista de usuarios; el filtro por
--  rol/visibilidad se hace en el cliente)
CREATE POLICY "app_users_select_authenticated"
  ON app_users FOR SELECT
  TO authenticated
  USING (true);

-- 4. INSERT: solo admins pueden crear usuarios nuevos
CREATE POLICY "app_users_insert_admin_only"
  ON app_users FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
      AND rol = 'Admin'
    )
  );

-- 5. UPDATE: solo admins pueden modificar (incluido cambiar rol/permisos)
CREATE POLICY "app_users_update_admin_only"
  ON app_users FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
      AND rol = 'Admin'
    )
  );

-- 6. DELETE: solo admins
CREATE POLICY "app_users_delete_admin_only"
  ON app_users FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
      AND rol = 'Admin'
    )
  );
```

### Verificación

```sql
-- Como Admin: debería devolver todos los usuarios
SELECT * FROM app_users;

-- Como no-Admin (cambiá de cuenta en Supabase Studio o probá desde la app):
-- - SELECT funciona: ve la lista
-- - UPDATE rol = 'Admin' debería FALLAR con "new row violates row-level security policy"
```

---

## 2. Tabla `shared_data`

**Riesgo actual:** cualquier user autenticado puede leer `portal_tokens` (con los datos de clientes y números WA) y modificar `whatsapp_pending` (borrar pendientes).

**Estrategia:** Para keys "compartidas operativas" (obras, movimientos, etc.) — acceso de lectura/escritura para todos los autenticados (la app necesita eso). Para keys sensibles (`portal_tokens`) — solo admin.

```sql
-- 1. Activar RLS
ALTER TABLE shared_data ENABLE ROW LEVEL SECURITY;

-- 2. Limpiar políticas viejas
DROP POLICY IF EXISTS "shared_data_select" ON shared_data;
DROP POLICY IF EXISTS "shared_data_modify" ON shared_data;
DROP POLICY IF EXISTS "shared_data_admin_keys" ON shared_data;
DROP POLICY IF EXISTS "shared_data_general_select" ON shared_data;
DROP POLICY IF EXISTS "shared_data_general_modify" ON shared_data;

-- 3. SELECT general: usuarios autenticados pueden leer keys "operativas"
CREATE POLICY "shared_data_select_authenticated"
  ON shared_data FOR SELECT
  TO authenticated
  USING (
    key IN (
      'config', 'dolar', 'obras', 'catalog', 'plantillas',
      'gastos_fijos', 'proveedores', 'clientes', 'movimientos',
      'cheques', 'whatsapp_pending', 'solicitudes', 'alertas'
    )
  );

-- 4. SELECT admin-only: para keys sensibles (portal_tokens)
CREATE POLICY "shared_data_select_admin_keys"
  ON shared_data FOR SELECT
  TO authenticated
  USING (
    key IN ('portal_tokens')
    AND EXISTS (
      SELECT 1 FROM app_users
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
      AND rol = 'Admin'
    )
  );

-- 5. INSERT/UPDATE de keys operativas: autenticados
CREATE POLICY "shared_data_insert_authenticated"
  ON shared_data FOR INSERT
  TO authenticated
  WITH CHECK (
    key IN (
      'config', 'dolar', 'obras', 'catalog', 'plantillas',
      'gastos_fijos', 'proveedores', 'clientes', 'movimientos',
      'cheques', 'whatsapp_pending', 'solicitudes', 'alertas'
    )
  );

CREATE POLICY "shared_data_update_authenticated"
  ON shared_data FOR UPDATE
  TO authenticated
  USING (
    key IN (
      'config', 'dolar', 'obras', 'catalog', 'plantillas',
      'gastos_fijos', 'proveedores', 'clientes', 'movimientos',
      'cheques', 'whatsapp_pending', 'solicitudes', 'alertas'
    )
  );

-- 6. INSERT/UPDATE de keys admin-only
CREATE POLICY "shared_data_insert_admin_keys"
  ON shared_data FOR INSERT
  TO authenticated
  WITH CHECK (
    key IN ('portal_tokens')
    AND EXISTS (
      SELECT 1 FROM app_users
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
      AND rol = 'Admin'
    )
  );

CREATE POLICY "shared_data_update_admin_keys"
  ON shared_data FOR UPDATE
  TO authenticated
  USING (
    key IN ('portal_tokens')
    AND EXISTS (
      SELECT 1 FROM app_users
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
      AND rol = 'Admin'
    )
  );

-- 7. DELETE: no permitir desde cliente (solo service key server-side)
-- (omitimos política DELETE; sin política RLS deniega por default cuando RLS está activa)
```

### Verificación

```sql
-- Como cualquier user autenticado: SELECT shared_data WHERE key = 'obras' funciona
-- Como no-Admin: SELECT shared_data WHERE key = 'portal_tokens' devuelve 0 rows
-- Como Admin: SELECT shared_data WHERE key = 'portal_tokens' funciona
```

---

## 3. Tabla `user_data`

Esta tabla está pensada para datos privados por usuario. La política correcta es "solo accedés a TUS filas".

```sql
ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_data_own" ON user_data;
DROP POLICY IF EXISTS "user_data_select_own" ON user_data;
DROP POLICY IF EXISTS "user_data_insert_own" ON user_data;
DROP POLICY IF EXISTS "user_data_update_own" ON user_data;
DROP POLICY IF EXISTS "user_data_delete_own" ON user_data;

CREATE POLICY "user_data_select_own"
  ON user_data FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_data_insert_own"
  ON user_data FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_data_update_own"
  ON user_data FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_data_delete_own"
  ON user_data FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
```

---

## 4. Tablas usadas SOLO por edge functions (whatsapp_*)

Estas tablas (`whatsapp_users`, `whatsapp_verifications`, `whatsapp_conversations`) las usan **únicamente** el webhook y otras funciones serverless con la `SUPABASE_SERVICE_KEY`. El cliente nunca debería tocarlas.

**Estrategia:** activar RLS y NO crear políticas. Eso deniega todo acceso a clientes autenticados/anónimos. La service_key bypasea RLS automáticamente.

```sql
ALTER TABLE whatsapp_users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_verifications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_conversations  ENABLE ROW LEVEL SECURITY;

-- No crear políticas: por default, RLS sin políticas deniega todo.
-- El webhook (con service_key) sigue funcionando porque bypasea RLS.
```

### Excepción: WhatsappVerificationBanner.jsx

El banner consulta `whatsapp_verifications` con la anon_key (cliente normal). Necesita poder LEER y BORRAR su propia verificación.

```sql
-- Política para que un user logueado vea SU propia verificación pendiente
CREATE POLICY "whatsapp_verifications_select_own"
  ON whatsapp_verifications FOR SELECT
  TO authenticated
  USING (
    user_email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

CREATE POLICY "whatsapp_verifications_delete_own"
  ON whatsapp_verifications FOR DELETE
  TO authenticated
  USING (
    user_email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Para whatsapp_users (vinculación final): el banner también lo escribe
CREATE POLICY "whatsapp_users_insert_own"
  ON whatsapp_users FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT email FROM auth.users WHERE id = auth.uid())
  );
```

---

## 5. Storage bucket `kamak-fotos`

Actualmente el bucket está **público** — cualquier persona con la URL ve la foto sin auth.

**Recomendación:** pasar a privado + servir vía signed URLs desde un endpoint server-side. Es un cambio más complejo (afecta el webhook que sube fotos y los componentes que las muestran).

**Por ahora**, configurar al menos políticas de Storage:

1. Supabase Studio → **Storage** → bucket `kamak-fotos`.
2. Click en el bucket → **Configuration**.
3. Cambiar **Public** → **OFF** (esto vuelve el bucket privado).
4. Ir a **Policies** del bucket.
5. Crear política:

```sql
-- INSERT: solo autenticados pueden subir (el webhook usa service_key, bypasea)
CREATE POLICY "kamak_fotos_insert_authenticated"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'kamak-fotos');

-- SELECT: solo autenticados pueden ver (cliente del portal NO ve fotos directas)
CREATE POLICY "kamak_fotos_select_authenticated"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'kamak-fotos');
```

> ⚠️ Pasar a privado **rompe** los componentes del portal cliente que muestran fotos via URL directa. Eso requiere migración (signed URLs). Por ahora dejarlo público hasta hacer esa migración. Estás dejando una **brecha conocida** documentada para arreglar después.

**Si querés dejarlo público por ahora**, ignorá esta sección 5. Lo dejamos como deuda pendiente.

---

## 6. Después de aplicar todo: probá la app

1. Logueate como Admin en la app — todo debería funcionar igual.
2. Logueate como Comprador — verificá:
   - El sidebar no muestra ítems admin-only ✓ (esto ya estaba)
   - Si abrís DevTools y ejecutás `supabase.from('app_users').update({rol:'Admin'}).eq('id', miId)` → debería fallar con un error de RLS ✓
   - El portal cliente funciona si tenés un link válido ✓
3. Probá que el bot de WhatsApp siga funcionando (manda una factura por WA y aprobá desde /autorizaciones).

---

## 7. Si algo se rompe

Las políticas se pueden borrar con:

```sql
DROP POLICY "nombre-policy" ON nombre_tabla;
```

Si querés volver al estado "wide open" temporalmente (NO recomendado en producción):

```sql
ALTER TABLE app_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE shared_data DISABLE ROW LEVEL SECURITY;
-- etc
```

---

## Resumen de cambios

| Tabla | RLS activa | Políticas |
|---|---|---|
| `app_users` | ✅ | SELECT autenticados; INSERT/UPDATE/DELETE solo Admin |
| `shared_data` | ✅ | SELECT/INSERT/UPDATE autenticados para keys operativas; `portal_tokens` solo Admin |
| `user_data` | ✅ | CRUD solo sobre fila propia |
| `whatsapp_users` | ✅ | Solo service_key; excepción: INSERT propio para vinculación |
| `whatsapp_verifications` | ✅ | Solo service_key; excepción: SELECT/DELETE propio |
| `whatsapp_conversations` | ✅ | Solo service_key |
| Storage `kamak-fotos` | (pendiente) | Deuda conocida — requiere migración a signed URLs |

## Después de esto

Con estas políticas:
- Un Comprador NO puede escalarse a Admin desde la consola.
- Un user autenticado NO puede leer `portal_tokens` (datos sensibles de clientes).
- La edge function `admin-users` y el webhook siguen funcionando porque usan `service_key`.
- El comportamiento normal de la app no cambia para usuarios legítimos.

Si después de aplicar algo se rompe, decime exactamente qué error te da (idealmente con el contenido de la consola) y lo ajustamos.
