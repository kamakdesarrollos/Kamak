# Backlog Kamak — recordatorios (2026-06-03)

Lista de pedidos del usuario (+ los marcados como de **Enzo**), ordenados por
valor/esfuerzo. Se hace **de a uno**.

## Estado del sistema de tareas (relevante para el backlog)
`src/store/TareasContext.jsx` YA tiene: tarea con `asignadoA` (array de usuarios),
`checklist` (items con `texto`/`completado`/`completadoPor`), `comentarios`
(array `{id,userId,texto,creadoAt}`, vía `addComentario`), `vistaPor`. La página
`src/pages/Tareas.jsx` muestra el checklist en el panel expandido, pero **no**
muestra los comentarios (solo se ven entrando al `TareaModal` a editar).

---

## Fase 1 — Mejoras al sistema de tareas (chicas, sobre lo existente)
1. **Comentarios visibles sin editar.** Hoy los comentarios se guardan pero solo
   se ven al editar. → Mostrarlos en la tarjeta / panel expandido de la tarea.
   _Chico._ **← arrancamos por acá.**
2. **Observaciones por ítem de checklist.** Hoy el ítem solo tiene `texto`. →
   Agregar nota/observación por ítem (campo + UI). _Chico-medio._
3. **Checklist asignable por persona + tarea grupal.** La tarea ya se asigna a
   varios; falta asignar **cada ítem** del checklist a una persona distinta
   (ej. "presupuesto obra" con ítems repartidos). _Medio._
4. **Adjuntar documentos/fotos a tareas.** Reutilizar el subidor multi-archivo
   (bucket `kamak-fotos`). _Medio (requiere policy 0004 aplicada)._

## Fase 2 — Notificaciones / bot
5. **Alerta a todo el equipo al iniciar/confirmar una obra.** Enganchar el cambio
   de estado de obra con AlertasContext + bot WhatsApp. _Medio._
6. **Aviso del bot 30 días posteriores.** Recordatorio diferido del bot. _Medio
   (depende de cron/scheduler del bot)._
7. **Factura "pendiente de pago" → saldarla (conectar con bot).** Cargar factura
   que queda pendiente y luego se salda; el bot avisa. _Medio-grande._

## Fase 3 — Personas / equipo
8. **Agregar a Enzo** — ingeniero eléctrico **terciarizado (externo)**. Alta de
   usuario con **rol acotado**: ver los **planos** de cada obra (tab Documentos
   tipo Planos) y poder **subir documentación**. SIN acceso al resto (finanzas,
   presupuestos, cajas, etc.). _Chico-medio — define un patrón de "rol externo /
   colaborador" reutilizable. Falta de Enzo: email + teléfono. Nota: la subida de
   archivos ya queda habilitada por la policy 0004 (rol authenticated)._
9. **Ficha de empleados** (datos completos + fotos de DNI). _Módulo nuevo —
   grande._ Base para el ítem 10.
10. **Altas/bajas de nómina de seguros (ART).** Sobre la ficha de empleados.
    _Grande._

## Fase 4 — Comercial
11. **Contrato / locación de obra unificado:** carta oferta + aceptación de la
    carta oferta + presupuesto, todo en un mismo documento. _Grande (generador
    de documento)._

---

## Orden propuesto de ejecución
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8(Enzo, cuando haya datos) → 9 → 10 → 11.
(Las grandes 9/10/11 se brainstormean aparte antes de codear.)
