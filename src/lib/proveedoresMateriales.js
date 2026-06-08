// proveedoresMateriales — agrupa los rubros REALES del catálogo SISMAT (5297
// materiales en 40 rubros, nombres en castellano CON acentos) en 14 "proveedores
// tipo" (corralón, electricidad, sanitarios, etc.). Lógica PURA, sin React, para
// poder testearla y reusarla en scripts/bot.
//
// IMPORTANTE: extensión .js explícita en el import — Node ESM no resuelve sin ella.
import { searchNorm } from './searchNorm.js';

// Normalizador local: searchNorm (minúsculas + sin acentos) + trim, para que el
// match del rubro tolere también espacios sobrantes ("  Pinturas  ").
const norm = (s) => searchNorm(s).trim();

// Los 14 proveedores tipo. id kebab-case ESTABLE (no cambiar: se persiste), label
// el nombre legible, color distinto del theme T (paleta tierra/acento de Kamak).
export const PROVEEDORES = [
  { id: 'corralon',        label: 'Corralón de materiales',       color: '#8a5a2b' }, // tierra
  { id: 'electricidad',    label: 'Casa de electricidad',         color: '#d4923a' }, // ámbar
  { id: 'sanitarios',      label: 'Sanitarios / Plomería',        color: '#1a9b9c' }, // accent
  { id: 'revestimientos',  label: 'Casa de revestimientos',       color: '#b06a4f' }, // terracota
  { id: 'pintureria',      label: 'Pinturería',                   color: '#7a4fb0' }, // violeta
  { id: 'aberturas',       label: 'Aberturas',                    color: '#3a6ea5' }, // azul
  { id: 'maderera',        label: 'Maderera / Carpintería',       color: '#9c6b3f' }, // madera
  { id: 'vidrieria',       label: 'Vidriería',                    color: '#5fb3c4' }, // celeste
  { id: 'marmoleria',      label: 'Marmolería',                   color: '#6b7280' }, // gris piedra
  { id: 'construccion-seco', label: 'Construcción en seco',       color: '#a39487' }, // gris cálido
  { id: 'climatizacion',   label: 'Climatización / Equipamiento', color: '#2f8f6b' }, // verde agua
  { id: 'ferreteria',      label: 'Ferretería / Herrajes',        color: '#9a9892' }, // ink3
  { id: 'mobiliario',      label: 'Mobiliario (San Francisco)',   color: '#c0468a' }, // magenta
  { id: 'servicios-otros', label: 'Servicios / Otros',            color: '#5a6b8a' }, // azul gris
];

// Label de fallback cuando un rubro no está mapeado. NO es uno de los 14: es el
// "no sé de quién es". (El proveedor 'Servicios / Otros' es para rubros de
// servicio conocidos; 'Otros' es para lo desmapeado.)
export const FALLBACK_LABEL = 'Otros';
const FALLBACK_COLOR = '#9a9892'; // ink3, neutro

// El rubro mixto que hay que partir por el NOMBRE del material.
const RUBRO_MIXTO_CEMENTOS = norm('Cales, Cementos, Finos, Pegamentos, Pastina y Hormigones');

// Mapa rubro(real) → label de proveedor tipo. Las CLAVES se guardan ya
// normalizadas (minúsculas + sin acentos + trim) para que matcheen contra el
// rubro de entrada aunque difieran acentos o mayúsculas.
const MAPA_FUENTE = {
  'Corralón de materiales': [
    'Hierros, Mallas, Alambres, Tornillos, Clavos y Cercos.',
    'Aditivos, Impermeabilizaciones y Aislaciones',
    'Chapas, Tejas y Losas',
    'Ladrillos y Bloques',
    'Zingueria',
    'Agregados (Costos por m3)',
    'Tierra, Tosca y Suelos para Rellenos',
    'Yeseria',
  ],
  'Casa de electricidad': [
    'Instalaciones Eléctricas',
    'ELECTRICIDAD ALTERNATIVA',
    'Energías Renovables',
    '15 - Instalación eléctrica',
  ],
  'Sanitarios / Plomería': [
    'Instalaciones Sanitarias (Agua)',
    'Instalaciones Sanitarias (Desagües)',
    'Artefactos, Griferias y Accesorios Sanitarios',
    'Instalaciones de Gas y Reguladores',
  ],
  'Casa de revestimientos': [
    'Pisos y Revestimientos',
    'Revestimientos Texturados',
  ],
  'Pinturería': [
    'Pinturas',
  ],
  'Aberturas': [
    'Carpinterías de Aluminio',
    'Carpinterías de PVC',
    'Carpinterías Metálicas',
  ],
  'Maderera / Carpintería': [
    'Maderas',
    'Carpinterías de Madera',
  ],
  'Vidriería': [
    'Cristales, Vidrios y Espejos',
  ],
  'Marmolería': [
    'Mármoles y Granitos',
    'Piedras',
  ],
  'Construcción en seco': [
    'Construcción en Seco y Steel Framing',
  ],
  'Climatización / Equipamiento': [
    'Equipamiento',
    'Sistemas de Calefacción',
  ],
  'Ferretería / Herrajes': [
    'Herramientas (Ventas)',
    'Herrajes',
  ],
  'Mobiliario (San Francisco)': [
    'Mobiliario San Francisco',
    'Mobiliario Super7',
    'Mobiliario Shop Express',
    'Amoblamiento para Cocinas, Placares y Vestidores',
  ],
  'Servicios / Otros': [
    'Herramientas y Servicios (Alquiler)',
    '46 - GRAFICA',
    '47 - LOGISTICA',
  ],
};

