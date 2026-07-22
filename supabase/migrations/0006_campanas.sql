-- ============================================================================
-- Kamak — Módulo Campañas (Fase 1): schema + índices + RLS
-- ----------------------------------------------------------------------------
-- Base real de contactos de la campaña a estaciones de servicio, con el modelo
-- Estación → Operador (unidad de contacto) → Decisor. Tablas Postgres reales
-- (NO shared_data/JSONB) para escalar a ~4.070 estaciones con paginación
-- server-side desde el frontend.
--
-- IDEMPOTENTE Y ADITIVA: create table/index if not exists + drop policy if
-- exists + create. Se puede re-correr sin romper (regla del flujo de deploy:
-- se aplica primero a Kamak-Pruebas y a prod la aplica el Action db-migrate).
--
-- Permisos: helper `puede_campanas()` (patrón is_admin() de 0001_rls.sql):
-- Admin o usuarios con permisos->>'campanas' = 'true' (ej. Carolina, que SOLO
-- ve este módulo — P11: nada de obras ni montos). Delete: solo Admin.
-- ============================================================================


-- ============================================================================
-- 1. Tablas
-- ============================================================================

-- Operador: la unidad de CONTACTO y anti-colisión. Un operador maneja N
-- estaciones; las tratativas (owner + canal) viven acá para que nadie lo
-- toque por otro canal mientras está en conversación (P6).
create table if not exists public.camp_operadores (
  id                text primary key default gen_random_uuid()::text,
  nombre            text,
  nombre_norm       text,                       -- clave de dedup (nombre normalizado)
  razones_sociales  text[],
  banderas          text[],
  multibandera      boolean,
  n_estaciones      integer,
  web               text,
  emails            text[],
  notas             text,
  -- anti-colisión (P6): si en_tratativas, solo owner_user_id (o Admin) lo toca
  owner_user_id     text,
  canal_activo      text,
  en_tratativas     boolean default false,
  -- pre-embudo kanban: sin_contactar · contactado · respondio · en_conversacion
  -- · reunion · promovido · descartado
  etapa_prospeccion text default 'sin_contactar',
  -- promoción al embudo real: link a cliente + obra esLead (patrón Pipeline)
  cliente_id        text,
  obra_id           text,
  confianza         text,
  verificado        boolean default false,
  prioridad         text,
  datos             jsonb default '{}'::jsonb,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- Estación: la unidad de OPORTUNIDAD de obra (bandera, APIES, tipo tienda,
-- teléfono). El estado de llamada vive acá (lo trabaja Carolina).
create table if not exists public.camp_estaciones (
  id              text primary key default gen_random_uuid()::text,
  operador_id     text references public.camp_operadores(id),
  bandera         text,
  nombre          text,
  direccion       text,
  localidad       text,
  provincia       text,
  apies           text,
  tipo_tienda     text,
  telefono        text,
  telefono_norm   text,                          -- E.164 normalizado (dedup)
  email           text,
  web             text,
  -- estado canónico + lo que escribió Caro (se preserva SIEMPRE, P9)
  estado_llamada  text default 'SIN LLAMAR',
  estado_original text,
  telefono_fijo   boolean default false,
  decisor_nombre  text,
  decisor_email   text,
  proximo_paso    text,
  datos           jsonb default '{}'::jsonb,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Decisor: la persona (cargo, LinkedIn único, email, confianza/verificado).
create table if not exists public.camp_decisores (
  id               text primary key default gen_random_uuid()::text,
  operador_id      text references public.camp_operadores(id),
  nombre           text,
  cargo            text,
  linkedin_url     text,                         -- único (índice parcial abajo)
  linkedin_empresa text,
  email            text,
  telefono         text,
  confianza        text,
  verificado       boolean,
  prioridad        text,
  fuente           text,
  lista_salesnav   text,
  datos            jsonb default '{}'::jsonb,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- Lista/campaña (Kamak-Shell, secuencia email, lista SalesNav, etc.).
create table if not exists public.camp_listas (
  id            text primary key default gen_random_uuid()::text,
  nombre        text,
  canal         text,
  tipo          text,
  descripcion   text,
  costo_mensual numeric,
  activa        boolean default true,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Pertenencia a una lista con estado por miembro (decisor U operador).
create table if not exists public.camp_lista_miembros (
  id            text primary key default gen_random_uuid()::text,
  lista_id      text references public.camp_listas(id),
  decisor_id    text references public.camp_decisores(id),
  operador_id   text references public.camp_operadores(id),
  estado        text default 'pendiente',
  enviado_at    timestamptz,
  respondido_at timestamptz,
  datos         jsonb default '{}'::jsonb,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Actividad: TODA la trazabilidad (llamada/email/linkedin/whatsapp/nota/
-- cambio de estado/import) con usuario, canal y resultado.
-- Refs nullable a propósito: una actividad puede colgar de operador, decisor,
-- estación y/o lista según el evento (sin FK para permitir imports masivos
-- y actividades globales, ej. un import run).
create table if not exists public.camp_actividades (
  id          text primary key default gen_random_uuid()::text,
  operador_id text,
  decisor_id  text,
  estacion_id text,
  lista_id    text,
  tipo        text not null,
  canal       text,
  resultado   text,
  texto       text,
  usuario     text,
  fecha       timestamptz default now(),
  datos       jsonb default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Auditoría de cada import (archivo, stats, usuario).
create table if not exists public.camp_import_runs (
  id         text primary key default gen_random_uuid()::text,
  archivo    text,
  tipo       text,
  resumen    jsonb default '{}'::jsonb,
  usuario    text,
  fecha      timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);


-- ============================================================================
-- 2. Índices
-- ============================================================================

create index if not exists camp_estaciones_operador_id_idx
  on public.camp_estaciones (operador_id);

create index if not exists camp_estaciones_telefono_norm_idx
  on public.camp_estaciones (telefono_norm);

-- LinkedIn URL única cuando existe (dedup de decisores por perfil).
create unique index if not exists camp_decisores_linkedin_url_uniq
  on public.camp_decisores (linkedin_url)
  where linkedin_url is not null;

create index if not exists camp_decisores_operador_id_idx
  on public.camp_decisores (operador_id);

-- Timeline de un operador: sus actividades más recientes primero.
create index if not exists camp_actividades_operador_fecha_idx
  on public.camp_actividades (operador_id, fecha desc);

create index if not exists camp_lista_miembros_lista_id_idx
  on public.camp_lista_miembros (lista_id);


-- ============================================================================
-- 3. Helper: ¿el usuario actual puede usar el módulo Campañas?
-- Patrón is_admin() (0001_rls.sql): SECURITY DEFINER para que la consulta a
-- app_users NO re-dispare RLS. True si es Admin o tiene el permiso `campanas`.
-- ============================================================================
create or replace function public.puede_campanas()
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
      and (au.rol = 'Admin' or au.permisos->>'campanas' = 'true')
  );
$$;

revoke all on function public.puede_campanas() from public;
grant execute on function public.puede_campanas() to authenticated;


-- ============================================================================
-- 4. RLS — select/insert/update para quien puede_campanas(); delete solo Admin
-- ============================================================================

-- camp_operadores
alter table public.camp_operadores enable row level security;
drop policy if exists "camp_operadores_select" on public.camp_operadores;
drop policy if exists "camp_operadores_insert" on public.camp_operadores;
drop policy if exists "camp_operadores_update" on public.camp_operadores;
drop policy if exists "camp_operadores_delete" on public.camp_operadores;
create policy "camp_operadores_select"
  on public.camp_operadores for select to authenticated using (public.puede_campanas());
create policy "camp_operadores_insert"
  on public.camp_operadores for insert to authenticated with check (public.puede_campanas());
create policy "camp_operadores_update"
  on public.camp_operadores for update to authenticated using (public.puede_campanas()) with check (public.puede_campanas());
create policy "camp_operadores_delete"
  on public.camp_operadores for delete to authenticated using (public.is_admin());

-- camp_estaciones
alter table public.camp_estaciones enable row level security;
drop policy if exists "camp_estaciones_select" on public.camp_estaciones;
drop policy if exists "camp_estaciones_insert" on public.camp_estaciones;
drop policy if exists "camp_estaciones_update" on public.camp_estaciones;
drop policy if exists "camp_estaciones_delete" on public.camp_estaciones;
create policy "camp_estaciones_select"
  on public.camp_estaciones for select to authenticated using (public.puede_campanas());
create policy "camp_estaciones_insert"
  on public.camp_estaciones for insert to authenticated with check (public.puede_campanas());
create policy "camp_estaciones_update"
  on public.camp_estaciones for update to authenticated using (public.puede_campanas()) with check (public.puede_campanas());
create policy "camp_estaciones_delete"
  on public.camp_estaciones for delete to authenticated using (public.is_admin());

-- camp_decisores
alter table public.camp_decisores enable row level security;
drop policy if exists "camp_decisores_select" on public.camp_decisores;
drop policy if exists "camp_decisores_insert" on public.camp_decisores;
drop policy if exists "camp_decisores_update" on public.camp_decisores;
drop policy if exists "camp_decisores_delete" on public.camp_decisores;
create policy "camp_decisores_select"
  on public.camp_decisores for select to authenticated using (public.puede_campanas());
create policy "camp_decisores_insert"
  on public.camp_decisores for insert to authenticated with check (public.puede_campanas());
create policy "camp_decisores_update"
  on public.camp_decisores for update to authenticated using (public.puede_campanas()) with check (public.puede_campanas());
create policy "camp_decisores_delete"
  on public.camp_decisores for delete to authenticated using (public.is_admin());

-- camp_listas
alter table public.camp_listas enable row level security;
drop policy if exists "camp_listas_select" on public.camp_listas;
drop policy if exists "camp_listas_insert" on public.camp_listas;
drop policy if exists "camp_listas_update" on public.camp_listas;
drop policy if exists "camp_listas_delete" on public.camp_listas;
create policy "camp_listas_select"
  on public.camp_listas for select to authenticated using (public.puede_campanas());
create policy "camp_listas_insert"
  on public.camp_listas for insert to authenticated with check (public.puede_campanas());
create policy "camp_listas_update"
  on public.camp_listas for update to authenticated using (public.puede_campanas()) with check (public.puede_campanas());
create policy "camp_listas_delete"
  on public.camp_listas for delete to authenticated using (public.is_admin());

-- camp_lista_miembros
alter table public.camp_lista_miembros enable row level security;
drop policy if exists "camp_lista_miembros_select" on public.camp_lista_miembros;
drop policy if exists "camp_lista_miembros_insert" on public.camp_lista_miembros;
drop policy if exists "camp_lista_miembros_update" on public.camp_lista_miembros;
drop policy if exists "camp_lista_miembros_delete" on public.camp_lista_miembros;
create policy "camp_lista_miembros_select"
  on public.camp_lista_miembros for select to authenticated using (public.puede_campanas());
create policy "camp_lista_miembros_insert"
  on public.camp_lista_miembros for insert to authenticated with check (public.puede_campanas());
create policy "camp_lista_miembros_update"
  on public.camp_lista_miembros for update to authenticated using (public.puede_campanas()) with check (public.puede_campanas());
create policy "camp_lista_miembros_delete"
  on public.camp_lista_miembros for delete to authenticated using (public.is_admin());

-- camp_actividades
alter table public.camp_actividades enable row level security;
drop policy if exists "camp_actividades_select" on public.camp_actividades;
drop policy if exists "camp_actividades_insert" on public.camp_actividades;
drop policy if exists "camp_actividades_update" on public.camp_actividades;
drop policy if exists "camp_actividades_delete" on public.camp_actividades;
create policy "camp_actividades_select"
  on public.camp_actividades for select to authenticated using (public.puede_campanas());
create policy "camp_actividades_insert"
  on public.camp_actividades for insert to authenticated with check (public.puede_campanas());
create policy "camp_actividades_update"
  on public.camp_actividades for update to authenticated using (public.puede_campanas()) with check (public.puede_campanas());
create policy "camp_actividades_delete"
  on public.camp_actividades for delete to authenticated using (public.is_admin());

-- camp_import_runs
alter table public.camp_import_runs enable row level security;
drop policy if exists "camp_import_runs_select" on public.camp_import_runs;
drop policy if exists "camp_import_runs_insert" on public.camp_import_runs;
drop policy if exists "camp_import_runs_update" on public.camp_import_runs;
drop policy if exists "camp_import_runs_delete" on public.camp_import_runs;
create policy "camp_import_runs_select"
  on public.camp_import_runs for select to authenticated using (public.puede_campanas());
create policy "camp_import_runs_insert"
  on public.camp_import_runs for insert to authenticated with check (public.puede_campanas());
create policy "camp_import_runs_update"
  on public.camp_import_runs for update to authenticated using (public.puede_campanas()) with check (public.puede_campanas());
create policy "camp_import_runs_delete"
  on public.camp_import_runs for delete to authenticated using (public.is_admin());


-- ============================================================================
-- VERIFICACIÓN (correr después de aplicar)
-- ----------------------------------------------------------------------------
--  Como Admin:                    select public.puede_campanas();  -> true
--                                 select count(*) from camp_operadores; -> ok
--  Como usuario con permiso `campanas` (ej. Carolina):
--                                 select public.puede_campanas();  -> true
--                                 insert/update en camp_* -> ok; delete -> ERROR RLS
--  Como usuario SIN el permiso:   select * from camp_operadores;   -> 0 rows
-- ============================================================================
