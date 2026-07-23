# Módulo Campañas — Fase 1 (núcleo) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Módulo de ventas/campañas dentro del ERP: base real de contactos (Estación→Operador→Decisor) con importación incremental + dedup, kanban dinámico de prospección, trazabilidad multicanal con anti-colisión, rol acotado para Carolina, modo llamadas mobile, import de LinkedIn (ZIP oficial) y tablero de KPIs con gráficos — deployado a `pruebas`.

**Architecture:** Tablas Postgres reales (NO shared_data/JSONB) con RLS por permiso `campanas`; el frontend habla directo a Supabase con paginación server-side (patrón `app_users`); cero funciones serverless nuevas en esta fase (import client-side con `xlsx` y `jszip`, ya en deps). UI como páginas nuevas `src/pages/campanas/*` siguiendo la identidad visual del ERP (gráficos artesanales, `PageLayout`/`PageHero`/`Kpi`).

**Tech Stack:** React 19 + vite + vitest · supabase-js · xlsx (SheetJS) · jszip · react-router 7. Sin librerías nuevas.

**Contexto obligatorio:** leer `docs/campana/proyecto-campana.md` (spec + decisiones + hallazgos verificados con file:line).

**Reglas duras:** rama `feat/campana-marketing`; NUNCA PR a main (auto-merge a prod); deploy solo pusheando a rama `pruebas`; los 690 tests existentes siguen verdes; migraciones aditivas idempotentes; commits en español.

---

## Modelo de datos (migración `supabase/migrations/0006_campanas.sql`)

Entidades (de los CSVs reales, ver §f del informe de docs en proyecto-campana.md §3.bis):
- `camp_operadores` — unidad de CONTACTO y anti-colisión (un operador maneja N estaciones).
- `camp_estaciones` — unidad de OPORTUNIDAD de obra (bandera, APIES, tipo tienda, teléfono).
- `camp_decisores` — persona (cargo, LinkedIn único, email, confianza/verificado).
- `camp_listas` + `camp_lista_miembros` — campañas/listas (Kamak-Shell, secuencia email, etc.) y pertenencia con estado por miembro.
- `camp_actividades` — TODA la trazabilidad (llamada/email/linkedin/whatsapp/nota/estado/import) con usuario, canal y resultado.
- `camp_import_runs` — auditoría de cada import (archivo, stats, usuario).

