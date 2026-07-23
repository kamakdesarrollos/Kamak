// Cruce lead web ↔ base de campañas (hallazgo QA #21). Lógica PURA sin red —
// la consume leadsHandler (handlers.js) y la testea campanasMatch.test.js.
// El teléfono normalizado (telefono_norm, ver src/lib/campanas/normalizar.js)
// es la clave de matcheo contra camp_estaciones.

// Estaciones matcheadas por teléfono → operadores únicos. Un operador puede
// tener N estaciones con el mismo número: una sola actividad por operador,
// colgada de la PRIMERA estación que matcheó. Filas sin operador_id se saltean.
export function operadoresMatcheados(estaciones) {
  const porOperador = new Map();
  for (const e of estaciones || []) {
    if (!e || !e.operador_id) continue;
    if (!porOperador.has(e.operador_id)) porOperador.set(e.operador_id, e.id || null);
  }
  return [...porOperador.entries()].map(([operadorId, estacionId]) => ({ operadorId, estacionId }));
}

// Payload de camp_actividades para el cruce (shape de la tabla en
// supabase/migrations/0006_campanas.sql; id lo genera la DB por default).
export function actividadLeadWeb({ operadorId, estacionId, leadId, nowISO }) {
  return {
    operador_id: operadorId,
    estacion_id: estacionId || null,
    tipo: 'nota',
    canal: 'otro',
    texto: `Respondió por el form de la web (lead ${leadId})`,
    usuario: 'sistema',
    fecha: nowISO,
  };
}

// Etapas de prospección que el cruce PUEDE pisar a 'respondio'. Nunca se
// degrada una etapa más avanzada (en_conversacion, reunion, promovido, …).
export const ETAPAS_PISABLES = ['sin_contactar', 'contactado'];

// Cambios del PATCH a camp_operadores (updated_at explícito: no hay trigger).
export function patchOperadorRespondio(nowISO) {
  return { etapa_prospeccion: 'respondio', updated_at: nowISO };
}
