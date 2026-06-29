# Kamak Internal Bot — Inventory & WhatsApp→Telegram Migration Map

Scope: migrate the INTERNAL/operational flows (staff) from WhatsApp to a Telegram bot, integrated into the EXISTING `api/whatsapp/webhook.js` Vercel function (no 13th function — capped at 12/12). Clients stay on WhatsApp; the presupuesto QR onboarding flow is untouched. Business core + the per-role access limits (costos/márgenes admin-only) do NOT change — only the channel does.

---

## 1. Command catalog

Inbound dispatch is a layered pipeline, not a keyword table: `handler()` (webhook.js:4538, HMAC + dedup + type-normalize) → identity resolution (`getLinkedUser` internal / `getLinkedCliente` portal / unknown→onboarding/linking) → `handleMainFlow` (webhook.js:4002), a per-user state machine with a regex fast-path cascade, then a regex slot pre-extractor, then `callClaude` (webhook.js:1406) LLM NLU as fallback → `ejecutarAccion` (webhook.js:1761) / `ejecutarComando` (webhook.js:2938). Buttons/lists are normalized to text before this engine, so the whole engine is already channel-agnostic.

### Gastos / facturas
| Command | Trigger | Input type | Roles |
|---|---|---|---|
| **gasto** | "gasto/gasté/compré/pagué/factura/comprobante", photo of ticket, NL "pagué $50k de materiales en Baradero" | Text and/or photo/PDF; confirm buttons (state `confirmando`) | all (Admin auto-applies; non-Admin → approval buzón) |
| **factura_compra** | photo/PDF of a formal supplier invoice; "facturá esto"/"cargá la factura" | Photo/PDF + caption; LLM OCR; confirm buttons | all (Admin auto-loads; non-Admin → buzón) |
| **cargar_factura** | "cargar factura / factura pendiente / orden de pago / le debo a / debo pagar a" | Free text; LLM extract; confirm | **Admin** (hard-gated webhook.js:1951) |
| **dictado (multi-gasto)** | prefix regex `/^(cargá\|anotá\|gastos?)\s*:?/` + comma/line items each with a monto | Text list; preview + confirm (state `dictado_confirmando`); bypasses Claude | all |

### Caja / tesorería
| Command | Trigger | Input type | Roles |
|---|---|---|---|
| **ingreso** | "ingreso/cobro/cobré/recibí/me transfirieron/me pagaron" | Text (+opt photo); sub-states `awaiting_ingreso_caja`, `awaiting_client_notice/phone` | all (Admin auto-applies; non-Admin → buzón) |
| **cheque_recibido** | "cheque/echeq", "me dieron un cheque", photo of cheque | Photo and/or text; asks caja if not explicit | all |
| **pago_proveedor** | "le pagué $X a [prov]", "abonar/cancelar a [persona]" | Free text; sub-states `awaiting_factura_pago_confirm/pick` | **Admin** (hard-gated webhook.js:2278) — NLU also gates |
| **traspaso** | "traspaso / pasá $X de Caja A a Caja B / mover de / transferir de" | Free text; asks TC if cross-currency | **Admin** (hard-gated webhook.js:2390/2419) |
| **deshacer** | "deshacer / borrá lo último / undo / me equivoqué" | Free text regex (handleMainFlow ~4100) | all (only own WA-created movs) |
| **estado_cheque** | "deposité el cheque NNNN / se cobró el NNNN" (+ number) | Free text w/ number; fast-path `pideEstadoCheque` | all |

### Avance de obra
| Command | Trigger | Input type | Roles |
|---|---|---|---|
| **avance_obra** | "avance/avancé/hice/terminé/colocamos", "150 m² de revoque grueso en Baradero", "30% de pintura" | Text and/or photo; direct-bypass to confirm when complete | all (biased intent for Capataz/Jefe de obra) |

### Tareas
| Command | Trigger | Input type | Roles |
|---|---|---|---|
| **nueva_tarea** | "nueva/crear tarea, asigname tarea, crear tarea para Juan: …" | Free text; asks "a quién" if missing | all (self-assign); **assign-to-others = Admin** (webhook.js:2835) |
| **tareas** | "tareas / mis tareas / qué tengo pendiente / qué hago hoy" | Free text; fast-path `pideTareas` | all |
| **tarea_detalle** | "tarea N / detalle de la tarea N" | Free text w/ number (Claude comando) | all (needs prior `tareas`) |
| **completar_item** | "hice/completé el item N" | Free text w/ number | all (needs prior `tarea N`) |

