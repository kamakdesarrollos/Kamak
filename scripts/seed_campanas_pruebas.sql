-- ============================================================================
-- Seed de datos TRUCHOS del mÃ³dulo CampaÃ±as para Kamak-Pruebas.
-- âš ï¸ SOLO PRUEBAS: se aplica vÃ­a .github/workflows/db-pruebas.yml (ref de
-- pruebas hardcodeado). Idempotente: ids fijos op_seed_*/est_seed_*/... con
-- ON CONFLICT DO NOTHING â€” se puede re-correr sin duplicar.
-- Nombres obviamente falsos ("Trucho") para que nadie los confunda con reales.
-- ============================================================================

-- 60 operadores repartidos en banderas/etapas/confianzas
insert into camp_operadores (id, nombre, nombre_norm, razones_sociales, banderas, multibandera, n_estaciones, web, emails, notas, etapa_prospeccion, confianza, verificado, prioridad, datos)
select
  'op_seed_' || lpad(i::text, 3, '0'),
  'Operador Trucho ' || lpad(i::text, 3, '0') || ' ' || (array['SA','SRL','SAS','Coop'])[1 + i % 4],
  'operador trucho ' || lpad(i::text, 3, '0'),
  array['Operador Trucho ' || lpad(i::text, 3, '0')],
  case
    when i % 11 = 0 then array['YPF','Shell']
    else array[(array['YPF','Shell','Axion','Puma','ACA','Gulf','Refinor'])[1 + i % 7]]
  end,
  (i % 11 = 0),
  1 + i % 4,
  case when i % 3 = 0 then 'https://trucho' || i || '.example.com' end,
  case when i % 2 = 0 then array['contacto' || i || '@trucho.example.com'] else array[]::text[] end,
  case when i % 5 = 0 then 'Nota de ejemplo del operador ' || i end,
  (array['sin_contactar','sin_contactar','sin_contactar','contactado','contactado','respondio','en_conversacion','reunion','promovido','descartado'])[1 + i % 10],
  (array['alta','media','media','baja'])[1 + i % 4],
  (i % 3 = 0),
  case when i % 7 = 0 then 'alta' end,
  '{"seed":true}'::jsonb
from generate_series(1, 60) i
on conflict (id) do nothing;

-- Anti-colisiÃ³n de ejemplo: 3 operadores "en tratativas" con Franco
update camp_operadores set
  en_tratativas = true,
  owner_user_id = (select id::text from app_users where lower(email) = 'fgeespinoza@gmail.com' limit 1),
  canal_activo = (array['linkedin','email','llamada'])[1 + (case id when 'op_seed_007' then 0 when 'op_seed_014' then 1 else 2 end)]
where id in ('op_seed_007', 'op_seed_014', 'op_seed_021')
  and owner_user_id is null;