// rubroNormalizado → label. Se construye una sola vez al cargar el módulo.
const RUBRO_A_PROVEEDOR = new Map();
for (const [label, rubros] of Object.entries(MAPA_FUENTE)) {
  for (const r of rubros) RUBRO_A_PROVEEDOR.set(norm(r), label);
}

// Índices para los helpers (por id y por label normalizado).
const POR_ID = new Map(PROVEEDORES.map((p) => [p.id, p]));
const POR_LABEL_NORM = new Map(PROVEEDORES.map((p) => [norm(p.label), p]));

// Keywords para PARTIR el rubro mixto de cementos según el NOMBRE del material.
// Obra gruesa → Corralón; terminación/colocación → Casa de revestimientos.
const KW_CORRALON = ['cemento', 'cal', 'hormigon', 'cascote', 'mortero', 'concreto', 'revoque', 'portland', 'plasticor'];
const KW_REVESTIMIENTOS = ['pegamento', 'pastina', 'adhesivo', 'junta', 'fino', 'klaukol', 'ligante'];

// proveedorDeRubro(rubro) → label del proveedor tipo.
// Si el rubro es el MIXTO de cementos, sin material no se puede partir: cae al
// default del partidor (Corralón). Rubro no mapeado → 'Otros'.
export function proveedorDeRubro(rubro) {
  const rn = norm(rubro);
  if (!rn) return FALLBACK_LABEL;
  if (rn === RUBRO_MIXTO_CEMENTOS) return partirRubroMixto('');
  return RUBRO_A_PROVEEDOR.get(rn) || FALLBACK_LABEL;
}

// proveedorDeMaterial(material) → label. Usa material.rubro; si es el rubro mixto,
// parte por keyword del nombre. Fallback 'Otros'.
export function proveedorDeMaterial(material) {
  if (!material) return FALLBACK_LABEL;
  const rn = norm(material.rubro);
  if (!rn) return FALLBACK_LABEL;
  if (rn === RUBRO_MIXTO_CEMENTOS) return partirRubroMixto(material.nombre);
  return RUBRO_A_PROVEEDOR.get(rn) || FALLBACK_LABEL;
}

// Parte el rubro mixto de cementos por keyword del nombre del material.
// DEFAULT (no matchea ninguna keyword) → 'Corralón de materiales'.
function partirRubroMixto(nombre) {
  const n = searchNorm(nombre);
  // Terminación primero: 'fino' es más específico que la obra gruesa, y un
  // "pegamento de cemento" debe ir a revestimientos por la intención del nombre.
  if (KW_REVESTIMIENTOS.some((k) => n.includes(k))) return 'Casa de revestimientos';
  if (KW_CORRALON.some((k) => n.includes(k))) return 'Corralón de materiales';
  return 'Corralón de materiales'; // default
}

// labelProveedor(id) → label legible. Acepta también un label (lo devuelve tal
// cual si ya es uno conocido). Desconocido → el propio valor (no rompe).
export function labelProveedor(idOrLabel) {
  if (POR_ID.has(idOrLabel)) return POR_ID.get(idOrLabel).label;
  const byLabel = POR_LABEL_NORM.get(norm(idOrLabel));
  if (byLabel) return byLabel.label;
  return String(idOrLabel ?? FALLBACK_LABEL);
}

// colorProveedor(idOrLabel) → color hex. Acepta id o label. Desconocido → neutro.
export function colorProveedor(idOrLabel) {
  if (POR_ID.has(idOrLabel)) return POR_ID.get(idOrLabel).color;
  const byLabel = POR_LABEL_NORM.get(norm(idOrLabel));
  if (byLabel) return byLabel.color;
  return FALLBACK_COLOR;
}