### Vinculación / comercial
| Command | Trigger | Input type | Roles |
|---|---|---|---|
| **crear_prospecto** | "nuevo prospecto/lead, primer contacto, me contactó/escribió, consulta de", **shared contact (vCard)** | Free text OR shared contact card; confirm | **Admin** (hard-gated webhook.js:2776) |
| **mover_etapa** | "a ganado/perdido/negociación/cotizado, pasá X a ganado, cambiar etapa" | Free text; disambiguates | **Admin** (hard-gated webhook.js:2811) |
| **vinculacion_empleado** | any unknown-number msg that isn't QR onboarding / client command | Multi-step `linking_*` states; name/email | all (issues 6-digit code, confirm in app) |
| **onboarding_cliente_QR** | `/hola\s+soy\s+(.+?)\s+obra\s+(.+)/i` from unknown number | Single free-text msg | (client — **stays on WhatsApp**) |

### Consultas (read)
| Command | Trigger | Input type | Roles |
|---|---|---|---|
| **confirmar/cancelar/editar** | sí/no/editar + slot corrections; interactive buttons | Buttons (`BOTONES_CONFIRMAR`) or text in `confirmando` | all |
| **ayuda** | "ayuda/help/menu" | Free text | all (role-aware content) |
| **saludo** | bare "hola/buenas/buen día/hey" (<12 chars) | Free text greeting only | all |
| **saldo** | "saldo" | Free text (Claude comando) | all — **scoped by `cajaEsVisible`** |
| **pendientes** | "pendientes" (APPROVAL inbox, not unpaid invoices) | Free text | all (list); aprobar/rechazar hint = Admin only |
| **cheques** | "cheques" (due ≤7d) | Free text | **Admin** (hard-gated webhook.js:3348) |
| **resumen** | "resumen [obra] [fecha]" (daily gastos/ingresos) | Free text | **Admin** (hard-gated webhook.js:3366) |
| **cc_proveedor** | "cuánto le debo a X / saldo de X / cc X" | Free text; fast-path `pideCCProveedor` | all — **REDACTION GAP (no code gate)** |
| **buscar_gastos** | "últimos N gastos de X / gastos de [concepto]" | Free text; fast-path `pideBuscarGastos` | all — **REDACTION GAP (no code gate)** |
| **contacto_proveedor** | "tel/wa/whatsapp/contacto de X" | Free text; fast-path | all (no cost data, open by design) |
| **cliente_portal_consultas** | client read-only menu (saldo/avance/cuotas/portal) | Free text regex routing | (client — **stays on WhatsApp**) |

### Obras
| Command | Trigger | Input type | Roles |
|---|---|---|---|
| **como_va_obra** | "cómo va/está [obra] / estado/status de [obra]" | Free text; fast-path `pideEstadoObra` | all — **REDACTION GAP (exposes gastado vs presupuesto, no code gate)** |
| **nota_obra** | "dejá/anotá nota en [obra]: texto" | Free text; fast-path `pideNotaObra` | all |
| **cotizar_proveedor_obra** | "materiales/cotización/lista de + grupo-proveedor + obra" | Free text; fast-path `pideCotizarProveedor` | all — deliberately price-stripped (only nombre+cantidad+unidad) |

### Admin
| Command | Trigger | Input type | Roles |
|---|---|---|---|
| **aprobar_pendiente / rechazar_pendiente** | "aprobar/aprobá/ok N", "rechazar/rechazá/no N" | Free text; fast-path `pideAprobacion` | **Admin** (hard-gated webhook.js:3156) |

---

## 2. RBAC contract (MUST be preserved)