-- 120 estaciones (2 por operador)
insert into camp_estaciones (id, operador_id, bandera, nombre, direccion, localidad, provincia, apies, tipo_tienda, telefono, telefono_norm, email, estado_llamada, estado_original, telefono_fijo, decisor_nombre, decisor_email, proximo_paso, datos)
select
  'est_seed_' || lpad(i::text, 3, '0'),
  'op_seed_' || lpad((1 + (i - 1) % 60)::text, 3, '0'),
  (array['YPF','Shell','Axion','Puma','ACA','Gulf','Refinor'])[1 + ((1 + (i - 1) % 60) % 7)],
  'EstaciÃ³n Trucha ' || (array['Norte','Sur','Centro','Ruta'])[1 + i % 4] || ' ' || lpad(i::text, 3, '0'),
  'Av. Siempreviva Falsa ' || (100 + i * 7),
  (array['Necochea','Quilmes','BahÃ­a Blanca','CÃ³rdoba','Rosario','Mendoza','San Justo','Tandil'])[1 + i % 8],
  (array['Buenos Aires','Buenos Aires','Buenos Aires','CÃ³rdoba','Santa Fe','Mendoza','Buenos Aires','Buenos Aires'])[1 + i % 8],
  case when 1 + ((1 + (i - 1) % 60) % 7) = 1 then 'APIES-TRUCHO-' || i end,
  (array['FULL','FULL NUEVA IMAGEN','SERVICOMPRAS','SIN TIENDA','MINIMERCADO'])[1 + i % 5],
  '02262-15-' || (400000 + i * 137),
  '549226215' || lpad((400000 + i * 137)::text, 6, '0'),
  case when i % 3 = 0 then 'estacion' || i || '@trucho.example.com' end,
  (array['SIN LLAMAR','SIN LLAMAR','SIN LLAMAR','NO ATIENDE','VOLVER A LLAMAR','PASÃ“ MAIL','PASÃ“ WHATSAPP','DECISOR IDENTIFICADO','NO INTERESA','LEAD CALIENTE','FUERA DE SERVICIO'])[1 + i % 11],
  case when i % 4 = 0 then (array['me paso el mail','NUMERO EQUIVOCADO','volver a llamar 15hs','TELEFONO FIJO'])[1 + i % 4] end,
  (i % 9 = 0),
  case when i % 6 = 0 then 'Decisor Trucho ' || i end,
  case when i % 6 = 0 then 'decisor' || i || '@trucho.example.com' end,
  case when i % 8 = 0 then 'Mandar propuesta la semana que viene' end,
  '{"seed":true}'::jsonb
from generate_series(1, 120) i
on conflict (id) do nothing;

-- 50 decisores (en los primeros 50 operadores)
insert into camp_decisores (id, operador_id, nombre, cargo, linkedin_url, email, confianza, verificado, prioridad, fuente, lista_salesnav, datos)
select
  'dec_seed_' || lpad(i::text, 3, '0'),
  'op_seed_' || lpad(i::text, 3, '0'),
  (array['Juan','MarÃ­a','Carlos','LucÃ­a','Pedro','SofÃ­a','Diego','Ana'])[1 + i % 8] || ' ' ||
  (array['Trucho','Fictini','Demozzi','Pruebalez','Ejemplar'])[1 + i % 5],
  (array['DueÃ±o','Gerente de Operaciones','Resp. ExpansiÃ³n','Jefa de Tiendas','Socio Gerente'])[1 + i % 5],
  case when i % 3 <> 0 then 'https://linkedin.com/in/trucho-' || lpad(i::text, 3, '0') end,
  case when i % 2 = 0 then 'decisor' || i || '@trucho.example.com' end,
  (array['alta','media','baja'])[1 + i % 3],
  (i % 3 = 0),
  case when i % 10 = 0 then 'alta' end,
  (array['SalesNavigator','Llamada','Planilla','LinkedIn'])[1 + i % 4],
  case when i % 3 <> 0 then 'Kamak-' || (array['YPF','Shell','Axion','Puma','ACA'])[1 + i % 5] end,
  '{"seed":true}'::jsonb
from generate_series(1, 50) i
on conflict (id) do nothing;

-- 4 listas de campaÃ±a
insert into camp_listas (id, nombre, canal, tipo, descripcion, costo_mensual, activa) values
  ('lst_seed_001', 'Kamak-Shell (trucha)',        'linkedin', 'salesnav',  'Lista de prueba Shell',              0,     true),
  ('lst_seed_002', 'Kamak-Axion (trucha)',        'linkedin', 'salesnav',  'Lista de prueba Axion',              0,     true),
  ('lst_seed_003', 'Cold email YPF+ACA (trucha)', 'email',    'secuencia', 'Secuencia de emails de prueba',      37,    true),
  ('lst_seed_004', 'Meta CTWA Julio (trucha)',    'whatsapp', 'ads',       'CampaÃ±a de anuncios de prueba',      150,   true)
on conflict (id) do nothing;

