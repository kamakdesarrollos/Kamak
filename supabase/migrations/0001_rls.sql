-- ============================================================================
-- Kamak — Row Level Security (RLS) baseline
-- ----------------------------------------------------------------------------
-- Endurece el acceso a las tablas de Supabase del lado del SERVIDOR. Hoy el
-- control de permisos es solo del frontend (UI); sin esto, cualquier usuario
-- autenticado podría, desde la consola del navegador, hacer (por ejemplo)
-- `supabase.from('app_users').update({rol:'Admin'})` y escalarse a Admin.
--
-- Modelo de la app: cada usuario inicia sesión con Supabase Auth → sus requests
-- llevan su JWT (rol `authenticated`). Las funciones serverless (webhook, etc.)
-- usan la SERVICE KEY, que BYPASEA RLS → siguen funcionando sin cambios.
--
-- Cómo aplicar: Supabase Studio → SQL Editor → pegar y Run (de a una sección).
-- Es IDEMPOTENTE (drop if exists + create): se puede re-correr sin romper.
-- Rollback al final del archivo.
--
-- Mejoras sobre el doc manual previo (docs/RLS-SETUP.md):
--   • is_admin() SECURITY DEFINER → evita recursión de RLS al chequear el rol
--     dentro de las propias policies de app_users.
--   • shared_data genérico: cualquier key operativa (incl. nuevas como
--     indices_cac) es accesible por autenticados; solo portal_tokens es admin.
-- ============================================================================


-- ============================================================================
-- 0. Helper: ¿el usuario actual es Admin?
-- SECURITY DEFINER hace que la consulta a app_users NO re-dispare RLS (sino las
-- policies de app_users que llaman a esta función entrarían en recursión).
-- ============================================================================
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.app_users au
    where lower(au.email) = lower((select u.email from auth.users u where u.id = auth.uid()))
      and au.rol = 'Admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;


-- ============================================================================
-- 1. app_users  — todos leen; solo Admin crea/modifica/borra (clave: el rol)
-- ============================================================================
alter table public.app_users enable row level security;

drop policy if exists "app_users_select_authenticated" on public.app_users;
drop policy if exists "app_users_insert_admin_only"     on public.app_users;
drop policy if exists "app_users_update_admin_only"     on public.app_users;
drop policy if exists "app_users_delete_admin_only"     on public.app_users;
-- nombres legacy del doc viejo, por si quedaron:
drop policy if exists "app_users_select_all"   on public.app_users;
drop policy if exists "app_users_insert"       on public.app_users;
drop policy if exists "app_users_update"       on public.app_users;
drop policy if exists "app_users_delete"       on public.app_users;

create policy "app_users_select_authenticated"
  on public.app_users for select to authenticated using (true);

create policy "app_users_insert_admin_only"
  on public.app_users for insert to authenticated with check (public.is_admin());

create policy "app_users_update_admin_only"
  on public.app_users for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "app_users_delete_admin_only"
  on public.app_users for delete to authenticated using (public.is_admin());


-- ============================================================================
-- 2. shared_data  — store key/value del estado de la app
-- Genérico: cualquier key operativa la leen/escriben los autenticados. Excepciones:
--   • 'portal_tokens'  → admin-only (datos de clientes + acceso a portales).
--   • 'afip_ta_*'      → SERVER-ONLY: es el Ticket de Acceso de AFIP (token+sign).
--     Sin policy que lo habilite → RLS deniega todo acceso del cliente; solo la
--     service key (emitir.js) lo lee/escribe. CRÍTICO: si el front pudiera leerlo,
--     un autenticado cualquiera podría llamar a WSFE y emitir suplantando al emisor.
-- DELETE no se permite desde el cliente (sin policy → denegado; el server usa
-- la service key, que bypasea).
-- ============================================================================
alter table public.shared_data enable row level security;

drop policy if exists "shared_data_select_operativas"   on public.shared_data;
drop policy if exists "shared_data_insert_operativas"   on public.shared_data;
drop policy if exists "shared_data_update_operativas"   on public.shared_data;
drop policy if exists "shared_data_select_admin_keys"   on public.shared_data;
drop policy if exists "shared_data_insert_admin_keys"   on public.shared_data;
drop policy if exists "shared_data_update_admin_keys"   on public.shared_data;
-- nombres legacy:
drop policy if exists "shared_data_select" on public.shared_data;
drop policy if exists "shared_data_modify" on public.shared_data;
drop policy if exists "shared_data_select_authenticated" on public.shared_data;
drop policy if exists "shared_data_insert_authenticated" on public.shared_data;
drop policy if exists "shared_data_update_authenticated" on public.shared_data;

-- Keys operativas = todas menos portal_tokens y las keys server-only de AFIP (afip_*:
-- el TA token+sign y el libro de emisión afip_emit_*). (key !~ '^afip_' = NO matchea
-- la regex → excluye toda key que empiece con afip_; el server las usa con service key.)
create policy "shared_data_select_operativas"
  on public.shared_data for select to authenticated using (key <> 'portal_tokens' and key !~ '^afip_');
