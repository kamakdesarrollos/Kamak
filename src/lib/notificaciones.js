// Lógica pura del sistema de notificaciones (sin React, sin red): qué evento
// avisa a qué rol, a quién le toca, y si una notif está sin leer para alguien.

// Catálogo de eventos. titulo(datos) arma el texto; link es la ruta destino.
// Plan 1 sólo CABLEA solicitud_eliminacion y solicitud_resuelta; el resto del
// catálogo se completa en Plan 2 (los call sites). Tener la config entera acá
// desde ya mantiene el routing en un solo lugar.
export const EVENTOS = {
  solicitud_eliminacion:   { roles: ['Admin'], titulo: (d) => `Solicitud de eliminación: ${d?.descripcion || 'un movimiento'}`, link: '/autorizaciones' },
  solicitud_resuelta:      { roles: [],        titulo: (d) => `Tu solicitud fue ${d?.estado || 'resuelta'}`, link: '/movimientos' },
  wa_factura_pendiente:    { roles: ['Admin'], titulo: () => 'Factura de WhatsApp para revisar', link: '/autorizaciones?origen=whatsapp' },
  wa_movimiento_pendiente: { roles: ['Admin'], titulo: () => 'Movimiento de WhatsApp para revisar', link: '/autorizaciones?origen=whatsapp' },
  cheque_por_vencer:       { roles: ['Admin', 'Administración'], titulo: (d) => `Cheque por vencer: ${d?.detalle || ''}`, link: '/cheques' },
  cuenta_por_vencer:       { roles: ['Administración'], titulo: (d) => `Cuenta por pagar próxima: ${d?.detalle || ''}`, link: '/ordenes-de-pago' },
  cobro_cliente_proximo:   { roles: ['Admin', 'Administración'], titulo: (d) => `Cobro próximo: ${d?.detalle || ''}`, link: '/clientes' },
  tarea_asignada:          { roles: [], titulo: (d) => `Te asignaron: ${d?.tarea || 'una tarea'}`, link: '/tareas' },
  presupuesto_adjuntado:   { roles: ['Jefe de obra', 'Admin'], titulo: (d) => `Presupuesto adjuntado en ${d?.obra || 'una obra'}${d?.rubro ? ` · ${d.rubro}` : ''}`, link: '/obras' },
  orden_pago_creada:       { roles: ['Admin', 'Administración'], titulo: (d) => `Orden de pago creada: ${d?.detalle || ''}`, link: '/ordenes-de-pago' },
  cliente_firmo:           { roles: ['Admin', 'Administración'], titulo: (d) => `${d?.cliente || 'Un cliente'} firmó un documento`, link: '/clientes' },
  proveedor_firmo:         { roles: ['Admin', 'Administración'], titulo: (d) => `${d?.proveedor || 'Un proveedor'} firmó/subió algo`, link: '/proveedores' },
};

// Tipos que YA se muestran in-app como alerta derivada en vivo del Topbar
// (solicitudes, WhatsApp pendiente, cheques/cuotas por vencer, tareas nuevas). El
// feed los OCULTA para no duplicar el conteo del badge — pero igual se les manda
// push (ese es el valor que agrega Fase 2 para estos). Fuente única acá: el Topbar
// y el helper server-side (api/_lib/notif.js) lo importan de este módulo.
export const TIPOS_LEGACY = [
  'solicitud_eliminacion',
  'wa_factura_pendiente',
  'wa_movimiento_pendiente',
  'cheque_por_vencer',
  'cobro_cliente_proximo',
  'tarea_asignada',
];

// destino = { roles:[...], userIds?:[...] }. Devuelve la lista de userIds a
// notificar: todos los usuarios con esos roles + los userIds explícitos,
// deduplicados y SIN el actor (no se auto-notifica).
export function resolverDestinatarios(destino, usuarios, actorUserId) {
  const roles = (destino && destino.roles) || [];
  const extra = (destino && destino.userIds) || [];
  const set = new Set(extra);
  for (const u of (usuarios || [])) {
    if (u && roles.includes(u.rol)) set.add(u.id);
  }
  if (actorUserId) set.delete(actorUserId);
  return [...set];
}

// Una notif está "no leída" para un usuario si su id no figura en leidaPor.
export function noLeidaPara(notif, userId) {
  return !((notif && notif.leidaPor) || []).includes(userId);
}
