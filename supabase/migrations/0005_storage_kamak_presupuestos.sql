-- 0005_storage_kamak_presupuestos.sql
-- ============================================================================
-- Bucket PRIVADO `kamak-presupuestos` para los adjuntos de presupuestos de
-- tercero (PDF/imagen/Excel que sube la app al adjuntar un presupuesto a un
-- rubro).
--
-- Motivo (SEC-09): a diferencia de las fotos de obra, un presupuesto de
-- subcontratista contiene datos comerciales sensibles (razón social, CUIT,
-- precios unitarios de proveedores). En `kamak-fotos` (público) quedaban
-- accesibles por URL directa para cualquiera que la tuviera. Acá viven en un
-- bucket PRIVADO y la app los lee con signed URLs temporales
-- (supabase.storage.createSignedUrl, ver src/lib/upload.js getSignedUrl).
--
-- Aplicar en: Supabase Dashboard -> SQL Editor (igual que la 0003/0004).
-- IMPORTANTE: aplicar ANTES (o junto) al deploy de la feature de adjuntar
-- presupuesto — si el bucket/policies no existen, la subida falla.
-- ============================================================================

-- Bucket privado (public = false). Idempotente.
insert into storage.buckets (id, name, public)
values ('kamak-presupuestos', 'kamak-presupuestos', false)
on conflict (id) do nothing;

-- INSERT: subir un adjunto de presupuesto (usuarios logueados).
drop policy if exists "kamak_presupuestos_insert_authenticated" on storage.objects;
create policy "kamak_presupuestos_insert_authenticated"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'kamak-presupuestos');

-- UPDATE: la app sube con { upsert: true } (sobreescribe si el path ya existe).
drop policy if exists "kamak_presupuestos_update_authenticated" on storage.objects;
create policy "kamak_presupuestos_update_authenticated"
  on storage.objects for update to authenticated
  using (bucket_id = 'kamak-presupuestos')
  with check (bucket_id = 'kamak-presupuestos');

-- SELECT: necesario para que createSignedUrl funcione con el JWT del usuario.
drop policy if exists "kamak_presupuestos_select_authenticated" on storage.objects;
create policy "kamak_presupuestos_select_authenticated"
  on storage.objects for select to authenticated
  using (bucket_id = 'kamak-presupuestos');

-- ============================================================================
-- VERIFICACION (correr despues de aplicar):
--   select id, public from storage.buckets where id = 'kamak-presupuestos';
--   -> public debe ser false.
--
--   select policyname, cmd, roles
--   from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--     and policyname like 'kamak_presupuestos_%';
--   -> deben aparecer las 3 (insert / update / select) con role {authenticated}
--
-- Luego, en la app: Obra -> Presupuesto -> rubro -> Adjuntar presupuesto ->
-- subir un PDF -> el chip debe abrir el archivo (signed URL).
--
-- ROLLBACK:
--   drop policy if exists "kamak_presupuestos_insert_authenticated" on storage.objects;
--   drop policy if exists "kamak_presupuestos_update_authenticated" on storage.objects;
--   drop policy if exists "kamak_presupuestos_select_authenticated" on storage.objects;
--   delete from storage.buckets where id = 'kamak-presupuestos';  -- sólo si está vacío
-- ============================================================================
