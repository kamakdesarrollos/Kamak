-- ============================================================================
-- Kamak — Operaciones de DINERO transaccionales + registro de auditoría
-- ----------------------------------------------------------------------------
-- PROBLEMA (auditoría 2026-07-03): las operaciones de dinero que tocan MÁS DE
-- UNA colección se hacían como escrituras independientes sin transacción:
--   • pagar una factura = movimiento (key 'movimientos') + pago (key
--     'proveedores') — si falla la 2ª, la caja queda debitada y la factura
--     abierta (pasó en prod: pago $405.336 con movimientoId muerto).
--   • confirmar el prorrateo no era idempotente (doble click = gastos dobles).
--   • aprobar un pendiente del bot podía aprobarse dos veces (sin test-and-set).
-- SOLUCIÓN: una función SQL por OPERACIÓN DE NEGOCIO. Cada función valida y
-- escribe TODO en una sola transacción. Las llaman la app (dbHelpers) y el bot
-- (webhook) con fallback al camino viejo si aún no están desplegadas.
--
-- SEGURIDAD: SECURITY INVOKER → la RLS de shared_data sigue aplicando (0001).
-- AUDITORÍA: cada operación deja una fila en public.money_audit (append-only).
--
-- Cómo aplicar: Supabase Studio → SQL Editor → pegar y Run. Idempotente.
-- ============================================================================


-- ============================================================================
-- 0. Registro de auditoría de dinero (append-only)
--    Quién hizo qué operación de dinero y con qué datos. Los admins lo leen;
--    nadie lo edita ni borra desde el cliente (sin policies de update/delete).
-- ============================================================================
create table if not exists public.money_audit (
  id         bigint generated always as identity primary key,
  ts         timestamptz not null default now(),
  actor      text not null default coalesce(
               (select u.email from auth.users u where u.id = auth.uid()), 'service'),
  operacion  text not null,
  detalle    jsonb not null default '{}'::jsonb
);
alter table public.money_audit enable row level security;
drop policy if exists "money_audit_select_admin" on public.money_audit;
create policy "money_audit_select_admin"
  on public.money_audit for select to authenticated using (public.is_admin());
-- insert: solo a través de las funciones de este archivo (grant abajo); el
-- cliente no tiene policy de INSERT directo.

create or replace function public._audit_dinero(p_operacion text, p_detalle jsonb)
returns void language sql security definer set search_path = public as $fn$
  insert into public.money_audit (operacion, detalle, actor)
  values (p_operacion, p_detalle,
          coalesce((select u.email from auth.users u where u.id = auth.uid()), 'service'));
$fn$;
revoke all on function public._audit_dinero(text, jsonb) from public;
grant execute on function public._audit_dinero(text, jsonb) to authenticated;


-- ============================================================================
-- 1. Helper interno: recalcular estado/saldoPendiente de una factura (jsonb).
--    Misma semántica que src/lib/facturasPendientes.js (estado derivado de los
--    pagos; 'anulada' y 'registrada' se respetan tal cual).
-- ============================================================================
create or replace function public._factura_derivar(p_factura jsonb)
returns jsonb language plpgsql as $fn$
declare
  v_monto  numeric := coalesce((p_factura->>'monto')::numeric, 0);
  v_pagado numeric := coalesce((
    select sum(coalesce((p->>'monto')::numeric, 0))
    from jsonb_array_elements(coalesce(p_factura->'pagos', '[]'::jsonb)) p), 0);
  v_saldo  numeric := greatest(0, v_monto - v_pagado);
  v_estado text := p_factura->>'estado';
begin
  if v_estado is distinct from 'anulada' and v_estado is distinct from 'registrada' then
    v_estado := case when v_saldo <= 1 then 'pagada'
                     when v_pagado > 0 then 'parcial'
                     else 'pendiente' end;
  end if;
  return p_factura || jsonb_build_object('estado', v_estado, 'saldoPendiente', round(v_saldo));
end;
$fn$;


-- ============================================================================
-- 2. registrar_pago_factura — EL circuito de órdenes de pago, atómico.
--    Agrega el movimiento de caja Y el pago en la factura en UNA transacción.
--    • p_mov: movimiento completo (con id 'mov-...' generado por el caller).
--    • p_factura_id / p_pago: opcionales (null = pago suelto / anticipo).
--    Validaciones: idempotencia por id de movimiento; factura abierta; el pago
--    no excede el saldo (tolerancia $1) — el excedente se registra aparte como
--    anticipo (mov con anticipo:true), nunca "tragado".
-- ============================================================================
create or replace function public.registrar_pago_factura(
  p_mov jsonb, p_factura_id text default null, p_pago jsonb default null
) returns jsonb language plpgsql as $fn$
declare
  v_mov_id   text := p_mov->>'id';
  v_factura  jsonb;
  v_saldo    numeric;
  v_monto    numeric := coalesce((p_pago->>'monto')::numeric, 0);
  v_estado   text;
