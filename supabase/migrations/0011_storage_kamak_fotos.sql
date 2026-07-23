-- 0004_storage_kamak_fotos.sql
-- ============================================================================
-- Permite a los usuarios logueados (rol `authenticated`, que es con el que
-- corre la app) SUBIR / SOBREESCRIBIR / LEER archivos del bucket kamak-fotos.
--
-- Motivo: subir el PDF de planos (TabDocumentos -> path obras/<id>/docs/...)
-- fallaba con "new row violates row-level security policy": el bucket no tenia
-- una policy de INSERT que cubriera ese path para el rol authenticated.
-- (Las fotos van a obras/<id>/fotos/ y los comprobantes a cobros/<id>/.)
--
-- El bucket kamak-fotos YA es PUBLICO para lectura (el portal del cliente
-- muestra fotos por URL directa). Esto NO cambia esa lectura publica: solo
-- habilita la ESCRITURA desde la app para usuarios logueados, para cualquier
-- carpeta del bucket. El endurecimiento real (bucket privado + signed URLs)
-- sigue siendo deuda aparte (ver 0001_rls.sql seccion 5 / docs/RLS-SETUP.md).
--
-- Aplicar en: Supabase Dashboard -> SQL Editor (igual que la 0003).
-- ============================================================================

-- INSERT: subir archivo nuevo (fotos, comprobantes de cobro, docs/planos, etc.)
drop policy if exists "kamak_fotos_insert_authenticated" on storage.objects;
create policy "kamak_fotos_insert_authenticated"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'kamak-fotos');

-- UPDATE: la app sube con { upsert: true } (sobreescribe si el path ya existe).
drop policy if exists "kamak_fotos_update_authenticated" on storage.objects;
create policy "kamak_fotos_update_authenticated"
  on storage.objects for update to authenticated
  using (bucket_id = 'kamak-fotos')
  with check (bucket_id = 'kamak-fotos');

-- SELECT: listar / acceder via API a los objetos del bucket.
drop policy if exists "kamak_fotos_select_authenticated" on storage.objects;
create policy "kamak_fotos_select_authenticated"
  on storage.objects for select to authenticated
  using (bucket_id = 'kamak-fotos');

-- ============================================================================
-- VERIFICACION (correr despues de aplicar):
--   select policyname, cmd, roles
--   from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--     and policyname like 'kamak_fotos_%';
--   -> deben aparecer las 3 (insert / update / select) con role {authenticated}
--
-- Luego, en la app: Obra -> Documentos -> subir el PDF de planos -> debe andar.
--
-- ROLLBACK:
--   drop policy if exists "kamak_fotos_insert_authenticated" on storage.objects;
--   drop policy if exists "kamak_fotos_update_authenticated" on storage.objects;
--   drop policy if exists "kamak_fotos_select_authenticated" on storage.objects;
-- ============================================================================
