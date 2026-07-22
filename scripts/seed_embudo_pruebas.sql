-- ============================================================================
-- Seed de OBRAS TRUCHAS "en-presupuesto" para el embudo comercial de PRUEBAS.
-- Motivo: la base de pruebas es espejo de prod y casi todas sus obras están
-- confirmadas/archivadas → el embudo mostraba todo con candado (solo las obras
-- en-presupuesto son arrastrables) y parecía roto.
-- ⚠️ SOLO PRUEBAS (se aplica vía db-pruebas.yml, ref hardcodeado). Idempotente:
-- guard @> por id; no toca nada si ya están.
-- ============================================================================

-- Clientes truchos
update shared_data set value = value || '[
  {"id":"cliente_seed_e1","nombre":"Cliente Trucho Embudo SA","telefono":"2262000001","estado":"prospecto"},
  {"id":"cliente_seed_e2","nombre":"Estaciones Truchas del Sur SRL","telefono":"2262000002","estado":"prospecto"}
]'::jsonb, updated_at = now()
where key = 'clientes'
  and jsonb_typeof(value) = 'array'
  and not (value @> '[{"id":"cliente_seed_e1"}]'::jsonb);

-- Obras truchas en-presupuesto (las ÚNICAS arrastrables en el embudo)
update shared_data set value = value || '[
  {"id":"obra_seed_e1","nombre":"Consulta — Estación Trucha Norte","cliente":"Cliente Trucho Embudo SA","clienteId":"cliente_seed_e1","tipo":"Otro","presupuesto":0,"notas":"Obra de prueba para el embudo","estado":"en-presupuesto","esLead":true,"venta":{"etapa":"prospecto","fechaCambioEtapa":"2026-07-15","changelog":[{"etapa":"prospecto","fecha":"2026-07-15","usuario":null}]}},
  {"id":"obra_seed_e2","nombre":"Consulta — Minimercado Trucho Ruta 88","cliente":"Cliente Trucho Embudo SA","clienteId":"cliente_seed_e1","tipo":"Otro","presupuesto":0,"notas":"Obra de prueba para el embudo","estado":"en-presupuesto","esLead":true,"venta":{"etapa":"prospecto","fechaCambioEtapa":"2026-07-18","changelog":[{"etapa":"prospecto","fecha":"2026-07-18","usuario":null}]}},
  {"id":"obra_seed_e3","nombre":"Tienda Trucha — Estaciones del Sur","cliente":"Estaciones Truchas del Sur SRL","clienteId":"cliente_seed_e2","tipo":"Otro","presupuesto":0,"notas":"Obra de prueba para el embudo","estado":"en-presupuesto","esLead":false,"venta":{"etapa":"cotizado","fechaCambioEtapa":"2026-07-19","changelog":[{"etapa":"prospecto","fecha":"2026-07-10","usuario":null},{"etapa":"cotizado","fecha":"2026-07-19","usuario":null}]}},
  {"id":"obra_seed_e4","nombre":"Remodelación Trucha — Shop Bahía","cliente":"Estaciones Truchas del Sur SRL","clienteId":"cliente_seed_e2","tipo":"Otro","presupuesto":0,"notas":"Obra de prueba para el embudo","estado":"en-presupuesto","esLead":false,"venta":{"etapa":"negociacion","fechaCambioEtapa":"2026-07-20","changelog":[{"etapa":"prospecto","fecha":"2026-07-08","usuario":null},{"etapa":"cotizado","fecha":"2026-07-14","usuario":null},{"etapa":"negociacion","fecha":"2026-07-20","usuario":null}]}}
]'::jsonb, updated_at = now()
where key = 'obras'
  and jsonb_typeof(value) = 'array'
  and not (value @> '[{"id":"obra_seed_e1"}]'::jsonb);

-- Verificación: cuántos seeds del embudo quedaron
select
  (select count(*) from jsonb_array_elements((select value from shared_data where key='obras')) o where o->>'id' like 'obra_seed_e%') as obras_seed,
  (select count(*) from jsonb_array_elements((select value from shared_data where key='clientes')) c where c->>'id' like 'cliente_seed_e%') as clientes_seed;
