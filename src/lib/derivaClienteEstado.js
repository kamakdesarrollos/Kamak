// Estado comercial DERIVADO de un cliente (spec §7.3). Lógica PURA, sin React.
// .js explícito: la pueden importar scripts/bot en Node ESM.
import { DEFAULT_MESES_INACTIVO } from './constants.js';

// Una obra "ganada" (cliente real) está activa/finalizada/pausada; 'en-presupuesto'
// es oportunidad abierta; 'archivada' es perdida/cerrada (ni ganada ni abierta).
const esGanada = (o) => !!o && (o.estado === 'activa' || o.estado === 'finalizada' || o.estado === 'pausada');
const esAbierta = (o) => !!o && o.estado === 'en-presupuesto';

/**
 * derivaClienteEstado(cliente, obrasCliente, ultimaActividadISO?, opts?) →
 *   'prospecto' | 'cliente' | 'inactivo'
 * obrasCliente: obras YA filtradas de ese cliente. ultimaActividadISO: fecha ISO
 * de la última actividad CRM del cliente (o null).
 */
export function derivaClienteEstado(cliente, obrasCliente, ultimaActividadISO = null, { mesesInactivo = DEFAULT_MESES_INACTIVO, hoy = new Date() } = {}) {
  const obras = obrasCliente || [];
  if (obras.some(esGanada)) return 'cliente';
  if (obras.some(esAbierta)) return 'prospecto';

  // Sin obra ganada ni abierta: depende de cuán reciente sea la última señal.
  const fechas = [];
  for (const o of obras) {
    if (o && o.fechaFin) fechas.push(o.fechaFin);
    if (o && o.createdAt) fechas.push(o.createdAt);
  }
  if (ultimaActividadISO) fechas.push(ultimaActividadISO);
  const ultima = fechas.filter(Boolean).sort().slice(-1)[0];
  if (!ultima) return 'prospecto'; // cliente nuevo, sin historia
  const meses = (hoy.getTime() - new Date(ultima).getTime()) / (1000 * 60 * 60 * 24 * 30);
  return meses > mesesInactivo ? 'inactivo' : 'prospecto';
}
