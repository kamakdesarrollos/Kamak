import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { loadSharedData, saveSharedData, patchItemInSharedArray, appendItemInSharedArray, removeItemInSharedArray } from '../lib/dbHelpers';
import { onRemoteChange } from '../lib/syncBus';
import { useAppLoading } from './AppLoadingContext';

const newId = () => `plt-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
const today = () => new Date().toISOString().split('T')[0];

// SEED de plantillas SISMAT. Solo guardamos `nombre + unidad + cantidad` por
// tarea — los costos los resuelve Plantillas.jsx buscando la APU homónima en
// el catálogo (via calcTarea + catalogIndex), así un cambio de precio en el
// catálogo se refleja automáticamente en todas las plantillas.
//
// Márgenes default para plantillas SISMAT:
// - Materiales: 20% (compra mayorista, margen acotado).
// - Sub Contrato: 100% (× 2) — porque el sub-contrato Kamak vale la mitad
//   de la MO SISMAT, así al duplicar lo cobrado el cliente paga la MO
//   real del SISMAT y la empresa se queda con el 50% como margen.
const tareasFromList = (arr) =>
  arr.map((t, i) => ({ id: `t${i + 1}`, nombre: t[0], unidad: t[1], cantidad: t[2], costoMat: 0, costoSub: 0 }));

const rubroFromList = (id, nombre, items) => ({
  id, nombre, margenMat: 20, margenMO: 100, tareas: tareasFromList(items),
});

const SEED = [
  {
    id: 'plt-sismat-duplex',
    nombre: 'Sismat - Duplex',
    descripcion: 'Vivienda dúplex · 200 m² (extraído de SISMAT)',
    tipo: 'Vivienda', updatedAt: '2026-05-27', usosCount: 0,
    rubros: [
      rubroFromList('r1', '1 - Trabajos Preliminares', [
        ['Baño químico', 'U', 6],
        ['Cartel de obra', 'M²', 2],
        ['Cerco de obra', 'ML', 10],
        ['Contenedor grande', 'U', 4],
        ['Limpieza y nivelación de terreno.', 'M²', 160],
        ['Pilar de luz tradicional', 'U', 2],
        ['Replanteo', 'M²', 200],
        ['Retiro de tierra y nivelación de sup. p/ejecutar contrapisos y/o plateas. Incluye compactacion', 'M²', 160],
      ]),
      rubroFromList('r3', '3 - Movimiento de suelos', [
        ['Excavación de bases', 'M³', 13.3],
        ['Excavación de vigas de fundición', 'M³', 6.3],
        ['Relleno de suelos con tosca (para nivelar)', 'M³', 24],
      ]),
      rubroFromList('r4', '4 - Fundaciones', [
        ['Base 3 de H°A° 0.80x0.80 (armado y llenado)', 'U', 26],
        ['Viga de fundación 20x25 (armado y llenado)', 'ML', 20],
        ['Viga de fundación 25x30 (armado y llenado)', 'ML', 68],
      ]),
      rubroFromList('r5', '5 - Mampostería de cimientos', [
        ['Mampostería de 15', 'M²', 4],
        ['Mampostería de 20', 'M²', 13.6],
      ]),
      rubroFromList('r6', '6 - Capas aisladoras', [
        ['Horizontal (Espesor 2cm)', 'M²', 16.6],
        ['Vertical azotado (Espesor 0.5cm)', 'M²', 35.2],
      ]),
      rubroFromList('r7', '7 - Mampostería de elevación con cemento tradicional', [
        ['Ladrillos huecos 12x18x33', 'M²', 100.4],
        ['Ladrillos huecos 18x18x33', 'M²', 306],
      ]),
      rubroFromList('r8', '8 - Estructuras de hormigón armado', [
        ['Columna HºAº 20x20 (Hierro 12mm)', 'ML', 118],
        ['Encadenado H°A° 15x15', 'ML', 46],
        ['Encadenado H°A° 15x20', 'ML', 112],
        ['Escalera de H°A° (ancho 0.90 mts)', 'U', 2],
        ['Losa de viguetas con ladrillo de tergopol', 'M²', 86],
        ['Viga H°A° por 3,00 mts. (12x30cm)', 'U', 4],
      ]),
      rubroFromList('r9', '9 - Revoques', [
        ['Azotado hidrófugo bajo revoque', 'M²', 239],
        ['Fino exterior', 'M²', 239],
        ['Fino interior', 'M²', 442],
        ['Grueso regleado exterior', 'M²', 239],
        ['Grueso regleado interior', 'M²', 514],
      ]),
      rubroFromList('r10', '10 - Contrapisos', [
        ['De cascotes s/ terreno natural. Esp: 10cm.', 'M²', 234],
      ]),
      rubroFromList('r12', '12 - Cubiertas', [
        ['Techo de Chapa Ondulada o Trapezoidal sobre Estructura de Madera Vista. (c/aislante y machimbre)', 'M²', 162],
      ]),
      rubroFromList('r13', '13 - Instalaciones sanitarias', [
        ['Balcón c/canilla de servicio (Desagües pluviales)', 'U', 2],
        ['Baño completo (Desagües primarios y secundarios, agua caliente y fría)', 'U', 2],
        ['Cocina-Lavadero c/Termo o Calefon (Desagües primarios y secundarios, agua caliente y fría)', 'U', 2],
        ['Subida de agua al tanque de reserva c/2 canillas de servicio, colector c/3 bajadas indep.', 'U', 2],
        ['Toilette (Desagües primarios y secundarios, agua caliente y fría)', 'U', 2],
      ]),
      rubroFromList('r14', '14 - Instalaciones de gas', [
        ['Inst. en Fusión completa. Cocina, termo y 3 calefactores (sin planos)', 'GL', 2],
        ['Inst. en Fusión, boca adicional.', 'U', 2],
      ]),
      rubroFromList('r15', '15 - Instalación eléctrica', [
        ['Colocación de artefacto, (con armado)', 'U', 24],
        ['Inst. eléctrica para 50 bocas completa (incluye tablero seccional)', 'GL', 2],
      ]),
      rubroFromList('r16', '16 - Carpetas', [
        ['Hidrofuga s/contrapiso (Esp: 2cm)', 'M²', 206],
      ]),
      rubroFromList('r17', '17 - Pisos Cerámico, Porcellanato y Loseta', [
        ['Cerámico 20x20', 'M²', 158],
        ['Loseta de Vereda 40x40 (Calcáreos)', 'M²', 28],
        ['Porcellanato 30x30', 'M²', 48],
      ]),
      rubroFromList('r20', '20 - Zócalos y Contramarcos', [
        ['Contramarco de madera 1/2´ liso', 'ML', 110],
        ['Zócalo Cerámico H:7cm', 'ML', 48],
        ['Zócalo Madera 3/4´ liso', 'ML', 120],
      ]),
      rubroFromList('r21', '21 - Revestimientos Cerámico, Porcellanato, Venecita y Refractario', [
        ['Cerámico 20x20', 'M²', 72],
      ]),
      rubroFromList('r24', '24 - Cielorrasos y Molduras', [
        ['Moldura de tergopol 25x20mm. (lista p/pintar)', 'ML', 238],
      ]),
      rubroFromList('r25', '25 - Escaleras y Barandas', [
        ['Baranda de Madera con tensores y 4 lineas de cable de acero inoxidable.', 'ML', 16],
        ['Baranda Pasamanos de Madera', 'ML', 12],
        ['Carpeta cementicia. (P/escalera de H°A°)', 'M²', 11.2],
        ['Nariz de escalera de 2¨x 3´ en guayubira', 'ML', 27],
        ['Revest., alzada y pedada de cerámica', 'M²', 11.2],
      ]),
      rubroFromList('r26', '26 - Construcción en Seco', [
        ['Cielorraso con placas de yeso', 'M²', 190],
      ]),
      rubroFromList('r28', '28 - Pinturas', [
        ['Barniz s/madera y/o abertura.', 'M²', 90.8],
        ['Cielorraso de yeso y/o cal', 'M²', 196],
        ['Impermeabilizacion de losa. (terraza)', 'M²', 6],
        ['Paredes exteriores', 'M²', 239],
        ['Paredes interiores', 'M²', 514],
      ]),
      rubroFromList('r29', '29 - Marmolería/Granitos', [
        ['Mesada de Granito y/o Mármol', 'M²', 5.1],
        ['Mesada de Granito y/o Mármol c/Pileta de Cocina Doble ( 0.60 x 1.20)', 'U', 2],
        ['Zócalo de Granito Gris Mara (Alt. 5 cm)', 'ML', 9.2],
      ]),
      rubroFromList('r30', '30 - Amoblamientos para cocinas, placares y vestidores', [
        ['Alacena de aglomerado enchapado, enlaminado plástico c/ estante y cajonera', 'ML', 9.6],
        ['Bajo mesada aglomerado enchapado, enlaminado plástico c/ estante y cajonera', 'ML', 6],
      ]),
      rubroFromList('r31', '31 - Aberturas de madera', [
        ['Portón Garage 2.40 x 2.00', 'U', 2],
        ['Puerta de Entrada 0,80 x 2.00 (Exterior)', 'U', 2],
        ['Puerta Placa, hoja 60/70. (Interior)', 'U', 10],
      ]),
      rubroFromList('r32', '32 - Aberturas de aluminio', [
        ['Linea Herrero. Ventana 1.50 x 1.10 Corrediza c/Cortina de PVC c/Vidrio Simple 4mm.', 'U', 6],
        ['Linea Herrero. Ventana 1.50 x 1.10 Corrediza c/Vidrio Simple 4mm.', 'U', 4],
        ['Linea Herrero. Ventana Balcón 1.60 x 2.00 Corrediza c/Cortina de PVC c/Vidrio Simple 4mm.', 'U', 4],
        ['Linea Herrero. Ventiluz 1.00 x 0.50 Corredizo c/Vidrio Simple 4mm.', 'U', 2],
      ]),
      rubroFromList('r34', '34 - Cristales', [
        ['Vidrio de 4mm', 'M²', 28],
      ]),
      rubroFromList('r35', '35 - Colocación de artefactos sanitarios, accesorios y grifería', [
        ['Baño Completo (inodoro c/mochila, bidet, lavatorio y bañera)', 'U', 2],
        ['Lavadero y cocina', 'U', 2],
        ['Toilette c/depósito a mochila', 'U', 2],
      ]),
      rubroFromList('r36', '36 - Colocación de artefactos a gas', [
        ['Colocación Calefactor 3000 cal., (tiro natural)', 'U', 4],
        ['Colocación Calefactor 5000 cal., (tiro natural)', 'U', 4],
        ['Colocación Cocina, (sin ventilación)', 'U', 2],
        ['Colocación Termotanque 80lts., (con ventilación)', 'U', 2],
      ]),
      rubroFromList('r41', '41 - Limpieza y Ayuda de Gremios', [
        ['Ayuda de gremios', 'M²', 200],
        ['Limpieza final', 'M²', 200],
        ['Limpieza periódica', 'U', 1],
      ]),
    ],
  },
  {
    id: 'plt-sismat-dos-plantas',
    nombre: 'Sismat - En Dos Plantas',
    descripcion: 'Vivienda en dos plantas · 120 m² (extraído de SISMAT)',
    tipo: 'Vivienda', updatedAt: '2026-05-27', usosCount: 0,
    rubros: [
      rubroFromList('r1', '1 - Trabajos Preliminares', [
        ['Baño químico', 'U', 6],
        ['Cartel de obra', 'M²', 2],
        ['Cerco de obra', 'ML', 10],
        ['Contenedor grande', 'U', 3],
        ['Limpieza y nivelación de terreno.', 'M²', 80],
        ['Pilar de luz tradicional', 'U', 1],
        ['Replanteo', 'M²', 120],
        ['Retiro de tierra y nivelación de sup. p/ejecutar contrapisos y/o plateas. Incluye compactacion', 'M²', 72],
      ]),
      rubroFromList('r3', '3 - Movimiento de suelos', [
        ['Excavación de bases', 'M³', 7.2],
        ['Excavación de vigas de fundición', 'M³', 3.2],
        ['Relleno de suelos con tosca (para nivelar)', 'M³', 12],
      ]),
      rubroFromList('r4', '4 - Fundaciones', [
        ['Base 3 de H°A° 0.80x0.80 (armado y llenado)', 'U', 14],
        ['Viga de fundación 20x25 (armado y llenado)', 'ML', 12],
        ['Viga de fundación 25x30 (armado y llenado)', 'ML', 32],
      ]),
      rubroFromList('r5', '5 - Mampostería de cimientos', [
        ['Mampostería de 15', 'M²', 2.4],
        ['Mampostería de 20', 'M²', 6.4],
      ]),
      rubroFromList('r6', '6 - Capas aisladoras', [
        ['Horizontal (Espesor 2cm)', 'M²', 8.2],
        ['Vertical azotado (Espesor 0.5cm)', 'M²', 17.6],
      ]),
      rubroFromList('r7', '7 - Mampostería de elevación con cemento tradicional', [
        ['Ladrillos huecos 12x18x33', 'M²', 90],
        ['Ladrillos huecos 18x18x33', 'M²', 190],
      ]),
      rubroFromList('r8', '8 - Estructuras de hormigón armado', [
        ['Columna HºAº 20x20 (Hierro 12mm)', 'ML', 67.2],
        ['Encadenado H°A° 15x15', 'ML', 32],
        ['Encadenado H°A° 15x20', 'ML', 64],
        ['Escalera de H°A° (ancho 0.90 mts)', 'U', 1],
        ['Losa de viguetas con ladrillo de tergopol', 'M²', 65],
        ['Viga H°A° por 4,00 mts. (12x40cm)', 'U', 1],
      ]),
      rubroFromList('r9', '9 - Revoques', [
        ['Azotado hidrófugo bajo revoque', 'M²', 190],
        ['Fino exterior', 'M²', 190],
        ['Fino interior', 'M²', 307],
        ['Grueso regleado exterior', 'M²', 190],
        ['Grueso regleado interior', 'M²', 370],
      ]),
      rubroFromList('r10', '10 - Contrapisos', [
        ['De cascotes s/ terreno natural. Esp: 10cm.', 'M²', 138],
      ]),
      rubroFromList('r12', '12 - Cubiertas', [
        ['Techo de Chapa Ondulada o Trapezoidal sobre Estructura de Madera Vista. (c/aislante y machimbre)', 'M²', 91],
      ]),
      rubroFromList('r13', '13 - Instalaciones sanitarias', [
        ['Balcón c/canilla de servicio (Desagües pluviales)', 'U', 3],
        ['Baño completo (Desagües primarios y secundarios, agua caliente y fría)', 'U', 2],
        ['Cocina-Lavadero c/Termo o Calefon (Desagües primarios y secundarios, agua caliente y fría)', 'U', 1],
        ['Subida de agua al tanque de reserva c/2 canillas de servicio, colector c/3 bajadas indep.', 'U', 1],
        ['Toilette (Desagües primarios y secundarios, agua caliente y fría)', 'U', 1],
      ]),
      rubroFromList('r14', '14 - Instalaciones de gas', [
        ['Inst. en Fusión completa. Cocina, termo y 3 calefactores (sin planos)', 'GL', 1],
        ['Inst. en Fusión, boca adicional.', 'U', 2],
      ]),
      rubroFromList('r15', '15 - Instalación eléctrica', [
        ['Colocación de artefacto, (con armado)', 'U', 12],
        ['Inst. eléctrica para 50 bocas completa (incluye tablero seccional)', 'GL', 1],
      ]),
      rubroFromList('r16', '16 - Carpetas', [
        ['Hidrofuga s/contrapiso (Esp: 2cm)', 'M²', 126],
      ]),
      rubroFromList('r17', '17 - Pisos Cerámico, Porcellanato y Loseta', [
        ['Cerámico 20x20', 'M²', 68],
        ['Loseta de Vereda 40x40 (Calcáreos)', 'M²', 16],
        ['Porcellanato 30x30', 'M²', 54],
      ]),
      rubroFromList('r20', '20 - Zócalos y Contramarcos', [
        ['Contramarco de madera 1/2´ liso', 'ML', 80],
        ['Zócalo Cerámico H:7cm', 'ML', 24],
        ['Zócalo Madera 3/4´ liso', 'ML', 100],
      ]),
      rubroFromList('r21', '21 - Revestimientos Cerámico, Porcellanato, Venecita y Refractario', [
        ['Cerámico 20x20', 'M²', 63],
      ]),
      rubroFromList('r24', '24 - Cielorrasos y Molduras', [
        ['Moldura de tergopol 25x20mm. (lista p/pintar)', 'ML', 134],
      ]),
      rubroFromList('r25', '25 - Escaleras y Barandas', [
        ['Baranda de Madera con tensores y 4 lineas de cable de acero inoxidable.', 'ML', 15],
        ['Baranda Pasamanos de Madera', 'ML', 6],
        ['Carpeta cementicia. (P/escalera de H°A°)', 'M²', 5.6],
        ['Nariz de escalera de 2¨x 3´ en guayubira', 'ML', 13.5],
        ['Revest., alzada y pedada de cerámica', 'M²', 5.6],
      ]),
      rubroFromList('r26', '26 - Construcción en Seco', [
        ['Cielorraso con placas de yeso', 'M²', 125],
      ]),
      rubroFromList('r28', '28 - Pinturas', [
        ['Barniz s/madera y/o abertura.', 'M²', 48],
        ['Cielorraso de yeso y/o cal', 'M²', 125],
        ['Impermeabilizacion de losa. (terraza)', 'M²', 9],
        ['Paredes exteriores', 'M²', 190],
        ['Paredes interiores', 'M²', 307],
      ]),
      rubroFromList('r29', '29 - Marmolería/Granitos', [
        ['Mesada de Granito y/o Mármol', 'M²', 2.1],
        ['Mesada de Granito y/o Mármol c/Pileta de Cocina Doble ( 0.60 x 1.20)', 'U', 1],
        ['Zócalo de Granito Gris Mara (Alt. 5 cm)', 'ML', 5.9],
      ]),
      rubroFromList('r30', '30 - Amoblamientos para cocinas, placares y vestidores', [
        ['Alacena de aglomerado enchapado, enlaminado plástico c/ estante y cajonera', 'ML', 5.6],
        ['Bajo mesada aglomerado enchapado, enlaminado plástico c/ estante y cajonera', 'ML', 3.7],
      ]),
      rubroFromList('r31', '31 - Aberturas de madera', [
        ['Puerta de Entrada 0,80 x 2.00 (Exterior)', 'U', 1],
        ['Puerta Placa, hoja 60/70. (Interior)', 'U', 8],
      ]),
      rubroFromList('r32', '32 - Aberturas de aluminio', [
        ['Linea Herrero. Ventana 1.50 x 1.10 Corrediza c/Cortina de PVC c/Vidrio Simple 4mm.', 'U', 2],
        ['Linea Herrero. Ventana 1.50 x 1.10 Corrediza c/Vidrio Simple 4mm.', 'U', 1],
        ['Linea Herrero. Ventana Balcón 1.60 x 2.00 Corrediza c/Cortina de PVC c/Vidrio Simple 4mm.', 'U', 4],
        ['Linea Herrero. Ventiluz 1.00 x 0.50 Corredizo c/Vidrio Simple 4mm.', 'U', 3],
      ]),
      rubroFromList('r34', '34 - Cristales', [
        ['Vidrio de 4mm', 'M²', 17],
      ]),
      rubroFromList('r35', '35 - Colocación de artefactos sanitarios, accesorios y grifería', [
        ['Baño Completo (inodoro c/mochila, bidet, lavatorio y bañera)', 'U', 2],
        ['Lavadero y cocina', 'U', 1],
        ['Toilette c/depósito a mochila', 'U', 1],
      ]),
      rubroFromList('r36', '36 - Colocación de artefactos a gas', [
        ['Colocación Calefactor 3000 cal., (tiro natural)', 'U', 3],
        ['Colocación Calefactor 5000 cal., (tiro natural)', 'U', 2],
        ['Colocación Cocina, (sin ventilación)', 'U', 1],
        ['Colocación Termotanque 80lts., (con ventilación)', 'U', 1],
      ]),
      rubroFromList('r41', '41 - Limpieza y Ayuda de Gremios', [
        ['Ayuda de gremios', 'M²', 120],
        ['Limpieza final', 'M²', 120],
        ['Limpieza periódica', 'U', 1],
      ]),
    ],
  },
  {
    id: 'plt-sismat-vivienda',
    nombre: 'Sismat - Vivienda Unifamiliar',
    descripcion: 'Vivienda unifamiliar 1 planta · 80–100 m² (extraído de SISMAT)',
    tipo: 'Vivienda', updatedAt: '2026-05-27', usosCount: 0,
    rubros: [
      rubroFromList('r1', '1 - Trabajos Preliminares', [
        ['Baño químico', 'U', 5],
        ['Cartel de obra', 'M²', 1],
        ['Cerco de obra', 'ML', 10],
        ['Contenedor grande', 'U', 1],
        ['Pilar de luz tradicional', 'U', 1],
        ['Replanteo', 'M²', 80],
        ['Retiro de tierra y nivelación de sup. p/ejecutar contrapisos y/o plateas. Incluye compactacion', 'M²', 100],
      ]),
      rubroFromList('r3', '3 - Movimiento de suelos', [
        ['Excavación de bases', 'M³', 4.5],
        ['Excavación de vigas de fundición', 'M³', 4],
        ['Relleno de suelos con tosca (para nivelar)', 'M³', 16],
      ]),
      rubroFromList('r4', '4 - Fundaciones', [
        ['Base 1 de H°A° 0.60x0.60 (armado y llenado)', 'U', 15],
        ['Viga de fundación 20x25 (armado y llenado)', 'ML', 24.5],
        ['Viga de fundación 25x30 (armado y llenado)', 'ML', 36.5],
      ]),
      rubroFromList('r5', '5 - Mampostería de cimientos', [
        ['Mampostería de 15', 'M²', 4.9],
        ['Mampostería de 20', 'M²', 7.3],
      ]),
      rubroFromList('r6', '6 - Capas aisladoras', [
        ['Horizontal (Espesor 2cm)', 'M²', 11],
        ['Vertical azotado (Espesor 0.5cm)', 'M²', 24.4],
      ]),
      rubroFromList('r7', '7 - Mampostería de elevación con cemento tradicional', [
        ['Ladrillos huecos 12x18x33', 'M²', 63.7],
        ['Ladrillos huecos 18x18x33', 'M²', 108.7],
      ]),
      rubroFromList('r8', '8 - Estructuras de hormigón armado', [
        ['Columna HºAº 20x20 (Hierro 10mm)', 'ML', 36],
        ['Encadenado H°A° 15x15', 'ML', 24.5],
        ['Encadenado H°A° 15x20', 'ML', 36.5],
      ]),
      rubroFromList('r9', '9 - Revoques', [
        ['Azotado hidrófugo bajo revoque', 'M²', 108.7],
        ['Fino exterior', 'M²', 108.7],
        ['Fino interior', 'M²', 206.1],
        ['Grueso regleado exterior', 'M²', 108.7],
        ['Grueso regleado interior', 'M²', 236.1],
      ]),
      rubroFromList('r10', '10 - Contrapisos', [
        ['De cascotes s/ terreno natural. Esp: 10cm.', 'M²', 94.4],
      ]),
      rubroFromList('r12', '12 - Cubiertas', [
        ['Techo de Chapa Ondulada o Trapezoidal sobre Estructura de Madera Vista. (c/aislante y machimbre)', 'M²', 100.8],
      ]),
      rubroFromList('r13', '13 - Instalaciones sanitarias', [
        ['Baño completo (Desagües primarios y secundarios, agua caliente y fría)', 'U', 1],
        ['Cocina-Lavadero c/Termo o Calefon (Desagües primarios y secundarios, agua caliente y fría)', 'U', 1],
        ['Subida de agua al tanque de reserva c/2 canillas de servicio, colector c/3 bajadas indep.', 'U', 1],
        ['Toilette (Desagües primarios y secundarios, agua caliente y fría)', 'U', 1],
      ]),
      rubroFromList('r14', '14 - Instalaciones de gas', [
        ['Inst. en Fusión completa. Cocina, termo y 3 calefactores (sin planos)', 'GL', 1],
      ]),
      rubroFromList('r15', '15 - Instalación eléctrica', [
        ['Colocación de artefacto, (con armado)', 'U', 10],
        ['Inst. eléctrica para 30 bocas completa (incluye tablero seccional)', 'GL', 1],
      ]),
      rubroFromList('r16', '16 - Carpetas', [
        ['Hidrofuga s/contrapiso (Esp: 2cm)', 'M²', 72],
      ]),
      rubroFromList('r17', '17 - Pisos Cerámico, Porcellanato y Loseta', [
        ['Cerámico 20x20', 'M²', 28],
        ['Loseta de Vereda 40x40 (Calcáreos)', 'M²', 22.4],
        ['Porcellanato 30x30', 'M²', 44],
      ]),
      rubroFromList('r20', '20 - Zócalos y Contramarcos', [
        ['Contramarco de madera 1/2´ liso', 'ML', 50],
        ['Zócalo Cerámico H:7cm', 'ML', 15],
        ['Zócalo Madera 3/4´ liso', 'ML', 60],
      ]),
      rubroFromList('r21', '21 - Revestimientos Cerámico, Porcellanato, Venecita y Refractario', [
        ['Cerámico 20x20', 'M²', 30],
      ]),
      rubroFromList('r24', '24 - Cielorrasos y Molduras', [
        ['Moldura de tergopol 25x20mm. (lista p/pintar)', 'ML', 84],
      ]),
      rubroFromList('r26', '26 - Construcción en Seco', [
        ['Cielorraso con placas de yeso', 'M²', 80],
      ]),
      rubroFromList('r28', '28 - Pinturas', [
        ['Barniz s/madera y/o abertura.', 'M²', 28],
        ['Cielorraso de yeso y/o cal', 'M²', 80],
        ['Paredes exteriores', 'M²', 108.7],
        ['Paredes interiores', 'M²', 206.1],
      ]),
      rubroFromList('r29', '29 - Marmolería/Granitos', [
        ['Mesada de Granito y/o Mármol', 'M²', 1.8],
        ['Mesada de Granito y/o Mármol c/Pileta de Cocina Doble ( 0.60 x 1.20)', 'U', 1],
        ['Zócalo de Granito Gris Mara (Alt. 5 cm)', 'ML', 4.2],
      ]),
      rubroFromList('r30', '30 - Amoblamientos para cocinas, placares y vestidores', [
        ['Alacena de aglomerado enchapado, enlaminado plástico c/ estante y cajonera', 'ML', 4.8],
        ['Bajo mesada aglomerado enchapado, enlaminado plástico c/ estante y cajonera', 'ML', 4.2],
      ]),
      rubroFromList('r31', '31 - Aberturas de madera', [
        ['Puerta de Entrada 0,80 x 2.00 (Exterior)', 'U', 1],
        ['Puerta Placa, hoja 60/70. (Interior)', 'U', 5],
      ]),
      rubroFromList('r32', '32 - Aberturas de aluminio', [
        ['Linea Herrero. Puerta de Entrada 0,80 x 2.00 (Exterior)', 'U', 1],
        ['Linea Herrero. Ventana 1.50 x 1.10 Corrediza c/Cortina de PVC c/Vidrio Simple 4mm.', 'U', 4],
        ['Linea Herrero. Ventana 1.50 x 1.10 Corrediza c/Vidrio Simple 4mm.', 'U', 1],
        ['Linea Herrero. Ventiluz 1.00 x 0.50 Corredizo c/Vidrio Simple 4mm.', 'U', 1],
      ]),
      rubroFromList('r34', '34 - Cristales', [
        ['Vidrio de 4mm', 'M²', 8.5],
      ]),
      rubroFromList('r35', '35 - Colocación de artefactos sanitarios, accesorios y grifería', [
        ['Baño Completo (inodoro c/mochila, bidet, lavatorio y bañera)', 'U', 1],
        ['Lavadero y cocina', 'U', 1],
        ['Toilette c/depósito a mochila', 'U', 1],
      ]),
      rubroFromList('r36', '36 - Colocación de artefactos a gas', [
        ['Colocación Calefactor 3000 cal., (tiro natural)', 'U', 2],
        ['Colocación Calefactor 5000 cal., (tiro natural)', 'U', 1],
        ['Colocación Cocina, (sin ventilación)', 'U', 1],
        ['Colocación Termotanque 80lts., (con ventilación)', 'U', 1],
      ]),
      rubroFromList('r41', '41 - Limpieza y Ayuda de Gremios', [
        ['Ayuda de gremios', 'M²', 80],
        ['Limpieza final', 'M²', 80],
        ['Limpieza periódica', 'U', 1],
      ]),
    ],
  },
];

// Versión del SEED: al bumpearla, forzamos reemplazar las plantillas en LS y
// Supabase con SEED actual (eliminando las viejas plt1..plt6, plt-fan).
// v4: margen MO/Sub default 100% (× 2) en lugar de 35%, porque al cobrar el
// sub al doble cubrimos la MO SISMAT completa.
const PLANTILLAS_SEED_VERSION = '4';

const PlantillasContext = createContext(null);

// IMPORTANTE: no bumpear la versión acá — el useEffect tiene que poder leer
// la versión vieja para saber que hay que sobreescribir también Supabase.
// Solo devolvemos SEED sincronicamente para el render inicial.
function load() {
  try {
    const ver = localStorage.getItem('kamak_plantillas_seed_v');
    if (ver !== PLANTILLAS_SEED_VERSION) return SEED;
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
  // Timestamp del último guardado local. El handler de broadcast ignora eventos
  // dentro de los 3s siguientes: pueden traer datos del server SIN el cambio que
  // acabamos de hacer y "desaparecerlo" (la escritura atómica ya lo persistió).
  const lastLocalSaveAt = useRef(0);
  const { markReady } = useAppLoading();

  useEffect(() => {
    let cancelled = false;
    const seedVerLS = localStorage.getItem('kamak_plantillas_seed_v');
    const needsReseed = seedVerLS !== PLANTILLAS_SEED_VERSION;
    loadSharedData('plantillas').then(data => {
      if (cancelled) return;
      if (needsReseed) {
        // Versión del SEED bumpeada: actualizamos las plantillas del SEED PERO
        // sin destruir las creadas por el usuario (MERGE, no reemplazo). Antes
        // esto sobreescribía TODO con el SEED → borraba las plantillas propias
        // (ej. "Puma Shop Express"). Conservamos las creadas por el usuario
        // (id con timestamp de newId) y descartamos basura de seeds viejos.
        const seedIds = new Set(SEED.map(p => p.id));
        const userPlts = (Array.isArray(data) ? data : [])
          .filter(p => p && !seedIds.has(p.id) && /^plt-\d{10,}/.test(p.id || ''));
        const merged = [...SEED, ...userPlts];
        localStorage.setItem('kamak_plantillas_seed_v', PLANTILLAS_SEED_VERSION);
        localStorage.setItem('kamak_plantillas_v1', JSON.stringify(merged));
        fromRemote.current = true;
        setPlantillas(merged);
        saveSharedData('plantillas', merged);
        setTimeout(() => { fromRemote.current = false; }, 0);
      } else if (data) {
        fromRemote.current = true;
        setPlantillas(data); localStorage.setItem('kamak_plantillas_v1', JSON.stringify(data));
        setTimeout(() => { fromRemote.current = false; }, 0);
      } else saveSharedData('plantillas', plantillas); // eslint-disable-line react-hooks/exhaustive-deps
      sbLoaded.current = true;
      markReady();
    });

    const unsub = onRemoteChange('plantillas', () => {
      // Si acabamos de guardar (< 3s), ignoramos el broadcast: puede traer del
      // server una versión SIN nuestro cambio y pisarlo en pantalla ("aparece y
      // desaparece"). La escritura atómica ya lo persistió; al pasar la ventana,
      // la próxima recarga trae todo correcto.
      if (lastLocalSaveAt.current && Date.now() - lastLocalSaveAt.current < 3000) return;
      loadSharedData('plantillas').then(d => {
        if (cancelled || !d) return;
        fromRemote.current = true;
        setPlantillas(d);
        localStorage.setItem('kamak_plantillas_v1', JSON.stringify(d));
        setTimeout(() => { fromRemote.current = false; }, 0);
      });
    });
    return () => { cancelled = true; unsub(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persistencia: cache local + escritura ATÓMICA por ítem (ver mutaciones).
  // YA NO se guarda el blob entero con debounce: eso pisaba la edición de otra
  // persona/pestaña (last-write-wins) y los cambios "desaparecían" al recibir su
  // broadcast. Cada add/update/remove persiste solo SU ítem.
  const plantillasRef = useRef(plantillas);
  useEffect(() => {
    plantillasRef.current = plantillas;
    localStorage.setItem('kamak_plantillas_v1', JSON.stringify(plantillas));
  }, [plantillas]);

  // Mutaciones: estado local optimista + escritura atómica por ítem en Supabase.
  // touch() marca el guardado local para que el broadcast no pise el cambio.
  const touch = () => { lastLocalSaveAt.current = Date.now(); };
  const add = useCallback((plt) => {
    touch();
    const full = { ...plt, id: newId(), updatedAt: today(), usosCount: 0 };
    setPlantillas(p => [...p, full]);
    appendItemInSharedArray('plantillas', full);
    return full.id;
  }, []);
  const update = useCallback((id, changes) => {
    touch();
    const patch = { ...changes, updatedAt: today() };
    setPlantillas(p => p.map(t => t.id === id ? { ...t, ...patch } : t));
    patchItemInSharedArray('plantillas', id, patch);
  }, []);
  const remove = useCallback((id) => {
    touch();
    setPlantillas(p => p.filter(t => t.id !== id));
    removeItemInSharedArray('plantillas', id);
  }, []);
  const duplicate = useCallback((id) => {
    const src = plantillasRef.current.find(x => x.id === id);
    if (!src) return;
    touch();
    const copy = { ...JSON.parse(JSON.stringify(src)), id: newId(), nombre: src.nombre + ' (copia)', updatedAt: today(), usosCount: 0 };
    setPlantillas(p => [...p, copy]);
    appendItemInSharedArray('plantillas', copy);
  }, []);
  const incrementUso = useCallback((id) => {
    const cur = plantillasRef.current.find(t => t.id === id);
    if (!cur) return;
    touch();
    const usosCount = (cur.usosCount || 0) + 1;
    setPlantillas(p => p.map(t => t.id === id ? { ...t, usosCount } : t));
    patchItemInSharedArray('plantillas', id, { usosCount });
  }, []);

  const value = useMemo(() => ({ plantillas, add, update, remove, duplicate, incrementUso }), [plantillas, add, update, remove, duplicate, incrementUso]);

  return (
    <PlantillasContext.Provider value={value}>
      {children}
    </PlantillasContext.Provider>
  );
}

export function usePlantillas() { return useContext(PlantillasContext); }