-- Miembros de listas (40): decisores en listas LinkedIn, operadores en email
insert into camp_lista_miembros (id, lista_id, decisor_id, operador_id, estado, enviado_at, respondido_at, datos)
select
  'lm_seed_' || lpad(i::text, 3, '0'),
  case when i <= 15 then 'lst_seed_001' when i <= 28 then 'lst_seed_002' else 'lst_seed_003' end,
  case when i <= 28 then 'dec_seed_' || lpad(i::text, 3, '0') end,
  case when i > 28 then 'op_seed_' || lpad(i::text, 3, '0') end,
  (array['pendiente','enviado','enviado','respondio','enviado'])[1 + i % 5],
  case when i % 5 <> 0 then now() - (i || ' days')::interval end,
  case when i % 5 = 3 then now() - ((i - 2) || ' days')::interval end,
  '{"seed":true}'::jsonb
from generate_series(1, 40) i
on conflict (id) do nothing;

-- ~300 actividades de las Ãºltimas 8 semanas, variadas por canal/tipo
insert into camp_actividades (id, operador_id, decisor_id, estacion_id, lista_id, tipo, canal, resultado, texto, usuario, fecha, datos)
select
  'act_seed_' || lpad(i::text, 4, '0'),
  'op_seed_' || lpad((1 + i % 60)::text, 3, '0'),
  case when i % 3 = 0 and (1 + i % 60) <= 50 then 'dec_seed_' || lpad((1 + i % 60)::text, 3, '0') end,
  case when i % 4 = 0 then 'est_seed_' || lpad((1 + i % 120)::text, 3, '0') end,
  case when i % 6 = 0 then (array['lst_seed_001','lst_seed_002','lst_seed_003','lst_seed_004'])[1 + i % 4] end,
  (array['llamada','llamada','llamada','email','linkedin_contactado','linkedin_respondio','whatsapp','nota','cambio_etapa','reunion'])[1 + i % 10],
  (array['llamada','llamada','llamada','email','linkedin','linkedin','whatsapp','otro','otro','presencial'])[1 + i % 10],
  case when 1 + i % 10 <= 3 then (array['SIN LLAMAR','NO ATIENDE','VOLVER A LLAMAR','PASÃ“ MAIL','PASÃ“ WHATSAPP','DECISOR IDENTIFICADO','NO INTERESA','LEAD CALIENTE'])[1 + i % 8] end,
  'Actividad de prueba #' || i,
  case when 1 + i % 10 <= 3
    then coalesce((select id::text from app_users where lower(email) = 'admkamakdesarrollos@gmail.com' limit 1), 'seed')
    else coalesce((select id::text from app_users where lower(email) = 'fgeespinoza@gmail.com' limit 1), 'seed')
  end,
  now() - (i * 4 || ' hours')::interval,
  '{"seed":true}'::jsonb
from generate_series(1, 300) i
on conflict (id) do nothing;

-- Un import run de ejemplo para el historial del importador
insert into camp_import_runs (id, archivo, tipo, resumen, usuario, fecha) values
  ('imp_seed_001', 'Kamak_Estaciones_Unificado_TRUCHO.xlsx', 'unificado',
   '{"nuevos":{"operadores":60,"estaciones":120,"decisores":50},"actualizados":0,"salteados":0,"errores":[]}'::jsonb,
   'seed', now() - interval '2 days')
on conflict (id) do nothing;

-- Darle el permiso campanas a los usuarios de pruebas (Admin ya entra por rol;
-- AdministraciÃ³n = el rol de Carolina en la vida real).
update app_users
  set permisos = coalesce(permisos, '{}'::jsonb) || '{"campanas": true}'::jsonb
  where rol = 'AdministraciÃ³n' and (permisos ->> 'campanas') is distinct from 'true';

-- VerificaciÃ³n rÃ¡pida
select 'operadores' t, count(*) from camp_operadores
union all select 'estaciones', count(*) from camp_estaciones
union all select 'decisores', count(*) from camp_decisores
union all select 'listas', count(*) from camp_listas
union all select 'miembros', count(*) from camp_lista_miembros
union all select 'actividades', count(*) from camp_actividades;
