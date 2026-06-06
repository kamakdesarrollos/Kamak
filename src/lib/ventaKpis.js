// KPIs del embudo de ventas (módulo Comercial). Lógica PURA, sin React.
import { PROBABILIDAD_POR_ETAPA } from './constants.js';

// Pipeline ponderado = Σ(montoUSD × probabilidad[etapa]) sobre las oportunidades.
export function pipelinePonderado(oportunidades) {
  return Math.round((oportunidades || []).reduce((s, op) => s + (op.montoUSD || 0) * (PROBABILIDAD_POR_ETAPA[op.etapa] || 0), 0));
}

// Días que una obra lleva en su etapa actual (desde venta.fechaCambioEtapa).
export function agingDias(obra, hoy = new Date()) {
  const f = obra?.venta?.fechaCambioEtapa;
  if (!f) return null;
  return Math.floor((hoy.getTime() - new Date(f).getTime()) / (1000 * 60 * 60 * 24));
}

// Regla de apagado (§8): avisar follow-up SOLO si la oportunidad está abierta,
// en-presupuesto, sin ingreso, en cotizado/negociación y lleva > N días.
export function debeAvisarFollowup(obra, { tieneIngreso = false, hoy = new Date(), dias = 5 } = {}) {
  if (!obra || obra.estado !== 'en-presupuesto') return false;
  const etapa = obra.venta?.etapa;
  if (etapa !== 'cotizado' && etapa !== 'negociacion') return false;
  if (tieneIngreso) return false;
  const aging = agingDias(obra, hoy);
  return aging != null && aging > dias;
}

// Ranking de motivos de pérdida (de las obras perdidas).
export function motivosPerdida(obras) {
  const m = {};
  for (const o of obras || []) {
    if (o?.venta?.etapa === 'perdido') {
      const mot = (o.venta.motivoPerdida || '(sin motivo)').trim() || '(sin motivo)';
      m[mot] = (m[mot] || 0) + 1;
    }
  }
  return Object.entries(m).map(([motivo, count]) => ({ motivo, count })).sort((a, b) => b.count - a.count);
}

// Win rate por responsable comercial (ganadas / cerradas).
export function winRatePorResponsable(oportunidades) {
  const r = {};
  for (const op of oportunidades || []) {
    const k = op.responsable || '(sin responsable)';
    r[k] = r[k] || { ganadas: 0, perdidas: 0, winRate: 0 };
    if (op.etapa === 'ganado') r[k].ganadas++;
    else if (op.etapa === 'perdido') r[k].perdidas++;
  }
  for (const k of Object.keys(r)) { const cerradas = r[k].ganadas + r[k].perdidas; r[k].winRate = cerradas > 0 ? Math.round((r[k].ganadas / cerradas) * 100) : 0; }
  return r;
}