Campos clave anti-colisión en `camp_operadores`: `owner_user_id text`, `canal_activo text`, `en_tratativas boolean default false`.
Estados de llamada: `estado_llamada` (canónico: SIN LLAMAR·FUERA DE SERVICIO·NO ATIENDE·VOLVER A LLAMAR·PASÓ MAIL·PASÓ WHATSAPP·DECISOR IDENTIFICADO·NO INTERESA·LEAD CALIENTE) + `estado_original text` (lo que escribió Caro, se preserva SIEMPRE) en `camp_estaciones`.
Pre-embudo kanban en `camp_operadores.etapa_prospeccion`: `sin_contactar · contactado · respondio · en_conversacion · reunion · promovido · descartado`.
Promoción: `camp_operadores.cliente_id text` + `obra_id text` → link al embudo real existente (crea cliente+obra esLead como `Pipeline.jsx:85-101`).
RLS: helper `public.puede_campanas()` (SECURITY DEFINER, patrón `is_admin()` de `0001_rls.sql:30-46`): `rol='Admin' OR permisos->>'campanas'='true'`. Todas las tablas `camp_*`: select/insert/update para `authenticated` con `puede_campanas()`; delete solo `is_admin()`.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/0006_campanas.sql` | Crear: schema + índices + RLS (idempotente) |
| `src/lib/campanas/constants.js` | Crear: estados canónicos, etapas kanban, colores (ETAPA_META-style), banderas, canales |
| `src/lib/campanas/normalizar.js` | Crear: normalización de estados sucios → canónico + original; normalización de teléfonos AR (dedup key) |
| `src/lib/campanas/importUnificado.js` | Crear: parse xlsx Unificado → {operadores, estaciones, decisores} + dedup vs existentes + plan de import |
| `src/lib/campanas/importLinkedIn.js` | Crear: parse ZIP oficial LinkedIn (messages.csv/Connections.csv/Invitations.csv) → actividades diff |
| `src/lib/campanas/kpis.js` | Crear: agregaciones para el tablero (por lista/canal/etapa, tasas, serie temporal) |
| `src/store/CampanasContext.jsx` | Crear: data layer Supabase (paginado, filtros, CRUD, actividades, anti-colisión, import batches) |
| `src/pages/campanas/CampanasDashboard.jsx` | Crear: tablero KPIs con gráficos (focales, artesanales) |
| `src/pages/campanas/CampContactos.jsx` | Crear: lista paginada + filtros + búsqueda + ficha operador (drawer con estaciones, decisores, actividades, anti-colisión) |
| `src/pages/campanas/CampKanban.jsx` | Crear: kanban etapa_prospeccion, DnD desktop + mover-por-tap mobile |
| `src/pages/campanas/CampImportar.jsx` | Crear: importador (xlsx Unificado / CSV decisores / ZIP LinkedIn) con preview + resumen |
| `src/pages/campanas/CampLlamadas.jsx` | Crear: modo llamadas mobile para Carolina (cola, tel:, resultado 2 taps) |
| `src/store/UsuariosContext.jsx:10-35` | Modificar: permiso `campanas` en PERMISOS_DEFAULT + ROLES |
| `src/pages/Usuarios.jsx:21-22` | Modificar: agregar `campanas` al listado editable de permisos |
| `src/components/layout/Sidebar.jsx:14-17` | Modificar: sección Comercial → item `Campañas` (`perm:'campanas'`) |
| `src/App.jsx:258-290` | Modificar: rutas `/campanas`, `/campanas/contactos`, `/campanas/kanban`, `/campanas/importar`, `/campanas/llamadas` |
| `scripts/seed_campanas_pruebas.mjs` | Crear: datos truchos para Kamak-Pruebas |
| Tests | `src/lib/campanas/*.test.js` (normalizar, importUnificado, importLinkedIn, kpis) + `src/store/CampanasContext.test.jsx` (anti-colisión) |

## Contrato de `CampanasContext` (lo consumen TODAS las páginas — respetarlo)

```js
// useCampanas() →
{
  // datos paginados (server-side; NUNCA cargar todo)
  fetchOperadores({ page, pageSize=50, filtros:{ bandera, provincia, etapa, estadoLlamada, confianza, busqueda, listaId }, orden }), // → { rows, total }
  fetchEstaciones({ operadorId | filtros, page, pageSize }),
  fetchDecisores({ operadorId | listaId, page, pageSize }),
  fetchActividades({ operadorId, limit=100 }),
  contarPorEtapa(filtros), // → { sin_contactar: n, ... } para kanban/KPIs (usa count head:true por etapa)
  // mutaciones
  crearOperador(data), actualizarOperador(id, changes),
  setEtapaProspeccion(operadorId, etapa, { usuario }),           // registra camp_actividades tipo 'cambio_etapa'
  registrarLlamada(estacionId, { estadoLlamada, comentario, decisorNombre, decisorEmail, proximoPaso, usuario }), // actualiza estación + actividad tipo 'llamada'
  registrarActividad({ operadorId, decisorId?, estacionId?, tipo, canal, resultado, texto, usuario, datos }),
  // anti-colisión (P6): SIEMPRE chequear antes de mutar
  chequearColision(operadorId, usuarioId), // → null | { ownerNombre, canal, desde } si en_tratativas y owner distinto
  tomarOperador(operadorId, { usuario, canal }),   // en_tratativas=true, owner, canal_activo + actividad
  liberarOperador(operadorId, { usuario }),
  // promoción al embudo real
  promoverAEmbudo(operadorId, { usuario }), // crea cliente (useClientes.addCliente) + obra esLead (useObras.addObra, patrón Pipeline.jsx:85-101), guarda cliente_id/obra_id, etapa 'promovido', actividad
  // import
  ejecutarImport(plan, { usuario, archivo, tipo }), // batches de 500 upserts + camp_import_runs + actividad global
  // listas
  fetchListas(), crearLista(data), setEstadoMiembro(listaId, decisorId, estado),
}
```

Regla de mutación: toda mutación que toque un operador con `chequearColision() != null` debe rechazarse con `{ error: { colision } }` — la UI muestra banner "En tratativas con {owner} por {canal}" y NO ejecuta (excepto el propio owner o Admin con confirmación).

## Tasks

### Task 1: Migración SQL `0006_campanas.sql`
**Files:** Create `supabase/migrations/0006_campanas.sql`
- [ ] Escribir la migración completa: `create table if not exists` para las 7 tablas con los campos del modelo (ids `text primary key` con default `gen_random_uuid()::text`, timestamps `timestamptz default now()`), índices (`camp_estaciones(operador_id)`, `camp_estaciones(telefono_norm)`, `camp_decisores(linkedin_url)` unique parcial where not null, `camp_decisores(operador_id)`, `camp_actividades(operador_id, fecha desc)`, `camp_lista_miembros(lista_id)`), helper `puede_campanas()` y RLS idempotente (drop policy if exists + create) siguiendo `0001_rls.sql`.
- [ ] Validar sintaxis SQL localmente (lectura cuidadosa; no hay postgres local).
- [ ] Commit: `feat(campanas): esquema de base — operadores, estaciones, decisores, listas, actividades e imports con RLS`

### Task 2: Permiso `campanas` + Sidebar + rutas
**Files:** Modify `src/store/UsuariosContext.jsx`, `src/pages/Usuarios.jsx`, `src/components/layout/Sidebar.jsx`, `src/App.jsx`
- [ ] `PERMISOS_DEFAULT` + todos los roles: `campanas:false` salvo `Admin: campanas:true`.
- [ ] `Usuarios.jsx` lista editable: `{ key:'campanas', label:'Módulo Campañas' }`.
- [ ] Sidebar sección Comercial: `{ icon:'📣', label:'Campañas', path:'/campanas', perm:'campanas' }`.
- [ ] Rutas en App.jsx (lazy como las existentes) para las 5 páginas (crear stubs mínimos que rendericen el título para que compile).
- [ ] Guard patrón `Pipeline.jsx:40-41` en cada página: `const puede = currentUser?.rol==='Admin' || currentUser?.permisos?.campanas; useEffect(()=>{ if (currentUser && !puede) navigate('/', {replace:true}) },...)`.
- [ ] `npm test` verde + commit: `feat(campanas): permiso, menú y rutas del módulo`

### Task 3: constants + normalizar (TDD)
**Files:** Create `src/lib/campanas/constants.js`, `src/lib/campanas/normalizar.js`, `src/lib/campanas/normalizar.test.js`
- [ ] Test primero: casos reales de la planilla — `"ME PASO EL MAIL"→'PASÓ MAIL'`, `"PASO MAIL"→'PASÓ MAIL'`, `"NUMERO EQUIVOCADO"→'FUERA DE SERVICIO'` (con original preservado), `"TELEFONO FIJO"→null` (atributo, no estado → queda en original y flag `telefonoFijo`), `"lead caliente"→'LEAD CALIENTE'`, vacío→'SIN LLAMAR'; teléfonos: `"02262-15-530944"→'5492262530944'`, `"+54 9 11 5555-4433"→'5491155554433'`, `"011 4444-5555"→'541144445555'` (fijo sin 9), basura→null.
- [ ] Implementar `normalizarEstado(raw) → { estado, original, flags }` y `normalizarTelefonoAR(raw) → e164 | null`.
- [ ] Tests verdes + commit: `feat(campanas): estados canónicos y normalización de teléfonos (TDD)`

### Task 4: importUnificado (TDD)
**Files:** Create `src/lib/campanas/importUnificado.js`, `importUnificado.test.js`
- [ ] Test primero con fixtures inline (arrays de filas como las devuelve `XLSX.utils.sheet_to_json`, columnas REALES: `Bandera, Estacion, Direccion, Localidad, Provincia, Operador, Telefono, Email, Web, Decisor, Cargo, LinkedIn_decisor, LinkedIn_empresa, Confianza, APIES` + estados sucios): agrupa por operador (key: nombre normalizado), estaciones bajo su operador, decisores dedup por LinkedIn URL, dedup de estación por `telefono_norm` y por `APIES`, filas ya existentes en DB → `accion:'actualizar'|'saltear'`, emails multivaluados con `;` → array.
- [ ] Implementar `planImportUnificado(rows, { existentes }) → { operadores:[{accion,data}], estaciones:[], decisores:[], resumen:{nuevos,actualizados,salteados,errores:[]} }` — función PURA (la ejecución del plan la hace el Context).
- [ ] Tests verdes + commit: `feat(campanas): plan de import del Unificado con dedup (TDD)`

### Task 5: importLinkedIn (TDD)
**Files:** Create `src/lib/campanas/importLinkedIn.js`, `importLinkedIn.test.js`
- [ ] Test primero con fixtures CSV string reales del export de LinkedIn: `messages.csv` (columnas `CONVERSATION ID, FROM, SENDER PROFILE URL, TO, DATE, CONTENT`) → por conversación: primer msj propio = 'linkedin_contactado', respuesta ajena posterior = 'linkedin_respondio'; `Connections.csv` (arranca con 3 líneas de notas — saltearlas; columnas `First Name, Last Name, URL, Email Address, Company, Position, Connected On`) → 'linkedin_acepto'; `Invitations.csv` → 'linkedin_invitado'. Match contra decisores por URL de perfil normalizada (lowercase, sin trailing slash) y fallback por nombre completo case-insensitive. Diff vs actividades ya importadas (no duplicar: key `tipo+decisorId+fecha`).
- [ ] Implementar `parseLinkedInZip(zip: JSZip) → rawFiles` y `planImportLinkedIn(rawFiles, { decisores, actividadesPrevias, miPerfilUrl }) → { actividades:[], sinMatch:[], resumen }`.
- [ ] Tests verdes + commit: `feat(campanas): import del export oficial de LinkedIn (TDD)`

### Task 6: kpis (TDD)
**Files:** Create `src/lib/campanas/kpis.js`, `kpis.test.js`
- [ ] Test primero: dado un dataset de operadores+actividades+listas → `kpisGenerales()` (totales, por etapa, tasa de respuesta por lista, reuniones — "la métrica que paga", llamadas de Caro por resultado, serie semanal de actividades por canal), `comparativaListas()` (enviados/respondidos/reuniones/promovidos por lista, tasa%), `embudoConcrecion()` (Contacto→Respondió→WhatsApp→Reunión→Presupuesto→Obra: los 2 últimos desde obras promovidas `esLead`/etapa venta — recibe `obras` como parámetro).
- [ ] Implementar funciones puras.
- [ ] Tests verdes + commit: `feat(campanas): agregaciones de KPIs (TDD)`

### Task 7: CampanasContext
**Files:** Create `src/store/CampanasContext.jsx`, `src/store/CampanasContext.test.jsx`; Modify `src/App.jsx` (provider)
- [ ] Implementar el CONTRATO completo de arriba con supabase-js (`.from('camp_operadores').select('*', { count:'exact' }).range(...)`, filtros `.eq/.ilike/.or`), lazy (NO carga nada al boot — solo al entrar al módulo), batches de upsert de a 500. Anti-colisión implementada en el context (chequeo + rechazo).
- [ ] Test (mock de supabase con vi.mock): `chequearColision` y rechazo de `registrarActividad`/`setEtapaProspeccion` sobre operador tomado por otro; `tomarOperador`/`liberarOperador` felices; Admin bypasea con `force:true`.
- [ ] Montar `<CampanasProvider>` en App.jsx junto a los demás providers.
- [ ] Tests verdes + commit: `feat(campanas): data layer paginado con anti-colisión de canales`

### Task 8: páginas UI (5, en paralelo — cada una archivo propio, stubs ya ruteados en Task 2)
**Files:** Create las 5 páginas de la tabla de estructura.
Todas: `PageLayout` + `PageHero` (patrón `Pipeline.jsx:112-122`), guard de permiso, `useIsMobile`, identidad visual T (theme), copiar interacciones existentes (NO inventar estética nueva). Sin montos de obras en ninguna vista del módulo (P11).
- [ ] `CampContactos.jsx`: tabla paginada (50/pág) con filtros (bandera/provincia/etapa/estado llamada/confianza/búsqueda), chips de estado con color, badge 🔒 "en tratativas con X" (anti-colisión visible), click → drawer ficha: datos operador, sus estaciones (con estado llamada + original de Caro), decisores (LinkedIn link), timeline de actividades (`fetchActividades`), acciones (tomar/liberar, registrar actividad con select tipo+canal+texto patrón `ClienteFicha360Modal.jsx:151-160`, promover al embudo con confirm).
- [ ] `CampKanban.jsx`: columnas por `etapa_prospeccion` (colores de `constants.js`), counts por `contarPorEtapa`, cards de operador (nombre, bandera(s), decisores count, último touch, lock si tratativas de otro). DnD HTML5 desktop (patrón exacto `Pipeline.jsx:45-81,143-198`) + en mobile: tap en card → sheet con botones de etapa (patrón select `ClienteFicha360Modal.jsx:131-140`). Cargar SOLO una página por columna (30) + "cargar más". Todo movimiento → `setEtapaProspeccion` (que ya registra actividad y chequea colisión).
- [ ] `CampanasDashboard.jsx`: KPI tiles (patrón `VentasReportes.jsx:22-28`) — contactados, tasa respuesta, reuniones (destacada, "la métrica que paga"), leads calientes, promovidos, obras ganadas de promovidos; embudo de concreción como barras horizontales proporcionales con conversión % entre escalones (artesanal, patrón `Dashboard.jsx:349-365`); comparativa de listas (tabla + barra de tasa de respuesta por lista); serie semanal de actividades por canal (línea/área SVG artesanal — puede crearse `src/pages/campanas/ChartLinea.jsx` interno); filtros por canal/bandera/rango fechas. Datos vía `kpis.js` alimentado con fetch agregado del context (usar `contarPorEtapa` + fetch de actividades del rango, NUNCA la tabla entera).
- [ ] `CampImportar.jsx`: 3 tarjetas (Unificado xlsx / CSV decisores / ZIP LinkedIn), file input → parse client-side (`XLSX.read` patrón de `src/lib/presupuestoImport.js`; `jszip` para el ZIP) → llamar al planificador puro → PREVIEW (tabla resumen nuevos/actualizados/salteados/errores + muestra de 20 filas) → botón "Importar" → `ejecutarImport` con barra de progreso → resultado + entrada en historial (`camp_import_runs` listado abajo). Historial de imports previos visible.
- [ ] `CampLlamadas.jsx`: mobile-first (patrón visual `pages/mobile/MobileComprador.jsx:18-31` pero con datos REALES): cola del día = estaciones filtradas (estado SIN LLAMAR / VOLVER A LLAMAR, orden por prioridad/provincia), tarjeta grande: estación, bandera, teléfono ENORME con `<a href="tel:...">📞 Llamar</a>`, y al volver: grid de botones de resultado (los 9 estados canónicos, 2 taps) + campos opcionales decisor/mail/próximo paso + guardar → `registrarLlamada` → siguiente de la cola. Contador de progreso del día ("14 de 40").
- [ ] `npm test` + `npm run build` verdes + commit: `feat(campanas): páginas del módulo — contactos, kanban, dashboard, importador y modo llamadas`

### Task 9: seed de datos truchos
**Files:** Create `scripts/seed_campanas_pruebas.mjs`
- [ ] Script Node idempotente (patrón de `scripts/_backfill_leads.mjs`): recibe `SUPABASE_URL`+`SUPABASE_SERVICE_KEY` por env, borra `camp_*` SOLO si `--reset`, inserta ~60 operadores / ~120 estaciones / ~50 decisores / 4 listas / ~300 actividades con banderas y estados variados (datos inventados obvios: "Estación Trucha Norte SA"). NUNCA correr contra prod (guard: aborta si la URL no contiene el ref de Kamak-Pruebas, pedirlo por env `PRUEBAS_REF`).
- [ ] Commit: `chore(campanas): seed de datos de muestra para pruebas`

### Task 10: aplicar migración + seed a Kamak-Pruebas
- [ ] Buscar credenciales de Kamak-Pruebas (`.env*` local, `vercel env pull` con target preview, o docs de guardarraíles). Si no hay: dejar TODO listo + instrucción exacta en el reporte final y seguir (la UI ya degrada con mensaje si la tabla no existe).
- [ ] Aplicar `0006_campanas.sql` + correr seed. Verificar con un select.

### Task 11: QA multi-agente + correcciones
- [ ] Workflow de review (dimensiones: bugs/estado-compartido/permisos-P11/escala-paginación/UX-mobile/consistencia-con-el-resto-del-ERP + puntos de CONEXIÓN con features existentes: embudo, clientes, notificaciones Telegram, bot) con verificación adversaria; aplicar los fixes CONFIRMED.
- [ ] `npm test` + `npm run build` verdes finales.

### Task 12: deploy a pruebas
- [ ] Commits finales en `feat/campana-marketing`; push del branch al remoto.
- [ ] `git push origin feat/campana-marketing:pruebas --force-with-lease` (la rama pruebas refleja el candidato; NUNCA main).
- [ ] Verificar deploy en Vercel (URL fija `kamak1324-git-pruebas-kamak.vercel.app`) — build OK + smoke test de rutas.
- [ ] Reporte final en criollo.
