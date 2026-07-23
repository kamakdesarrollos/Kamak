-- ============================================================================
-- Kamak — Campañas: camp_resumen_arbol() agrupado POR RUBRO → SECCIÓN
-- ----------------------------------------------------------------------------
-- Franco va a administrar el explorador por secciones (rubros): Estaciones de
-- servicio hoy, Franquicias mañana. La RPC de resumen pasa de devolver las
-- banderas "planas" en la raíz a anidar SECCIONES dentro de su rubro.
--
-- SECCIÓN = la combinación canónica de banderas del operador. Un operador
-- MULTIBANDERA ya no se duplica en cada bandera: vive SOLO en su sección
-- combo (ej. "YPF-SHELL-AXION"). Cada operador cuenta UNA sola vez.
--
-- {
--   "global": { "total": n, "por_etapa": {...}, "respondieron": n,
--               "reuniones": n, "obras_vinculadas": n, "leads_calientes": n },
--   "rubros": [ { "rubro": "estaciones", "total": n, "por_etapa": {...},
--                 "respondieron": n, "reuniones": n, "obras": n,
--                 "secciones": [ { "seccion": "YPF-SHELL-AXION",
--                                  "banderas": ["YPF","Shell","Axion"],
--                                  "multibandera": true,
--                                  "total": n, "por_etapa": {...},
--                                  "respondieron": n, "reuniones": n,
--                                  "obras": n }, ... ] }, ... ]
-- }
--
-- BREAKING para el shape (no para la firma): la clave raíz "banderas"
-- DESAPARECE, y dentro de cada rubro la lista se llama "secciones" (ya no
-- "banderas"). Su único consumidor (CampanasContext → CampExplorador) se
-- actualiza en esta misma ola, así que no hay período de doble shape.
--
-- Reglas de agrupado:
--   · rubro null/vacío → 'estaciones' (coalesce + nullif + trim, igual
--     criterio que las banderas). Los rubros se ordenan por total desc
--     (desempate alfabético para que el orden sea determinístico).
--   · SECCIÓN dentro de cada rubro:
--       - 1 bandera → sección con su nombre en MAYÚSCULAS (ej. 'YPF').
--       - varias   → nombres unidos con '-' en el ORDEN CANÓNICO
--         ['YPF','Shell','Axion','Puma','ACA','Gulf','Refinor',
--          'Voy con Energía','Dapsa','Wico','Rhasa','Líder Oil'];
--         las banderas desconocidas van al final, en orden alfabético.
--       - banderas null / vacías / solo blancos → 'Sin bandera'.
--       - valores trim-eados y de-duplicados antes de armar la sección.
--   · "banderas" de cada sección = los valores ORIGINALES trim-eados en su
--     orden canónico (sin upper), para que el front pueda filtrar operadores
--     por igualdad exacta de array. "multibandera" = más de una bandera.
--   · Cada operador cuenta UNA vez en su sección (chau doble conteo del
--     unnest de antes): la suma de totales de secciones = total del rubro,
--     y la suma de rubros = total global. El global no cambia.
--
-- IDEMPOTENTE: create or replace de la misma firma (mismo nombre, sin args,
-- returns jsonb) + revoke/grant re-ejecutables. Se puede re-correr sin romper.
-- ============================================================================


-- ============================================================================
-- RPC: resumen del árbol (global + rubros → secciones) en un solo llamado
-- ----------------------------------------------------------------------------
-- Definiciones (sin cambios respecto de 0007):
--   · respondieron    = etapa in ('respondio','en_conversacion','reunion',
--                       'promovido')  (respondió al menos una vez).
--   · reuniones       = etapa = 'reunion'.
--   · obras(_vinculadas) = operadores con obra_id (promovidos a obra real).
--   · leads_calientes (solo global) = estaciones con estado_llamada
--                       'LEAD CALIENTE' (la joya de la cola de llamadas).
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
  -- Orden canónico de banderas para nombrar secciones combo. Las que no
  -- estén acá caen al final (posición 999) en orden alfabético.
  v_orden constant text[] := array[
    'YPF', 'Shell', 'Axion', 'Puma', 'ACA', 'Gulf', 'Refinor',
    'Voy con Energía', 'Dapsa', 'Wico', 'Rhasa', 'Líder Oil'
  ];
  v_global jsonb;
  v_rubros jsonb;