begin
  if v_mov_id is null or v_mov_id = '' then
    raise exception 'registrar_pago_factura: p_mov.id requerido';
  end if;

  -- fila base si la key no existía (fix del hueco UPDATE-only de 0002/0003)
  insert into public.shared_data (key, data)
  values ('movimientos', '{"cajas": [], "movimientos": []}'::jsonb)
  on conflict (key) do nothing;

  -- Idempotencia: si el movimiento ya existe, no repetir (reintento de red/bot).
  if exists (
    select 1 from public.shared_data sd,
      jsonb_array_elements(coalesce(sd.data->'movimientos', '[]'::jsonb)) m
    where sd.key = 'movimientos' and m->>'id' = v_mov_id
  ) then
    return jsonb_build_object('ok', true, 'idempotente', true);
  end if;

  if p_factura_id is not null then
    select f into v_factura
    from public.shared_data sd,
      jsonb_array_elements(coalesce(sd.data->'facturasPendientes', '[]'::jsonb)) f
    where sd.key = 'proveedores' and f->>'id' = p_factura_id;
    if v_factura is null then
      raise exception 'registrar_pago_factura: factura % no existe', p_factura_id;
    end if;
    v_estado := (public._factura_derivar(v_factura))->>'estado';
    if v_estado in ('anulada', 'registrada', 'pagada') then
      raise exception 'registrar_pago_factura: la factura % está % y no admite pagos', p_factura_id, v_estado;
    end if;
    v_saldo := greatest(0, coalesce((v_factura->>'monto')::numeric, 0) - coalesce((
      select sum(coalesce((p->>'monto')::numeric, 0))
      from jsonb_array_elements(coalesce(v_factura->'pagos', '[]'::jsonb)) p), 0));
    if v_monto > v_saldo + 1 then
      raise exception 'registrar_pago_factura: el pago $% excede el saldo $% de la factura %', v_monto, v_saldo, p_factura_id;
    end if;
  end if;

  -- 1) movimiento de caja
  update public.shared_data sd
  set data = jsonb_set(sd.data, '{movimientos}',
        jsonb_build_array(p_mov) || coalesce(sd.data->'movimientos', '[]'::jsonb), true),
      updated_at = now()
  where sd.key = 'movimientos';

  -- 2) pago en la factura + estado/saldo derivados
  if p_factura_id is not null then
    update public.shared_data sd
    set data = jsonb_set(sd.data, '{facturasPendientes}',
          (select jsonb_agg(
             case when f->>'id' = p_factura_id
               then public._factura_derivar(
                      jsonb_set(f, '{pagos}',
                        coalesce(f->'pagos', '[]'::jsonb) ||
                        (p_pago || jsonb_build_object('movimientoId', v_mov_id))))
               else f end)
           from jsonb_array_elements(coalesce(sd.data->'facturasPendientes', '[]'::jsonb)) f),
          true),
        updated_at = now()
    where sd.key = 'proveedores';
  end if;

  perform public._audit_dinero('registrar_pago_factura', jsonb_build_object(
    'movimientoId', v_mov_id, 'facturaId', p_factura_id, 'monto', p_mov->>'monto',
    'cajaId', p_mov->>'cajaId', 'proveedor', p_mov->>'proveedor', 'anticipo', p_mov->'anticipo'));
  return jsonb_build_object('ok', true);
end;
$fn$;
grant execute on function public.registrar_pago_factura(jsonb, text, jsonb) to authenticated;


-- ============================================================================
-- 3. aplicar_credito_factura — consume crédito a favor contra una factura.
--    NO mueve caja: agrega un pago {tipo:'credito'} y deriva estado/saldo.
--    (La suficiencia del crédito la valida la app — lib/proveedorCC; acá se
--    valida factura abierta y monto ≤ saldo para que nunca quede sobrepagada.)
-- ============================================================================
create or replace function public.aplicar_credito_factura(
  p_factura_id text, p_pago jsonb
) returns jsonb language plpgsql as $fn$
declare
  v_factura jsonb;
  v_saldo   numeric;
  v_monto   numeric := coalesce((p_pago->>'monto')::numeric, 0);
  v_estado  text;
