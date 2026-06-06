-- ============================================================================
-- 0004 — portal_otp_codes: SERVER-ONLY (firma electrónica, Fase 3 Comercial)
-- ============================================================================
-- El blob shared_data['portal_otp_codes'] guarda los códigos OTP de la firma de
-- contratos. Aunque van HASHEADOS (scrypt+salt) y nunca en claro, no hay razón
-- para que el browser de un usuario autenticado pueda leerlos. Lo movemos al mismo
-- modelo SERVER-ONLY que afip_* / portal_tokens: sin policy que lo habilite → la
-- RLS deniega todo acceso del cliente; solo la service key (api/portal/*.js) lo
-- lee/escribe.
--
-- Implementación: recreamos las 3 policies "operativas" de 0001_rls.sql agregando
-- la exclusión de 'portal_otp_codes'. Idempotente (drop if exists + create).
-- ============================================================================

drop policy if exists "shared_data_select_operativas" on public.shared_data;
drop policy if exists "shared_data_insert_operativas" on public.shared_data;
drop policy if exists "shared_data_update_operativas" on public.shared_data;

-- Keys operativas = todas menos portal_tokens, portal_otp_codes y las afip_*.
create policy "shared_data_select_operativas"
  on public.shared_data for select to authenticated
  using (key <> 'portal_tokens' and key <> 'portal_otp_codes' and key !~ '^afip_');
create policy "shared_data_insert_operativas"
  on public.shared_data for insert to authenticated
  with check (key <> 'portal_tokens' and key <> 'portal_otp_codes' and key !~ '^afip_');
create policy "shared_data_update_operativas"
  on public.shared_data for update to authenticated
  using (key <> 'portal_tokens' and key <> 'portal_otp_codes' and key !~ '^afip_')
  with check (key <> 'portal_tokens' and key <> 'portal_otp_codes' and key !~ '^afip_');

-- Verificación (como no-Admin desde la app/DevTools):
--   select * from shared_data where key='portal_otp_codes'; -> 0 rows