begin
  -- Guardia de permiso: DEFINER bypasea RLS, así que acá no hay red de
  -- seguridad abajo — sin permiso, null y chau.
  if not public.puede_campanas() then
    return null;
  end if;

  -- --- Nivel global: operadores únicos + leads calientes de estaciones ---
  -- (idéntico a 0007: el consumidor no necesita que cambie)
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

  -- --- Nivel rubro → sección ---
  -- Base normalizada una sola vez: cada operador sale con SU sección ya
  -- resuelta (lateral de agregación: siempre devuelve exactamente una fila,
  -- así que el cross join no pierde operadores). De ahí salen los agregados
  -- de rubro y de sección, ambos contando operadores únicos.
  with op as (
    select coalesce(nullif(trim(o.rubro), ''), 'estaciones') as rubro,
           coalesce(o.etapa_prospeccion, 'sin_contactar')    as etapa,
           o.obra_id,
           coalesce(s.seccion, 'Sin bandera')                as seccion,
           coalesce(s.banderas, '{}'::text[])                as banderas
    from public.camp_operadores o
    cross join lateral (
      select string_agg(
               upper(x.bandera), '-'
               order by coalesce(array_position(v_orden, x.bandera), 999),
                        upper(x.bandera)
             ) as seccion,
             array_agg(
               x.bandera
               order by coalesce(array_position(v_orden, x.bandera), 999),
                        upper(x.bandera)
             ) as banderas
      from (
        select distinct trim(b.val) as bandera
        from unnest(coalesce(o.banderas, '{}'::text[])) as b(val)
        where trim(b.val) <> ''
      ) x
    ) s
  ),
  rubro_totales as (
    select rubro,
           count(*) as total,
           count(*) filter (where etapa in
             ('respondio', 'en_conversacion', 'reunion', 'promovido')) as respondieron,
           count(*) filter (where etapa = 'reunion')       as reuniones,
           count(*) filter (where obra_id is not null)     as obras
    from op
    group by rubro
  ),
  rubro_etapas as (
    select rubro, jsonb_object_agg(etapa, n) as por_etapa
    from (
      select rubro, etapa, count(*) as n
      from op
      group by rubro, etapa
    ) x
    group by rubro
  ),
  -- La identidad de una sección es su ARRAY canónico de banderas (no solo el
  -- nombre): si conviven casings distintos en los datos ('ypf' vs 'YPF'),
  -- son secciones separadas con igual nombre pero filtro exacto distinto.
  seccion_totales as (
    select rubro, seccion, banderas,
           count(*) as total,
           count(*) filter (where etapa in
             ('respondio', 'en_conversacion', 'reunion', 'promovido')) as respondieron,
           count(*) filter (where etapa = 'reunion')       as reuniones,
           count(*) filter (where obra_id is not null)     as obras
    from op
    group by rubro, seccion, banderas
  ),
  seccion_etapas as (
    select rubro, seccion, banderas, jsonb_object_agg(etapa, n) as por_etapa
    from (
      select rubro, seccion, banderas, etapa, count(*) as n
      from op
      group by rubro, seccion, banderas, etapa
    ) x
    group by rubro, seccion, banderas
  ),
  seccion_json as (
    select st.rubro,
           jsonb_agg(
             jsonb_build_object(
               'seccion',      st.seccion,
               'banderas',     to_jsonb(st.banderas),
               'multibandera', cardinality(st.banderas) > 1,
               'total',        st.total,
               'por_etapa',    se.por_etapa,
               'respondieron', st.respondieron,
               'reuniones',    st.reuniones,
               'obras',        st.obras
             )
             order by st.total desc, st.seccion asc
           ) as secciones
    from seccion_totales st
    join seccion_etapas se using (rubro, seccion, banderas)
    group by st.rubro
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'rubro',        rt.rubro,
               'total',        rt.total,
               'por_etapa',    re.por_etapa,
               'respondieron', rt.respondieron,
               'reuniones',    rt.reuniones,
               'obras',        rt.obras,
               'secciones',    coalesce(sj.secciones, '[]'::jsonb)
             )
             order by rt.total desc, rt.rubro asc
           ),
           '[]'::jsonb
         )
    into v_rubros
    from rubro_totales rt
    join rubro_etapas re using (rubro)
    left join seccion_json sj using (rubro);

  return jsonb_build_object('global', v_global, 'rubros', v_rubros);
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
--      -> jsonb con "global" (igual que antes: total/por_etapa/respondieron/
--         reuniones/obras_vinculadas/leads_calientes) y "rubros" ordenados
--         por total desc; cada rubro trae sus "secciones" (total desc,
--         'Sin bandera' para las vacías). Las claves viejas YA NO están:
--    select public.camp_resumen_arbol() ? 'banderas';   -> false
--    select public.camp_resumen_arbol() ? 'rubros';     -> true
--    select public.camp_resumen_arbol()->'rubros'->0 ? 'secciones';  -> true
--    select public.camp_resumen_arbol()->'rubros'->0 ? 'banderas';   -> false
--    select jsonb_array_length(public.camp_resumen_arbol()->'rubros');
--      -> 1 mientras todo sea 'estaciones' (null/vacíos caen ahí también)
--    select s->>'seccion', s->'banderas', s->>'multibandera', s->>'total'
--      from jsonb_array_elements(
--             public.camp_resumen_arbol()->'rubros'->0->'secciones') s;
--      -> un operador con banderas ['Shell','YPF'] aparece SOLO en la sección
--         'YPF-SHELL' (banderas ["YPF","Shell"], multibandera true) — NO en
--         'YPF' ni en 'SHELL'. Ya no hay doble conteo:
--    select (select sum((s->>'total')::int)
--              from jsonb_array_elements(r->'secciones') s) = (r->>'total')::int
--      from jsonb_array_elements(public.camp_resumen_arbol()->'rubros') r;
--      -> true en TODOS los rubros (la suma de secciones = total del rubro)
--  Como usuario SIN el permiso:
--    select public.camp_resumen_arbol();  -> null (ni un número afuera)
-- ============================================================================
