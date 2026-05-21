import { createContext, useContext, useState, useEffect } from 'react';

const newId = () => `cat-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
const today = () => new Date().toISOString().split('T')[0];

export const calcTarea = (t) => {
  const mat = (t.materiales||[]).reduce((s,m) => s + m.cantidad * m.precio, 0);
  const sub = (t.subcontratos||[]).reduce((s,sc) => s + sc.cantidad * sc.precio, 0);
  const mo  = (t.mo||[]).reduce((s,m) => s + m.horas * m.precioHora, 0);
  const gen = (t.generales||[]).reduce((s,g) => s + (g.cantidad||1) * g.precio, 0);
  return { mat, sub, mo, gen, total: mat + sub + mo + gen };
};

const SEED = {
  rubros: [
    { id: 'r1', nombre: 'ELECTRICIDAD' },
    { id: 'r2', nombre: 'ALBAÑILERÍA' },
    { id: 'r3', nombre: 'ESTRUCTURA' },
    { id: 'r4', nombre: 'PLOMERÍA' },
    { id: 'r5', nombre: 'PINTURA' },
    { id: 'r6', nombre: 'CARPINTERÍA' },
    { id: 'r7', nombre: 'REVESTIMIENTOS' },
    { id: 'r8', nombre: 'GASTOS GENERALES' },
  ],
  materiales: [
    { id: 'mat1', codigo: 'ELE-CAB-001', nombre: 'Cable 2.5mm unipolar', unidad: 'm', precio: 120, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-12' },
    { id: 'mat2', codigo: 'ELE-CAB-002', nombre: 'Cable 4mm unipolar', unidad: 'm', precio: 185, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-12' },
    { id: 'mat3', codigo: 'ELE-CAN-001', nombre: 'Caño corrugado 7/8"', unidad: 'm', precio: 160, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-12' },
    { id: 'mat4', codigo: 'ELE-CAJ-001', nombre: 'Caja rectangular 4x2"', unidad: 'u', precio: 200, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-12' },
    { id: 'mat5', codigo: 'ELE-CAJ-002', nombre: 'Caja cuadrada 4x4"', unidad: 'u', precio: 280, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-12' },
    { id: 'mat6', codigo: 'ALB-LAD-001', nombre: 'Ladrillo común 12x12x25', unidad: 'u', precio: 85, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-10' },
    { id: 'mat7', codigo: 'ALB-CEM-001', nombre: 'Cemento Portland x 50kg', unidad: 'saco', precio: 8500, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-10' },
    { id: 'mat8', codigo: 'ALB-ARE-001', nombre: 'Arena fina', unidad: 'm³', precio: 45000, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-08' },
    { id: 'mat9', codigo: 'ALB-CAL-001', nombre: 'Cal hidráulica x 20kg', unidad: 'bolsa', precio: 3200, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-08' },
    { id: 'mat10', codigo: 'ALB-PIE-001', nombre: 'Piedra partida 6/20', unidad: 'm³', precio: 52000, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-06' },
    { id: 'mat11', codigo: 'PLO-TUB-001', nombre: 'Cañería PPR 20mm', unidad: 'm', precio: 650, rubro: 'PLOMERÍA', updatedAt: '2026-05-05' },
    { id: 'mat12', codigo: 'PLO-TUB-002', nombre: 'Cañería PPR 32mm', unidad: 'm', precio: 1100, rubro: 'PLOMERÍA', updatedAt: '2026-05-05' },
    { id: 'mat13', codigo: 'PIN-LAT-001', nombre: 'Látex interior x 20L', unidad: 'u', precio: 32000, rubro: 'PINTURA', updatedAt: '2026-05-01' },
    { id: 'mat14', codigo: 'PIN-EXT-001', nombre: 'Látex exterior x 20L', unidad: 'u', precio: 38000, rubro: 'PINTURA', updatedAt: '2026-05-01' },
    { id: 'mat15', codigo: 'CAR-TAB-001', nombre: 'Tablero multilaminado 18mm', unidad: 'u', precio: 42000, rubro: 'CARPINTERÍA', updatedAt: '2026-04-28' },
  ],
  mo: [
    { id: 'mo1', nombre: 'Oficial electricista', oficio: 'ELECTRICIDAD', unidad: 'h', precioHora: 2000 },
    { id: 'mo2', nombre: 'Ayudante electricista', oficio: 'ELECTRICIDAD', unidad: 'h', precioHora: 1200 },
    { id: 'mo3', nombre: 'Oficial albañil', oficio: 'ALBAÑILERÍA', unidad: 'h', precioHora: 1800 },
    { id: 'mo4', nombre: 'Ayudante albañil', oficio: 'ALBAÑILERÍA', unidad: 'h', precioHora: 1100 },
    { id: 'mo5', nombre: 'Oficial plomero', oficio: 'PLOMERÍA', unidad: 'h', precioHora: 2200 },
    { id: 'mo6', nombre: 'Ayudante plomero', oficio: 'PLOMERÍA', unidad: 'h', precioHora: 1300 },
    { id: 'mo7', nombre: 'Oficial pintor', oficio: 'PINTURA', unidad: 'h', precioHora: 1600 },
    { id: 'mo8', nombre: 'Ayudante pintor', oficio: 'PINTURA', unidad: 'h', precioHora: 1000 },
    { id: 'mo9', nombre: 'Oficial carpintero', oficio: 'CARPINTERÍA', unidad: 'h', precioHora: 2400 },
    { id: 'mo10', nombre: 'Ayudante carpintero', oficio: 'CARPINTERÍA', unidad: 'h', precioHora: 1400 },
  ],
  generales: [
    { id: 'g1', nombre: 'Alquiler andamios', unidad: 'día', precio: 12000 },
    { id: 'g2', nombre: 'Flete materiales', unidad: 'viaje', precio: 25000 },
    { id: 'g3', nombre: 'Herramientas menores', unidad: 'gl', precio: 8000 },
    { id: 'g4', nombre: 'Limpieza final de obra', unidad: 'gl', precio: 35000 },
    { id: 'g5', nombre: 'Cartel de obra', unidad: 'u', precio: 18000 },
    { id: 'g6', nombre: 'Volquete escombros', unidad: 'u', precio: 45000 },
  ],
  subcontratos: [
    // Generales
    { id: 'sc1', codigo: 'SUB-DEM-001', nombre: 'Demolición de carpeta existente', unidad: 'm²', precio: 3500, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-12' },
    { id: 'sc2', codigo: 'SUB-CAR-001', nombre: 'Realización de carpeta', unidad: 'm²', precio: 8500, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-12' },
    { id: 'sc3', codigo: 'SUB-EXC-001', nombre: 'Excavación manual', unidad: 'm³', precio: 12000, rubro: 'ESTRUCTURA', updatedAt: '2026-05-10' },
    { id: 'sc4', codigo: 'SUB-PIN-001', nombre: 'Pintura completa interior', unidad: 'm²', precio: 4500, rubro: 'PINTURA', updatedAt: '2026-05-08' },
    { id: 'sc5', codigo: 'SUB-REV-001', nombre: 'Revestimiento cerámico', unidad: 'm²', precio: 7200, rubro: 'REVESTIMIENTOS', updatedAt: '2026-05-08' },
    { id: 'sc6', codigo: 'SUB-ELE-001', nombre: 'Instalación eléctrica completa', unidad: 'gl', precio: 280000, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-05' },
    { id: 'sc7', codigo: 'SUB-PLO-001', nombre: 'Instalación sanitaria completa', unidad: 'gl', precio: 320000, rubro: 'PLOMERÍA', updatedAt: '2026-05-05' },
    { id: 'sc8', codigo: 'SUB-VOL-001', nombre: 'Volquete de escombros', unidad: 'u', precio: 45000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-01' },
    // Fan de pan · Panadería — ALBAÑILERÍA
    { id: 'sc9',  codigo: 'FDP-ALB-001', nombre: 'Demolición de carpeta completa y retiro de escombro', unidad: 'm²', precio: 6500, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-18' },
    { id: 'sc10', codigo: 'FDP-ALB-002', nombre: 'Demolición de muros y retiro de escombro', unidad: 'm²', precio: 15000, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-18' },
    { id: 'sc11', codigo: 'FDP-ALB-003', nombre: 'Demolición y retiro de carpinterías', unidad: 'gl', precio: 350000, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-18' },
    { id: 'sc12', codigo: 'FDP-ALB-004', nombre: 'Mochetas', unidad: 'ml', precio: 6000, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-18' },
    { id: 'sc13', codigo: 'FDP-ALB-005', nombre: 'Realización de carpeta niveladora', unidad: 'm²', precio: 8500, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-18' },
    { id: 'sc14', codigo: 'FDP-ALB-006', nombre: 'Realización de contrapisos en canaleteados', unidad: 'm²', precio: 8500, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-18' },
    { id: 'sc15', codigo: 'FDP-ALB-007', nombre: 'Colocación revestimiento 33×45', unidad: 'm²', precio: 13500, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-18' },
    { id: 'sc16', codigo: 'FDP-ALB-008', nombre: 'Colocación revestimiento 33×45 en baños', unidad: 'm²', precio: 13500, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-18' },
    { id: 'sc17', codigo: 'FDP-ALB-009', nombre: 'Colocación revestimientos Subways 10×20 Eliane', unidad: 'm²', precio: 17500, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-18' },
    { id: 'sc18', codigo: 'FDP-ALB-010', nombre: 'Colocar porcelanatos 60×60 Manhattan White', unidad: 'm²', precio: 13500, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-18' },
    { id: 'sc19', codigo: 'FDP-ALB-011', nombre: 'Colocar porcelanatos 60×60 Manhattan Dark', unidad: 'm²', precio: 13500, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-18' },
    { id: 'sc20', codigo: 'FDP-ALB-012', nombre: 'Colocación de zócalos', unidad: 'ml', precio: 11000, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-18' },
    { id: 'sc21', codigo: 'FDP-ALB-013', nombre: 'Colocación de accesorios (sin materiales)', unidad: 'gl', precio: 650000, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-18' },
    { id: 'sc22', codigo: 'FDP-ALB-014', nombre: 'Desmontar cieloraso existente', unidad: 'm²', precio: 4500, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-18' },
    // Fan de pan · Panadería — DURLOCK
    { id: 'sc23', codigo: 'FDP-DUR-001', nombre: 'Cieloraso Durlock junta tomada', unidad: 'm²', precio: 8500, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-18' },
    { id: 'sc24', codigo: 'FDP-DUR-002', nombre: 'Tabiques en Drywall', unidad: 'm²', precio: 12000, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-18' },
    { id: 'sc25', codigo: 'FDP-DUR-003', nombre: 'Planchado completo de paredes', unidad: 'm²', precio: 3000, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-18' },
    { id: 'sc26', codigo: 'FDP-DUR-004', nombre: 'Estructura con perfil Omega + Emplacado', unidad: 'm²', precio: 4500, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-18' },
    { id: 'sc27', codigo: 'FDP-DUR-005', nombre: 'Puertas y ventanas interiores en tabiques', unidad: 'u', precio: 25000, rubro: 'ALBAÑILERÍA', updatedAt: '2026-05-18' },
    // Fan de pan · Panadería — ELECTRICIDAD
    { id: 'sc28', codigo: 'FDP-ELE-001', nombre: 'Dicroicas', unidad: 'u', precio: 11220, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-18' },
    { id: 'sc29', codigo: 'FDP-ELE-002', nombre: 'Glitter', unidad: 'u', precio: 33000, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-18' },
    { id: 'sc30', codigo: 'FDP-ELE-003', nombre: 'AR111', unidad: 'u', precio: 11220, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-18' },
    { id: 'sc31', codigo: 'FDP-ELE-004', nombre: 'Marea / Pila', unidad: 'u', precio: 33000, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-18' },
    { id: 'sc32', codigo: 'FDP-ELE-005', nombre: 'Salida de emergencia', unidad: 'u', precio: 33000, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-18' },
    { id: 'sc33', codigo: 'FDP-ELE-006', nombre: 'Aplique de baño (P12W)', unidad: 'u', precio: 33000, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-18' },
    { id: 'sc34', codigo: 'FDP-ELE-007', nombre: 'Baños P130 18W (22cm)', unidad: 'u', precio: 33000, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-18' },
    { id: 'sc35', codigo: 'FDP-ELE-008', nombre: 'Apliques exterior saliente circular', unidad: 'u', precio: 33000, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-18' },
    { id: 'sc36', codigo: 'FDP-ELE-009', nombre: 'Exterior: cartel vainilla', unidad: 'u', precio: 33000, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-18' },
    { id: 'sc37', codigo: 'FDP-ELE-010', nombre: 'Reflectores LED', unidad: 'u', precio: 33000, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-18' },
    { id: 'sc38', codigo: 'FDP-ELE-011', nombre: 'Recambio y refacción luminarias en sótano', unidad: 'u', precio: 10000, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-18' },
    { id: 'sc39', codigo: 'FDP-ELE-012', nombre: 'Pisoductos sector Atención', unidad: 'u', precio: 100000, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-18' },
    { id: 'sc40', codigo: 'FDP-ELE-013', nombre: 'Generales (periscopio, freezers, AA, servicios)', unidad: 'u', precio: 33000, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-18' },
    { id: 'sc41', codigo: 'FDP-ELE-014', nombre: 'Acometida Horno Trifásico', unidad: 'u', precio: 33000, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-18' },
    { id: 'sc42', codigo: 'FDP-ELE-015', nombre: 'Acometida Cámara Monofásica', unidad: 'u', precio: 33000, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-18' },
    { id: 'sc43', codigo: 'FDP-ELE-016', nombre: 'Cámaras exterior (solo cableado)', unidad: 'u', precio: 33000, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-18' },
    { id: 'sc44', codigo: 'FDP-ELE-017', nombre: 'Parlantes', unidad: 'u', precio: 33000, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-18' },
    { id: 'sc45', codigo: 'FDP-ELE-018', nombre: 'Conexión datos pantallas Menu Board', unidad: 'u', precio: 33000, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-18' },
    { id: 'sc46', codigo: 'FDP-ELE-019', nombre: 'Tablero / rack de conectividad', unidad: 'gl', precio: 978639, rubro: 'ELECTRICIDAD', updatedAt: '2026-05-18' },
    // Fan de pan · Panadería — PINTURA
    { id: 'sc47', codigo: 'FDP-PIN-001', nombre: 'Cieloraso ultralavable (Cabras Blancas)', unidad: 'm²', precio: 4500, rubro: 'PINTURA', updatedAt: '2026-05-18' },
    { id: 'sc48', codigo: 'FDP-PIN-002', nombre: 'Cieloraso antihongos (Blanco)', unidad: 'm²', precio: 4500, rubro: 'PINTURA', updatedAt: '2026-05-18' },
    { id: 'sc49', codigo: 'FDP-PIN-003', nombre: 'Cieloraso satinado (Dije de plata)', unidad: 'm²', precio: 4500, rubro: 'PINTURA', updatedAt: '2026-05-18' },
    { id: 'sc50', codigo: 'FDP-PIN-004', nombre: 'Paredes interiores ultralavable (Cabras Blancas)', unidad: 'm²', precio: 3500, rubro: 'PINTURA', updatedAt: '2026-05-18' },
    { id: 'sc51', codigo: 'FDP-PIN-005', nombre: 'Paredes interiores satinado sótano y PB (Dije de plata)', unidad: 'm²', precio: 3500, rubro: 'PINTURA', updatedAt: '2026-05-18' },
    { id: 'sc52', codigo: 'FDP-PIN-006', nombre: 'Paredes exteriores texturado (Dije de plata)', unidad: 'm²', precio: 3500, rubro: 'PINTURA', updatedAt: '2026-05-18' },
    { id: 'sc53', codigo: 'FDP-PIN-007', nombre: 'Puertas con marcos en sintético (Dije de plata)', unidad: 'u', precio: 10000, rubro: 'PINTURA', updatedAt: '2026-05-18' },
    // Fan de pan · Panadería — PLOMERÍA
    { id: 'sc54', codigo: 'FDP-PLO-001', nombre: 'Adaptación sanitaria (fermentadora, heladera, cámara)', unidad: 'gl', precio: 650000, rubro: 'PLOMERÍA', updatedAt: '2026-05-18' },
    { id: 'sc55', codigo: 'FDP-PLO-002', nombre: 'Instalación termo + adaptación canilla y agua hasta horno', unidad: 'gl', precio: 450000, rubro: 'PLOMERÍA', updatedAt: '2026-05-18' },
    // Fan de pan · Panadería — HERRERÍA
    { id: 'sc56', codigo: 'FDP-HER-001', nombre: 'Estructura de hierro con vidrio repartido', unidad: 'gl', precio: 1300000, rubro: 'ESTRUCTURA', updatedAt: '2026-05-18' },
    // Fan de pan · Panadería — CARPINTERÍA DE ALUMINIO
    { id: 'sc57', codigo: 'FDP-CAL-001', nombre: 'Carpinterías de aluminio según plano', unidad: 'gl', precio: 12302069, rubro: 'CARPINTERÍA', updatedAt: '2026-05-18' },
    // Fan de pan · Panadería — MOBILIARIO
    { id: 'sc58', codigo: 'FDP-MOB-001', nombre: 'Facturero doble horizontal 138,5×46,5×217cm', unidad: 'u', precio: 420500, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc59', codigo: 'FDP-MOB-002', nombre: 'Panero simple horizontal 72,5×46,5×217cm', unidad: 'u', precio: 376650, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc60', codigo: 'FDP-MOB-003', nombre: 'Panero doble horizontal 138,5×46,5×217cm', unidad: 'u', precio: 436000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc61', codigo: 'FDP-MOB-004', nombre: 'Isla triple 136,5×90×131cm', unidad: 'u', precio: 446500, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc62', codigo: 'FDP-MOB-005', nombre: 'Mueble sano y rico 91,5×46,5×217cm', unidad: 'u', precio: 597000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc63', codigo: 'FDP-MOB-006', nombre: 'Mueble especiales simple horizontal 72,5×46,5×217', unidad: 'u', precio: 343000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc64', codigo: 'FDP-MOB-007', nombre: 'Box refrigerados freezer 124×62×217cm', unidad: 'u', precio: 447000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc65', codigo: 'FDP-MOB-008', nombre: 'Box refrigerados 2 heladeras 124×62×217cm', unidad: 'u', precio: 453000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc66', codigo: 'FDP-MOB-009', nombre: 'Mueble de café con espacio cafetera interior', unidad: 'u', precio: 487000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc67', codigo: 'FDP-MOB-010', nombre: 'Mostrador 150×80×102cm', unidad: 'u', precio: 782000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc68', codigo: 'FDP-MOB-011', nombre: 'Anexo mostrador 130×80×84cm', unidad: 'u', precio: 623000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc69', codigo: 'FDP-MOB-012', nombre: 'Mueble de apoyo 130×35×86cm', unidad: 'u', precio: 329000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc70', codigo: 'FDP-MOB-013', nombre: 'Mueble de apoyo especial 132×35×86cm', unidad: 'u', precio: 417000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc71', codigo: 'FDP-MOB-014', nombre: 'Estantería tipo escalera 240×32×200cm', unidad: 'u', precio: 108000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc72', codigo: 'FDP-MOB-015', nombre: 'Estantería tipo escalera 150×32×200cm', unidad: 'u', precio: 108000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc73', codigo: 'FDP-MOB-016', nombre: 'Estantería tipo escalera 170×32×130cm', unidad: 'u', precio: 108000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc74', codigo: 'FDP-MOB-017', nombre: 'Estantería tipo escalera 180×47×150cm', unidad: 'u', precio: 108000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc75', codigo: 'FDP-MOB-018', nombre: 'Estantería reforzada 120×30×200', unidad: 'u', precio: 87000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc76', codigo: 'FDP-MOB-019', nombre: 'Estante de acero turboblender', unidad: 'u', precio: 28000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc77', codigo: 'FDP-MOB-020', nombre: 'Mueble de limpieza y personal 120×30×185cm', unidad: 'u', precio: 183000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc78', codigo: 'FDP-MOB-021', nombre: 'Escritorio 120×60×72', unidad: 'u', precio: 73000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc79', codigo: 'FDP-MOB-022', nombre: 'Mueble de oficina 170×30×86cm', unidad: 'u', precio: 393000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc80', codigo: 'FDP-MOB-023', nombre: 'Mesa de comedor 100×60×72cm', unidad: 'u', precio: 73000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc81', codigo: 'FDP-MOB-024', nombre: 'Banco de vestidor 100×40×45cm', unidad: 'u', precio: 42000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc82', codigo: 'FDP-MOB-025', nombre: 'Instalación de mobiliario', unidad: 'gl', precio: 400000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    // Fan de pan · Panadería — ACERO INOX
    { id: 'sc83', codigo: 'FDP-AIN-001', nombre: 'Mensulas + estante de chapa 130×30×34', unidad: 'u', precio: 229500, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc84', codigo: 'FDP-AIN-002', nombre: 'Autoservicio alto 72,5×41×217', unidad: 'u', precio: 700000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc85', codigo: 'FDP-AIN-003', nombre: 'Autoservicio bajo 65×41×105', unidad: 'u', precio: 557550, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    // Fan de pan · Panadería — LOGÍSTICA
    { id: 'sc86', codigo: 'FDP-LOG-001', nombre: 'Flete general (x km)', unidad: 'km', precio: 2200, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc87', codigo: 'FDP-LOG-002', nombre: 'Traslado de personas (km x vehículos x 2)', unidad: 'km', precio: 3300, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    { id: 'sc88', codigo: 'FDP-LOG-003', nombre: 'Limpieza de obra periódica + final', unidad: 'm²', precio: 3500, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
    // Fan de pan · Panadería — DIRECCIÓN DE OBRA
    { id: 'sc89', codigo: 'FDP-DIR-001', nombre: 'Dirección de obra (Arquitecto full time + asistencia online)', unidad: 'm²', precio: 30000, rubro: 'GASTOS GENERALES', updatedAt: '2026-05-18' },
  ],
  tareas: [
    {
      id: 'apu1', codigo: 'ELE-BOC-001', nombre: 'Boca de luz simple', unidad: 'u', rubroNombre: 'ELECTRICIDAD',
      materiales: [
        { id: 'i1', nombre: 'Caño corrugado 7/8"', cantidad: 2, unidad: 'm', precio: 160 },
        { id: 'i2', nombre: 'Cable 2.5mm unipolar', cantidad: 4, unidad: 'm', precio: 120 },
        { id: 'i3', nombre: 'Caja rectangular 4x2"', cantidad: 1, unidad: 'u', precio: 200 },
      ],
      mo: [{ id: 'i4', nombre: 'Oficial electricista', horas: 1.5, precioHora: 2000 }],
      generales: [],
    },
    {
      id: 'apu2', codigo: 'ELE-TOM-001', nombre: 'Toma 220V simple', unidad: 'u', rubroNombre: 'ELECTRICIDAD',
      materiales: [
        { id: 'i1', nombre: 'Cable 2.5mm unipolar', cantidad: 3, unidad: 'm', precio: 120 },
        { id: 'i2', nombre: 'Caja rectangular 4x2"', cantidad: 1, unidad: 'u', precio: 200 },
      ],
      mo: [{ id: 'i3', nombre: 'Oficial electricista', horas: 1.5, precioHora: 2000 }],
      generales: [],
    },
    {
      id: 'apu3', codigo: 'ELE-LLA-001', nombre: 'Llave simple 1 punto', unidad: 'u', rubroNombre: 'ELECTRICIDAD',
      materiales: [
        { id: 'i1', nombre: 'Cable 2.5mm unipolar', cantidad: 2, unidad: 'm', precio: 120 },
        { id: 'i2', nombre: 'Caja rectangular 4x2"', cantidad: 1, unidad: 'u', precio: 200 },
      ],
      mo: [{ id: 'i3', nombre: 'Oficial electricista', horas: 1, precioHora: 2000 }],
      generales: [],
    },
    {
      id: 'apu4', codigo: 'ALB-MUR-001', nombre: 'Mampostería ladrillo visto', unidad: 'm²', rubroNombre: 'ALBAÑILERÍA',
      materiales: [
        { id: 'i1', nombre: 'Ladrillo común 12x12x25', cantidad: 50, unidad: 'u', precio: 85 },
        { id: 'i2', nombre: 'Cemento Portland x 50kg', cantidad: 0.3, unidad: 'saco', precio: 8500 },
        { id: 'i3', nombre: 'Arena fina', cantidad: 0.04, unidad: 'm³', precio: 45000 },
      ],
      mo: [
        { id: 'i4', nombre: 'Oficial albañil', horas: 3, precioHora: 1800 },
        { id: 'i5', nombre: 'Ayudante albañil', horas: 2, precioHora: 1100 },
      ],
      generales: [],
    },
    {
      id: 'apu5', codigo: 'ALB-REV-001', nombre: 'Revoque grueso a la cal', unidad: 'm²', rubroNombre: 'ALBAÑILERÍA',
      materiales: [
        { id: 'i1', nombre: 'Cemento Portland x 50kg', cantidad: 0.2, unidad: 'saco', precio: 8500 },
        { id: 'i2', nombre: 'Arena fina', cantidad: 0.03, unidad: 'm³', precio: 45000 },
        { id: 'i3', nombre: 'Cal hidráulica x 20kg', cantidad: 0.15, unidad: 'bolsa', precio: 3200 },
      ],
      mo: [
        { id: 'i4', nombre: 'Oficial albañil', horas: 2, precioHora: 1800 },
        { id: 'i5', nombre: 'Ayudante albañil', horas: 1.5, precioHora: 1100 },
      ],
      generales: [],
    },
    {
      id: 'apu6', codigo: 'PIN-LAT-001', nombre: 'Pintura látex interior 2 manos', unidad: 'm²', rubroNombre: 'PINTURA',
      materiales: [{ id: 'i1', nombre: 'Látex interior x 20L', cantidad: 0.25, unidad: 'u', precio: 32000 }],
      mo: [{ id: 'i2', nombre: 'Oficial pintor', horas: 0.5, precioHora: 1600 }],
      generales: [],
    },
    {
      id: 'apu7', codigo: 'PIN-EXT-001', nombre: 'Pintura látex exterior 2 manos', unidad: 'm²', rubroNombre: 'PINTURA',
      materiales: [{ id: 'i1', nombre: 'Látex exterior x 20L', cantidad: 0.25, unidad: 'u', precio: 38000 }],
      mo: [{ id: 'i2', nombre: 'Oficial pintor', horas: 0.6, precioHora: 1600 }],
      generales: [],
    },
    {
      id: 'apu8', codigo: 'PLO-TUB-001', nombre: 'Cañería agua fría PPR 20mm', unidad: 'm', rubroNombre: 'PLOMERÍA',
      materiales: [{ id: 'i1', nombre: 'Cañería PPR 20mm', cantidad: 1, unidad: 'm', precio: 650 }],
      mo: [{ id: 'i2', nombre: 'Oficial plomero', horas: 0.5, precioHora: 2200 }],
      generales: [],
    },
  ],
};

const CatalogContext = createContext(null);

function load() {
  try {
    const s = localStorage.getItem('kamak_catalog_v1');
    if (s) {
      const saved = JSON.parse(s);
      if (!saved.subcontratos) {
        saved.subcontratos = SEED.subcontratos;
      } else {
        const savedIds = new Set(saved.subcontratos.map(x => x.id));
        const missing = SEED.subcontratos.filter(x => !savedIds.has(x.id));
        if (missing.length) saved.subcontratos = [...saved.subcontratos, ...missing];
      }
      return saved;
    }
  } catch {}
  return SEED;
}

export function CatalogProvider({ children }) {
  const [catalog, setCatalog] = useState(load);
  useEffect(() => { localStorage.setItem('kamak_catalog_v1', JSON.stringify(catalog)); }, [catalog]);

  const add    = (coll, item)        => setCatalog(c => ({ ...c, [coll]: [...c[coll], { id: newId(), ...item, updatedAt: today() }] }));
  const update = (coll, id, changes) => setCatalog(c => ({ ...c, [coll]: c[coll].map(i => i.id === id ? { ...i, ...changes, updatedAt: today() } : i) }));
  const remove = (coll, id)          => setCatalog(c => ({ ...c, [coll]: c[coll].filter(i => i.id !== id) }));

  return (
    <CatalogContext.Provider value={{ catalog, add, update, remove }}>
      {children}
    </CatalogContext.Provider>
  );
}

export function useCatalog() { return useContext(CatalogContext); }
