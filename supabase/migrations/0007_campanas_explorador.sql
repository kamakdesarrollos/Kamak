-- ============================================================================
-- Kamak — Módulo Campañas (Explorador jerárquico): rubro + RPC de resumen
-- ----------------------------------------------------------------------------
-- Soporte de datos para el PIVOT DE UX (2026-07-22): el explorador es UNA
-- pantalla con árbol Rubro (Estaciones de servicio / Franquicias) → Bandera →
-- Operadores, con KPIs pegados a cada nivel. Esta migración agrega:
--   1. Columna `rubro` en camp_operadores (hoy todo es 'estaciones'; a futuro
--      se suman 'franquicias' u otros rubros sin tocar el schema).
--   2. RPC `camp_resumen_arbol()`: un solo round-trip que devuelve los KPIs
--      del nivel global y de cada bandera, para pintar el árbol de entrada.
--
-- IDEMPOTENTE Y ADITIVA: alter add column if not exists + create or replace
-- + create index if not exists. Se puede re-correr sin romper (regla del
-- flujo de deploy: primero Kamak-Pruebas, a prod la aplica el Action
-- db-migrate al mergear).
-- ============================================================================


-- ============================================================================
-- 1. Rubro del operador
-- ----------------------------------------------------------------------------
-- Primer nivel del árbol del explorador. Default 'estaciones' (la campaña
-- actual); cuando arranque la campaña a franquicias, esos operadores se
-- cargan con rubro = 'franquicias' y el árbol suma la rama sola.
-- ============================================================================
alter table public.camp_operadores
  add column if not exists rubro text default 'estaciones';

-- Índice por si el frontend filtra por rubro al listar operadores. Los
-- agregados del RPC de abajo van a full-scan igual y está bien: a esta
-- escala (miles de operadores, no millones) un scan completo es barato.
create index if not exists camp_operadores_rubro_idx
  on public.camp_operadores (rubro);


-- ============================================================================
-- 2. RPC: resumen del árbol (KPIs global + por bandera) en un solo llamado
-- ----------------------------------------------------------------------------
-- Devuelve:
-- {
--   "global": { "total": n, "por_etapa": {"sin_contactar": n, ...},
--               "respondieron": n, "reuniones": n, "obras_vinculadas": n,
--               "leads_calientes": n },
--   "banderas": [ { "bandera": "YPF", "total": n, "por_etapa": {...},
--                   "respondieron": n, "reuniones": n, "obras": n }, ... ]
-- }
--
-- Definiciones:
--   · respondieron    = etapa in ('respondio','en_conversacion','reunion',
--                       'promovido')  (respondió al menos una vez).
--   · reuniones       = etapa = 'reunion'.
--   · obras(_vinculadas) = operadores con obra_id (promovidos a obra real).
--   · leads_calientes (solo global) = estaciones con estado_llamada
--                       'LEAD CALIENTE' (la joya de la cola de llamadas).
--
-- OJO multibandera: banderas se expande con unnest(), así que un operador
-- multibandera (ej. maneja YPF y Shell) cuenta UNA vez en cada bandera.
-- Por eso la suma de los totales por bandera puede superar el total global
-- (que sí cuenta operadores únicos). Es intencional: cada rama del árbol
-- muestra "cuántos operadores tocan esa bandera".
-- Operadores sin banderas (null, array vacío o elementos en blanco) se
-- agrupan bajo 'Sin bandera'. Los nombres se trim-ean ('YPF ' cuenta como
-- 'YPF').
--
-- SECURITY DEFINER (bypasea RLS para leer camp_* sin re-disparar políticas)
-- → el permiso se chequea ADENTRO: si el usuario no puede_campanas(),
-- devuelve null y no filtra ni un número.
-- ============================================================================
create or replace function public.camp_resumen_arbol()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_global   jsonb;
  v_banderas jsonb;