create policy "shared_data_insert_operativas"
  on public.shared_data for insert to authenticated with check (key <> 'portal_tokens' and key !~ '^afip_');
create policy "shared_data_update_operativas"
  on public.shared_data for update to authenticated using (key <> 'portal_tokens' and key !~ '^afip_') with check (key <> 'portal_tokens' and key !~ '^afip_');

-- portal_tokens: solo Admin (contiene datos de clientes + acceso a portales).
create policy "shared_data_select_admin_keys"
  on public.shared_data for select to authenticated using (key = 'portal_tokens' and public.is_admin());
create policy "shared_data_insert_admin_keys"
  on public.shared_data for insert to authenticated with check (key = 'portal_tokens' and public.is_admin());
create policy "shared_data_update_admin_keys"
  on public.shared_data for update to authenticated using (key = 'portal_tokens' and public.is_admin()) with check (key = 'portal_tokens' and public.is_admin());


-- ============================================================================
-- 3. (OPCIONAL) user_data — datos privados por usuario. Correr SOLO si la tabla
--    existe. El guard `to_regclass` la saltea silenciosamente si no está.
-- ============================================================================
do $$
begin
  if to_regclass('public.user_data') is not null then
    execute 'alter table public.user_data enable row level security';
    execute 'drop policy if exists "user_data_select_own" on public.user_data';
    execute 'drop policy if exists "user_data_insert_own" on public.user_data';
    execute 'drop policy if exists "user_data_update_own" on public.user_data';
    execute 'drop policy if exists "user_data_delete_own" on public.user_data';
    execute 'create policy "user_data_select_own" on public.user_data for select to authenticated using (auth.uid() = user_id)';
    execute 'create policy "user_data_insert_own" on public.user_data for insert to authenticated with check (auth.uid() = user_id)';
    execute 'create policy "user_data_update_own" on public.user_data for update to authenticated using (auth.uid() = user_id)';
    execute 'create policy "user_data_delete_own" on public.user_data for delete to authenticated using (auth.uid() = user_id)';
  end if;
end $$;


-- ============================================================================
-- 4. (OPCIONAL) tablas del bot (whatsapp_*) — solo service key, salvo el banner
--    de verificación que el cliente sí usa. Guards por si no existen.
-- ============================================================================
do $$
begin
  if to_regclass('public.whatsapp_conversations') is not null then
    execute 'alter table public.whatsapp_conversations enable row level security';
    -- sin policies → RLS deniega todo al cliente; la service key bypasea.
  end if;

  if to_regclass('public.whatsapp_users') is not null then
    execute 'alter table public.whatsapp_users enable row level security';
    execute 'drop policy if exists "whatsapp_users_insert_own" on public.whatsapp_users';
    execute 'create policy "whatsapp_users_insert_own" on public.whatsapp_users for insert to authenticated with check (user_id = (select u.email from auth.users u where u.id = auth.uid()))';
  end if;

  if to_regclass('public.whatsapp_verifications') is not null then
    execute 'alter table public.whatsapp_verifications enable row level security';
    execute 'drop policy if exists "whatsapp_verifications_select_own" on public.whatsapp_verifications';
    execute 'drop policy if exists "whatsapp_verifications_delete_own" on public.whatsapp_verifications';
    execute 'create policy "whatsapp_verifications_select_own" on public.whatsapp_verifications for select to authenticated using (user_email = (select u.email from auth.users u where u.id = auth.uid()))';
    execute 'create policy "whatsapp_verifications_delete_own" on public.whatsapp_verifications for delete to authenticated using (user_email = (select u.email from auth.users u where u.id = auth.uid()))';
  end if;
end $$;


-- ============================================================================
-- 5. Storage bucket `kamak-fotos` — DEUDA CONOCIDA (no incluida acá).
-- Hoy el bucket es PÚBLICO. Pasarlo a privado rompe el portal del cliente que
-- muestra fotos por URL directa → requiere migrar a signed URLs. Se deja como
-- ítem aparte (ver docs/RLS-SETUP.md §5). NO aplicar todavía.
-- ============================================================================


-- ============================================================================
-- VERIFICACIÓN (correr después de aplicar)
-- ----------------------------------------------------------------------------
--  Como Admin:   select public.is_admin();                        -> true
--                select * from app_users;                          -> ok
--                select * from shared_data where key='portal_tokens'; -> ok
--  Como no-Admin (desde la app / DevTools):
--                update app_users set rol='Admin' where id=...;    -> ERROR RLS
--                select * from shared_data where key='portal_tokens'; -> 0 rows
--                select * from shared_data where key like 'afip_%'; -> 0 rows (TA + libro emisión)
--                select * from shared_data where key='obras';      -> ok
--
-- ROLLBACK (si algo se rompe):
--   alter table public.app_users  disable row level security;
--   alter table public.shared_data disable row level security;
--   -- (y las demás que hayas tocado)
-- ============================================================================