### Roles
- **Admin** — the only role hard-enforced across the bot (`user.user_rol === 'Admin'`). Direct ledger writes (gasto/ingreso auto-applied), approve/reject pendientes, cargar_factura/factura_compra auto-load, pago_proveedor, traspaso, crear_prospecto, mover_etapa, assign-to-others, cheques, resumen. Receives all financial alerts.
- **Administración** — semi-privileged. Does NOT get the Admin-only writes (those all check `=== 'Admin'`), BUT is treated like Admin for VISIBILITY of órdenes de pago / open invoices in the LLM context (`_esAdminBot`, webhook.js:1469) and is a finance-notification recipient.
- **Compras / Jefe de obra / Capataz / (free-form roles)** — generic internal user. May submit gasto/ingreso/factura (→ approval buzón), report avance, run read-only queries. Role only BIASES the LLM intent (webhook.js:1567 "cualquier rol puede hacer cualquier cosa"); it does not hard-gate except where code checks the string. Jefe de obra/Capataz biased to avance; Compras/Administración biased to gasto/factura.
- **Cliente** — external, not an `app_users` role; QR-bound, routed to `handleClienteFlow` read-only, sees only their own obra's SALE side. **Stays on WhatsApp.**
- **Unregistered** — unknown number → QR onboarding or employee linking; no data.

### Linking mechanism (3 steps — concept is reusable, only the phone key is channel-flavored)
1. **REQUEST** — unlinked number messages bot; `handleLinkingFlow` (webhook.js:1190-1255) asks nombre/email, matches `app_users` (email exact OR nombre substring), writes `whatsapp_verifications {code(PK), phone, user_email, expires_at=now+15min}`.
2. **CONFIRM in ERP** — app POSTs `/api/whatsapp/link` `{action:'confirm', email, …}`; server re-reads the verification by email and takes the phone **from the server record, not the client** (link.js:72-73); upserts `whatsapp_users {phone, user_id, user_name, user_rol, linked_at}`; deletes verifications. Runs server-side with `SUPABASE_SERVICE_KEY`.
3. **RESOLVE per message** — `getLinkedUser(phone)` (webhook.js:1154-1163) joins `whatsapp_users`→`app_users`, returns merged user where **`user_rol` is LIVE from `app_users.rol`** (the stored snapshot is only a fallback). ERP role changes take effect immediately. `getAllAdmins()` (webhook.js:1053-1060) fans out admin notifications.

> Migration-critical: the table key is `phone`. Telegram gives a numeric `chat.id`, NOT a phone, unless the user shares a contact. Linking will need a Telegram-flavored identity table/key (see §7).
> Note: `app_users.permisos` (granular) is loaded onto the user but NEVER consulted — all authorization is the coarse `user_rol === 'Admin'` (plus `=== 'Administración'` in one visibility branch).

### Redaction/permission rules to preserve, with enforcement points
**Correctly gated (keep exactly):**
- gasto/ingreso auto-apply = Admin only; non-Admin → approval buzón + notify admins (webhook.js:1860 vs 1906-1942).
- factura_compra auto-load = Admin (webhook.js:2078/2139); non-Admin → buzón (2234-2258).
- cargar_factura (1951), pago_proveedor (2278), traspaso (2390/2419), crear_prospecto (2776), mover_etapa (2811), aprobar/rechazar (3156), cheques (3348), resumen (3366), assign-to-others (2835) — all hard `=== 'Admin'`.
- **saldo** scoped by `cajaEsVisible` (webhook.js:3114-3120 + 1173-1187): Admin (`cajasVisibles==='*'`) sees all; non-admin sees only cajas they're responsable of (`caja.usuarioId===user.email`) + explicit `cajas_visibles`.
- Open invoices / órdenes de pago in LLM context: Admin + Administración see all; others only their own (`_esAdminBot`, webhook.js:1469-1471).
- Margins (`margenLinea/margenMat/margenMO`) are NEVER printed to internal users — used only inside `saldoObraBotUSD` (webhook.js:609-640) to compute the client SALE total, which only reaches the CLIENT flow. So "márgenes solo admin" is effectively satisfied today.