begin
  select f into v_factura
  from public.shared_data sd,
    jsonb_array_elements(coalesce(sd.data->'facturasPendientes', '[]'::jsonb)) f
  where sd.key = 'proveedores' and f->>'id' = p_factura_id;
  if v_factura is null then
    raise exception 'aplicar_credito_factura: factura % no existe', p_factura_id;
  end if;
  v_estado := (public._factura_derivar(v_factura))->>'estado';
  if v_estado not in ('pendiente', 'parcial') then
    raise exception 'aplicar_credito_factura: la factura % está %', p_factura_id, v_estado;
  end if;
  v_saldo := greatest(0, coalesce((v_factura->>'monto')::numeric, 0) - coalesce((
    select sum(coalesce((p->>'monto')::numeric, 0))
    from jsonb_array_elements(coalesce(v_factura->'pagos', '[]'::jsonb)) p), 0));
  if v_monto <= 0 or v_monto > v_saldo + 1 then
    raise exception 'aplicar_credito_factura: monto $% inválido (saldo $%)', v_monto, v_saldo;
  end if;

  update public.shared_data sd
  set data = jsonb_set(sd.data, '{facturasPendientes}',
        (select jsonb_agg(
           case when f->>'id' = p_factura_id
             then public._factura_derivar(
                    jsonb_set(f, '{pagos}',
                      coalesce(f->'pagos', '[]'::jsonb) ||
                      (p_pago || jsonb_build_object('tipo', 'credito'))))
             else f end)
         from jsonb_array_elements(coalesce(sd.data->'facturasPendientes', '[]'::jsonb)) f),
        true),
      updated_at = now()
  where sd.key = 'proveedores';

  perform public._audit_dinero('aplicar_credito_factura',
    jsonb_build_object('facturaId', p_factura_id, 'monto', v_monto));
  return jsonb_build_object('ok', true);
end;
$fn$;
grant execute on function public.aplicar_credito_factura(text, jsonb) to authenticated;


-- ============================================================================
-- 4. confirmar_prorrateo — idempotente por mes.
--    Aborta si YA existen movimientos de categoría 'prorrateo' en ese mes
--    (doble click / dos admins el mismo mes = el bug de gastos duplicados).
-- ============================================================================
create or replace function public.confirmar_prorrateo(
  p_mes text, p_movs jsonb  -- p_mes 'YYYY-MM'; p_movs = array de movimientos
) returns jsonb language plpgsql as $fn$
begin
  if p_mes is null or p_mes !~ '^\d{4}-\d{2}$' then
    raise exception 'confirmar_prorrateo: p_mes debe ser YYYY-MM';
  end if;
  if exists (
    select 1 from public.shared_data sd,
      jsonb_array_elements(coalesce(sd.data->'movimientos', '[]'::jsonb)) m
    where sd.key = 'movimientos'
      and m->>'categoria' = 'prorrateo'
      and coalesce(m->>'fecha', '') like p_mes || '%'
  ) then
    raise exception 'confirmar_prorrateo: el prorrateo de % ya fue confirmado', p_mes;
  end if;

  insert into public.shared_data (key, data)
  values ('movimientos', '{"cajas": [], "movimientos": []}'::jsonb)
  on conflict (key) do nothing;

  update public.shared_data sd
  set data = jsonb_set(sd.data, '{movimientos}',
        p_movs || coalesce(sd.data->'movimientos', '[]'::jsonb), true),
      updated_at = now()
  where sd.key = 'movimientos';

  perform public._audit_dinero('confirmar_prorrateo',
    jsonb_build_object('mes', p_mes, 'cantidad', jsonb_array_length(p_movs)));
  return jsonb_build_object('ok', true);
end;
$fn$;
grant execute on function public.confirmar_prorrateo(text, jsonb) to authenticated;


-- ============================================================================
-- 5. aprobar_pendiente_atomico — test-and-set del buzón del bot.
--    Solo aprueba si el ítem sigue 'pending'; marca 'confirmed' y agrega el
--    movimiento en la MISMA transacción. Reintentos y carreras chat↔app dejan
--    de duplicar movimientos.
-- ============================================================================
create or replace function public.aprobar_pendiente_atomico(
  p_item_id text, p_mov jsonb, p_resuelto_por text default null
) returns jsonb language plpgsql as $fn$
declare
  v_item jsonb;
