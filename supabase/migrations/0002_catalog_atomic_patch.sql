-- ============================================================================
-- Kamak — Escritura ATÓMICA por ítem para el catálogo (fix CAT-003)
-- ----------------------------------------------------------------------------
-- PROBLEMA: el catálogo (shared_data key='catalog') se guardaba como UN blob
-- entero con upsert del objeto completo. Con dos personas editando a la vez, el
-- save de una —con el catálogo viejo en memoria— pisaba la edición de la otra
-- (last-write-wins). Síntoma: "edito/duplico una APU y no se guarda".
--
-- SOLUCIÓN: estas funciones modifican SOLO el ítem editado dentro de
-- data->coleccion (tareas / materiales / subcontratos / mo / generales /
-- rubros / tiposObra), de forma atómica server-side. Dos ediciones a ítems
-- distintos ya no se pisan. Son el espejo de src/lib/catalogPatch.js.
--
-- SEGURIDAD: SECURITY INVOKER (default) → corren con los permisos del usuario
-- que llama, así la RLS de shared_data sigue aplicando (0001_rls.sql): solo
-- keys operativas (catalog lo es); portal_tokens y afip_* siguen bloqueadas.
-- No hace falta DELETE en la tabla: todo es UPDATE de jsonb.
--
-- Cómo aplicar: Supabase Studio → SQL Editor → pegar y Run. Idempotente.
-- (dollar-quote nombrado $fn$ para evitar problemas de parseo al pegar.)
-- ============================================================================

-- patch: mergea (superficial) p_patch en el elemento de data->p_collection
-- cuyo 'id' = p_id. Equivale a { ...item, ...patch }. No-op si no existe el id.
create or replace function public.patch_shared_object_item(
  p_key text, p_collection text, p_id text, p_patch jsonb
) returns void language sql as $fn$
  update public.shared_data sd
  set data = jsonb_set(
        sd.data, array[p_collection],
        coalesce(
          (select jsonb_agg(case when elem->>'id' = p_id then elem || p_patch else elem end)
           from jsonb_array_elements(coalesce(sd.data -> p_collection, '[]'::jsonb)) elem),
          '[]'::jsonb),
        true),
      updated_at = now()
  where sd.key = p_key;
$fn$;

-- append: agrega p_item al final de data->p_collection. Equivale a [...list, item].
create or replace function public.append_shared_object_item(
  p_key text, p_collection text, p_item jsonb
) returns void language sql as $fn$
  update public.shared_data sd
  set data = jsonb_set(
        sd.data, array[p_collection],
        coalesce(sd.data -> p_collection, '[]'::jsonb) || p_item,
        true),
      updated_at = now()
  where sd.key = p_key;
$fn$;

-- remove: saca de data->p_collection el elemento cuyo 'id' = p_id.
create or replace function public.remove_shared_object_item(
  p_key text, p_collection text, p_id text
) returns void language sql as $fn$
  update public.shared_data sd
  set data = jsonb_set(
        sd.data, array[p_collection],
        coalesce(
          (select jsonb_agg(elem)
           from jsonb_array_elements(coalesce(sd.data -> p_collection, '[]'::jsonb)) elem
           where elem->>'id' <> p_id),
          '[]'::jsonb),
        true),
      updated_at = now()
  where sd.key = p_key;
$fn$;

grant execute on function public.patch_shared_object_item(text, text, text, jsonb) to authenticated;
grant execute on function public.append_shared_object_item(text, text, jsonb) to authenticated;
grant execute on function public.remove_shared_object_item(text, text, text) to authenticated;

-- ============================================================================
-- VERIFICACIÓN (opcional, autenticado):
--   select proname from pg_proc where proname like '%_shared_object_item';  -- 3 filas
-- ROLLBACK:
--   drop function if exists public.patch_shared_object_item(text,text,text,jsonb);
--   drop function if exists public.append_shared_object_item(text,text,jsonb);
--   drop function if exists public.remove_shared_object_item(text,text,text);
-- ============================================================================
