<!-- Verificación por workflow (12 agentes) post-fixes, 2026-05-31. M1 y M2 ya corregidos en commit 396f6ed. -->

# Informe de Verificación — Sesión de Fixes Kamak

## 1. Veredicto general

La sesión está **mayormente sólida**: 8 de 9 áreas funcionan correctamente con alta confianza, y la verificación objetiva (build + tests + sintaxis) pasa al 100%.

**Hay UN problema real a corregir antes de dar la sesión por cerrada:** una regresión de integridad de datos en *Imputar gasto a rubro* (severidad media). No bloquea el build ni rompe la app, pero puede hacer que un gasto desaparezca silenciosamente del desglose presupuesto-vs-real al cambiar de obra sin re-tocar el rubro. El resto son observaciones de severidad baja (código muerto, comentarios obsoletos, glitches de UX en casos extremos).

## 2. Tabla área → estado

| Área | Estado |
|------|--------|
| Traspaso cross-moneda | OK (2 obs. bajas) |
| Acreditar cheque propio | OK (2 obs. bajas) |
| Bot estado_cheque ajusta caja | OK — **1 riesgo medio** (idempotencia) |
| Firma webhook Meta | OK (2 obs. bajas) |
| Dashboard ARS+USD | OK (2 obs. bajas) |
| Quick wins (rol/fechas/cajas/plantillas) | OK (2 obs. bajas) |
| **Imputar gasto a rubro + desvío** | **PROBLEMA — regresión media** |
| Redeterminación CAC | OK (1 obs. baja) |
| Andamiaje WSFE | OK (2 obs. bajas) |
| Regresión en consumidores | OK (3 obs. bajas) |

## 3. Problemas reales ordenados por severidad

### Severidad MEDIA

**M1 — Gasto imputado a rubro fantasma al cambiar de obra**
- Ubicación: `src/pages/Movimientos.jsx` — `QuickAddForm`, estado `rubroNombre` (línea 388), usado en `save` (541-547).
- Qué pasa: `rubroNombre` no se resetea al cambiar `obraId`. Si se elige rubro en Obra A y luego se cambia a Obra B (que no lo tiene), el `<select>` se ve vacío pero el state conserva el nombre viejo. Al guardar, `rubroId` no se escribe (no matchea) pero `rubroNombre` sí se persiste. El gasto queda imputado a un rubro inexistente en B: no aparece en ningún rubro real ni en "sin rubro" del desglose "Ejecución por rubro", descuadrando la reconciliación.
- Fix sugerido: agregar un `useEffect` que haga `setRubroNombre('')` cuando cambia `obraId`; **o** validar en `save` que `rubrosImputables.find(x => x.nombre === rubroNombre)` exista antes de persistir `rubroNombre` (si no matchea, escribir `rubroNombre: null`).

**M2 — Bot estado_cheque sin guard de estado / no idempotente**
- Ubicación: `api/whatsapp/webhook.js:3000-3066` (lookup en 3006 sin filtro de estado; ramas 3026 y 3045).
- Qué pasa: el handler busca el cheque por número y ajusta la caja sin validar el estado actual. Reenviar "deposité el cheque 4421" dos veces hace dos traspasos (doble descuento); reenviar "rechazá 4421" genera plata fantasma; y rechazar un cheque YA depositado revierte contra `chq.cajaId` (caja origen) cuando la plata ya está en el banco, dejando la caja origen sub-contada y el banco sin respaldo.
- Fix sugerido: validar `chq.estado` antes de mover caja (p.ej. solo permitir depositar/cobrar/rechazar desde `'cartera'`); y para rechazar/anular un cheque depositado, revertir contra `cajaDestinoId`, no `cajaId`. Hacer la operación idempotente.

> Nota: este punto venía clasificado como "media" dentro del veredicto del área (que dio `correcto: true`). Lo elevo aquí porque es un riesgo adversarial real de descuadre de caja vía WhatsApp; no rompe build ni tests, pero conviene endurecerlo.

### Severidad BAJA (no bloqueantes — agrupadas)

