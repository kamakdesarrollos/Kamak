-- ============================================================================
-- Kamak — Escritura ATÓMICA por ítem para shared_data cuyo `data` es un ARRAY
-- ----------------------------------------------------------------------------
-- PROBLEMA: varias keys (plantillas, alertas, whatsapp_pending) guardan en
-- shared_data.data un ARRAY de objetos {id, ...}. Se persistían como UN blob
-- entero con upsert. Con dos personas editando a la vez, el save de una —con el
-- array viejo en memoria— pisaba la edición de la otra (last-write-wins).
-- Síntoma: "edito una plantilla, le agrego rubros, guardo y desaparecen".
--
-- SOLUCIÓN: estas funciones modifican SOLO el ítem por id dentro de `data`
-- (que ES el array), de forma atómica server-side. Análogo a las de objetos
-- (0002) pero operando sobre data directamente, no sobre data->coleccion.
-- Espejo de src/lib/catalogPatch.js (patchItem/appendItem/removeItem).
--
-- SEGURIDAD: SECURITY INVOKER (default) → la RLS de shared_data sigue aplicando.
--
-- Cómo aplicar: Supabase Studio → SQL Editor → pegar y Run. Idempotente.
-- ============================================================================

-- patch: mergea (superficial) p_patch en el elemento de `data` cuyo 'id' = p_id.
create or replace function public.patch_item_in_shared_array(
  p_key text, p_id text, p_patch jsonb
) returns void language sql as $fn$
  update public.shared_data sd
  set data = coalesce(
        (select jsonb_agg(case when elem->>'id' = p_id then elem || p_patch else elem end)
         from jsonb_array_elements(coalesce(sd.data, '[]'::jsonb)) elem),
        '[]'::jsonb),
      updated_at = now()
  where sd.key = p_key;
$fn$;

-- append: agrega p_item al final de `data`. Equivale a [...list, item].
create or replace function public.append_item_in_shared_array(
  p_key text, p_item jsonb
) returns void language sql as $fn$
  update public.shared_data sd
  set data = coalesce(sd.data, '[]'::jsonb) || p_item,
      updated_at = now()
  where sd.key = p_key;
$fn$;

-- remove: saca de `data` el elemento cuyo 'id' = p_id.
create or replace function public.remove_item_in_shared_array(
  p_key text, p_id text
) returns void language sql as $fn$
  update public.shared_data sd
  set data = coalesce(
        (select jsonb_agg(elem)
         from jsonb_array_elements(coalesce(sd.data, '[]'::jsonb)) elem
         where elem->>'id' <> p_id),
        '[]'::jsonb),
      updated_at = now()
  where sd.key = p_key;
$fn$;

grant execute on function public.patch_item_in_shared_array(text, text, jsonb) to authenticated;
grant execute on function public.append_item_in_shared_array(text, jsonb) to authenticated;
grant execute on function public.remove_item_in_shared_array(text, text) to authenticated;

-- ============================================================================
-- VERIFICACIÓN (opcional, autenticado):
--   select proname from pg_proc where proname like '%_item_in_shared_array';  -- 3 filas
-- ROLLBACK:
--   drop function if exists public.patch_item_in_shared_array(text,text,jsonb);
--   drop function if exists public.append_item_in_shared_array(text,jsonb);
--   drop function if exists public.remove_item_in_shared_array(text,text);
-- ============================================================================
