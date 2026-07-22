-- ============================================================================
-- Kamak — Campañas: camp_metricas (snapshots de métricas de plataformas)
-- ----------------------------------------------------------------------------
-- Snapshots diarios de las métricas de las plataformas externas de la campaña
-- (Instantly, Meta Ads, GA4, Search Console, Google Ads, Clarity). La ESCRIBE
-- únicamente el sync server-side con la service key (bypassea RLS) y la LEE
-- el módulo Campañas para los KPIs.
--
-- Modelo: una fila = (fuente, campaña externa, día). `campana_ext_id` es el
-- id de la campaña EN la plataforma; '' (vacío, el default) = métricas
-- globales de la fuente (ej. GA4/GSC/Clarity del sitio entero, que no tienen
-- "campaña"). Sentinel '' y NO null a propósito: el unique de upsert es de
-- columnas simples y PostgREST (on_conflict + Prefer resolution=
-- merge-duplicates) no puede apuntar a índices de expresión. `metricas`
-- guarda los números crudos de esa fuente ese día tal como los devuelve su
-- API (jsonb: cada fuente tiene su propio shape y no queremos una migración
-- por cada métrica nueva).
--
-- IDEMPOTENTE Y ADITIVA: create table/index if not exists + drop policy if
-- exists + create. Se puede re-correr sin romper (regla del flujo de deploy:
-- se aplica primero a Kamak-Pruebas y a prod la aplica el Action db-migrate).
--
-- Permisos: lectura con puede_campanas() (0006_campanas.sql). Escritura: NADIE
-- desde el cliente — solo la service key (ver sección 3).
-- ============================================================================


-- ============================================================================
-- 1. Tabla
-- ============================================================================

create table if not exists public.camp_metricas (
  id                 text primary key default gen_random_uuid()::text,
  -- 'instantly' · 'meta_ads' · 'ga4' · 'gsc' · 'gads' · 'clarity'
  fuente             text not null,
  -- id de la campaña EN la plataforma; '' = métricas globales de la fuente
  campana_ext_id     text not null default '',
  campana_ext_nombre text,
  -- link opcional a la lista/campaña interna (camp_listas) para cruzar KPIs
  lista_id           text references public.camp_listas(id),
  fecha              date not null,              -- el día del snapshot/período
  metricas           jsonb not null default '{}'::jsonb,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);


-- ============================================================================
-- 2. Índices
-- ============================================================================

-- UN snapshot por (fuente, campaña externa, día): el sync upsertea idempotente
-- contra este índice vía PostgREST (on_conflict=fuente,campana_ext_id,fecha +
-- Prefer resolution=merge-duplicates). Columnas simples a propósito: PostgREST
-- no puede apuntar a índices de expresión, por eso el sentinel '' (not null)
-- en campana_ext_id — con null, dos snapshots globales no colisionarían.
create unique index if not exists camp_metricas_snapshot_uniq
  on public.camp_metricas (fuente, campana_ext_id, fecha);

-- La lectura típica del módulo: serie temporal de una fuente, reciente primero.
create index if not exists camp_metricas_fuente_fecha_idx
  on public.camp_metricas (fuente, fecha desc);

create index if not exists camp_metricas_lista_id_idx
  on public.camp_metricas (lista_id)
  where lista_id is not null;


-- ============================================================================
-- 3. RLS — solo lectura para quien puede_campanas(); escribe SOLO el sync
-- ----------------------------------------------------------------------------
-- A PROPÓSITO no hay policies de insert/update/delete: ningún usuario (ni
-- Admin) escribe métricas desde el cliente — son espejos de las APIs externas
-- y las escribe únicamente el sync server-side con la service key, que
-- bypassea RLS. Con RLS habilitado y sin policy de escritura, cualquier
-- insert/update/delete desde `authenticated` muere en RLS.
-- ============================================================================
alter table public.camp_metricas enable row level security;
drop policy if exists "camp_metricas_select" on public.camp_metricas;
create policy "camp_metricas_select"
  on public.camp_metricas for select to authenticated using (public.puede_campanas());


-- ============================================================================
-- VERIFICACIÓN (correr después de aplicar)
-- ----------------------------------------------------------------------------
--  Con service key (o SQL editor como postgres) — el upsert del sync:
--    insert into camp_metricas (fuente, campana_ext_id, fecha, metricas)
--      values ('instantly', 'cmp-1', current_date, '{"enviados": 100}')
--      on conflict (fuente, campana_ext_id, fecha)
--      do update set metricas = excluded.metricas, updated_at = now();
--      -> correrlo DOS veces deja UNA sola fila (upsert idempotente). Ídem
--         la métrica global de una fuente (campana_ext_id '', u omitido: el
--         default lo pone), ej.:
--    insert into camp_metricas (fuente, campana_ext_id, fecha, metricas)
--      values ('ga4', '', current_date, '{"sesiones": 42}')
--      on conflict (fuente, campana_ext_id, fecha)
--      do update set metricas = excluded.metricas, updated_at = now();
--      -> la segunda corrida actualiza, no duplica.
--  Como Admin (o usuario con permiso `campanas`):
--    select count(*) from camp_metricas;          -> ok
--    insert into camp_metricas (fuente, fecha) values ('ga4', current_date);
--      -> ERROR RLS (nadie escribe desde el cliente, ni siquiera Admin)
--  Como usuario SIN el permiso:
--    select * from camp_metricas;                 -> 0 rows
-- ============================================================================
