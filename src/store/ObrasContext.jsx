import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { loadSharedData, saveSharedData, appendItemInSharedArray, appendObjectItem, patchObjectItem, removeObjectItem, patchDetalleObra } from '../lib/dbHelpers';
import { onRemoteChange } from '../lib/syncBus';
import { useAppLoading } from './AppLoadingContext';
import { SAVE_DEBOUNCE_MS } from '../lib/constants';
import { cascadeRubroRenameEnDetalle } from '../lib/catalogCascade';

// Alerta global "obra iniciada" para todo el equipo (campana del Topbar +
// dashboard). Se dispara cuando una obra pasa a 'activa' — sea confirmándola a
// mano, al aprobar el presupuesto, o automáticamente al recibir el primer pago
// (recibir plata auto-aprueba el presupuesto y activa la obra). Append atómico
// en shared_data 'alertas'.
//
// De-dupe por obra dentro de la sesión: aunque la transición se evalúe dos veces
// muy rápido (antes de que obrasRef se sincronice), la alerta sale UNA sola vez.
function emitAlertaObraIniciada(obra, yaAlertadas) {
  if (!obra || yaAlertadas.has(obra.id)) return;
  yaAlertadas.add(obra.id);
  appendItemInSharedArray('alertas', {
    id:     `alerta-obra-${obra.id}-${Date.now()}`,
    tipo:   'obra_iniciada',
    texto:  `Se inició la obra "${obra.nombre}"${obra.cliente ? ' — ' + obra.cliente : ''}. ¡A trabajar!`,
    obra:   obra.nombre,
    obraId: obra.id,
    tarea:  '',
    fecha:  new Date().toISOString(),
    leida:  false,
    fuente: 'app',
  });
}

// ── Datos semilla obras ───────────────────────────────────────────────────────
const SEED_OBRAS = [
  { id: 'baradero', nombre: 'Baradero', cliente: 'Familia Pérez', direccion: 'San Martín 420, Baradero', tipo: 'Estación de Servicio', estado: 'activa', moneda: 'ARS', presupuesto: 18500000, gastado: 11800000, avance: 64, margen: 28, fechaInicio: '2026-01-15', fechaFinEstim: '2026-08-12', fechaFin: '', notas: '', createdAt: '2026-01-10T10:00:00Z' },
  { id: 'san-isidro', nombre: 'San Isidro', cliente: 'Estación Shell', direccion: 'Av. Centenario 1200, San Isidro', tipo: 'Estación de Servicio', estado: 'activa', moneda: 'USD', presupuesto: 145000, gastado: 32000, avance: 22, margen: 31, fechaInicio: '2026-02-01', fechaFinEstim: '2026-09-30', fechaFin: '', notas: '', createdAt: '2026-01-28T10:00:00Z' },
  { id: 'tigre', nombre: 'Tigre', cliente: 'Panadería del Sur', direccion: 'Av. Italia 340, Tigre', tipo: 'Panadería completa', estado: 'activa', moneda: 'ARS', presupuesto: 8200000, gastado: 7500000, avance: 92, margen: 22, fechaInicio: '2025-10-01', fechaFinEstim: '2026-05-25', fechaFin: '', notas: 'Cerca del cierre', createdAt: '2025-09-20T10:00:00Z' },
  { id: 'pilar', nombre: 'Pilar', cliente: 'Casa Gómez', direccion: 'Los Robles 45, Pilar', tipo: 'Vivienda unifamiliar', estado: 'activa', moneda: 'USD', presupuesto: 220000, gastado: 18000, avance: 8, margen: 35, fechaInicio: '2026-04-01', fechaFinEstim: '2026-12-10', fechaFin: '', notas: '', createdAt: '2026-03-15T10:00:00Z' },
  { id: 'recoleta', nombre: 'Recoleta', cliente: 'Local López', direccion: 'Av. Santa Fe 3450, Recoleta', tipo: 'Local comercial', estado: 'activa', moneda: 'ARS', presupuesto: 6000000, gastado: 4200000, avance: 45, margen: -3, fechaInicio: '2026-02-15', fechaFinEstim: '2026-07-15', fechaFin: '', notas: 'Sobrecosto en materiales', createdAt: '2026-02-01T10:00:00Z' },
  { id: 'rosario-1', nombre: 'Rosario', cliente: 'Fundación Esperanza', direccion: 'Corrientes 1234, Rosario', tipo: 'Local comercial', estado: 'en-presupuesto', moneda: 'ARS', presupuesto: 12000000, gastado: 0, avance: 0, margen: 0, fechaInicio: '', fechaFinEstim: '2026-11-01', fechaFin: '', notas: 'En revisión con cliente', createdAt: '2026-05-01T10:00:00Z' },
  { id: 'martinez-1', nombre: 'Martínez', cliente: 'Arq. Ruiz', direccion: 'Av. Libertador 5600, Martínez', tipo: 'Vivienda unifamiliar', estado: 'en-presupuesto', moneda: 'USD', presupuesto: 180000, gastado: 0, avance: 0, margen: 0, fechaInicio: '', fechaFinEstim: '2027-03-01', fechaFin: '', notas: '', createdAt: '2026-05-10T10:00:00Z' },
  { id: 'moreno-1', nombre: 'Moreno', cliente: 'YPF SA', direccion: 'Ruta 7 km 42, Moreno', tipo: 'Estación de Servicio', estado: 'en-presupuesto', moneda: 'USD', presupuesto: 210000, gastado: 0, avance: 0, margen: 0, fechaInicio: '', fechaFinEstim: '2027-01-01', fechaFin: '', notas: 'Pendiente aprobación YPF', createdAt: '2026-05-12T10:00:00Z' },
  { id: 'quilmes-1', nombre: 'Quilmes', cliente: 'Bodega del Sol SRL', direccion: 'Av. Mitre 800, Quilmes', tipo: 'Galpón industrial', estado: 'pausada', moneda: 'ARS', presupuesto: 9500000, gastado: 3200000, avance: 33, margen: 18, fechaInicio: '2025-12-01', fechaFinEstim: '2026-06-30', fechaFin: '', notas: 'Pausada por falta de financiamiento', createdAt: '2025-11-20T10:00:00Z' },
  { id: 'palermo-1', nombre: 'Palermo', cliente: 'Café Cortado SRL', direccion: 'Gurruchaga 1450, CABA', tipo: 'Local comercial', estado: 'finalizada', moneda: 'ARS', presupuesto: 4200000, gastado: 3980000, avance: 100, margen: 24, fechaInicio: '2025-06-01', fechaFinEstim: '2025-11-30', fechaFin: '2025-12-05', notas: '', createdAt: '2025-05-20T10:00:00Z' },
  { id: 'flores-1', nombre: 'Flores', cliente: 'Familia Martínez', direccion: 'Av. Rivadavia 6700, Flores', tipo: 'Vivienda unifamiliar', estado: 'finalizada', moneda: 'ARS', presupuesto: 7800000, gastado: 7400000, avance: 100, margen: 19, fechaInicio: '2025-03-01', fechaFinEstim: '2025-09-30', fechaFin: '2025-10-15', notas: '', createdAt: '2025-02-15T10:00:00Z' },
  { id: 'lomas-1', nombre: 'Lomas de Zamora', cliente: 'Shell Argentina', direccion: 'Av. H. Yrigoyen 3200, Lomas', tipo: 'Estación de Servicio', estado: 'finalizada', moneda: 'USD', presupuesto: 138000, gastado: 131000, avance: 100, margen: 15, fechaInicio: '2024-09-01', fechaFinEstim: '2025-05-01', fechaFin: '2025-05-20', notas: '', createdAt: '2024-08-15T10:00:00Z' },
  { id: 'belgrano-1', nombre: 'Belgrano', cliente: 'Inmobiliaria Sur', direccion: 'Cabildo 2100, Belgrano', tipo: 'Refacción baño', estado: 'archivada', moneda: 'ARS', presupuesto: 1800000, gastado: 1650000, avance: 100, margen: 22, fechaInicio: '2024-01-01', fechaFinEstim: '2024-06-30', fechaFin: '2024-07-10', notas: '', createdAt: '2023-12-15T10:00:00Z' },
];

