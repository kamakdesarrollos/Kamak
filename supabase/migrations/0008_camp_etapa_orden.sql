-- ============================================================================
-- Kamak — Campañas: columna generada etapa_orden para ordenar el árbol del
-- Explorador por ranking de embudo (lo caliente arriba) en vez del orden
-- alfabético que da ordenar etapa_prospeccion como text vía PostgREST.
-- Idempotente y aditiva. Ranking: reunion(1) > en_conversacion(2) >
-- respondio(3) > contactado(4) > sin_contactar(5) > promovido(6) >
-- descartado(7); desconocido/null cae con sin_contactar (5).
-- ============================================================================

alter table public.camp_operadores
  add column if not exists etapa_orden smallint
  generated always as (
    case etapa_prospeccion
      when 'reunion'         then 1
      when 'en_conversacion' then 2
      when 'respondio'       then 3
      when 'contactado'      then 4
      when 'sin_contactar'   then 5
      when 'promovido'       then 6
      when 'descartado'      then 7
      else 5
    end
  ) stored;

create index if not exists camp_operadores_etapa_orden_idx
  on public.camp_operadores (etapa_orden, updated_at desc);

-- Verificación (comentada):
--   select etapa_prospeccion, etapa_orden from camp_operadores limit 10;
--   -- reunion → 1 · descartado → 7 · null → 5
