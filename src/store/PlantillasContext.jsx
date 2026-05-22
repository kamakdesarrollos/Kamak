import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { loadSharedData, saveSharedData } from '../lib/dbHelpers';
import { supabase } from '../lib/supabase';
import { useAppLoading } from './AppLoadingContext';

const newId = () => `plt-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
const today = () => new Date().toISOString().split('T')[0];

const SEED = [
  {
    id: 'plt1', nombre: 'Estación de Servicio', descripcion: 'Shell · YPF · Axion — local 300–600 m²',
    tipo: 'Comercial', updatedAt: '2026-03-01', usosCount: 5,
    rubros: [
      { id: 'r1', nombre: 'ELECTRICIDAD', margenMat: 20, margenMO: 40, tareas: [
        { id: 't1', nombre: 'Bocas de luz', unidad: 'u', costoMat: 1000, costoSub: 3000, cantidad: 80 },
        { id: 't2', nombre: 'Tomas 220V', unidad: 'u', costoMat: 800, costoSub: 3000, cantidad: 45 },
        { id: 't3', nombre: 'Tablero principal', unidad: 'gl', costoMat: 120000, costoSub: 168000, cantidad: 1 },
        { id: 't4', nombre: 'Cañería corrugada', unidad: 'm', costoMat: 400, costoSub: 600, cantidad: 120 },
      ]},
      { id: 'r2', nombre: 'ALBAÑILERÍA', margenMat: 15, margenMO: 35, tareas: [
        { id: 't5', nombre: 'Mampostería', unidad: 'm²', costoMat: 4500, costoSub: 8000, cantidad: 320 },
        { id: 't6', nombre: 'Revoque grueso', unidad: 'm²', costoMat: 2000, costoSub: 4500, cantidad: 280 },
        { id: 't7', nombre: 'Contrapiso + carpeta', unidad: 'm²', costoMat: 5500, costoSub: 6000, cantidad: 200 },
      ]},
      { id: 'r3', nombre: 'PLOMERÍA', margenMat: 20, margenMO: 40, tareas: [
        { id: 't8', nombre: 'Red agua fría', unidad: 'm', costoMat: 650, costoSub: 800, cantidad: 80 },
        { id: 't9', nombre: 'Red agua caliente', unidad: 'm', costoMat: 900, costoSub: 800, cantidad: 60 },
      ]},
      { id: 'r4', nombre: 'PINTURA', margenMat: 15, margenMO: 30, tareas: [
        { id: 't10', nombre: 'Pintura látex interior', unidad: 'm²', costoMat: 8000, costoSub: 800, cantidad: 400 },
        { id: 't11', nombre: 'Pintura látex exterior', unidad: 'm²', costoMat: 9500, costoSub: 960, cantidad: 200 },
      ]},
    ],
  },
  {
    id: 'plt2', nombre: 'Panadería completa', descripcion: 'Local 80–150 m²',
    tipo: 'Comercial', updatedAt: '2026-02-15', usosCount: 3,
    rubros: [
      { id: 'r1', nombre: 'ELECTRICIDAD', margenMat: 20, margenMO: 40, tareas: [
        { id: 't1', nombre: 'Bocas de luz', unidad: 'u', costoMat: 1000, costoSub: 3000, cantidad: 30 },
        { id: 't2', nombre: 'Tomas 220V', unidad: 'u', costoMat: 800, costoSub: 3000, cantidad: 20 },
        { id: 't3', nombre: 'Tomas 380V industrial', unidad: 'u', costoMat: 5400, costoSub: 8500, cantidad: 5 },
      ]},
      { id: 'r2', nombre: 'ALBAÑILERÍA', margenMat: 15, margenMO: 35, tareas: [
        { id: 't4', nombre: 'Mampostería', unidad: 'm²', costoMat: 4500, costoSub: 8000, cantidad: 120 },
        { id: 't5', nombre: 'Revestimiento porcellanato', unidad: 'm²', costoMat: 12000, costoSub: 5000, cantidad: 80 },
      ]},
      { id: 'r3', nombre: 'PLOMERÍA', margenMat: 20, margenMO: 40, tareas: [
        { id: 't6', nombre: 'Instalación sanitaria', unidad: 'gl', costoMat: 120000, costoSub: 90000, cantidad: 1 },
      ]},
    ],
  },
  {
    id: 'plt3', nombre: 'Vivienda unifamiliar', descripcion: '120–200 m² · 1 planta',
    tipo: 'Vivienda', updatedAt: '2026-01-10', usosCount: 12,
    rubros: [
      { id: 'r1', nombre: 'ESTRUCTURA', margenMat: 15, margenMO: 30, tareas: [
        { id: 't1', nombre: 'Losa alivianada', unidad: 'm²', costoMat: 28000, costoSub: 15000, cantidad: 150 },
        { id: 't2', nombre: 'Columnas y vigas', unidad: 'm', costoMat: 18000, costoSub: 12000, cantidad: 40 },
      ]},
      { id: 'r2', nombre: 'ALBAÑILERÍA', margenMat: 15, margenMO: 35, tareas: [
        { id: 't3', nombre: 'Mampostería', unidad: 'm²', costoMat: 4500, costoSub: 8000, cantidad: 280 },
        { id: 't4', nombre: 'Revoque fino', unidad: 'm²', costoMat: 1500, costoSub: 3500, cantidad: 250 },
        { id: 't5', nombre: 'Contrapiso', unidad: 'm²', costoMat: 5500, costoSub: 6000, cantidad: 150 },
      ]},
      { id: 'r3', nombre: 'ELECTRICIDAD', margenMat: 20, margenMO: 40, tareas: [
        { id: 't6', nombre: 'Bocas de luz', unidad: 'u', costoMat: 1000, costoSub: 3000, cantidad: 45 },
        { id: 't7', nombre: 'Tomas 220V', unidad: 'u', costoMat: 800, costoSub: 3000, cantidad: 25 },
        { id: 't8', nombre: 'Tablero principal', unidad: 'gl', costoMat: 80000, costoSub: 120000, cantidad: 1 },
      ]},
      { id: 'r4', nombre: 'PLOMERÍA', margenMat: 20, margenMO: 40, tareas: [
        { id: 't9', nombre: 'Red agua fría', unidad: 'm', costoMat: 650, costoSub: 800, cantidad: 60 },
        { id: 't10', nombre: 'Instalación sanitaria', unidad: 'gl', costoMat: 90000, costoSub: 70000, cantidad: 1 },
      ]},
      { id: 'r5', nombre: 'PINTURA', margenMat: 15, margenMO: 30, tareas: [
        { id: 't11', nombre: 'Pintura látex interior', unidad: 'm²', costoMat: 8000, costoSub: 800, cantidad: 300 },
      ]},
    ],
  },
  {
    id: 'plt4', nombre: 'Local comercial', descripcion: 'Showroom · oficina 60–120 m²',
    tipo: 'Comercial', updatedAt: '2026-02-01', usosCount: 4,
    rubros: [
      { id: 'r1', nombre: 'ELECTRICIDAD', margenMat: 20, margenMO: 40, tareas: [
        { id: 't1', nombre: 'Bocas de luz', unidad: 'u', costoMat: 1000, costoSub: 3000, cantidad: 25 },
        { id: 't2', nombre: 'Tomas 220V', unidad: 'u', costoMat: 800, costoSub: 3000, cantidad: 15 },
      ]},
      { id: 'r2', nombre: 'ALBAÑILERÍA', margenMat: 15, margenMO: 35, tareas: [
        { id: 't3', nombre: 'Tabiques drywall', unidad: 'm²', costoMat: 3500, costoSub: 4000, cantidad: 80 },
        { id: 't4', nombre: 'Cielorraso drywall', unidad: 'm²', costoMat: 4000, costoSub: 4500, cantidad: 60 },
      ]},
    ],
  },
  {
    id: 'plt5', nombre: 'Refacción de baño', descripcion: 'Pequeña escala',
    tipo: 'Refacción', updatedAt: '2026-04-01', usosCount: 8,
    rubros: [
      { id: 'r1', nombre: 'PLOMERÍA', margenMat: 20, margenMO: 40, tareas: [
        { id: 't1', nombre: 'Instalación sanitaria', unidad: 'gl', costoMat: 80000, costoSub: 60000, cantidad: 1 },
      ]},
      { id: 'r2', nombre: 'REVESTIMIENTOS', margenMat: 15, margenMO: 35, tareas: [
        { id: 't2', nombre: 'Porcellanato piso', unidad: 'm²', costoMat: 14000, costoSub: 5000, cantidad: 8 },
        { id: 't3', nombre: 'Revestimiento pared', unidad: 'm²', costoMat: 12000, costoSub: 5000, cantidad: 16 },
      ]},
      { id: 'r3', nombre: 'ELECTRICIDAD', margenMat: 20, margenMO: 40, tareas: [
        { id: 't4', nombre: 'Circuito exclusivo', unidad: 'gl', costoMat: 8000, costoSub: 6000, cantidad: 1 },
      ]},
    ],
  },
  {
    id: 'plt6', nombre: 'Galpón industrial', descripcion: 'Estructura + cerramientos',
    tipo: 'Industrial', updatedAt: '2026-01-20', usosCount: 2,
    rubros: [
      { id: 'r1', nombre: 'ESTRUCTURA', margenMat: 12, margenMO: 25, tareas: [
        { id: 't1', nombre: 'Fundación', unidad: 'gl', costoMat: 280000, costoSub: 180000, cantidad: 1 },
        { id: 't2', nombre: 'Estructura metálica', unidad: 'tn', costoMat: 380000, costoSub: 120000, cantidad: 8 },
      ]},
      { id: 'r2', nombre: 'ELECTRICIDAD', margenMat: 20, margenMO: 40, tareas: [
        { id: 't3', nombre: 'Iluminación industrial', unidad: 'u', costoMat: 8500, costoSub: 4500, cantidad: 20 },
        { id: 't4', nombre: 'Tablero general', unidad: 'gl', costoMat: 180000, costoSub: 220000, cantidad: 1 },
      ]},
    ],
  },
  {
    id: 'plt-fan', nombre: 'Fan de pan - Panadería', descripcion: 'Panadería tipo Acasuso · 129–200 m²',
    tipo: 'Comercial', updatedAt: '2026-05-17', usosCount: 0,
    rubros: [
      { id: 'r1', nombre: 'ALBAÑILERÍA', margenMat: 10, margenMO: 150, tareas: [
        { id: 't1', nombre: 'Demolición de carpeta completa y retiro de escombro', unidad: 'm²', costoMat: 0, costoSub: 6500, cantidad: 129, margenLinea: 200 },
        { id: 't2', nombre: 'Demolición de muros y retiro de escombro', unidad: 'm²', costoMat: 0, costoSub: 15000, cantidad: 4, margenLinea: 200 },
        { id: 't3', nombre: 'Demolición y retiro de carpinterías', unidad: 'gl', costoMat: 0, costoSub: 350000, cantidad: 1, margenLinea: 95 },
        { id: 't4', nombre: 'Mochetas', unidad: 'ml', costoMat: 0, costoSub: 6000, cantidad: 55, margenLinea: 100 },
        { id: 't5', nombre: 'Realización de carpeta niveladora', unidad: 'm²', costoMat: 0, costoSub: 8500, cantidad: 129, margenLinea: 150 },
        { id: 't6', nombre: 'Realización de contrapisos en canaleteados', unidad: 'm²', costoMat: 0, costoSub: 8500, cantidad: 20, margenLinea: 150 },
        { id: 't7', nombre: 'Colocación revestimiento 33×45', unidad: 'm²', costoMat: 0, costoSub: 13500, cantidad: 35, margenLinea: 200 },
        { id: 't8', nombre: 'Colocación revestimiento 33×45 en baños', unidad: 'm²', costoMat: 0, costoSub: 13500, cantidad: 27, margenLinea: 200 },
        { id: 't9', nombre: 'Colocación revestimientos Subways 10×20 Eliane', unidad: 'm²', costoMat: 0, costoSub: 17500, cantidad: 13, margenLinea: 200 },
        { id: 't10', nombre: 'Colocar porcelanatos 60×60 Manhattan White', unidad: 'm²', costoMat: 0, costoSub: 13500, cantidad: 57, margenLinea: 200 },
        { id: 't11', nombre: 'Colocar porcelanatos 60×60 Manhattan Dark', unidad: 'm²', costoMat: 0, costoSub: 13500, cantidad: 72, margenLinea: 200 },
        { id: 't12', nombre: 'Colocación de zócalos', unidad: 'ml', costoMat: 0, costoSub: 11000, cantidad: 68, margenLinea: 103 },
        { id: 't13', nombre: 'Colocación de accesorios (sin materiales)', unidad: 'gl', costoMat: 0, costoSub: 650000, cantidad: 1, margenLinea: 75 },
        { id: 't14', nombre: 'Desmontar cieloraso existente', unidad: 'm²', costoMat: 0, costoSub: 4500, cantidad: 129, margenLinea: 100 },
      ]},
      { id: 'r2', nombre: 'DURLOCK', margenMat: 15, margenMO: 140, tareas: [
        { id: 't1', nombre: 'Cieloraso Durlock junta tomada', unidad: 'm²', costoMat: 0, costoSub: 8500, cantidad: 120, margenLinea: 135 },
        { id: 't2', nombre: 'Tabiques en Drywall', unidad: 'm²', costoMat: 0, costoSub: 12000, cantidad: 77, margenLinea: 145 },
        { id: 't3', nombre: 'Planchado completo de paredes', unidad: 'm²', costoMat: 0, costoSub: 3000, cantidad: 150, margenLinea: 150 },
        { id: 't4', nombre: 'Estructura con perfil Omega + Emplacado', unidad: 'm²', costoMat: 0, costoSub: 4500, cantidad: 110, margenLinea: 130 },
        { id: 't5', nombre: 'Puertas y ventanas interiores en tabiques', unidad: 'u', costoMat: 0, costoSub: 25000, cantidad: 4, margenLinea: 166 },
      ]},
      { id: 'r3', nombre: 'ELECTRICIDAD', margenMat: 10, margenMO: 100, tareas: [
        { id: 't1', nombre: 'Dicroicas', unidad: 'u', costoMat: 0, costoSub: 11220, cantidad: 0, margenLinea: 100 },
        { id: 't2', nombre: 'Glitter', unidad: 'u', costoMat: 0, costoSub: 33000, cantidad: 4, margenLinea: 100 },
        { id: 't3', nombre: 'AR111', unidad: 'u', costoMat: 0, costoSub: 11220, cantidad: 52, margenLinea: 100 },
        { id: 't4', nombre: 'Marea / Pila', unidad: 'u', costoMat: 0, costoSub: 33000, cantidad: 17, margenLinea: 100 },
        { id: 't5', nombre: 'Salida de emergencia', unidad: 'u', costoMat: 0, costoSub: 33000, cantidad: 1, margenLinea: 100 },
        { id: 't6', nombre: 'Aplique de baño (P12W)', unidad: 'u', costoMat: 0, costoSub: 33000, cantidad: 2, margenLinea: 100 },
        { id: 't7', nombre: 'Baños P130 18W (22cm)', unidad: 'u', costoMat: 0, costoSub: 33000, cantidad: 3, margenLinea: 100 },
        { id: 't8', nombre: 'Apliques exterior saliente circular', unidad: 'u', costoMat: 0, costoSub: 33000, cantidad: 2, margenLinea: 100 },
        { id: 't9', nombre: 'Exterior: cartel vainilla', unidad: 'u', costoMat: 0, costoSub: 33000, cantidad: 2, margenLinea: 100 },
        { id: 't10', nombre: 'Reflectores LED', unidad: 'u', costoMat: 0, costoSub: 33000, cantidad: 4, margenLinea: 100 },
        { id: 't11', nombre: 'Recambio y refacción luminarias en sótano', unidad: 'u', costoMat: 0, costoSub: 10000, cantidad: 8, margenLinea: 100 },
        { id: 't12', nombre: 'Pisoductos sector Atención', unidad: 'u', costoMat: 0, costoSub: 100000, cantidad: 1, margenLinea: 70 },
        { id: 't13', nombre: 'Generales (periscopio, freezers, AA, servicios)', unidad: 'u', costoMat: 0, costoSub: 33000, cantidad: 39, margenLinea: 100 },
        { id: 't14', nombre: 'Acometida Horno Trifásico', unidad: 'u', costoMat: 0, costoSub: 33000, cantidad: 1, margenLinea: 100 },
        { id: 't15', nombre: 'Acometida Cámara Monofásica', unidad: 'u', costoMat: 0, costoSub: 33000, cantidad: 1, margenLinea: 100 },
        { id: 't16', nombre: 'Cámaras exterior (solo cableado)', unidad: 'u', costoMat: 0, costoSub: 33000, cantidad: 6, margenLinea: 100 },
        { id: 't17', nombre: 'Parlantes', unidad: 'u', costoMat: 0, costoSub: 33000, cantidad: 4, margenLinea: 100 },
        { id: 't18', nombre: 'Conexión datos pantallas Menu Board', unidad: 'u', costoMat: 0, costoSub: 33000, cantidad: 3, margenLinea: 100 },
        { id: 't19', nombre: 'Tablero / rack de conectividad', unidad: 'u', costoMat: 0, costoSub: 978639, cantidad: 1, margenLinea: 100 },
      ]},
      { id: 'r4', nombre: 'PINTURA', margenMat: 15, margenMO: 200, tareas: [
        { id: 't1', nombre: 'Cieloraso ultralavable (Cabras Blancas)', unidad: 'm²', costoMat: 0, costoSub: 4500, cantidad: 60, margenLinea: 200 },
        { id: 't2', nombre: 'Cieloraso antihongos (Blanco)', unidad: 'm²', costoMat: 0, costoSub: 4500, cantidad: 65, margenLinea: 200 },
        { id: 't3', nombre: 'Cieloraso satinado (Dije de plata)', unidad: 'm²', costoMat: 0, costoSub: 4500, cantidad: 70, margenLinea: 200 },
        { id: 't4', nombre: 'Paredes interiores ultralavable (Cabras Blancas)', unidad: 'm²', costoMat: 0, costoSub: 3500, cantidad: 70, margenLinea: 200 },
        { id: 't5', nombre: 'Paredes interiores satinado sótano y PB (Dije de plata)', unidad: 'm²', costoMat: 0, costoSub: 3500, cantidad: 300, margenLinea: 200 },
        { id: 't6', nombre: 'Paredes exteriores texturado (Dije de plata)', unidad: 'm²', costoMat: 0, costoSub: 3500, cantidad: 55, margenLinea: 200 },
        { id: 't7', nombre: 'Puertas con marcos en sintético (Dije de plata)', unidad: 'u', costoMat: 0, costoSub: 10000, cantidad: 4, margenLinea: 100 },
      ]},
      { id: 'r5', nombre: 'PLOMERÍA', margenMat: 0, margenMO: 150, tareas: [
        { id: 't1', nombre: 'Adaptación sanitaria (fermentadora, heladera, cámara)', unidad: 'gl', costoMat: 0, costoSub: 650000, cantidad: 1, margenLinea: 150 },
        { id: 't2', nombre: 'Instalación termo + adaptación canilla y agua hasta horno', unidad: 'gl', costoMat: 0, costoSub: 450000, cantidad: 1, margenLinea: 150 },
      ]},
      { id: 'r6', nombre: 'HERRERÍA', margenMat: 0, margenMO: 50, tareas: [
        { id: 't1', nombre: 'Estructura de hierro con vidrio repartido', unidad: 'gl', costoMat: 0, costoSub: 1300000, cantidad: 1, margenLinea: 50 },
      ]},
      { id: 'r7', nombre: 'CARPINTERÍA DE ALUMINIO', margenMat: 0, margenMO: 28, tareas: [
        { id: 't1', nombre: 'Carpinterías según plano', unidad: 'gl', costoMat: 0, costoSub: 12302069, cantidad: 1, margenLinea: 28 },
      ]},
      { id: 'r8', nombre: 'MOBILIARIO', margenMat: 0, margenMO: 35, tareas: [
        { id: 't1', nombre: 'Facturero doble horizontal 138,5×46,5×217cm', unidad: 'u', costoMat: 0, costoSub: 420500, cantidad: 2, margenLinea: 35 },
        { id: 't2', nombre: 'Panero simple horizontal 72,5×46,5×217cm', unidad: 'u', costoMat: 0, costoSub: 376650, cantidad: 0, margenLinea: 35 },
        { id: 't3', nombre: 'Panero doble horizontal 138,5×46,5×217cm', unidad: 'u', costoMat: 0, costoSub: 436000, cantidad: 2, margenLinea: 35 },
        { id: 't4', nombre: 'Isla triple 136,5×90×131cm', unidad: 'u', costoMat: 0, costoSub: 446500, cantidad: 2, margenLinea: 35 },
        { id: 't5', nombre: 'Mueble sano y rico 91,5×46,5×217cm', unidad: 'u', costoMat: 0, costoSub: 597000, cantidad: 1, margenLinea: 35 },
        { id: 't6', nombre: 'Mueble especiales simple horizontal 72,5×46,5×217', unidad: 'u', costoMat: 0, costoSub: 343000, cantidad: 1, margenLinea: 35 },
        { id: 't7', nombre: 'Box refrigerados freezer 124×62×217cm', unidad: 'u', costoMat: 0, costoSub: 447000, cantidad: 1, margenLinea: 35 },
        { id: 't8', nombre: 'Box refrigerados 2 heladeras 124×62×217cm', unidad: 'u', costoMat: 0, costoSub: 453000, cantidad: 1, margenLinea: 35 },
        { id: 't9', nombre: 'Mueble de café con espacio cafetera interior', unidad: 'u', costoMat: 0, costoSub: 487000, cantidad: 1, margenLinea: 35 },
        { id: 't10', nombre: 'Mostrador 150×80×102cm', unidad: 'u', costoMat: 0, costoSub: 782000, cantidad: 1, margenLinea: 35 },
        { id: 't11', nombre: 'Anexo mostrador 130×80×84cm', unidad: 'u', costoMat: 0, costoSub: 623000, cantidad: 1, margenLinea: 35 },
        { id: 't12', nombre: 'Mueble de apoyo 130×35×86cm', unidad: 'u', costoMat: 0, costoSub: 329000, cantidad: 1, margenLinea: 35 },
        { id: 't13', nombre: 'Mueble de apoyo especial 132×35×86cm', unidad: 'u', costoMat: 0, costoSub: 417000, cantidad: 1, margenLinea: 35 },
        { id: 't14', nombre: 'Estantería tipo escalera 240×32×200cm', unidad: 'u', costoMat: 0, costoSub: 108000, cantidad: 1, margenLinea: 35 },
        { id: 't15', nombre: 'Estantería tipo escalera 150×32×200cm', unidad: 'u', costoMat: 0, costoSub: 108000, cantidad: 1, margenLinea: 35 },
        { id: 't16', nombre: 'Estantería tipo escalera 170×32×130cm', unidad: 'u', costoMat: 0, costoSub: 108000, cantidad: 1, margenLinea: 35 },
        { id: 't17', nombre: 'Estantería tipo escalera 180×47×150cm', unidad: 'u', costoMat: 0, costoSub: 108000, cantidad: 1, margenLinea: 35 },
        { id: 't18', nombre: 'Estantería reforzada 120×30×200', unidad: 'u', costoMat: 0, costoSub: 87000, cantidad: 1, margenLinea: 35 },
        { id: 't19', nombre: 'Estante de acero turboblender', unidad: 'u', costoMat: 0, costoSub: 28000, cantidad: 2, margenLinea: 35 },
        { id: 't20', nombre: 'Mueble de limpieza y personal 120×30×185cm', unidad: 'u', costoMat: 0, costoSub: 183000, cantidad: 1, margenLinea: 35 },
        { id: 't21', nombre: 'Escritorio 120×60×72', unidad: 'u', costoMat: 0, costoSub: 73000, cantidad: 1, margenLinea: 35 },
        { id: 't22', nombre: 'Mueble de oficina 170×30×86cm', unidad: 'u', costoMat: 0, costoSub: 393000, cantidad: 1, margenLinea: 35 },
        { id: 't23', nombre: 'Mesa de comedor 100×60×72cm', unidad: 'u', costoMat: 0, costoSub: 73000, cantidad: 1, margenLinea: 35 },
        { id: 't24', nombre: 'Banco de vestidor 100×40×45cm', unidad: 'u', costoMat: 0, costoSub: 42000, cantidad: 1, margenLinea: 35 },
        { id: 't25', nombre: 'Instalación de mobiliario', unidad: 'gl', costoMat: 0, costoSub: 400000, cantidad: 1, margenLinea: 50 },
      ]},
      { id: 'r9', nombre: 'ACERO INOX', margenMat: 0, margenMO: 35, tareas: [
        { id: 't1', nombre: 'Mensulas + estante de chapa 130×30×34', unidad: 'u', costoMat: 0, costoSub: 229500, cantidad: 1, margenLinea: 35 },
        { id: 't2', nombre: 'Autoservicio alto 72,5×41×217', unidad: 'u', costoMat: 0, costoSub: 700000, cantidad: 1, margenLinea: 35 },
        { id: 't3', nombre: 'Autoservicio bajo 65×41×105', unidad: 'u', costoMat: 0, costoSub: 557550, cantidad: 1, margenLinea: 35 },
      ]},
      { id: 'r10', nombre: 'LOGÍSTICA', margenMat: 0, margenMO: 25, tareas: [
        { id: 't1', nombre: 'Flete general (x km)', unidad: 'km', costoMat: 0, costoSub: 2200, cantidad: 1020, margenLinea: 25 },
        { id: 't2', nombre: 'Traslado de personas (km x vehiculos x 2)', unidad: 'km', costoMat: 0, costoSub: 3300, cantidad: 1020, margenLinea: 20 },
        { id: 't3', nombre: 'Limpieza de obra periodica + final', unidad: 'm²', costoMat: 0, costoSub: 3500, cantidad: 194, margenLinea: 25 },
      ]},
      { id: 'r11', nombre: 'DIRECCIÓN DE OBRA', margenMat: 0, margenMO: 10, tareas: [
        { id: 't1', nombre: 'Dirección (Arquitecto full time + asistencia online)', unidad: 'm²', costoMat: 0, costoSub: 30000, cantidad: 194, margenLinea: 10 },
      ]},
    ],
  },
];

const PlantillasContext = createContext(null);

function load() {
  try {
    const s = localStorage.getItem('kamak_plantillas_v1');
    if (s) {
      const saved = JSON.parse(s);
      const savedIds = new Set(saved.map(p => p.id));
      const missing = SEED.filter(p => !savedIds.has(p.id));
      return missing.length ? [...saved, ...missing] : saved;
    }
  } catch {}
  return SEED;
}

export function PlantillasProvider({ children }) {
  const [plantillas, setPlantillas] = useState(load);
  const sbLoaded   = useRef(false);
  const fromRemote = useRef(false);
  const { markReady } = useAppLoading();

  useEffect(() => {
    loadSharedData('plantillas').then(data => {
      if (data) {
        fromRemote.current = true;
        setPlantillas(data); localStorage.setItem('kamak_plantillas_v1', JSON.stringify(data));
        setTimeout(() => { fromRemote.current = false; }, 0);
      } else saveSharedData('plantillas', plantillas); // eslint-disable-line react-hooks/exhaustive-deps
      sbLoaded.current = true;
      markReady();
    });

    const channel = supabase
      .channel('shared-plantillas')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_data' },
        (payload) => {
          if (payload.new?.key !== 'plantillas' || !payload.new?.data) return;
          fromRemote.current = true;
          setPlantillas(payload.new.data);
          localStorage.setItem('kamak_plantillas_v1', JSON.stringify(payload.new.data));
          setTimeout(() => { fromRemote.current = false; }, 0);
        }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    localStorage.setItem('kamak_plantillas_v1', JSON.stringify(plantillas));
    if (!sbLoaded.current || fromRemote.current) return;
    const t = setTimeout(() => { saveSharedData('plantillas', plantillas); }, 800);
    return () => clearTimeout(t);
  }, [plantillas]);

  const add = (plt) => setPlantillas(p => [...p, { ...plt, id: newId(), updatedAt: today(), usosCount: 0 }]);
  const update = (id, changes) => setPlantillas(p => p.map(t => t.id === id ? { ...t, ...changes, updatedAt: today() } : t));
  const remove = (id) => setPlantillas(p => p.filter(t => t.id !== id));
  const duplicate = (id) => {
    const src = plantillas.find(p => p.id === id);
    if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    setPlantillas(p => [...p, { ...copy, id: newId(), nombre: src.nombre + ' (copia)', updatedAt: today(), usosCount: 0 }]);
  };
  const incrementUso = (id) => setPlantillas(p => p.map(t => t.id === id ? { ...t, usosCount: (t.usosCount||0) + 1 } : t));

  return (
    <PlantillasContext.Provider value={{ plantillas, add, update, remove, duplicate, incrementUso }}>
      {children}
    </PlantillasContext.Provider>
  );
}

export function usePlantillas() { return useContext(PlantillasContext); }