// ── Datos semilla detalle por obra ────────────────────────────────────────────
export const EMPTY_DETALLE = { rubros: [], adicionales: [], movimientos: [], cuotas: [], contratos: [], documentos: [], fotos: [], mensajes: [], gantt: null, financiacion: {} };

const SEED_DETALLES = {
  baradero: {
    rubros: [
      { id: 'r-ela', nombre: 'ELECTRICIDAD', orden: 0, proveedor: 'Don Luis SRL', margenMat: 20, margenMO: 40, abierto: true,
        tareas: [
          { id: 't-ela-1', codigo: 'ELE-BOC-001', nombre: 'Bocas de luz', unidad: 'u', cantidad: 80, costoMat: 1000, costoMO: 3000, costoGral: 0, avance: 75 },
          { id: 't-ela-2', codigo: 'ELE-TOM-001', nombre: 'Tomas 220V', unidad: 'u', cantidad: 45, costoMat: 800, costoMO: 3000, costoGral: 0, avance: 60 },
          { id: 't-ela-3', codigo: 'ELE-LLA-001', nombre: 'Llaves', unidad: 'u', cantidad: 35, costoMat: 600, costoMO: 3000, costoGral: 0, avance: 40 },
          { id: 't-ela-4', codigo: 'ELE-TAB-001', nombre: 'Tablero principal', unidad: 'gl', cantidad: 1, costoMat: 120000, costoMO: 168000, costoGral: 0, avance: 0 },
          { id: 't-ela-5', codigo: 'ELE-CAN-001', nombre: 'Cañería corrugada', unidad: 'm', cantidad: 120, costoMat: 400, costoMO: 600, costoGral: 0, avance: 85 },
        ] },
      { id: 'r-alb', nombre: 'ALBAÑILERÍA', orden: 1, proveedor: '', margenMat: 15, margenMO: 35, abierto: false,
        tareas: [
          { id: 't-alb-1', codigo: 'ALB-MUR-001', nombre: 'Mampostería ladrillo', unidad: 'm²', cantidad: 320, costoMat: 4500, costoMO: 8000, costoGral: 0, avance: 90 },
          { id: 't-alb-2', codigo: 'ALB-REV-001', nombre: 'Revoque grueso', unidad: 'm²', cantidad: 280, costoMat: 2000, costoMO: 4500, costoGral: 0, avance: 70 },
          { id: 't-alb-3', codigo: 'ALB-CEL-001', nombre: 'Cielorraso yeso', unidad: 'm²', cantidad: 150, costoMat: 3000, costoMO: 5000, costoGral: 0, avance: 30 },
          { id: 't-alb-4', codigo: 'ALB-PIS-001', nombre: 'Contrapiso + carpeta', unidad: 'm²', cantidad: 200, costoMat: 5500, costoMO: 6000, costoGral: 0, avance: 100 },
          { id: 't-alb-5', codigo: 'ALB-CER-001', nombre: 'Cerámicos', unidad: 'm²', cantidad: 180, costoMat: 8000, costoMO: 4000, costoGral: 0, avance: 20 },
        ] },
      { id: 'r-est', nombre: 'ESTRUCTURA', orden: 2, proveedor: 'Hormigones Norte SRL', margenMat: 15, margenMO: 30, abierto: false,
        tareas: [
          { id: 't-est-1', codigo: 'EST-CIM-001', nombre: 'Cimentaciones y zapatas', unidad: 'm³', cantidad: 45, costoMat: 12000, costoMO: 18000, costoGral: 0, avance: 100 },
          { id: 't-est-2', codigo: 'EST-VIG-001', nombre: 'Vigas y columnas HA', unidad: 'm³', cantidad: 28, costoMat: 18000, costoMO: 22000, costoGral: 0, avance: 100 },
          { id: 't-est-3', codigo: 'EST-LON-001', nombre: 'Losa maciza', unidad: 'm²', cantidad: 200, costoMat: 8000, costoMO: 12000, costoGral: 0, avance: 100 },
          { id: 't-est-4', codigo: 'EST-MUR-001', nombre: 'Muro de contención', unidad: 'm²', cantidad: 60, costoMat: 9000, costoMO: 14000, costoGral: 0, avance: 80 },
        ] },
      { id: 'r-plo', nombre: 'PLOMERÍA', orden: 3, proveedor: '', margenMat: 20, margenMO: 40, abierto: false,
        tareas: [
          { id: 't-plo-1', codigo: 'PLO-FRI-001', nombre: 'Cañerías agua fría', unidad: 'm', cantidad: 180, costoMat: 1200, costoMO: 2500, costoGral: 0, avance: 45 },
          { id: 't-plo-2', codigo: 'PLO-CAL-001', nombre: 'Cañerías agua caliente', unidad: 'm', cantidad: 120, costoMat: 1800, costoMO: 2800, costoGral: 0, avance: 10 },
          { id: 't-plo-3', codigo: 'PLO-CL-001', nombre: 'Cloacas', unidad: 'm', cantidad: 90, costoMat: 2200, costoMO: 3500, costoGral: 0, avance: 60 },
          { id: 't-plo-4', codigo: 'PLO-PLU-001', nombre: 'Pluviales', unidad: 'm', cantidad: 40, costoMat: 1400, costoMO: 2000, costoGral: 0, avance: 0 },
        ] },
      { id: 'r-pin', nombre: 'PINTURA', orden: 4, proveedor: 'Pinturas Barugel', margenMat: 25, margenMO: 45, abierto: false,
        tareas: [
          { id: 't-pin-1', codigo: 'PIN-INT-001', nombre: 'Pintura interior látex', unidad: 'm²', cantidad: 400, costoMat: 800, costoMO: 1200, costoGral: 0, avance: 0 },
          { id: 't-pin-2', codigo: 'PIN-EXT-001', nombre: 'Pintura exterior', unidad: 'm²', cantidad: 250, costoMat: 1200, costoMO: 1800, costoGral: 0, avance: 0 },
          { id: 't-pin-3', codigo: 'PIN-IMP-001', nombre: 'Impermeabilización', unidad: 'm²', cantidad: 80, costoMat: 3500, costoMO: 2500, costoGral: 0, avance: 0 },
        ] },
      { id: 'r-car', nombre: 'CARPINTERÍA', orden: 5, proveedor: '', margenMat: 20, margenMO: 35, abierto: false,
        tareas: [
          { id: 't-car-1', codigo: 'CAR-MAR-001', nombre: 'Marcos y puertas int.', unidad: 'u', cantidad: 12, costoMat: 28000, costoMO: 12000, costoGral: 0, avance: 0 },
          { id: 't-car-2', codigo: 'CAR-PEX-001', nombre: 'Puerta exterior PVC', unidad: 'u', cantidad: 2, costoMat: 85000, costoMO: 15000, costoGral: 0, avance: 0 },
          { id: 't-car-3', codigo: 'CAR-VEN-001', nombre: 'Ventanas aluminio', unidad: 'u', cantidad: 18, costoMat: 32000, costoMO: 8000, costoGral: 0, avance: 0 },
        ] },
    ],
    adicionales: [
      { id: 'ad-1', descripcion: 'Ampliación tablero secundario cocina', fecha: '2026-03-10', monto: 85000, estado: 'aprobado' },
      { id: 'ad-2', descripcion: 'Cambio cerámicos baño por modelo premium', fecha: '2026-04-02', monto: 120000, estado: 'pendiente' },
    ],
    movimientos: [
      { id: 'mv-1', fecha: '2026-05-15', tipo: 'gasto', descripcion: 'Mat. eléctrica · Don Luis SRL', monto: 245000, rubro: 'ELECTRICIDAD', proveedor: 'Don Luis SRL', caja: 'Banco Galicia ARS' },
      { id: 'mv-2', fecha: '2026-05-10', tipo: 'gasto', descripcion: 'Pago Leandro V. · estructura', monto: 500000, rubro: 'ESTRUCTURA', proveedor: 'Leandro V.', caja: 'Banco Galicia ARS' },
      { id: 'mv-3', fecha: '2026-05-08', tipo: 'ingreso', descripcion: 'Cobro cliente · cuota 4', monto: 1200000, rubro: '—', proveedor: '', caja: 'Banco Galicia ARS' },
      { id: 'mv-4', fecha: '2026-04-28', tipo: 'gasto', descripcion: 'Mat. albañilería · Easy Construccion', monto: 380000, rubro: 'ALBAÑILERÍA', proveedor: 'Easy Construccion', caja: 'Banco Galicia ARS' },
      { id: 'mv-5', fecha: '2026-04-15', tipo: 'gasto', descripcion: 'ECHEQ #4421 · Leandro · estructura', monto: 350000, rubro: 'ESTRUCTURA', proveedor: 'Leandro V.', caja: 'Banco Galicia ARS' },
      { id: 'mv-6', fecha: '2026-04-01', tipo: 'ingreso', descripcion: 'Cobro cliente · cuota 3', monto: 1000000, rubro: '—', proveedor: '', caja: 'Banco Galicia ARS' },
      { id: 'mv-7', fecha: '2026-03-15', tipo: 'gasto', descripcion: 'Hormigón vigas · Hormigones Norte', monto: 860000, rubro: 'ESTRUCTURA', proveedor: 'Hormigones Norte SRL', caja: 'Banco Galicia ARS' },
      { id: 'mv-8', fecha: '2026-03-01', tipo: 'ingreso', descripcion: 'Cobro cliente · cuota 2', monto: 1000000, rubro: '—', proveedor: '', caja: 'Banco Galicia ARS' },
    ],
    cuotas: [
      { id: 'cq-1', n: 1, descripcion: 'Anticipo', fecha: '2026-01-20', monto: 1200000, estado: 'pagado' },
      { id: 'cq-2', n: 2, descripcion: 'Al inicio estructura', fecha: '2026-03-01', monto: 1000000, estado: 'pagado' },
      { id: 'cq-3', n: 3, descripcion: 'Al 30% de avance', fecha: '2026-04-01', monto: 1000000, estado: 'pagado' },
      { id: 'cq-4', n: 4, descripcion: 'Al 50% de avance', fecha: '2026-05-08', monto: 1200000, estado: 'pagado' },
      { id: 'cq-5', n: 5, descripcion: 'Al 70% de avance', fecha: '2026-06-15', monto: 1000000, estado: 'proximo' },
      { id: 'cq-6', n: 6, descripcion: 'Al 85% de avance', fecha: '2026-07-20', monto: 800000, estado: 'pendiente' },
      { id: 'cq-7', n: 7, descripcion: 'Recepción definitiva', fecha: '2026-08-12', monto: 500000, estado: 'pendiente' },
    ],
    contratos: [
      { id: 'ct-1', gremio: 'Electricidad', proveedor: 'Leandro V.', monto: 234600, estado: 'activo', fechaInicio: '2026-01-15', fechaFin: '2026-07-30', fondoReparo: 5 },
      { id: 'ct-2', gremio: 'Albañilería', proveedor: 'Construcciones SA', monto: 1850000, estado: 'activo', fechaInicio: '2026-01-15', fechaFin: '2026-08-12', fondoReparo: 5 },
      { id: 'ct-3', gremio: 'Estructura', proveedor: 'Hormigones Norte SRL', monto: 3200000, estado: 'cerrado', fechaInicio: '2026-01-15', fechaFin: '2026-04-30', fondoReparo: 5 },
    ],
    documentos: [
      { id: 'dc-1', nombre: 'Contrato de obra firmado', tipo: 'Contrato', fecha: '2026-01-10' },
      { id: 'dc-2', nombre: 'Presupuesto v3 aprobado', tipo: 'Presupuesto', fecha: '2026-01-08' },
      { id: 'dc-3', nombre: 'Planos aprobados municipio', tipo: 'Planos', fecha: '2026-01-20' },
      { id: 'dc-4', nombre: 'Certificado de avance N°1', tipo: 'Certificado', fecha: '2026-04-01' },
      { id: 'dc-5', nombre: 'Certificado de avance N°2', tipo: 'Certificado', fecha: '2026-05-08' },
    ],
    fotos: [
      { id: 'ft-1', label: 'Excavación y cimentaciones', fecha: '2026-01-20', rubro: 'Estructura' },
      { id: 'ft-2', label: 'Hormigón vigas', fecha: '2026-02-10', rubro: 'Estructura' },
      { id: 'ft-3', label: 'Losa terminada', fecha: '2026-03-01', rubro: 'Estructura' },
      { id: 'ft-4', label: 'Inicio albañilería', fecha: '2026-03-15', rubro: 'Albañilería' },
      { id: 'ft-5', label: 'Mampostería PB', fecha: '2026-04-01', rubro: 'Albañilería' },
      { id: 'ft-6', label: 'Cañería eléctrica embutida', fecha: '2026-04-20', rubro: 'Electricidad' },
      { id: 'ft-7', label: 'Revoque grueso avance', fecha: '2026-05-05', rubro: 'Albañilería' },
      { id: 'ft-8', label: 'Tablero principal instalado', fecha: '2026-05-12', rubro: 'Electricidad' },
    ],
    mensajes: [
      { id: 'msg-1', autor: 'kamak', texto: 'El tablero eléctrico ya está instalado. La semana próxima terminamos bocas de luz PB.', fecha: '2026-05-15T10:00:00Z' },
      { id: 'msg-2', autor: 'cliente', texto: '¿Cuándo podremos hacer la visita de obra?', fecha: '2026-05-16T09:00:00Z' },
      { id: 'msg-3', autor: 'kamak', texto: 'Podemos coordinar para el viernes 23/5 a las 10hs. ¿Les parece?', fecha: '2026-05-17T08:00:00Z' },
    ],
  },
  tigre: {
    rubros: [
      { id: 'r-alb', nombre: 'ALBAÑILERÍA', orden: 0, proveedor: '', margenMat: 15, margenMO: 35, abierto: true,
        tareas: [
          { id: 't-alb-1', codigo: 'ALB-PIS-001', nombre: 'Piso cerámico', unidad: 'm²', cantidad: 120, costoMat: 8000, costoMO: 3500, costoGral: 0, avance: 95 },
          { id: 't-alb-2', codigo: 'ALB-REV-001', nombre: 'Revoque interior', unidad: 'm²', cantidad: 200, costoMat: 1800, costoMO: 4000, costoGral: 0, avance: 90 },
          { id: 't-alb-3', codigo: 'ALB-PAR-001', nombre: 'Paredes locales', unidad: 'm²', cantidad: 180, costoMat: 3200, costoMO: 5000, costoGral: 0, avance: 100 },
        ] },
      { id: 'r-ela', nombre: 'ELECTRICIDAD', orden: 1, proveedor: 'Don Luis SRL', margenMat: 20, margenMO: 40, abierto: false,
        tareas: [
          { id: 't-ela-1', codigo: 'ELE-BOC-001', nombre: 'Bocas de luz', unidad: 'u', cantidad: 40, costoMat: 1000, costoMO: 3000, costoGral: 0, avance: 100 },
          { id: 't-ela-2', codigo: 'ELE-TAB-001', nombre: 'Tablero general', unidad: 'gl', cantidad: 1, costoMat: 85000, costoMO: 120000, costoGral: 0, avance: 80 },
        ] },
      { id: 'r-pin', nombre: 'PINTURA', orden: 2, proveedor: '', margenMat: 25, margenMO: 45, abierto: false,
        tareas: [
          { id: 't-pin-1', codigo: 'PIN-INT-001', nombre: 'Pintura interior', unidad: 'm²', cantidad: 280, costoMat: 800, costoMO: 1200, costoGral: 0, avance: 85 },
        ] },
    ],
    adicionales: [
      { id: 'ad-1', descripcion: 'Cambio de griferías a modelo acero', fecha: '2026-03-20', monto: 45000, estado: 'aprobado' },
    ],
    movimientos: [
      { id: 'mv-1', fecha: '2026-05-10', tipo: 'gasto', descripcion: 'Mat. pintura final', monto: 180000, rubro: 'PINTURA', proveedor: 'Pinturas Barugel', caja: 'Efectivo Tigre' },
      { id: 'mv-2', fecha: '2026-04-28', tipo: 'ingreso', descripcion: 'Cobro cliente · última cuota', monto: 800000, rubro: '—', proveedor: '', caja: 'Banco Galicia ARS' },
      { id: 'mv-3', fecha: '2026-04-15', tipo: 'gasto', descripcion: 'MO Pintura · Ariel', monto: 120000, rubro: 'PINTURA', proveedor: 'Ariel Pintor', caja: 'Efectivo Tigre' },
    ],
    cuotas: [
      { id: 'cq-1', n: 1, descripcion: 'Anticipo 40%', fecha: '2025-10-15', monto: 3280000, estado: 'pagado' },
      { id: 'cq-2', n: 2, descripcion: 'Al 60% de avance', fecha: '2026-02-01', monto: 2460000, estado: 'pagado' },
      { id: 'cq-3', n: 3, descripcion: 'Recepción definitiva', fecha: '2026-05-25', monto: 2460000, estado: 'proximo' },
    ],
    contratos: [
      { id: 'ct-1', gremio: 'Albañilería general', proveedor: 'Hernán y Assoc.', monto: 4500000, estado: 'activo', fechaInicio: '2025-10-01', fechaFin: '2026-05-25', fondoReparo: 5 },
    ],
    documentos: [
      { id: 'dc-1', nombre: 'Contrato de obra', tipo: 'Contrato', fecha: '2025-09-20' },
      { id: 'dc-2', nombre: 'Presupuesto final aprobado', tipo: 'Presupuesto', fecha: '2025-09-18' },
    ],
    fotos: [
      { id: 'ft-1', label: 'Demolición local anterior', fecha: '2025-10-05', rubro: 'Albañilería' },
      { id: 'ft-2', label: 'Estructura nueva', fecha: '2025-11-20', rubro: 'Estructura' },
      { id: 'ft-3', label: 'Piso terminado PB', fecha: '2026-02-15', rubro: 'Albañilería' },
      { id: 'ft-4', label: 'Pintura en progreso', fecha: '2026-04-20', rubro: 'Pintura' },
    ],
    mensajes: [
      { id: 'msg-1', autor: 'kamak', texto: 'La pintura interior está al 85%. Estimamos terminar la próxima semana.', fecha: '2026-05-10T10:00:00Z' },
      { id: 'msg-2', autor: 'cliente', texto: 'Perfecto, les avisamos para coordinar la recepción.', fecha: '2026-05-11T08:30:00Z' },
    ],
  },
};

