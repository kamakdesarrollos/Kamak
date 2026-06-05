// Etapas del embudo de ventas (módulo Comercial). Lógica PURA, sin React,
// para poder testearla y reusarla en scripts. Ver spec §7.
// IMPORTANTE: extensión .js explícita — este módulo lo importa también el script
// Node del backfill (Task 3), y Node ESM no resuelve imports sin extensión.
import { ETAPAS_VENTA } from './constants.js';

// Metadatos por etapa para el Kanban (color en hex del theme T).
export const ETAPA_META = {
  prospecto:   { label: 'Prospecto',   color: '#9a9892' }, // T.ink3
  cotizado:    { label: 'Cotizado',    color: '#1a9b9c' }, // T.accent
  negociacion: { label: 'Negociación', color: '#d4923a' }, // T.warn
  ganado:      { label: 'Ganado',      color: '#3d7a4a' }, // T.ok
  perdido:     { label: 'Perdido',     color: '#b91c1c' }, // rojo
};

// Estado de obra que corresponde a una etapa de venta (spec §7.1).
export function obraEstadoParaEtapa(etapa, estadoActual) {
  if (etapa === 'ganado')  return estadoActual === 'finalizada' ? 'finalizada' : 'activa';
  if (etapa === 'perdido') return 'archivada';
  return 'en-presupuesto'; // prospecto / cotizado / negociacion (reabre si venía cerrada)
}

// Etapa EFECTIVA para mostrar: reconcilia la etapa guardada con la realidad de la
// obra. Un pago, o estado activa/finalizada, fuerza 'ganado' aunque no se haya
// guardado todavía (el Kanban nunca muestra una obra cobrada como "cotizado").
export function etapaEfectiva(obra, { cobradoUSD = 0 } = {}) {
  if (!obra) return 'prospecto';
  const guardada = obra.venta && obra.venta.etapa;
  if (obra.estado === 'activa' || obra.estado === 'finalizada' || cobradoUSD > 0) {
    return guardada === 'perdido' ? 'perdido' : 'ganado';
  }
  if (obra.estado === 'archivada') return guardada || 'perdido';
  // en-presupuesto:
  if (guardada && guardada !== 'ganado' && ETAPAS_VENTA.includes(guardada)) return guardada;
  return 'prospecto';
}

// Etapa inicial para el backfill one-time de las obras existentes (spec §7.4).
export function etapaInicialBackfill(obra, { propuestaEnviada = false, tieneIngreso = false } = {}) {
  const e = obra && obra.estado;
  if (e === 'activa' || e === 'finalizada') return 'ganado';
  if (e === 'archivada') return tieneIngreso ? 'ganado' : 'perdido';
  return propuestaEnviada ? 'cotizado' : 'prospecto';
}

// ¿La obra debería pasar a 'ganado' por haber recibido un pago? (reconciler global).
export function necesitaGanarPorPago(obra, cobradoUSD) {
  if (!obra || !(cobradoUSD > 0)) return false;
  const etapa = obra.venta && obra.venta.etapa;
  return etapa !== 'ganado' && etapa !== 'perdido';
}

// Resumen del embudo desde las etapas efectivas de las oportunidades.
export function resumenEmbudo(etapas) {
  const conteo = { prospecto: 0, cotizado: 0, negociacion: 0, ganado: 0, perdido: 0 };
  for (const e of etapas || []) if (e in conteo) conteo[e]++;
  const cerradas = conteo.ganado + conteo.perdido;
  const conversion = cerradas > 0 ? Math.round((conteo.ganado / cerradas) * 100) : 0;
  const abiertas = conteo.prospecto + conteo.cotizado + conteo.negociacion;
  return { conteo, cerradas, conversion, abiertas };
}