begin
  select i into v_item
  from public.shared_data sd,
    jsonb_array_elements(coalesce(sd.data, '[]'::jsonb)) i
  where sd.key = 'whatsapp_pending' and i->>'id' = p_item_id;
  if v_item is null then
    raise exception 'aprobar_pendiente: ítem % no existe', p_item_id;
  end if;
  if coalesce(v_item->>'status', 'pending') <> 'pending' then
    raise exception 'aprobar_pendiente: ítem % ya está %', p_item_id, v_item->>'status';
  end if;

  update public.shared_data sd
  set data = (
        select jsonb_agg(
          case when i->>'id' = p_item_id
            then i || jsonb_build_object('status', 'confirmed',
                   'resolvedAt', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                   'resolvedBy', coalesce(p_resuelto_por, 'app'))
            else i end)
        from jsonb_array_elements(coalesce(sd.data, '[]'::jsonb)) i),
      updated_at = now()
  where sd.key = 'whatsapp_pending';

  insert into public.shared_data (key, data)
  values ('movimientos', '{"cajas": [], "movimientos": []}'::jsonb)
  on conflict (key) do nothing;

  update public.shared_data sd
  set data = jsonb_set(sd.data, '{movimientos}',
        jsonb_build_array(p_mov) || coalesce(sd.data->'movimientos', '[]'::jsonb), true),
      updated_at = now()
  where sd.key = 'movimientos';

  perform public._audit_dinero('aprobar_pendiente', jsonb_build_object(
    'itemId', p_item_id, 'movimientoId', p_mov->>'id', 'monto', p_mov->>'monto'));
  return jsonb_build_object('ok', true);
end;
$fn$;
grant execute on function public.aprobar_pendiente_atomico(text, jsonb, text) to authenticated;


-- ============================================================================
-- 6. Fix del hueco UPDATE-only en las RPC de 0002/0003: los APPEND ahora crean
--    la fila base si la key no existe (antes devolvían éxito sin escribir NADA
--    y el primer ítem de una key fresca podía perderse).
-- ============================================================================
create or replace function public.append_shared_object_item(
  p_key text, p_collection text, p_item jsonb
) returns void language plpgsql as $fn$
begin
  insert into public.shared_data (key, data) values (p_key, '{}'::jsonb)
  on conflict (key) do nothing;
  update public.shared_data sd
  set data = jsonb_set(
        coalesce(sd.data, '{}'::jsonb), array[p_collection],
        coalesce(sd.data -> p_collection, '[]'::jsonb) || p_item,
        true),
      updated_at = now()
  where sd.key = p_key;
end;
$fn$;

create or replace function public.append_item_in_shared_array(
  p_key text, p_item jsonb
) returns void language plpgsql as $fn$
begin
  insert into public.shared_data (key, data) values (p_key, '[]'::jsonb)
  on conflict (key) do nothing;
  update public.shared_data sd
  set data = coalesce(sd.data, '[]'::jsonb) || jsonb_build_array(p_item),
      updated_at = now()
  where sd.key = p_key;
end;
$fn$;

-- (el append del bot 'append_to_shared_array' agrega AL PRINCIPIO — mismo fix)
create or replace function public.append_to_shared_array(
  p_key text, p_item jsonb
) returns void language plpgsql as $fn$
begin
  insert into public.shared_data (key, data) values (p_key, '[]'::jsonb)
  on conflict (key) do nothing;
  update public.shared_data sd
  set data = jsonb_build_array(p_item) || coalesce(sd.data, '[]'::jsonb),
      updated_at = now()
  where sd.key = p_key;
end;
$fn$;

grant execute on function public.append_shared_object_item(text, text, jsonb) to authenticated;
grant execute on function public.append_item_in_shared_array(text, jsonb) to authenticated;
grant execute on function public.append_to_shared_array(text, jsonb) to authenticated;


-- ============================================================================
-- VERIFICACIÓN (correr después de aplicar):
--   select proname from pg_proc where proname in
--     ('registrar_pago_factura','aplicar_credito_factura','confirmar_prorrateo',
--      'aprobar_pendiente_atomico','_factura_derivar','_audit_dinero');  -- 6 filas
--   select * from money_audit order by id desc limit 5;  -- como Admin
--
-- ROLLBACK:
--   drop function if exists public.registrar_pago_factura(jsonb, text, jsonb);
--   drop function if exists public.aplicar_credito_factura(text, jsonb);
--   drop function if exists public.confirmar_prorrateo(text, jsonb);
--   drop function if exists public.aprobar_pendiente_atomico(text, jsonb, text);
--   drop function if exists public._factura_derivar(jsonb);
--   drop function if exists public._audit_dinero(text, jsonb);
--   drop table if exists public.money_audit;
--   -- (los appends de la sección 6 pueden quedar: son estrictamente mejores)
-- ============================================================================
