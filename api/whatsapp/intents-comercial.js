// Acciones comerciales del bot: crear prospecto y mover etapa de una obra.
// Escrituras atómicas (RPC) para no pisar a la app (LWW). Solo Admin.
//
// El RPC real de patch por id dentro de un campo ARRAY de un blob OBJETO es
// `patch_shared_object_item(p_key, p_collection, p_id, p_patch)` — migración
// 0002_catalog_atomic_patch.sql. (El plan mencionaba `patch_item_in_shared_object`,
// que NO existe; el correcto es éste, el mismo que usan api/portal/firmar.js y
// sbPatchObjectItem de webhook.js.) Si el RPC falla, fallback read-modify-write.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' });

async function loadSharedData(key) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/shared_data?key=eq.${key}&select=data`, { headers: sbH() });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0]?.data ?? null;
}
async function rpc(fn, args) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: sbH(), body: JSON.stringify(args) });
    return r.ok;
  } catch (e) { console.error(`[intents-comercial] rpc ${fn} falló`, e.message); return false; }
}
async function saveSharedData(key, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/shared_data?on_conflict=key`, {
    method: 'POST', headers: { ...sbH(), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ key, data }),
  });
}
const newId = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Agrega un ítem (al final) a obras.obras de forma atómica (append_shared_object_item,
// migración 0002). Fallback: read-modify-write del blob 'obras'.
async function appendObraItem(obrasData, nueva) {
  const ok = await rpc('append_shared_object_item', { p_key: 'obras', p_collection: 'obras', p_item: nueva });
  if (ok) return;
  console.error('[intents-comercial] append_shared_object_item fallback RMW');
  await saveSharedData('obras', { obras: [...(obrasData.obras || []), nueva], detalles: obrasData.detalles || {} });
}

// Mergea `cambios` en el ítem (por id) de obras.obras de forma atómica
// (patch_shared_object_item, migración 0002). Fallback: read-modify-write.
async function patchObraItem(obrasData, obraId, cambios) {
  const ok = await rpc('patch_shared_object_item', { p_key: 'obras', p_collection: 'obras', p_id: obraId, p_patch: cambios });
  if (ok) return;
  console.error('[intents-comercial] patch_shared_object_item fallback RMW');
  const arr = Array.isArray(obrasData.obras) ? obrasData.obras : [];
  await saveSharedData('obras', { obras: arr.map(o => o.id === obraId ? { ...o, ...cambios } : o), detalles: obrasData.detalles || {} });
}

// Crea una obra nueva en estado 'en-presupuesto' con la oportunidad en 'prospecto'.
// Matchea el cliente por nombre (si existe) para linkear clienteId.
export async function crearProspecto({ nombreObra, clienteNombre, usuario }) {
  const obrasData = (await loadSharedData('obras')) || { obras: [], detalles: {} };
  const clientes = (await loadSharedData('clientes')) || [];
  const cliente = clientes.find(c => (c.nombre || '').toLowerCase() === (clienteNombre || '').toLowerCase());
  // Evitar duplicados: si ya existe una obra con ese nombre, no crear otra.
  const dupe = (obrasData.obras || []).find(o => (o.nombre || '').toLowerCase().trim() === (nombreObra || '').toLowerCase().trim());
  if (dupe) return { duplicada: true, existente: { nombre: dupe.nombre, etapa: dupe.venta?.etapa || null } };
  const today = new Date().toISOString().slice(0, 10);
  const nueva = {
    id: newId('obra'), nombre: nombreObra, cliente: cliente?.nombre || clienteNombre || '', clienteId: cliente?.id || null,
    estado: 'en-presupuesto', moneda: 'USD', presupuesto: 0, gastado: 0, avance: 0, margen: 0, direccion: '', tipo: 'Otro',
    venta: { etapa: 'prospecto', responsable: usuario || null, origen: 'whatsapp', fechaCambioEtapa: today, motivoPerdida: null, changelog: [{ etapa: 'prospecto', fecha: today, usuario: usuario || 'bot' }] },
    createdAt: new Date().toISOString(), created_by: usuario || 'bot',
  };
  await appendObraItem(obrasData, nueva);
  return nueva;
}

// Mueve una obra (matcheada por nombre) a otra etapa del embudo. Si pasa a
// 'ganado' la convierte a activa/finalizada; si 'perdido', la archiva. Registra
// la actividad en el timeline (crm_actividades).
export async function moverEtapaObra({ obraNombre, etapaNueva, usuario }) {
  const obrasData = (await loadSharedData('obras')) || { obras: [], detalles: {} };
  const q = (obraNombre || '').toLowerCase().trim();
  const matches = (obrasData.obras || []).filter(o => (o.nombre || '').toLowerCase().includes(q));
  // Preferir match EXACTO (desambigua 'Shell Ruta 3' de 'Shell Ruta 3 Anexo'); si
  // hay varias coincidencias parciales y ninguna exacta, pedir desambiguación en
  // vez de mover la obra equivocada (mover a ganado/perdido es destructivo).
  const obra = matches.find(o => (o.nombre || '').toLowerCase().trim() === q) || (matches.length === 1 ? matches[0] : null);
  if (!obra) return matches.length > 1 ? { error: 'obra_ambigua', candidatos: matches.map(o => o.nombre) } : { error: 'obra_no_encontrada' };
  const today = new Date().toISOString().slice(0, 10);
  const venta = { ...(obra.venta || {}), etapa: etapaNueva, fechaCambioEtapa: today, changelog: [...((obra.venta || {}).changelog || []), { etapa: etapaNueva, fecha: today, usuario: usuario || 'bot' }] };
  const cambios = { venta };
  if (etapaNueva === 'ganado') cambios.estado = obra.estado === 'finalizada' ? 'finalizada' : 'activa';
  if (etapaNueva === 'perdido') cambios.estado = 'archivada';
  await patchObraItem(obrasData, obra.id, cambios);

  // Actividad en el timeline (read-modify-write: poco concurrente, igual que firmar.js).
  const acts = (await loadSharedData('crm_actividades')) || [];
  const now = new Date().toISOString();
  acts.unshift({ id: newId('act'), clienteId: obra.clienteId || null, obraId: obra.id, tipo: 'cambio_etapa', texto: `Movida a ${etapaNueva} — ${obra.nombre} (bot)`, fecha: now, usuario: usuario || 'bot', adjuntos: [], creadoAt: now, actualizadoAt: now });
  await saveSharedData('crm_actividades', acts);
  return { obra: obra.nombre, etapa: etapaNueva };
}