**Redaction GAPS to fix during migration (cost leaks to all roles — NOT currently honoring "costos solo admin"):**
- **como_va_obra** (webhook.js:3392-3460) — no role check; exposes gastado vs presupuesto, `totalCosto`, top gastos.
- **cc_proveedor** (3463-3506) — no role check; supplier debe/pagado/saldo + recent amounts (help text offers it admin-only, handler doesn't enforce).
- **buscar_gastos** (3530-3553) — no role check; cross-obra gasto amounts.
- **pendientes** list (3123-3151) — any user sees OTHER users' pending amounts; only the aprobar/rechazar line is Admin-gated.
- **avance cert confirmation** (webhook.js:2760) — the reporter sees `💰 Cert $X agregada a CC` = subcontractor cost (`(costoMat+costoSub)×cantidad`), despite the "sin precios" intent. Financial ALERTS (exceso/CC/$0) are already admin-only via `getAllAdmins` (2725-2735).
- **costoSubUnit** injected into the Claude prompt for the context obra regardless of role (webhook.js:1442).

> Recommendation: centralize a single `isAdmin(user)` helper (today scattered), explicitly decide whether **Administración** counts as cost-privileged, and add the missing gates/redaction to the six paths above so they match the "costos/márgenes solo admin" contract before/at migration.

---

## 3. Notifications & jobs

### WhatsApp → INTERNAL TEAM (these MOVE to Telegram)
All suffer Meta's 24h-window limit (the motivating pain). They run ALONGSIDE the campanita/push, so moving them replaces only the WA leg.
1. **wa_movimiento_pendiente** → admins — `sendWA` webhook.js:1931-1933 (separate from the push at 1937).
2. **wa_factura_pendiente** → admins — `sendWA` webhook.js:2240-2249.
3. **Nueva tarea asignada (bot-created)** → assignee — `sendWA` webhook.js:2914-2926, ONLY if the assignee wrote in the last 24h Meta window (else in-app badge only). Bot tasks bypass `TareasContext`, so they do NOT fire the `tarea_asignada` campanita/push.
4. **Seguimiento comercial** → admins — `runFollowups` (jobs.js:338-394, `?job=followups`).
5. **Cliente firmó** → admins — `avisarAdmins`/`sendWA` (firmar.js:189; note: the campanita+push leg at firmar.js:192 stays).

### WhatsApp → CLIENTS (external — STAY on WhatsApp, untouched)
- **Confirmación de cobro** → cliente — `notifyClienteCobro` (webhook.js:714, called 4298/4349).
- **Recordatorio de cuota** → cliente — `runReminders` template `recordatorio_cuota` es_AR (jobs.js:280-287).

### In-app campanita + web-push (STAY as-is — primary internal channel, independent of WA/TG)
All 11 wired EVENTOS (`src/lib/notificaciones.js:8-21`). Two parallel creators share one catalog: client `NotificacionesContext.jsx` (→ `?job=push`) and server `_notif.js crearNotifServidor` (used by webhook.js, jobs.js, portal/firmar.js).
- TIPOS_LEGACY (push-only, Topbar, NOT in feed): solicitud_eliminacion, wa_factura_pendiente, wa_movimiento_pendiente, cheque_por_vencer, cobro_cliente_proximo, tarea_asignada (notificaciones.js:28-35). Non-legacy = feed + push.
- Role routing (`resolverDestinatarios`, minus actor): solicitud_eliminacion / wa_*_pendiente → Admin; cheque_por_vencer & cobro_cliente_proximo → Admin+Administración; cuenta_por_vencer / orden_pago_creada / cliente_firmo / proveedor_firmo → Administración(+Admin); presupuesto_adjuntado → Jefe de obra+Admin; tarea_asignada → explicit userIds.
- **proveedor_firmo** is defined (notificaciones.js:20) but has NO call site — dead entry.
- Push setup: VAPID web-push via `_notif.js enviarPushAUsuarios` (62-84); subs in shared_data `push_subscriptions`; SW `public/sw-push.js` is MINIMAL push-only (no fetch/precache — to avoid the reverted-PWA breakage); `public/sw.js` is a kill-switch cleanup SW.

### Cron / `?job=` surface (single merged function — Hobby 12-function cap)
- **Vercel cron #1** `/api/whatsapp/jobs?job=reminders` `0 13 * * *` (10:00 ART) — `runReminders`: client cuota reminders (48h before / 72h after) + internal cobro_cliente_proximo, cheque_por_vencer (7d), cuenta_por_vencer (3d). Idempotent via shared_data `notif_cron_sent`. `CRON_SECRET` protected. (vercel.json:14)
- **Vercel cron #2** `/api/cron/sync-sanfrancisco` `0 8 * * *` — data sync, not notifications. (vercel.json:15)
- `?job=followups` — `runFollowups`, **manual only** (firing it as a 3rd cron breaks the Hobby deploy, see commit c798a71). Throttled via shared_data `sales_followups_state`.
- `?job=push` — `runPush`, called by the web client on every notif create (Bearer Supabase token). Delegates to `enviarPushAUsuarios`.
- Dispatch: jobs.js:419-425 switches on `req.query.job ∈ {reminders|followups|push}`, else 400. All three are one function due to the 12-function cap.

> Telegram impact: the team sends (1-5) become Telegram `sendMessage` calls. There is no 24h window and no template approval, so the `activo24h` branching in jobs.js can be dropped for team sends (keep cron idempotency). Client sends (cuota reminder, cobro confirm) keep the WA template path unchanged.

---

## 4. Extractors

Porting the OCR/file pipeline is clean: there is exactly ONE WhatsApp-coupled seam — `downloadMedia`. Everything else is channel-agnostic.

| Extractor (location) | Role | Channel coupling |
|---|---|---|
| **callClaude** (webhook.js:1406; Anthropic 1683-1686) | THE OCR/vision extractor. Reads factura/ticket/comprobante from photo OR PDF → structured action (monto total, tipo A/B/C, nº, CUIT, proveedor, medioPago, IVA, percepciones IIBB/IVA, fecha, nota_credito) AND classifies gasto vs factura_compra vs avance vs pago_proveedor. Model claude-sonnet-4-6, native image + PDF document blocks. | **CHANNEL-AGNOSTIC.** Needs only base64+mime+text. Drop-in for Telegram. |
| **downloadMedia** (webhook.js:544) | Fetches WA media binary → base64. | **TIGHTLY COUPLED — the one function to replace.** Two Meta Graph calls + `META_TOKEN` → swap for Telegram `getFile` + `api.telegram.org/file/bot<TOKEN>/<file_path>`. Also re-map inbound media parsing (webhook.js:4636-4647) and the `pendingMediaUrl` filepath (keyed by phone). |
| **uploadToStorage** (webhook.js:578) | base64 → Supabase Storage bucket `kamak-fotos` → public comprobanteUrl. | CHANNEL-AGNOSTIC. Only the filepath prefix uses phone → swap for chat id. |
| **desglosarCompraBot** (webhook.js:90) | AFIP post-processor: total+tipoLetra(+percepciones) → neto+IVA crédito for Libro IVA. Pure arithmetic, no AFIP call. | CHANNEL-AGNOSTIC (pure fn). |
| **extractSlots/extractIntent/extractMonto/extractCantidadUnidad/extractMedioPago/extractEtapaDestino/extractProspectoSlots** (_extractors.js) | Cheap regex pre-extractors on TYPED TEXT (not OCR) to pre-fill slots before Claude. | FULLY CHANNEL-AGNOSTIC (string in). Identical on Telegram text/captions. |
| **Fuzzy matchers** extractObra/Caja/Proveedor/Rubro/Tarea + matchPorNombre (_extractors.js:134-282) | Resolve free text → existing ERP entity by word-overlap scoring. | CHANNEL-AGNOSTIC (pure). |
| **parseDictado** (_extractors.js:407) | Multi-gasto batch parse. | CHANNEL-AGNOSTIC (pure). |
| **extractAvanceCompleto / extractCorreccion** (webhook.js:1322 / 1258) | Text-only bypass-Claude avance + correction extractor. | CHANNEL-AGNOSTIC (lives in webhook.js but no WA dependency). |

**Caveats:** (1) the `_extractors.js` functions parse TYPED text, not the image — image OCR is 100% `callClaude`. (2) There is NO Excel parser and PDFs are NOT parsed locally — they ship straight to Claude as a base64 document block. Any spreadsheet/local-PDF parse is new work, not reuse. Pipeline env: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY` (agnostic) + `META_TOKEN` (replace with `TELEGRAM_BOT_TOKEN`).

---

## 5. Channel-split map (most important)

The clean seam: every inbound funnels through a synthesized **`text` string + (mediaId, mimeType)** into `handleMainFlow`/`handleClienteFlow`, and every outbound goes through the four `sendWA*` calls. A Telegram adapter only re-implements inbound parsing + the send/download functions.

| Business core — channel-agnostic, REUSE AS-IS | WhatsApp-specific — RE-IMPLEMENT for Telegram |
|---|---|
| Intent/slot engine: `_extractors.js` (extractSlots/mergeSlots/parseDictado, all matchers), `extractAvanceCompleto/extractCorreccion` | The 4 send fns: `sendWA` / `sendWAButtons` / `sendWAList` / `sendWATemplate` (webhook.js:415-542) |
| LLM NLU: `callClaude` + system prompt + JSON action contract (webhook.js:1406, 1683-1686) | `downloadMedia` — Meta 2-step media API + `META_TOKEN` (webhook.js:544) |
| Commercial intents: `_intents-comercial.js` crearProspecto / moverEtapaObra | Inbound: `leerBodyCrudo` + `bodyParser:false` (webhook.js:27) + `firmaMetaValida` X-Hub-Signature-256 HMAC (43-49) |
| State machine: loadConversation/saveConversation/clearConversation + all `awaiting_*` / `linking_*` states | GET verify handshake (`hub.challenge`) + diagnostic JSON (webhook.js:4542-4554) |
| Dispatchers: `ejecutarAccion` (1761), `ejecutarComando` (2938) — all business branches | Payload parser: entry/changes/value/statuses/messages + `message.type` dispatch text/image/document/contacts/interactive (4574-4694) |
| All command logic in `handleMainFlow` + `handleClienteFlow` (gasto/ingreso/factura/pago/traspaso/avance, saldo/avance/cuota) | Interactive `button_reply`/`list_reply` → text normalization incl. `pick:` / confirmar mapping (4678-4691) |
| `saldoObraBotUSD` + cuota math; `cotizarProveedorObra` | `BOTONES_CONFIRMAR` shape (≤3 buttons, 20-char titles) (webhook.js:405) |
| RBAC gates (`user_rol==='Admin'`, `_esAdminBot`, `cajaEsVisible`) + `getAllAdmins` | `normalizePhone` (E.164-for-Meta) + **phone-as-conversation-key** |
| `getSystemContext` + Supabase data layer (loadSharedData/sbGet/sbPatchItem/appendMovimiento) | Delivery-status → `waStatus` persistence into `portal_tokens[*].waStatus` (4600-4620) |
| `uploadToStorage` (Supabase) + `desglosarCompraBot` (AFIP) | 24h-window/template branching in jobs.js (274-287) — **not needed on Telegram** |
| Portal-token generation (`generarPortalLink`); `_notif` campanita + web-push | `META_*` env vars (META_ACCESS_TOKEN/PHONE_NUMBER_ID/VERIFY_TOKEN/APP_SECRET) → `TELEGRAM_BOT_TOKEN` |
| Linking concept (getLinkedUser/getLinkedCliente/onboardCliente) + dedupe/lock mechanism | The phone-matching KEY of linking; dedupe ID source (wamid → update_id/message_id) |

---

## 6. WhatsApp → Telegram primitive mapping

Telegram Bot API base: `https://api.telegram.org/bot<TOKEN>/<method>`.

| WhatsApp primitive (webhook.js) | Telegram equivalent | Notes |
|---|---|---|
| `sendWA(to, body)` plain text (415-432) | `sendMessage {chat_id, text, parse_mode}` | WA uses `*single-asterisk*` bold → use `parse_mode:'Markdown'` (legacy) or HTML; MarkdownV2 needs escaping. Split >4096 chars. |
| `sendWAButtons` reply buttons ≤3, id+title≤20 (440-465) | `sendMessage` + `reply_markup.inline_keyboard=[[{text, callback_data}]]` | `callback_data` ≤64 bytes carries the id (`confirmar/editar/cancelar/pick:<id>`). NO 3-button limit, multi-row OK → text-fallback path unnecessary. |
| Button tap (inbound `interactive.button_reply.id`) | `callback_query` UPDATE — read `update.callback_query.data` | Arrives as a SEPARATE update, not a message. MUST call `answerCallbackQuery` to stop the spinner. Then normalize to text exactly as today. |
| `sendWAList` list ≤10 rows w/ description (470-499) | No native list → emulate with multi-row `inline_keyboard` (one row per option, `callback_data='pick:<id>'`), fold descriptions into message text | Same `pick:` convention already used (e.g. invoice picker webhook.js:2310-2314). |
| `sendWATemplate` / 24h window (505-542; jobs.js:62-80) | DOES NOT EXIST — just `sendMessage` anytime | No 24h window, no template approval. Only constraint: user must have pressed `/start` (a bot cannot DM someone who never initiated). Drop `activo24h` branching for team sends. |
| `downloadMedia` Meta 2-step (544) | `getFile?file_id=<id>` → `{file_path}`; then GET `…/file/bot<TOKEN>/<file_path>` | Token in URL path, not Bearer. Photos = `message.photo[]` (pick last/largest `.file_id`); PDFs = `message.document.file_id+mime_type`. Then reuse uploadToStorage + Claude unchanged. |
| Outbound media (currently NONE) | `sendPhoto` / `sendDocument` (multipart or URL/file_id) | Bot today only sends portal links as text; keep that, no new media needed. |
| GET verify `hub.challenge` (4542-4551) | `setWebhook` once (optional `secret_token`) OR `getUpdates` long-poll | Replace HMAC check with `X-Telegram-Bot-Api-Secret-Token` header check. |
| Inbound parser (entry/changes/value) | `update{update_id, message{message_id, from{id,username}, chat{id}, text\|photo\|document\|contact}}` OR `callback_query{from,message,data}` | Use `chat.id` (numeric) as conversation key instead of `message.from` phone. |
| `message.contacts[0]` vCard share | `message.contact{phone_number, first_name, last_name, user_id}` | Feeds the same prospecto seeding. |
| Delivery `statuses` → `waStatus` (4600-4620) | NONE — `sendMessage` returns the Message object synchronously | Replace waStatus tracking with the inline API response (ok/description). |
| Dedupe via wamid (`lastMsgIds`) | `update_id` (monotonic) or `message_id`; with `getUpdates` the `offset` dedupes | |
| `normalizePhone` + phone key | `chat.id` key; phone only available if user shares contact via `KeyboardButton{request_contact:true}` | **This is the linking blocker** (see §7). |

---

## 7. Migration risks & open questions

**Risk / gotcha checklist**

- **Identity & linking key change (highest risk).** Today `whatsapp_users.phone` is the join key and `getLinkedUser(phone)` re-reads the LIVE role from `app_users`. Telegram supplies `chat.id`/`username`, NOT a phone — so the whole linking flow (`handleLinkingFlow`, `whatsapp_verifications`, `/api/whatsapp/link` upsert) needs a Telegram identity (new column/table keyed by `telegram_chat_id`, or a one-time deep-link token `t.me/bot?start=<code>`). The ERP-side confirm endpoint (`link.js`) takes the phone from the server record; it would need a `telegram_chat_id` equivalent. Decide whether to add columns to `whatsapp_users` (becomes multi-channel) or a new `telegram_users` table.
- **Same webhook, two channels.** Clients stay on WA, team moves to TG, both inside `api/whatsapp/webhook.js` (no 13th function). The POST handler must branch by payload shape: Meta (`body.object==='whatsapp_business_account'`, X-Hub-Signature-256) vs Telegram (`update_id` present, `X-Telegram-Bot-Api-Secret-Token`). Different secret-validation, different parser, then converge on the same `(text, mediaId, mimeType)` seam. Telegram can hit the same URL with `?` query or a distinct path the function already serves.
- **12/12 function cap.** No new Vercel function — Telegram inbound rides the existing webhook; Telegram sends ride existing handlers. If long-polling (`getUpdates`) were chosen instead of webhooks it would need a persistent process → not viable on Hobby; webhook + `setWebhook` is the only fit. Confirm this doesn't push the bundle past limits.
- **Callback_query is a different update kind.** Button taps don't arrive as messages — they're `callback_query` and require `answerCallbackQuery`. The `pick:`/`confirmar`/`editar`/`cancelar` normalization is reusable, but the inbound router must handle this second update type and map `callback_query.message.chat.id` to the conversation.
- **callback_data ≤64 bytes.** Today button ids are short (`confirmar`, `pick:<id>`). For list pickers (`pick:<facturaId>`) verify the id payload fits 64 bytes; if ERP ids are long UUIDs, store an index→id map in `conv.data` and send `pick:<n>` instead.
- **No 24h window = simplification, but `/start` gate.** Team Telegram sends (movimiento/factura pendiente, tarea asignada, followups, cliente firmó) no longer need templates — big win, removes the exact Meta pain. BUT a bot cannot message a user who never pressed `/start`. Every staff member must initiate once; until then no proactive send works.
- **Markdown differences.** WA `*bold*` ≠ Telegram. Pick `parse_mode:'Markdown'` (legacy, single-asterisk bold) or HTML; audit existing reply strings for `*`, `_`, `` ` `` that would break MarkdownV2.
- **Idempotency/dedup.** Swap wamid for `update_id`/`message_id` in `lastMsgIds`. Telegram retries un-200'd webhooks too, so keep the dedupe. The per-phone media lock (`acquireLock`, TTL 30s) must re-key on `chat.id`.
- **Redaction gaps ride along.** The cost leaks in §2 (como_va_obra, cc_proveedor, buscar_gastos, pendientes, avance cert `💰`, costoSubUnit prompt injection) are pre-existing — migrating "as-is" preserves the leaks. Since the constraint is "costos/márgenes solo admin," decide whether to fix them now (centralize `isAdmin`) or knowingly carry them.
- **No delivery receipts on Telegram.** `waStatus` persistence becomes the synchronous `sendMessage` response. Any logic depending on sent/delivered/read must be reworked (mostly diagnostic today).
- **Filepath/storage keys.** `uploadToStorage` and `pendingMediaUrl` use the phone as prefix → re-key on `chat.id` to keep comprobante files unambiguous.
- **`permisos` still ignored.** If the migration is the moment to honor granular `app_users.permisos`, that's new behavior, not a port.

**Open design questions for the user (decide before implementation):**

1. **Identity store:** add `telegram_chat_id`/`telegram_username` columns to `whatsapp_users` (one multi-channel table) or create a separate `telegram_users` table — and what's the linking handshake (deep-link `start` token vs reuse the 6-digit code + confirm-in-app)?
2. **Cost redaction:** fix the known leaks (como_va_obra, cc_proveedor, buscar_gastos, pendientes, avance `💰` cert, costoSubUnit) during the migration to actually satisfy "costos/márgenes solo admin," or port as-is and fix later? And does **Administración** count as cost-privileged (it already sees all open invoices)?
3. **Webhook routing:** branch the existing `webhook.js` POST by payload shape (Meta vs Telegram) on the same URL, or route Telegram to a distinct path the same function exports — and which secret-validation (`X-Telegram-Bot-Api-Secret-Token`)?
4. **Scope of the team move:** migrate ALL five WA→team sends (movimiento/factura pendiente, bot-tarea aviso, followups, cliente firmó) to Telegram, or only the pending-approval pair first?
5. **Onboarding bootstrap:** how do staff press `/start` once (rollout message / QR for the team bot), given a Telegram bot can't DM uninitiated users?
6. **Channel of record per user:** can a staff member be reachable on BOTH WA and TG (dual-send) during a transition, or is it a hard cutover to Telegram for the team?
7. **Button payloads:** are any picker ids (`pick:<facturaId>`) longer than 64 bytes — i.e. do we need an index→id indirection map in `conv.data`?

Source files referenced throughout: `api/whatsapp/webhook.js`, `api/whatsapp/jobs.js`, `api/whatsapp/link.js`, `api/whatsapp/_notif.js`, `api/whatsapp/_extractors.js`, `api/whatsapp/_intents-comercial.js`, `api/portal/firmar.js`, `src/lib/notificaciones.js`, `src/lib/push.js`, `src/store/NotificacionesContext.jsx`, `src/store/TareasContext.jsx`, `vercel.json`, `public/sw-push.js`, `public/sw.js`.