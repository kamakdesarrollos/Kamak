// Transformaciones PURAS entre los valores crudos del form de la pestaña "Web"
// (strings de inputs) y el sub-objeto obra.web. Sin red, sin estado → testeable.
// Lo usa el editor de obra (subsistema 2). El whitelist real lo aplica obraPublic.
import { makeSlug } from './obraPublic.js';

function toNum(x) {
  if (x === '' || x == null) return null;
  const n = Number(String(x).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// Valores del form → patch para setWebObra. Parsea números, arma coords, parte el
// copy en párrafos (separados por línea en blanco). NO toca gallery/imageBefore/
// imageAfter/publicar (esos se manejan aparte en el editor).
export function parseWebForm(v = {}) {
  const lat = toNum(v.lat), lng = toNum(v.lng);
  const texto = String(v.texto || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  return {
    titulo: (v.titulo || '').trim(),
    slug: (v.slug || '').trim() || makeSlug(v.titulo || v.nombre || ''),
    categoria: v.categoria || '',
    marca: (v.marca || '').trim(),
    localidad: (v.localidad || '').trim(),
    provincia: (v.provincia || '').trim(),
    m2: toNum(v.m2),
    diasOverride: toNum(v.diasOverride),
    coords: (lat != null && lng != null) ? { lat, lng } : null,
    texto,
    destacada: !!v.destacada,
    orden: toNum(v.orden) ?? 999,
    antes: !!v.antes,
  };
}

// obra.web → valores del form (para precargar los inputs al abrir el editor).
export function webToForm(web = {}) {
  return {
    titulo: web.titulo || '',
    slug: web.slug || '',
    categoria: web.categoria || '',
    marca: web.marca || '',
    localidad: web.localidad || '',
    provincia: web.provincia || '',
    m2: web.m2 ?? '',
    diasOverride: web.diasOverride ?? '',
    lat: web.coords?.lat ?? '',
    lng: web.coords?.lng ?? '',
    texto: Array.isArray(web.texto) ? web.texto.join('\n\n') : (web.texto || ''),
    destacada: !!web.destacada,
    orden: web.orden ?? '',
    antes: !!web.antes,
  };
}

// Avisos NO bloqueantes antes de publicar (la regla del proyecto es "publicar
// igual, en blanco lo que falte"; esto solo le muestra a Franco qué conviene completar).
export function avisosPublicar(web = {}) {
  const a = [];
  if (!web.localidad) a.push('Falta la localidad');
  if (web.m2 == null) a.push('Faltan los m²');
  if (!(web.gallery && web.gallery.length) && !web.imageAfter) a.push('No hay fotos cargadas');
  if (web.antes && (!web.imageBefore || !web.imageAfter)) a.push('Modo antes/después activo pero falta marcar las 2 fotos');
  return a;
}