// ── Storage ───────────────────────────────────────────────────────────────────
const KEY_OBRAS = 'kamak_obras_v1';
const KEY_DET = 'kamak_detalle_v1';

const loadObras = () => { try { const r = localStorage.getItem(KEY_OBRAS); return r ? JSON.parse(r) : SEED_OBRAS; } catch { return SEED_OBRAS; } };
const loadDet = () => { try { const r = localStorage.getItem(KEY_DET); return r ? JSON.parse(r) : SEED_DETALLES; } catch { return SEED_DETALLES; } };
const saveObras = (v) => { try { localStorage.setItem(KEY_OBRAS, JSON.stringify(v)); } catch { /* ignore */ } };
const saveDet = (v) => { try { localStorage.setItem(KEY_DET, JSON.stringify(v)); } catch { /* ignore */ } };

// ── Context ───────────────────────────────────────────────────────────────────
const ObrasContext = createContext(null);

export function ObrasProvider({ children }) {
  const [obras, setObras] = useState(loadObras);
  const [detalles, setDetalles] = useState(loadDet);
  const sbLoaded    = useRef(false);
  const fromRemote  = useRef(false);
  const obrasRef    = useRef(obras);
  const detallesRef = useRef(detalles);
  // Marca true cuando el usuario edita ANTES de que llegue el primer fetch
  // a Supabase. Sin esto, el remote pisaba ediciones tempranas — sintoma
  // tipico: borrar una foto y verla aparecer de vuelta a los 2 segundos.
  const userEditedBeforeFirstLoad = useRef(false);
  // Timestamp del último save local (broadcast guard de 3s). dirtyDetalles junta
  // los obraId cuyo detalle cambió, para flushearlos atómicos POR OBRA.
  const lastLocalSaveAt = useRef(0);
  const dirtyDetalles = useRef(new Set());
  // De-dupe de alertas "obra iniciada" POR SESIÓN. Antes era un Set module-level
  // que sobrevivía remounts/sesiones y silenciaba la alerta para siempre.
  const obrasYaAlertadas = useRef(new Set());
  const { markReady } = useAppLoading();
  useEffect(() => { obrasRef.current = obras; }, [obras]);
  useEffect(() => { detallesRef.current = detalles; }, [detalles]);

  useEffect(() => {
    // Guard de cancelacion: si el provider se desmonta antes de que la
    // respuesta llegue (ej. cambio de usuario remontando DataProviders),
    // ignoramos el resultado para no escribir state en un componente
    // desmontado / de la sesion vieja.
    let cancelled = false;
    loadSharedData('obras').then(data => {
      if (cancelled) return;
      if (data === undefined) {
        // Error de red/permiso en el load. NO hacemos save (terminaria con
        // el mismo error). Marcamos ready para que la app se renderee con
        // el localStorage que ya tenemos.
        sbLoaded.current = true;
        markReady();
        return;
      }
      if (userEditedBeforeFirstLoad.current) {
        // El usuario ya hizo cambios antes de que llegara el fetch — sus cambios
        // YA se persistieron atómicos (obra por id / detalle por obra). No
        // pisamos. Si el key no existía (fresh install), lo creamos.
        if (data === null) saveSharedData('obras', { obras: obrasRef.current, detalles: detallesRef.current });
      } else if (data) {
        fromRemote.current = true;
        if (data.obras)    { setObras(data.obras);       saveObras(data.obras); }
        if (data.detalles) { setDetalles(data.detalles); saveDet(data.detalles); }
        setTimeout(() => { fromRemote.current = false; }, 0);
      } else {
        saveSharedData('obras', { obras: obrasRef.current, detalles: detallesRef.current });
      }
      sbLoaded.current = true;
      markReady();
    });

    const unsub = onRemoteChange('obras', () => {
      // IGNORAR el broadcast si tenemos un save local pendiente o uno recien
      // disparado (< 3s atras). El broadcast suele llegar con datos del
      // servidor que NO incluyen el cambio local todavia → pisaba el state
      // y los cambios desaparecían momentaneamente. Sintoma reportado: al
      // agregar un contrato MO (o cualquier patch), el item aparecía y
      // desaparecía. Esperamos a que el save propio se confirme.
      if (lastLocalSaveAt.current && Date.now() - lastLocalSaveAt.current < 3000) return;
      loadSharedData('obras').then(d => {
        if (cancelled || !d) return;
        fromRemote.current = true;
        if (d.obras)    { setObras(d.obras);       saveObras(d.obras); }
        if (d.detalles) { setDetalles(d.detalles); saveDet(d.detalles); }
        setTimeout(() => { fromRemote.current = false; }, 0);
      });
    });
    return () => { cancelled = true; unsub(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { saveObras(obras); }, [obras]);
  useEffect(() => { saveDet(detalles); }, [detalles]);

  // Persistencia ATÓMICA. Las obras (array) se persisten por ítem en cada
  // mutación (append/patch/remove). Los detalles (mapa por obraId) se flushean
  // con debounce y POR OBRA (patch_detalle_obra) — así editar el presupuesto de
  // una obra NO pisa el avance que el bot escribió en OTRA, y el tipeo rápido no
  // spamea ni se pisa entre sí (se junta y se escribe una vez por obra). YA NO se
  // guarda el blob entero {obras, detalles}, que era el que pisaba al bot.
  useEffect(() => {
    if (!sbLoaded.current || fromRemote.current) return;
    if (dirtyDetalles.current.size === 0) return;
    const t = setTimeout(() => {
      const ids = Array.from(dirtyDetalles.current);
      dirtyDetalles.current.clear();
      ids.forEach(obraId => {
        const det = detallesRef.current[obraId];
        if (det) patchDetalleObra(obraId, det);
      });
      lastLocalSaveAt.current = Date.now();
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [detalles]);

  // Flush al desmontar: escribir los detalles dirty que quedaron sin debounce.
  useEffect(() => () => {
    const ids = Array.from(dirtyDetalles.current);
    dirtyDetalles.current.clear();
    ids.forEach(obraId => {
      const det = detallesRef.current[obraId];
      if (det) patchDetalleObra(obraId, det);
    });
  }, []);

  // Helper: marcar que el usuario hizo un cambio antes del primer fetch a
  // Supabase (el load remoto no debe pisar los cambios locales) y sellar el
  // timestamp del último cambio local (broadcast guard de 3s).
  const markUserEdit = () => {
    if (!sbLoaded.current) userEditedBeforeFirstLoad.current = true;
    lastLocalSaveAt.current = Date.now();
  };

  // ── Obras CRUD (memoizado para que el value del Provider sea estable)
  const addObra = useCallback((obra) => {
    markUserEdit();
    const id = `obra-${Date.now()}`;
    const nueva = { id, nombre: obra.nombre, cliente: obra.cliente, clienteId: obra.clienteId || null, direccion: obra.direccion || '', tipo: obra.tipo || 'Otro', estado: 'en-presupuesto', moneda: obra.moneda || 'ARS', presupuesto: Number(obra.presupuesto) || 0, gastado: 0, avance: 0, margen: 0, fechaInicio: obra.fechaInicio || '', fechaFinEstim: obra.fechaFinEstim || '', fechaFin: '', notas: obra.notas || '', createdAt: new Date().toISOString() };
    setObras(prev => [...prev, nueva]);
    appendObjectItem('obras', 'obras', nueva);
    return id;
  }, []);

  const updateObra = useCallback((id, changes) => {
    markUserEdit();
    if (changes.estado === 'activa') {
      const prev = obrasRef.current.find(o => o.id === id);
      if (prev && prev.estado !== 'activa') emitAlertaObraIniciada(prev, obrasYaAlertadas.current);
    }
    setObras(prev => prev.map(o => o.id === id ? { ...o, ...changes } : o));
    patchObjectItem('obras', 'obras', id, changes);
  }, []);

  const setEstado = useCallback((id, nuevoEstado) => {
    markUserEdit();
    const prevObra = obrasRef.current.find(o => o.id === id);
    if (nuevoEstado === 'activa' && prevObra && prevObra.estado !== 'activa') emitAlertaObraIniciada(prevObra, obrasYaAlertadas.current);
    const today = new Date().toISOString().split('T')[0];
    const ch = { estado: nuevoEstado };
    if (nuevoEstado === 'activa' && prevObra && !prevObra.fechaInicio) ch.fechaInicio = today;
    if (nuevoEstado === 'finalizada') { ch.avance = 100; ch.fechaFin = today; }
    setObras(prev => prev.map(o => o.id === id ? { ...o, ...ch } : o));
    patchObjectItem('obras', 'obras', id, ch);
  }, []);

  const deleteObra = useCallback((id) => {
    markUserEdit();
    setObras(prev => prev.filter(o => o.id !== id));
    removeObjectItem('obras', 'obras', id);
    // (El detalle[id] queda huérfano — la limpieza con cascada es IR-01, aparte.)
  }, []);

  // byEstado y getDetalle son derivados — devuelven nueva referencia cada
  // call (es lo correcto: usar useMemo en el consumidor cuando se necesite).
  //
  // BUG previo: usaban obrasRef.current / detallesRef.current con deps [].
  // El ref se actualiza en useEffect — que corre DESPUES del render. Asi que
  // durante el render que sigue a un cambio de obras, byEstado todavia veia
  // la version vieja. Sintoma: al editar el cliente de una obra, la tarjeta
  // seguia mostrando el nombre viejo hasta hacer hard refresh.
  // Fix: leer del state directamente con [obras]/[detalles] como deps.
  const byEstado = useCallback((estado) => obras.filter(o => o.estado === estado), [obras]);
  const getDetalle = useCallback((id) => detalles[id] ?? EMPTY_DETALLE, [detalles]);

  const patchDetalle = useCallback((id, fn) => {
    markUserEdit();
    setDetalles(prev => {
      const current = prev[id] ?? EMPTY_DETALLE;
      const updated = typeof fn === 'function' ? fn(current) : { ...current, ...fn };
      return { ...prev, [id]: updated };
    });
    // El detalle de esta obra se persiste atómico (patch_detalle_obra) con
    // debounce: lo marcamos dirty y el efecto lo flushea por obra.
    dirtyDetalles.current.add(id);
  }, []);

  // Renombrar un RUBRO en el catálogo debe llegar al presupuesto de TODAS las
  // obras: el nombre vive copiado en detalle.rubros[].nombre y se matchea por
  // nombre (generarTareasObra, imputación de gastos). Recorremos todos los
  // detalles, propagamos con la función pura, y persistimos atómico SOLO las
  // obras que cambiaron. Devuelve cuántas obras se tocaron. Lo dispara el editor
  // de Rubros/Gremios (CAT-001 cross-store).
  const renombrarRubroEnObras = useCallback((oldName, newName) => {
    if (!oldName || !newName || oldName === newName) return 0;
    let n = 0;
    for (const [obraId, det] of Object.entries(detallesRef.current || {})) {
      const next = cascadeRubroRenameEnDetalle(det, oldName, newName);
      if (next !== det) { patchDetalle(obraId, () => next); n++; }
    }
    return n;
  }, [patchDetalle]);

  // Permite forzar una recarga desde Supabase (usado por el portal del
  // cliente para garantizar que ve la misma info que el admin, sin depender
  // exclusivamente del broadcast de Realtime).
  const refetch = useCallback(async () => {
    const data = await loadSharedData('obras');
    if (!data) return;
    fromRemote.current = true;
    if (data.obras)    { setObras(data.obras);       saveObras(data.obras); }
    if (data.detalles) { setDetalles(data.detalles); saveDet(data.detalles); }
    setTimeout(() => { fromRemote.current = false; }, 0);
  }, []);

  // Memoizar el value: sin esto, cada render del Provider crea un objeto nuevo
  // y todos los componentes que consuman este context re-renderizan, aunque
  // las obras / detalles no hayan cambiado. Era la causa principal de lentitud
  // al editar inputs (ObraPresupuesto consume 9 contexts).
  const value = useMemo(
    () => ({ obras, addObra, updateObra, setEstado, deleteObra, byEstado, detalles, getDetalle, patchDetalle, renombrarRubroEnObras, refetch }),
    [obras, addObra, updateObra, setEstado, deleteObra, byEstado, detalles, getDetalle, patchDetalle, renombrarRubroEnObras, refetch]
  );

  return (
    <ObrasContext.Provider value={value}>
      {children}
    </ObrasContext.Provider>
  );
}

export function useObras() {
  const ctx = useContext(ObrasContext);
  if (!ctx) throw new Error('useObras debe usarse dentro de ObrasProvider');
  return ctx;
}

// Selectores granulares: devuelven una referencia estable si la obra/detalle
// no cambia, aunque el resto del array si lo haga. El consumidor sigue
// re-renderizando porque el Context API no permite suscripcion granular
// real, pero al menos se evita procesar derivados costosos cuando la obra
// en cuestion no se modifico (con useMemo aguas abajo).

export function useObra(id) {
  const { obras } = useObras();
  return useMemo(() => obras.find(o => o.id === id) || null, [obras, id]);
}

export function useObraDetalle(id) {
  const { detalles } = useObras();
  return useMemo(() => detalles[id] ?? EMPTY_DETALLE, [detalles, id]);
}