- **Bot rubro sin validación server-side** — `api/whatsapp/webhook.js:1560-1561`: el bot persiste `rubroNombre` tal cual lo emite el LLM, sin reconciliar contra `ctx.detalles[obraId].rubros`. Si el LLM abrevia/alucina, cae en el mismo agujero que M1. Fix: matchear por nombre y completar `rubroId`, o descartar `rubroNombre` si no matchea.
- **Bot cheque legacy sin caja origen** — `webhook.js:3063-3065`: para tercero sin `cajaId`, el bot no genera ingreso al banco (la app sí). La plata del cheque legacy nunca se refleja.
- **Bot "cobrado" = "depositado" para terceros** — `webhook.js:3044-3056`: fuerza traspaso a banco aunque el cobro haya sido en efectivo.
- **Bot lookup de cheque solo por número** — `webhook.js:3006`: ignora el tipo; puede operar sobre el cheque equivocado si coexisten propio/tercero con el mismo número.
- **Traspaso sub-dólar redondea a 0** — `Movimientos.jsx:150-152,164` y `TraspasoModal.jsx:32-37,48`: ARS→USD < ~½ dólar redondea `montoDestino` a 0. Mitigar con `Math.max(1, ...)` o más decimales.
- **Constante `PORTAL_TOKEN_EXPIRY_MS` desactualizada** — `src/lib/constants.js:14`: sigue en 365 días; la lógica real (90 días) vive en `webhook.js:618` y no la usa. Código muerto. Fix: poner en `90 * MS_PER_DAY` o eliminar.
- **Comentario contradictorio en `cajaEsVisible`** — `webhook.js:965-967` (vs código correcto en 977-979) y repetido en 966-968: el comentario dice "array vacío → ve todas" cuando el código hace `[] = ninguna`. Solo limpiar el comentario.
- **`montoARS` es rama muerta** — `src/lib/caja.js:38`: ningún writer persiste `montoARS`; los movimientos USD siempre caen al fallback `monto*tc` (resultado correcto, pero el campo no se escribe).
- **Etiqueta botón "Acreditado"** (participio vs infinitivo) — `Cheques.jsx:246`; y cheque propio acreditado sin acción "Reactivar" — `Cheques.jsx:251` (consistente con "depositado").
- **Firma Meta fail-open** — `webhook.js:3745-3747`: si `META_APP_SECRET` está seteado pero el raw body no se pudo leer, procesa sin validar firma (es el comportamiento "degradar sin romper" pedido). Recomendación: monitorear ese warning en logs.
- **Fragilidad de test de timezone** — `dates.test.js:8,16` + `vite.config.js`: `today()` ahora depende de la TZ local; el test pasa en UTC-3 pero podría fallar en CI con TZ positiva. Fix: fijar `TZ=UTC` en el entorno de test.
- **Glitch UX en redeterminación CAC** — `Configuracion.jsx:195-198`: borrar un mes seleccionado como base/actual deja el state apuntando a un mes inexistente (muestra "faltan índices"); basta reseleccionar.
- **WSFE — código 3 (0% gravado) inalcanzable** y **NC/ND sin `CbtesAsoc` si la original es borrador** — `src/lib/wsfe.js:41,50-61,71-80`: defendibles como andamiaje (el endpoint devuelve 501).
- **Display cosmético** — `Dashboard.jsx:545` ("Cuotas próximas" con `$` fijo sin convertir USD) y header de traspasos sumando ARS+USD con prefijo `$` (`Movimientos.jsx:232,241`): preexistentes, fuera de alcance.
- **Lint preexistente** — varios en `src/store/*.jsx` y `Movimientos.jsx`: reglas de estilo, no introducidas esta sesión, sin impacto en runtime.

## 4. Tests / Build

- **Tests:** 205/205 pasan (11 archivos, vitest v4.1.7, 532 ms). 0 fallidos.
- **Build:** `vite build` (v8.0.13) compila sin errores — 182 módulos, 409 ms, `dist/` con los chunks esperados.
- **Sintaxis endpoints:** `node --check` OK en `api/whatsapp/webhook.js` y `api/afip/emitir.js`.
- **Lint:** sin errores nuevos introducidos esta sesión (los existentes son preexistentes y de estilo).

> El warning "Both esbuild and oxc options were set" en tests/build es informativo de config, no afecta resultados.

**Conclusión:** las verificaciones objetivas pasan al 100%. Funcionalmente, recomiendo corregir **M1** (riesgo real de descuadre presupuesto-vs-real) y, si se quiere endurecer el bot de WhatsApp, **M2** (idempotencia/guard de estado) antes de cerrar. Todo lo demás es cosmético o de UX de borde y no bloquea.