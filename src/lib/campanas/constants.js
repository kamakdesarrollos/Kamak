// Datos canónicos del módulo Campañas (spec: docs/campana/proyecto-campana.md §2).
// Lógica PURA sin React — la consumen normalizar.js, importUnificado.js, las
// páginas del módulo y scripts Node (por eso extensión .js explícita en imports).
// Colores: paleta sobria del theme T (src/theme.js), formato {label,color} como
// ETAPA_META en src/lib/ventaEtapa.js.

// Estados de llamada canónicos (el original sucio de la planilla se preserva
// aparte en estado_original — ver normalizar.js).
export const ESTADOS_LLAMADA = [
  'SIN LLAMAR',
  'FUERA DE SERVICIO',
  'NO ATIENDE',
  'VOLVER A LLAMAR',
  'PASÓ MAIL',
  'PASÓ WHATSAPP',
  'DECISOR IDENTIFICADO',
  'NO INTERESA',
  'LEAD CALIENTE',
];

export const ESTADO_LLAMADA_META = {
  'SIN LLAMAR':           { label: 'Sin llamar',           color: '#9a9892' }, // T.ink3 — neutro
  'FUERA DE SERVICIO':    { label: 'Fuera de servicio',    color: '#5a5a58' }, // T.ink2 — número muerto
  'NO ATIENDE':           { label: 'No atiende',           color: '#b08968' }, // terracota apagado — intento fallido
  'VOLVER A LLAMAR':      { label: 'Volver a llamar',      color: '#d4923a' }, // T.warn — pendiente
  'PASÓ MAIL':            { label: 'Pasó mail',            color: '#41698c' }, // azul apagado — canal mail
  'PASÓ WHATSAPP':        { label: 'Pasó WhatsApp',        color: '#3d7a4a' }, // T.ok — canal WA (el CTA)
  'DECISOR IDENTIFICADO': { label: 'Decisor identificado', color: '#1a9b9c' }, // T.accent — avance clave
  'NO INTERESA':          { label: 'No interesa',          color: '#b91c1c' }, // rojo — cierre negativo (mismo de 'perdido')
  'LEAD CALIENTE':        { label: 'Lead caliente',        color: '#c2410c' }, // naranja intenso — la joya
};

// Pre-embudo de prospección (kanban de camp_operadores.etapa_prospeccion).
// 'promovido' = pasó al embudo real de ventas (Pipeline).
export const ETAPAS_PROSPECCION = [
  'sin_contactar',
  'contactado',
  'respondio',
  'en_conversacion',
  'reunion',
  'promovido',
  'descartado',
];

export const ETAPA_PROSPECCION_META = {
  sin_contactar:   { label: 'Sin contactar',   color: '#9a9892' }, // T.ink3
  contactado:      { label: 'Contactado',      color: '#41698c' }, // azul apagado
  respondio:       { label: 'Respondió',       color: '#1a9b9c' }, // T.accent
  en_conversacion: { label: 'En conversación', color: '#d4923a' }, // T.warn
  reunion:         { label: 'Reunión',         color: '#0d7475' }, // T.accent2 — "la métrica que paga"
  promovido:       { label: 'Promovido',       color: '#3d7a4a' }, // T.ok — pasó al embudo real
  descartado:      { label: 'Descartado',      color: '#b91c1c' }, // rojo
};

// Banderas reales de la base (~4.070 estaciones) + 'Otra' como escape.
export const BANDERAS = [
  'YPF',
  'Shell',
  'Axion',
  'Puma',
  'ACA',
  'Gulf',
  'Refinor',
  'Voy con Energía',
  'Dapsa',
  'Wico',
  'Rhasa',
  'Líder Oil',
  'Otra',
];

// Canales de contacto de camp_actividades.
export const CANALES = ['llamada', 'email', 'linkedin', 'whatsapp', 'presencial', 'otro'];
