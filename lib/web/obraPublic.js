// Lógica PURA para exponer obras a la web pública (sin red → testeable).
// La usan los endpoints api/public/obras.js y api/public/leads.js.
// Regla de oro: la forma pública NUNCA incluye costos/márgenes/cliente.

export function makeSlug(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'obra';
}

function diasEntre(ini, fin) {
  if (!ini || !fin) return null;
  const a = new Date(ini + 'T00:00:00'), b = new Date(fin + 'T00:00:00');
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const d = Math.round((b - a) / 86400000);
  return d > 0 ? d : null;
}

// Mapa a forma pública. WHITELIST estricta.
export function obraPublic(obra) {
  const w = obra.web || {};
  return {
    slug: w.slug || makeSlug(obra.nombre),
    titulo: w.titulo || obra.nombre || '',
    nombre: obra.nombre || '',
    localidad: w.localidad || '',
    provincia: w.provincia || '',
    marca: w.marca || '',
    categoria: w.categoria || '',
    m2: w.m2 ?? null,
    dias: w.diasOverride ?? diasEntre(obra.fechaInicio, obra.fechaFin),
    antes: !!w.antes,
    imageBefore: w.imageBefore || null,
    imageAfter: w.imageAfter || null,
    gallery: Array.isArray(w.gallery) ? w.gallery.map(g => ({ url: g.url, caption: g.caption || '' })) : [],
    portada: w.portada || null,
    coords: w.coords && typeof w.coords.lat === 'number' ? { lat: w.coords.lat, lng: w.coords.lng } : null,
    texto: Array.isArray(w.texto) ? w.texto.filter(t => typeof t === 'string') : (typeof w.texto === 'string' ? [w.texto] : []),
    destacada: !!w.destacada,
    orden: Number.isFinite(w.orden) ? w.orden : 999,
    fechaFin: obra.fechaFin || null,
  };
}

export function obrasPublicadas(blob) {
  const obras = Array.isArray(blob?.obras) ? blob.obras : [];
  return obras
    .filter(o => o.web && o.web.publicar === true)
    .map(obraPublic)
    .sort((a, b) => (a.orden - b.orden) || a.titulo.localeCompare(b.titulo));
}

export function validateLead(body) {
  const errors = [];
  const nombre = (body?.nombre || '').toString().trim();
  const contacto = (body?.telefono || body?.email || '').toString().trim();
  if (body?._gotcha) errors.push('honeypot');
  if (nombre.length < 2) errors.push('nombre');
  if (!contacto) errors.push('contacto');
  return { ok: errors.length === 0, errors, nombre };
}

export function leadFromBody(body, nowISO) {
  const today = nowISO.split('T')[0];
  const partes = [body.tipoProyecto, body.m2 && `${body.m2} m²`, body.plazo, body.marca, body.mensaje].filter(Boolean);
  return {
    id: `obra-${Date.parse(nowISO)}-${Math.random().toString(36).slice(2, 7)}`,
    nombre: (body.nombre || '').toString().trim(),
    cliente: (body.empresa || body.nombre || '').toString().trim(),
    clienteId: null,
    direccion: (body.ubicacion || '').toString().trim(),
    tipo: (body.tipoProyecto || 'Otro').toString(),
    moneda: 'ARS',
    presupuesto: 0, gastado: 0, avance: 0, margen: 0,
    estado: 'en-presupuesto',
    fechaInicio: '', fechaFinEstim: '', fechaFin: '',
    notas: partes.join(' · '),
    esLead: true,
    contacto: { telefono: (body.telefono || '').toString().trim(), email: (body.email || '').toString().trim() },
    venta: { etapa: 'prospecto', origen: 'web', fechaCambioEtapa: today, changelog: [{ etapa: 'prospecto', fecha: today, usuario: 'sistema' }] },
    createdAt: nowISO,
  };
}