begin
  -- Guardia de permiso: DEFINER bypasea RLS, así que acá no hay red de
  -- seguridad abajo — sin permiso, null y chau.
  if not public.puede_campanas() then
    return null;
  end if;

  -- --- Nivel global: operadores únicos + leads calientes de estaciones ---
  select jsonb_build_object(
           'total',        count(*),
           'por_etapa',    (
             select coalesce(jsonb_object_agg(pe.etapa, pe.n), '{}'::jsonb)
             from (
               select coalesce(o2.etapa_prospeccion, 'sin_contactar') as etapa,
                      count(*) as n
               from public.camp_operadores o2
               group by 1
             ) pe
           ),
           'respondieron', count(*) filter (where o.etapa_prospeccion in
                             ('respondio', 'en_conversacion', 'reunion', 'promovido')),
           'reuniones',    count(*) filter (where o.etapa_prospeccion = 'reunion'),
           'obras_vinculadas', count(*) filter (where o.obra_id is not null),
           'leads_calientes', (
             select count(*)
             from public.camp_estaciones e
             where e.estado_llamada = 'LEAD CALIENTE'
           )
         )
    into v_global
    from public.camp_operadores o;

  -- --- Nivel bandera: unnest de banderas (multibandera cuenta en cada una) ---
  with op_bandera as (
    select coalesce(nullif(trim(b.val), ''), 'Sin bandera') as bandera,
           coalesce(o.etapa_prospeccion, 'sin_contactar')   as etapa,
           o.obra_id
    from public.camp_operadores o
    cross join lateral unnest(
      case when o.banderas is null or cardinality(o.banderas) = 0
           then array[null::text]          -- sin banderas → una fila 'Sin bandera'
           else o.banderas
      end
    ) as b(val)
  ),
  totales as (
    select bandera,
           count(*) as total,
           count(*) filter (where etapa in
             ('respondio', 'en_conversacion', 'reunion', 'promovido')) as respondieron,
           count(*) filter (where etapa = 'reunion')       as reuniones,
           count(*) filter (where obra_id is not null)     as obras
    from op_bandera
    group by bandera
  ),
  etapas as (
    select bandera, jsonb_object_agg(etapa, n) as por_etapa
    from (
      select bandera, etapa, count(*) as n
      from op_bandera
      group by bandera, etapa
    ) x
    group by bandera
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'bandera',      t.bandera,
               'total',        t.total,
               'por_etapa',    e.por_etapa,
               'respondieron', t.respondieron,
               'reuniones',    t.reuniones,
               'obras',        t.obras
             )
             order by t.total desc, t.bandera asc
           ),
           '[]'::jsonb
         )
    into v_banderas
    from totales t
    join etapas e using (bandera);

  return jsonb_build_object('global', v_global, 'banderas', v_banderas);
end;
$$;

-- Patrón is_admin() (0001_rls.sql): nadie anónimo la ejecuta; authenticated
-- sí, y el permiso fino lo resuelve la guardia interna.
revoke all on function public.camp_resumen_arbol() from public;
grant execute on function public.camp_resumen_arbol() to authenticated;


-- ============================================================================
-- VERIFICACIÓN (correr después de aplicar)
-- ----------------------------------------------------------------------------
--  Como Admin (o usuario con permiso `campanas`):
--    select public.camp_resumen_arbol();
--      -> jsonb con "global" (total/por_etapa/respondieron/reuniones/
--         obras_vinculadas/leads_calientes) y "banderas" ordenadas por
--         total desc; los sin bandera agrupados en 'Sin bandera'.
--    select jsonb_array_length(public.camp_resumen_arbol()->'banderas');
--      -> cantidad de banderas distintas (+1 si hay 'Sin bandera').
--  Como usuario SIN el permiso:
--    select public.camp_resumen_arbol();  -> null (ni un número afuera)
--  Columna nueva:
--    select rubro, count(*) from camp_operadores group by 1;
--      -> todo 'estaciones' (los existentes toman el default)
-- ============================================================================
