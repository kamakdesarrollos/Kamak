// Meta WhatsApp Cloud API — sin dependencias externas

const META_TOKEN      = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const VERIFY_TOKEN    = process.env.META_VERIFY_TOKEN;
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;

// ── Helpers Supabase ──────────────────────────────────────────────────────────
const sbH = () => ({
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

async function sbGet(table, params = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, { headers: sbH() });
  return res.json();
}

async function sbUpsert(table, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...sbH(), 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(data),
  });
}

async function sbDelete(table, params) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, { method: 'DELETE', headers: sbH() });
}

async function loadSharedData(key) {
  const rows = await sbGet('shared_data', `?key=eq.${key}&select=data`);
  return rows[0]?.data ?? null;
}

// ── Helpers Meta API ──────────────────────────────────────────────────────────
async function sendWA(to, body) {
  try {
    const r = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('sendWA error:', r.status, t);
    }
  } catch (e) {
    console.error('sendWA exception:', e.message);
  }
}

async function downloadMedia(mediaId) {
  try {
    const r1 = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { 'Authorization': `Bearer ${META_TOKEN}` },
    });
    const info = await r1.json();
    if (!info.url) return null;
    const r2 = await fetch(info.url, { headers: { 'Authorization': `Bearer ${META_TOKEN}` } });
    const buf = await r2.arrayBuffer();
    return Buffer.from(buf).toString('base64');
  } catch (e) {
    console.error('downloadMedia error:', e.message);
    return null;
  }
}

async function broadcastChange(key) {
  try {
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ topic: 'kamak-data-sync', event: 'changed', payload: { key } }],
      }),
    });
  } catch (e) {
    console.error('broadcastChange error:', e.message);
  }
}

async function uploadToStorage(base64Data, mimeType, filepath) {
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/kamak-fotos/${filepath}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': mimeType,
        'x-upsert': 'true',
      },
      body: buffer,
    });
    if (!r.ok) {
      console.error('uploadToStorage error:', r.status, await r.text());
      return null;
    }
    return `${SUPABASE_URL}/storage/v1/object/public/kamak-fotos/${filepath}`;
  } catch (e) {
    console.error('uploadToStorage exception:', e.message);
    return null;
  }
}

// ── Datos del sistema ─────────────────────────────────────────────────────────
async function getSystemContext() {
  const [movData, provData, obrasData] = await Promise.all([
    loadSharedData('movimientos'),
    loadSharedData('proveedores'),
    loadSharedData('obras'),
  ]);
  return {
    cajas:       movData?.cajas       || [],
    movimientos: movData?.movimientos || [],
    proveedores: provData?.proveedores || [],
    obras:       obrasData?.obras?.filter(o => o.estado === 'activa' || o.estado === 'en-presupuesto') || [],
    detalles:    obrasData?.detalles  || {},
  };
}

async function getAllAdmins() {
  const users  = await sbGet('app_users', '?select=*');
  const linked = await sbGet('whatsapp_users', '?select=*');
  return linked.filter(lu => {
    const u = users.find(u => u.id === lu.user_id);
    return u?.rol === 'Admin';
  });
}

// ── Conversación ──────────────────────────────────────────────────────────────
async function loadConversation(phone) {
  const rows = await sbGet('whatsapp_conversations', `?phone=eq.${phone}`);
  return rows[0] || { phone, state: 'idle', data: {}, history: [] };
}

async function saveConversation(phone, state, data, history) {
  await sbUpsert('whatsapp_conversations', {
    phone, state, data,
    history: history.slice(-8),
    updated_at: new Date().toISOString(),
  });
}

async function clearConversation(phone) {
  await saveConversation(phone, 'idle', {}, []);
}

// ── Usuario vinculado ─────────────────────────────────────────────────────────
async function getLinkedUser(phone) {
  const rows = await sbGet('whatsapp_users', `?phone=eq.${phone}`);
  if (!rows[0]) return null;
  const linked = rows[0];
  const appUsers = await sbGet('app_users', `?id=eq.${linked.user_id}&select=*`);
  const appUser = appUsers[0];
  if (!appUser) return null;
  return { ...linked, email: appUser.email, user_rol: appUser.rol || linked.user_rol, permisos: appUser.permisos, cajasVisibles: appUser.cajas_visibles || [] };
}

// ── Flujo de vinculación ──────────────────────────────────────────────────────
async function handleLinkingFlow(phone, text, conv) {
  if (conv.state === 'idle' || conv.state === 'linking_awaiting_user') {
    if (conv.state === 'idle') {
      await saveConversation(phone, 'linking_awaiting_user', {}, []);
      await sendWA(phone,
        '👋 Hola! Soy el asistente de *Kamak Desarrollos*.\n\n' +
        'Para vincular tu número con tu cuenta, escribí tu *nombre completo* o tu *email* registrado en el sistema.'
      );
      return;
    }

    const query = text.trim().toLowerCase();
    const appUsers = await sbGet('app_users', '?select=*');
    const match = appUsers.find(u =>
      u.email?.toLowerCase() === query ||
      u.nombre?.toLowerCase().includes(query) ||
      query.includes(u.nombre?.toLowerCase())
    );

    if (!match) {
      await sendWA(phone,
        '❌ No encontré ningún usuario con ese nombre o email.\n\nIntentá nuevamente con tu email exacto o nombre completo.'
      );
      return;
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await sbUpsert('whatsapp_verifications', {
      code,
      phone,
      user_email: match.email,
      expires_at: expiresAt,
    });

    await saveConversation(phone, 'linking_awaiting_confirmation', { user_email: match.email, user_name: match.nombre }, []);

    await sendWA(phone,
      `✅ Encontré tu cuenta: *${match.nombre}*\n\n` +
      `Tu código de verificación es: *${code}*\n\n` +
      `Ingresá a la app Kamak y confirmá la vinculación desde el aviso que aparece en pantalla. Tenés 15 minutos.`
    );
    return;
  }

  if (conv.state === 'linking_awaiting_confirmation') {
    const linked = await sbGet('whatsapp_users', `?phone=eq.${phone}`);
    if (linked[0]) {
      await clearConversation(phone);
      await sendWA(phone,
        `🎉 ¡Tu cuenta ya está vinculada! Bienvenido/a *${linked[0].user_name}*.\n\nEscribí *ayuda* para ver qué podés hacer desde acá.`
      );
    } else {
      await sendWA(phone,
        '⏳ Todavía no confirmaste en la app.\n\nAbrí Kamak y confirmá el aviso que aparece en pantalla.'
      );
    }
  }
}

// ── Detección de corrección de avance ────────────────────────────────────────
function extractCorreccion(text, obras, detalles) {
  if (!text) return null;
  const t = norm(text);

  const corrRE = /correg|corrijo|me equivoqu|error|en realidad|eran|era\b|no eran|no son|no era\b|cambiar avance|editar avance|modific/i;
  if (!corrRE.test(t)) return null;

  // Reutilizamos la extracción de avance para sacar obra, tarea y nueva cantidad
  const base = extractAvanceCompleto(text, obras, detalles);
  // Para corrección no requerimos la señal de avance, así que si no matcheó por eso
  // intentamos buscar obra + tarea + número directamente
  if (base?.obraId && base?.tareaId && base?.cantidadAvance != null) {
    return { ...base, esCorreccion: true };
  }

  // Intento directo: número + obra + tarea (sin palabras de avance)
  const cantRE = /(\d+(?:[.,]\d+)?)\s*(mts?2?|m2|m²|m3|m³|ml|u\b|kg|hs|unid(?:ades?)?)?/i;
  const cantMatch = text.match(cantRE);
  if (!cantMatch) return null;

  let obraEncontrada = null;
  for (const o of obras) {
    const oNorm = norm(o.nombre);
    if (t.includes(oNorm)) { obraEncontrada = o; break; }
    const pals = oNorm.split(/\s+/).filter(p => p.length > 3);
    if (pals.some(p => t.includes(p))) { obraEncontrada = o; break; }
  }

  let tareaEncontrada = null, rubroEncontrado = null;
  const buscar = obraEncontrada ? [obraEncontrada, ...obras.filter(o => o.id !== obraEncontrada.id)] : obras;
  outer2:
  for (const o of buscar) {
    for (const r of (detalles[o.id]?.rubros || []).filter(r => r.tipo !== 'seccion')) {
      for (const ta of (r.tareas || []).filter(ta => ta.tipo !== 'seccion')) {
        const taNorm = norm(ta.nombre);
        const pals = taNorm.split(/\s+/).filter(p => p.length > 2);
        if (t.includes(taNorm) || pals.some(p => t.includes(p))) {
          tareaEncontrada = ta; rubroEncontrado = r;
          if (!obraEncontrada) obraEncontrada = o;
          break outer2;
        }
      }
    }
  }

  if (!obraEncontrada || !tareaEncontrada || !cantMatch) return null;

  return {
    completo:       true,
    esCorreccion:   true,
    obraId:         obraEncontrada.id,
    rubroId:        rubroEncontrado?.id || null,
    tareaId:        tareaEncontrada.id,
    cantidadAvance: parseFloat(cantMatch[1].replace(',', '.')),
    unidad:         cantMatch[2] ? norm(cantMatch[2]) : (tareaEncontrada.unidad || 'u'),
    descripcion:    text.slice(0, 120),
    _obra:          obraEncontrada,
    _tarea:         tareaEncontrada,
  };
}

// ── Extracción directa de avance — bypasa Claude cuando todo está en el texto ──
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function extractAvanceCompleto(text, obras, detalles) {
  if (!text) return null;
  const t = norm(text);

  // Señal explícita de avance (requerida para el bypass)
  const avanceRE = /avance\s*de\s*obra|avance|coloc[aó]|instal[aó]|termin[eéóa]|terminamos|colocamos|hicimos|pusimos|avanzamos|finaliz|pegamos|revoc|enyesamos/i;
  if (!avanceRE.test(t)) return null;

  // Extraer cantidad + unidad
  // Caso 1: número + unidad estándar ("440 mts2", "75 m²")
  const cantRE = /(\d+(?:[.,]\d+)?)\s*(mts?2?|m2|m²|m3|m³|ml|u\b|kg|hs|unid(?:ades?)?)/i;
  let cantMatch = text.match(cantRE);
  let rawQty = cantMatch ? parseFloat(cantMatch[1].replace(',', '.')) : null;
  let rawUnit = cantMatch ? norm(cantMatch[2]) : null;
  let extraQtyWord = null;

  // Caso 2: número + palabra ("50 tomas", "12 bocas") — la palabra puede ser el nombre de la tarea
  if (!cantMatch) {
    const numWordMatch = t.match(/\b(\d+)\s+([a-záéíóúñ]{3,})/);
    if (numWordMatch) {
      rawQty  = parseFloat(numWordMatch[1]);
      rawUnit = 'u';
      extraQtyWord = numWordMatch[2];
    }
  } else {
    // También guardar la palabra que sigue para ayudar a matchear la tarea ("50 mts2 de ceramicos")
    const after = t.substring(t.indexOf(cantMatch[0]) + cantMatch[0].length);
    const m = after.match(/\s+de\s+([a-záéíóúñ]{3,})/);
    if (m) extraQtyWord = m[1];
  }

  // Matchear obra por nombre (full match primero, luego por palabra significativa)
  let obraEncontrada = null;
  for (const o of obras) {
    const oNorm = norm(o.nombre);
    if (t.includes(oNorm)) { obraEncontrada = o; break; }
    const palabras = oNorm.split(/\s+/).filter(p => p.length > 3);
    if (palabras.length > 0 && palabras.some(p => t.includes(p))) { obraEncontrada = o; break; }
  }

  // Matchear tarea (busca en obra encontrada primero, luego en el resto)
  let tareaEncontrada = null, rubroEncontrado = null;
  const obrasBuscar = obraEncontrada
    ? [obraEncontrada, ...obras.filter(o => o.id !== obraEncontrada.id)]
    : obras;

  outer:
  for (const o of obrasBuscar) {
    const rubros = (detalles[o.id]?.rubros || []).filter(r => r.tipo !== 'seccion');
    for (const r of rubros) {
      for (const ta of (r.tareas || []).filter(ta => ta.tipo !== 'seccion')) {
        const taNorm = norm(ta.nombre);
        const taPals = taNorm.split(/\s+/).filter(p => p.length > 2);
        // Coincidencia: nombre completo, cualquier palabra significativa, o extraQtyWord
        const matchNombre = t.includes(taNorm);
        const matchPalabra = taPals.some(p => t.includes(p));
        const matchQtyWord = extraQtyWord && taPals.some(p =>
          p === extraQtyWord || p.startsWith(extraQtyWord) || extraQtyWord.startsWith(p)
        );
        if (matchNombre || matchPalabra || matchQtyWord) {
          tareaEncontrada = ta; rubroEncontrado = r;
          if (!obraEncontrada) obraEncontrada = o;
          break outer;
        }
      }
    }
  }

  if (!obraEncontrada && !tareaEncontrada) return null;

  return {
    completo:      !!(obraEncontrada && tareaEncontrada && rawQty != null),
    obraId:        obraEncontrada?.id || null,
    rubroId:       rubroEncontrado?.id || null,
    tareaId:       tareaEncontrada?.id || null,
    cantidadAvance: rawQty,
    unidad:        rawUnit || tareaEncontrada?.unidad || 'u',
    descripcion:   text.slice(0, 120),
    _obra:         obraEncontrada,
    _tarea:        tareaEncontrada,
  };
}

// ── Claude: interpretar mensaje ───────────────────────────────────────────────
async function callClaude(user, messageText, base64Media, mimeType, conv, ctx, mediaUrl = null) {
  const cajasUsuario = ctx.cajas.filter(c => user.cajasVisibles.length === 0 || user.cajasVisibles.includes(c.id));
  const cajasEfectivo = ctx.cajas.filter(c => c.tipo === 'efectivo' && c.usuarioId === user.email);
  const cajaEfectivoARS = cajasEfectivo.find(c => c.moneda === 'ARS');
  const cajaEfectivoUSD = cajasEfectivo.find(c => c.moneda === 'USD');

  // Última obra usada por este usuario (de movimientos aprobados)
  const userMovs = ctx.movimientos
    .filter(m => m.obraId && (m.creadoPor === user.user_name || m.creadoPorWA))
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  const ultimaObraId = userMovs[0]?.obraId || null;
  const ultimaObra = ultimaObraId ? ctx.obras.find(o => o.id === ultimaObraId) : null;

  // Rubros de la obra en contexto (conversación activa o última usada)
  const obraContextId = conv.data?.obraId || ultimaObraId;
  const obraContext = obraContextId ? ctx.obras.find(o => o.id === obraContextId) : null;
  const obraRubros = obraContextId
    ? (ctx.detalles[obraContextId]?.rubros || []).filter(r => r.tipo !== 'seccion')
    : [];

  // Pre-extracción parcial como hint (para cuando el bypass no activó)
  const preExtObj = extractAvanceCompleto(messageText, ctx.obras, ctx.detalles);
  const preExtracted = preExtObj ? [
    preExtObj.cantidadAvance != null ? `cantidadAvance=${preExtObj.cantidadAvance} unidad=${preExtObj.unidad}` : null,
    preExtObj._obra ? `obra="${preExtObj._obra.nombre}" obraId=${preExtObj.obraId}` : null,
    preExtObj._tarea ? `tarea="${preExtObj._tarea.nombre}" tareaId=${preExtObj.tareaId} rubroId=${preExtObj.rubroId}` : null,
  ].filter(Boolean).join(' · ') : null;

  // Rubros de TODAS las obras activas para que Claude siempre pueda matchear
  const allRubrosStr = ctx.obras.slice(0, 6).map(o => {
    const rubros = (ctx.detalles[o.id]?.rubros || []).filter(r => r.tipo !== 'seccion').slice(0, 6);
    if (rubros.length === 0) return null;
    const isCtx = o.id === obraContextId;
    const rubStr = rubros.map(r => {
      const ts = (r.tareas || []).filter(t => t.tipo !== 'seccion').slice(0, 12);
      const tsStr = ts.length > 0
        ? '\n' + ts.map(t => `      TAREA:${t.id}|${t.nombre}|total:${t.cantidad}${t.unidad}|av:${t.avance||0}%${isCtx ? `|costoSubUnit:${Math.round(t.costoSub||0)}` : ''}`).join('\n')
        : '';
      return `    RUBRO:${r.id}|${r.nombre}|prov:${r.proveedor||'—'}${tsStr}`;
    }).join('\n');
    return `  OBRA:${o.id}|${o.nombre}${isCtx ? ' ← CONTEXTO ACTUAL' : ''}\n${rubStr}`;
  }).filter(Boolean).join('\n') || 'sin rubros cargados';

  const systemPrompt = `Sos el asistente de WhatsApp de Kamak Desarrollos, una constructora argentina.
Ayudás al equipo interno a registrar información en el sistema de gestión.

USUARIO ACTUAL:
- Nombre: ${user.user_name}
- Rol: ${user.user_rol}
- Caja efectivo ARS propia: ${cajaEfectivoARS ? `${cajaEfectivoARS.id}|${cajaEfectivoARS.nombre}` : 'ninguna'}
- Caja efectivo USD propia: ${cajaEfectivoUSD ? `${cajaEfectivoUSD.id}|${cajaEfectivoUSD.nombre}` : 'ninguna'}
- Otras cajas accesibles: ${cajasUsuario.filter(c => c.tipo !== 'efectivo' || c.usuarioId !== user.email).map(c => `${c.id}|${c.nombre}(${c.tipo},${c.moneda})`).join(', ') || 'ninguna'}

OBRAS ACTIVAS:
${ctx.obras.map(o => `- ${o.id}|${o.nombre}`).join('\n') || 'No hay obras activas'}

ÚLTIMA OBRA DEL USUARIO:
${ultimaObra ? `${ultimaObra.id}|${ultimaObra.nombre}` : 'sin historial'}

OBRAS ACTIVAS CON RUBROS Y TAREAS (buscá aquí obra y tarea cuando el usuario las mencione):
${allRubrosStr}
→ Para AVANCE_OBRA: usá los IDs exactos RUBRO:id y TAREA:id de esta lista. Matcheá obra y tarea por nombre aunque el usuario escriba con errores o abreviado.

PROVEEDORES:
${ctx.proveedores.slice(0, 30).map(p => `- ${p.id}|${p.nombre}(${p.tipo})`).join('\n')}

MATCHING DE CAJAS Y OBRAS — MUY IMPORTANTE:
- Ignorá mayúsculas/minúsculas siempre. "baradero" = "Baradero", "franco" = "Franco".
- Usá matching parcial: si el usuario dice "caja franco" buscá la caja cuyo nombre contenga "franco".
- Si el usuario dice "obra baradero" buscá la obra cuyo nombre contenga "baradero".
- Si hay una sola coincidencia parcial, usala directamente sin preguntar.
- Solo preguntá si hay ambigüedad (2+ coincidencias) o ninguna.

CAJA EFECTIVO AUTOMÁTICA — MUY IMPORTANTE:
- Si el usuario dice "en efectivo", "de mi caja", "caja propia", "pagué en mano" o no especifica caja: usá automáticamente SU caja efectivo.
- Si el monto es en pesos ($, ARS, pesos): usá su "Caja efectivo ARS propia".
- Si el monto es en dólares (USD, u$s, dólares): usá su "Caja efectivo USD propia".
- Si el usuario especifica otra caja por nombre: buscala por matching parcial entre "Otras cajas accesibles".
- NUNCA preguntés qué caja si el pago es en efectivo y el usuario tiene su caja efectivo configurada.

OBRA — INFERENCIA Y CONFIRMACIÓN:
- Si el usuario no menciona obra pero hay "Última obra del usuario": proponé esa obra y pedí confirmación.
  Ejemplo: "¿Es para [nombre obra]?" — si confirma, usá ese obraId.
- Si el usuario confirma la obra sugerida (sí/dale/esa/correcto): usá esa obra.
- NUNCA uses una obra sin que el usuario la haya mencionado o confirmado.
- Si el usuario menciona una obra: buscala por matching parcial en la lista de obras activas.

RUBRO — SUGERENCIA INTELIGENTE:
- Cuando el usuario describe un MATERIAL o SERVICIO (ej: "tornillos", "pintura", "arena", "caños"), analizá qué rubros de la obra son compatibles con ese material.
- Descartá los rubros donde ese material claramente NO se usaría (ej: tornillos no van en Pintura, arena no va en Electricidad).
- Si quedan 2 o más rubros posibles, preguntá: "¿Para qué rubro?\n1) Albañilería\n2) Construcción en seco\n..." (solo los relevantes, máx 4 opciones)
- Si solo queda 1 rubro posible, usalo directamente sin preguntar.
- Si no hay obra seleccionada todavía, primero confirmá la obra, luego preguntás el rubro.
- El rubro se guarda en el campo "descripcion" del gasto junto al material: "Tornillos - Albañilería".

FOTO EN ESTA CONVERSACIÓN:
- Foto en este mensaje: ${base64Media ? 'SÍ (recién recibida)' : 'NO'}
- Foto guardada de mensaje anterior: ${conv.data?.pendingMediaUrl ? 'SÍ (ya subida, disponible para usar)' : 'NO'}
→ Si hay foto guardada de antes, considerala como si fuera parte de este intercambio. NO pidas otra foto.

ROL DEL USUARIO — SESGO POR DEFECTO (no es una regla fija, cualquier rol puede hacer cualquier cosa):
- "Jefe de obra" / "Capataz": en caso de ambigüedad, asumí avance_obra. Si la foto no parece factura y no dice "compré" o "gasté" → avance. Si el usuario dice explícitamente "gasto", "pagué", "compré" → registrá como gasto.
- "Compras" / "Administración": en caso de ambigüedad, asumí gasto/factura. Si el usuario dice explícitamente "avance", "terminamos", "colocamos" → registrá como avance_obra.
- "Admin": sin sesgo. Seguí el flujo normal de preguntas.

TEXTO TIENE PRIORIDAD SOBRE LA IMAGEN:
- Si el texto del mensaje dice "avance de obra", "Avance de obra", "avancé", "foto del avance" → es SIEMPRE avance_obra. No importa lo que veas en la foto, el texto manda.
- Si el texto menciona una tarea ("revoque grueso", "cerámicos", "pintura"), usá ese texto para matchear con la lista de tareas. No analices la imagen para determinar la tarea.
- La foto es solo evidencia visual adjunta al registro, no es la fuente principal de interpretación.

EXTRACCIÓN DE CONTEXTO DEL HISTORIAL — MUY IMPORTANTE:
- Antes de hacer cualquier pregunta, revisá el HISTORIAL completo de la conversación.
- Si en algún mensaje anterior ya se mencionó la tarea, cantidad, obra o cualquier dato → usá ese dato directamente. NO lo vuelvas a pedir.
- Ejemplo: si el historial tiene "285 mts2 de revoque grueso en Baradero" → ya tenés cantidadAvance=285, unidad=m², tarea≈Revoque grueso, obra=Baradero. No preguntes nada de eso.
- Cuando el usuario confirma ("sí", "es avance", "para Baradero") → es una confirmación, no una nueva instrucción. Integrá esa confirmación con lo que ya tenés del historial y armá el registro completo.

AVANCE DE OBRA — PARSEO INTELIGENTE:
- REGLA CLAVE: si el mensaje (o el historial) tiene cantidad en unidades de obra (m², ml, m3, u, kg, hs) + nombre de trabajo + nombre de obra, y NO menciona precio → es avance_obra. Procesalo directo sin preguntar.
  Ejemplo: "285 mts2 de revoque grueso en obra Baradero" → avance_obra, obra=Baradero, tarea≈Revoque, cantidadAvance=285, unidad=m²
- Palabras que indican avance: "avance de obra", "avancé", "colocados", "instalados", "terminados", "terminé", "colocamos", "hicimos", "pusimos", "avanzamos", "quedó listo", "finalizado", "pegamos", "grueso", "revocamos".
- Matcheá obra y tarea por similitud: "revoque grueso" → tarea "Revoque", "ceramicos" → "Cerámicos". No importan mayúsculas ni tildes.
- Extraé cantidadAvance del número + unidad: "285 mts2" → 285 m², "20 metros lineales" → 20 ml.
- Mandá siempre los IDs exactos rubroId y tareaId. Calculá % automáticamente: cantidadAvance / total de la tarea.

ORDEN DE PREGUNTAS (nunca más de una a la vez):
0. SIEMPRE revisá el historial ANTES de hacer preguntas. Si la información ya fue dada, usala. No repitas preguntas.
1. Si llega FOTO:
   - Si el texto dice "avance de obra", "Avance de obra", o tiene cantidad+tarea → avance_obra DIRECTO, armá el registro con toda la info disponible (texto + historial).
   - Si parece factura (números, CUIT, totales, IVA) → factura_compra.
   - Si el texto dice "gasto"/"pagué"/"compré" → gasto con comprobante.
   - Si el texto tiene cantidad en unidades (m², ml, u, etc.) + trabajo + sin precio → avance_obra directo.
   - Si el texto dice "avancé"/"colocamos"/"terminamos"/"instalados"/"terminé" → avance_obra.
   - Si NO hay texto claro y rol es "Jefe de obra"/"Capataz" → asumí avance_obra, preguntá SOLO lo que no se sabe.
   - Si NO hay texto claro y rol es "Compras"/"Administración" → preguntá "¿Factura o gasto?"
   - Si NO hay texto claro y rol es "Admin" → preguntá "¿Avance, gasto o factura?"
2. Si llega FOTO + texto de gasto: procesá como gasto con comprobante=blanco automáticamente.
3. Si llega FOTO + texto de avance ("avancé", "foto de avance", "progreso", "terminé", "colocamos", "terminado", "avance de obra"): procesá como avance_obra directamente.
4. Si falta monto → preguntá el monto
5. Si falta obra → proponé la última o pedí que la indique
6. Si falta rubro → mostrá opciones relevantes al material
7. Si falta comprobante (y NO hay foto en esta conversación) → preguntá "¿Tiene factura? (sí/no)"
8. Con todo completo → mostrá resumen y pedí confirmación

ACCIONES DISPONIBLES:
1. GASTO: monto, descripción, obraId(opcional), cajaId, proveedorNombre(opcional), tipo(material/mano_de_obra/general), comprobante(blanco/negro), rubroId(opcional)
2. INGRESO: monto, descripción, obraId, cajaId
3. FACTURA_COMPRA: foto/PDF de factura de proveedor. Extraé: tipoFactura('A'/'B'/'C'), numeroFactura, proveedor, cuit, fecha(YYYY-MM-DD), monto(neto sin IVA), montoTotal(con IVA), concepto
4. AVANCE_OBRA: obraId(ID exacto de la lista), rubroId(ID del rubro), tareaId(ID de la tarea), cantidadAvance(unidades completadas, ej:75), unidad(ej:'m²'), porcentajeAvance(% a sumar si no hay cantidad), descripcion
5. CHEQUE_RECIBIDO: obraId, cajaDestinoId
6. COMANDOS: ayuda | saldo | pendientes | cheques | resumen [obraId] [fecha YYYY-MM-DD]

REGLAS DE FLUJO:
- El usuario escribe corto y conciso. Interpretá la intención aunque falten datos.
- Si la caja se resuelve por efectivo automático, NO la preguntes.
- Si hay foto en esta conversación y es un gasto: comprobante = blanco automáticamente, no preguntes.
- Para AVANCE_OBRA: el obraId en datos DEBE ser el ID exacto de la lista de obras activas (ej: "obra-baradero"), no el nombre.
- Si el usuario confirma (sí/si/dale/ok/confirmo/correcto/s): estado = "ejecutar"
- Si el usuario cancela (no/cancelar/error/mal/n): estado = "cancelar"
- Para comprobante sin foto: "factura"/"con factura"/"blanco" = blanco; "sin factura"/"negro" = negro
- Respondé en español argentino, breve y directo.

HISTORIAL DE CONVERSACIÓN:
${conv.history.map(h => `${h.rol}: ${h.texto}`).join('\n') || 'Sin historial'}

${preExtracted ? `EXTRACCIÓN AUTOMÁTICA DEL MENSAJE ACTUAL (datos ya identificados — USÁ ESTOS DIRECTAMENTE, no preguntes por ellos):
→ ${preExtracted}
Si tenés obra+tarea+cantidad → ejecutá avance_obra directo con estado:"ejecutar".` : ''}

Respondé ÚNICAMENTE con JSON válido:
{
  "mensaje": "texto a enviar al usuario (máx 400 chars)",
  "estado": "conversando" | "confirmando" | "ejecutar" | "cancelar" | "comando",
  "accion": {
    "tipo": "gasto" | "ingreso" | "factura_compra" | "avance_obra" | "cheque_recibido" | "comando" | null,
    "datos": {}
  }
}`;

  // Text FIRST so Claude reads it with priority before analyzing the image
  const userContent = [];
  userContent.push({ type: 'text', text: messageText || '(imagen adjunta)' });
  if (base64Media && mimeType) {
    if (mimeType === 'application/pdf') {
      userContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Media } });
    } else if (mimeType.startsWith('image/')) {
      userContent.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Media } });
    }
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2048, system: systemPrompt, messages: [{ role: 'user', content: userContent }] }),
  });
  const data = await res.json();

  try {
    const text = data.content[0].text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(text);
  } catch {
    return { mensaje: 'Perdón, no entendí bien. ¿Podés repetirlo?', estado: 'conversando', accion: { tipo: null, datos: {} } };
  }
}

// ── Ejecutar acción ───────────────────────────────────────────────────────────
async function ejecutarAccion(tipo, datos, user, ctx, mediaUrl = null) {
  if (tipo === 'gasto' || tipo === 'ingreso') {
    const obra  = ctx.obras.find(o => o.id === datos.obraId);
    const caja  = ctx.cajas.find(c => c.id === datos.cajaId);
    const monto = Math.round(parseFloat(datos.monto) || 0);

    const nuevoMov = {
      id:               `mov-${Date.now()}`,
      tipo:             tipo,
      descripcion:      datos.descripcion || '',
      monto,
      fecha:            datos.fecha || new Date().toISOString().split('T')[0],
      obraId:           datos.obraId || null,
      obraNombre:       obra?.nombre || 'General',
      cajaId:           datos.cajaId,
      cajaDestinoId:    null,
      proveedor:        datos.proveedorNombre || '',
      categoria:        datos.tipo === 'mano_de_obra' ? 'mano-de-obra' : datos.tipo === 'material' ? 'material' : 'general',
      medioPago:        'Transferencia',
      comprobante:      datos.comprobante || 'negro',
      comprobanteUrl:   mediaUrl || null,
      creadoPorWA:      true,
      creadoPor:        user.user_name,
      estadoAprobacion: 'pendiente',
    };

    const pendingRows = await sbGet('shared_data', '?key=eq.whatsapp_pending&select=data');
    const existing = Array.isArray(pendingRows[0]?.data) ? pendingRows[0].data : [];
    const newPending = [{
      id:            `wp-${Date.now()}`,
      tipoPendiente: 'movimiento',
      movimiento:    nuevoMov,
      from:          user.phone,
      creadoPor:     user.user_name,
      receivedAt:    new Date().toISOString(),
      status:        'pendiente',
    }, ...existing];

    await fetch(`${SUPABASE_URL}/rest/v1/shared_data`, {
      method: 'POST',
      headers: { ...sbH(), 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ key: 'whatsapp_pending', data: newPending, updated_at: new Date().toISOString() }),
    });
    await broadcastChange('whatsapp_pending');

    const admins = await getAllAdmins();
    const montoStr = `$${monto.toLocaleString('es-AR')}`;
    const tipoStr  = tipo === 'gasto' ? 'gasto' : 'ingreso';
    const msgAdmin =
      `📋 *Nueva solicitud de aprobación*\n\n` +
      `*${user.user_name}* registró un ${tipoStr}:\n` +
      `• Monto: *${montoStr}*\n` +
      `• Concepto: ${datos.descripcion || '—'}\n` +
      `• Obra: ${obra?.nombre || 'General'}\n` +
      `• Caja: ${caja?.nombre || '—'}\n` +
      `• Comprobante: ${datos.comprobante === 'blanco' ? '✅ Con factura' : '⚠️ Sin factura'}` +
      `${mediaUrl ? '\n• Foto: adjunta' : ''}\n\n` +
      `Revisalo en la app Kamak → Buzón WhatsApp.`;

    for (const admin of admins) {
      await sendWA(admin.phone, msgAdmin);
    }

    return `✅ Listo. El ${tipoStr} de *${montoStr}* fue enviado a aprobación.\nLos administradores recibirán una notificación.`;
  }

  if (tipo === 'factura_compra') {
    const pendingRows = await sbGet('shared_data', '?key=eq.whatsapp_pending&select=data');
    const existing = Array.isArray(pendingRows[0]?.data) ? pendingRows[0].data : [];
    const newPending = [{
      id:            `wp-${Date.now()}`,
      tipoPendiente: 'factura',
      tipoFactura:   datos.tipoFactura   || '',
      numeroFactura: datos.numeroFactura || '',
      proveedor:     datos.proveedor     || '',
      cuit:          datos.cuit          || '',
      fecha:         datos.fecha         || new Date().toISOString().split('T')[0],
      concepto:      datos.concepto      || '',
      monto:         datos.monto         != null ? Math.round(datos.monto) : null,
      montoTotal:    datos.montoTotal    != null ? Math.round(datos.montoTotal) : null,
      mediaType:     mediaUrl?.endsWith('.pdf') ? 'pdf' : 'image',
      mediaUrl:      mediaUrl || null,
      from:          user.phone,
      creadoPor:     user.user_name,
      receivedAt:    new Date().toISOString(),
      status:        'pendiente',
    }, ...existing];

    await fetch(`${SUPABASE_URL}/rest/v1/shared_data`, {
      method: 'POST',
      headers: { ...sbH(), 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ key: 'whatsapp_pending', data: newPending, updated_at: new Date().toISOString() }),
    });
    await broadcastChange('whatsapp_pending');

    const admins = await getAllAdmins();
    const montoStr = datos.montoTotal != null ? `$${Math.round(datos.montoTotal).toLocaleString('es-AR')}` : '—';
    for (const admin of admins) {
      await sendWA(admin.phone,
        `📄 *Nueva factura recibida*\n\n` +
        `*${user.user_name}* envió una factura${datos.tipoFactura ? ` ${datos.tipoFactura}` : ''}:\n` +
        `• Proveedor: ${datos.proveedor || '—'}\n` +
        `• Monto: ${montoStr}\n` +
        `• N°: ${datos.numeroFactura || '—'}\n\n` +
        `Revisala en la app Kamak → Buzón WhatsApp.`
      );
    }

    return `✅ Factura${datos.tipoFactura ? ` ${datos.tipoFactura}` : ''} de *${datos.proveedor || 'proveedor'}* recibida.\n${datos.montoTotal != null ? `Monto: *${montoStr}*\n` : ''}Los administradores la revisarán para aprobarla.`;
  }

  if (tipo === 'avance_obra') {
    const obraQ = (datos.obraId || '').toLowerCase();
    const obra  = ctx.obras.find(o => o.id === datos.obraId) ||
                  ctx.obras.find(o => o.nombre?.toLowerCase().includes(obraQ));
    if (!obra) return '❌ Obra no encontrada. Indicá el nombre de la obra.';

    const [obrasData, provData] = await Promise.all([
      loadSharedData('obras'),
      loadSharedData('proveedores'),
    ]);
    const detalles = obrasData?.detalles || {};
    const detalle  = detalles[obra.id] || { rubros: [], fotos: [] };

    // Buscar rubro y tarea para actualizar avance
    let rubroIdx = -1, tareaIdx = -1, tarea = null, rubro = null;
    if (datos.tareaId) {
      for (let ri = 0; ri < detalle.rubros.length; ri++) {
        const r = detalle.rubros[ri];
        const ti = (r.tareas || []).findIndex(t => t.id === datos.tareaId);
        if (ti >= 0) { rubroIdx = ri; tareaIdx = ti; tarea = r.tareas[ti]; rubro = r; break; }
      }
    }
    if (!rubro && datos.rubroId) {
      rubroIdx = detalle.rubros.findIndex(r => r.id === datos.rubroId);
      if (rubroIdx >= 0) rubro = detalle.rubros[rubroIdx];
    }

    // Calcular avance y valor a certificar (costoMat + costoSub = valor total del trabajo)
    const esCorreccion = !!datos.esCorreccion;
    let avanceAgregado = 0;
    let valorCertificado = 0;
    const cantAvance = parseFloat(datos.cantidadAvance) || 0;
    if (tarea && cantAvance > 0) {
      const cantTotal   = tarea.cantidad || 1;
      const costoUnit   = (tarea.costoMat || 0) + (tarea.costoSub || 0);
      avanceAgregado    = Math.round((cantAvance / cantTotal) * 100);
      valorCertificado  = Math.round(costoUnit * cantAvance);
    } else if (datos.porcentajeAvance) {
      avanceAgregado = parseFloat(datos.porcentajeAvance) || 0;
      if (tarea) {
        const costoUnit  = (tarea.costoMat || 0) + (tarea.costoSub || 0);
        valorCertificado = Math.round(costoUnit * (tarea.cantidad || 0) * avanceAgregado / 100);
      }
    }
    // Para correcciones: SET en vez de ADD
    const avancePrevio = tarea?.avance || 0;
    const avanceFinalUncapped = esCorreccion
      ? Math.round((cantAvance / (tarea?.cantidad || 1)) * 100)
      : avancePrevio + avanceAgregado;
    const avanceFinal = Math.min(100, avanceFinalUncapped);
    if (esCorreccion && tarea) avanceAgregado = avanceFinal - avancePrevio;

    // Detectar exceso sobre presupuesto
    let excesoMsg = '';
    let nuevoAdicional = null;
    if (tarea && avanceAgregado !== 0) {
      const nuevoAvanceRaw = avanceFinalUncapped;
      if (nuevoAvanceRaw > 100) {
        const excesoPct  = nuevoAvanceRaw - 100;
        const costoUnit  = (tarea.costoMat || 0) + (tarea.costoSub || 0);
        const excesoQty  = parseFloat(((excesoPct / 100) * (tarea.cantidad || 0)).toFixed(3));
        const excesoValor = Math.round(costoUnit * excesoQty);
        const qtyStr     = cantAvance > 0
          ? `${excesoQty}${datos.unidad || tarea.unidad || ''} sobre presupuesto`
          : `${excesoPct.toFixed(0)}% sobre presupuesto`;
        nuevoAdicional = {
          id:            `adic-${Date.now()}`,
          descripcion:   `⚠️ Exceso ${tarea.nombre} — ${qtyStr} (vía WhatsApp por ${user.user_name})`,
          fecha:         new Date().toISOString().split('T')[0],
          estado:        'pendiente',
          tarea:         tarea.nombre,
          cantidad:      excesoQty,
          unidad:        datos.unidad || tarea.unidad || '',
          // Costo (lo que le pagamos al proveedor)
          costoUnit:     costoUnit,
          costoTotal:    excesoValor,
          // Venta (lo que le cobramos al cliente — a completar en la app, por defecto igual al costo)
          valorVentaUnit:  null,
          valorVentaTotal: null,
          // Resumen
          monto:           excesoValor,   // alias para compatibilidad
          montoProveedor:  null,          // null = pendiente de decidir si se le cobra al proveedor
        };
        const montoFmt = String(excesoValor).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        excesoMsg = `\n⚠️ *Exceso de presupuesto:* ${qtyStr}. Se creó un adicional pendiente por $${montoFmt}.`;
      }
    }

    // Actualizar avance en rubros — SET para correcciones, ADD para avances normales
    let updatedRubros = detalle.rubros;
    if (rubroIdx >= 0 && tareaIdx >= 0 && tarea && avanceFinal !== avancePrevio) {
      updatedRubros = detalle.rubros.map((r, ri) =>
        ri !== rubroIdx ? r : {
          ...r,
          tareas: r.tareas.map((t, ti) => ti === tareaIdx ? { ...t, avance: avanceFinal } : t),
        }
      );
    }

    const nuevaFoto = mediaUrl ? {
      id:        `foto-${Date.now()}`,
      url:       mediaUrl,
      fecha:     new Date().toISOString().split('T')[0],
      label:     datos.descripcion || 'Avance de obra',
      rubro:     tarea?.nombre || datos.tareaId || '',
      creadoPor: user.user_name,
    } : null;

    const detalleActualizado = {
      ...detalle,
      rubros:     updatedRubros,
      fotos:      [...(detalle.fotos || []), ...(nuevaFoto ? [nuevaFoto] : [])],
      adicionales: esCorreccion
        ? [
            // Si la corrección ya no excede el 100%, quitar el adicional de exceso previo de esta tarea
            ...(detalle.adicionales || []).filter(a =>
              !(avanceFinalUncapped <= 100 && a.descripcion?.includes('Exceso') && a.tarea === tarea?.nombre)
            ),
            ...(nuevoAdicional ? [nuevoAdicional] : []),
          ]
        : [...(detalle.adicionales || []), ...(nuevoAdicional ? [nuevoAdicional] : [])],
    };
    await fetch(`${SUPABASE_URL}/rest/v1/shared_data`, {
      method: 'POST',
      headers: { ...sbH(), 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ key: 'obras', data: { obras: obrasData?.obras || [], detalles: { ...detalles, [obra.id]: detalleActualizado } }, updated_at: new Date().toISOString() }),
    });
    await broadcastChange('obras');

    // Agregar certificación a cuenta corriente del proveedor
    let ccMsg = '';
    console.log(`CC check: rubro.proveedor="${rubro?.proveedor}" valorCertificado=${valorCertificado} tarea.costoMat=${tarea?.costoMat} tarea.costoSub=${tarea?.costoSub}`);
    if (!rubro) {
      ccMsg = '\n⚠️ No se encontró el rubro en el presupuesto, no se creó cert. en CC.';
    } else if (!rubro.proveedor) {
      ccMsg = `\n⚠️ El rubro *${rubro.nombre}* no tiene proveedor asignado. Asignalo en la app para que la cert. se registre automáticamente.`;
    } else if (valorCertificado === 0) {
      ccMsg = `\n⚠️ El presupuesto de la tarea tiene costo $0. Verificá los costos en el presupuesto.`;
    } else if (provData) {
      const provNomQ = rubro.proveedor.toLowerCase();
      const prov = (provData.proveedores || []).find(p => {
        const pNom = p.nombre?.toLowerCase() || '';
        return pNom.includes(provNomQ) || provNomQ.includes(pNom) || pNom.split(' ')[0] === provNomQ.split(' ')[0];
      });
      if (!prov) {
        ccMsg = `\n⚠️ Proveedor "*${rubro.proveedor}*" no encontrado en el sistema. Revisá el nombre en el rubro.`;
      } else {
        const ccEntries = provData.ccEntries || [];
        const cantStr = cantAvance > 0 ? `${cantAvance}${datos.unidad || ''}` : `${Math.abs(avanceAgregado)}%`;
        let updatedCCEntries;
        if (esCorreccion) {
          // Buscar la última cert de este proveedor + obra + tarea y actualizarla
          const tareaKey = (tarea?.nombre || '').toLowerCase();
          let lastIdx = -1;
          for (let i = ccEntries.length - 1; i >= 0; i--) {
            const e = ccEntries[i];
            if (e.obraId === obra.id && e.tipo === 'cert' && (e.concepto || '').toLowerCase().includes(tareaKey)) {
              lastIdx = i; break;
            }
          }
          if (lastIdx >= 0) {
            updatedCCEntries = ccEntries.map((e, i) => i !== lastIdx ? e : {
              ...e,
              fecha:    new Date().toISOString().split('T')[0],
              concepto: `Corrección: ${tarea?.nombre || 'Avance'} (${cantStr}) — por ${user.user_name}`,
              debe:     valorCertificado,
            });
          } else {
            updatedCCEntries = [...ccEntries, {
              id: `cc-${Date.now()}`, proveedorId: prov.id,
              obraId: obra.id, obraNombre: obra.nombre,
              fecha: new Date().toISOString().split('T')[0],
              concepto: `Corrección: ${tarea?.nombre || 'Avance'} (${cantStr})`,
              tipo: 'cert', debe: valorCertificado, haber: 0,
            }];
          }
        } else {
          updatedCCEntries = [...ccEntries, {
            id:          `cc-${Date.now()}`,
            proveedorId: prov.id,
            obraId:      obra.id,
            obraNombre:  obra.nombre,
            fecha:       new Date().toISOString().split('T')[0],
            concepto:    `Cert: ${datos.descripcion || tarea?.nombre || 'Avance'} (${cantStr})`,
            tipo:        'cert',
            debe:        valorCertificado,
            haber:       0,
          }];
        }
        await fetch(`${SUPABASE_URL}/rest/v1/shared_data`, {
          method: 'POST',
          headers: { ...sbH(), 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify({ key: 'proveedores', data: { proveedores: provData.proveedores, ccEntries: updatedCCEntries }, updated_at: new Date().toISOString() }),
        });
        await broadcastChange('proveedores');
        const montoFmt = String(valorCertificado).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        ccMsg = esCorreccion
          ? `\n💰 CC de *${prov.nombre}* actualizada → $${montoFmt}`
          : `\n💰 Cert. $${montoFmt} agregada a CC de *${prov.nombre}*`;
      }
    }

    // Alertas financieras solo van a admins, no al que reportó
    const alertasAdmin = [excesoMsg, ccMsg].filter(m => m && m.startsWith('\n⚠️')).map(m => m.trim());
    if (alertasAdmin.length > 0) {
      const admins = await getAllAdmins();
      const cantStr = cantAvance > 0 ? `${cantAvance}${datos.unidad || ''}` : `${avanceAgregado}%`;
      const msgAdmin =
        `📋 *Avance registrado en ${obra.nombre}*\n` +
        `Por: *${user.user_name}*\n` +
        `Tarea: ${tarea?.nombre || '—'} · ${cantStr}\n\n` +
        alertasAdmin.join('\n');
      for (const admin of admins) await sendWA(admin.phone, msgAdmin);

      // Guardar también en shared_data 'alertas' para el dashboard
      try {
        const alertasData = await loadSharedData('alertas');
        const existingAlertas = Array.isArray(alertasData) ? alertasData : [];
        const nuevasAlertas = alertasAdmin.map((msg, i) => ({
          id:        `alerta-${Date.now()}-${i}`,
          tipo:      msg.includes('Exceso') ? 'exceso' : 'proveedor_faltante',
          texto:     msg,
          obra:      obra.nombre,
          obraId:    obra.id,
          tarea:     tarea?.nombre || '',
          fecha:     new Date().toISOString(),
          leida:     false,
          fuente:    'whatsapp',
          creadoPor: user.user_name,
        }));
        await fetch(`${SUPABASE_URL}/rest/v1/shared_data`, {
          method: 'POST',
          headers: { ...sbH(), 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify({ key: 'alertas', data: [...nuevasAlertas, ...existingAlertas.slice(0, 50)], updated_at: new Date().toISOString() }),
        });
        await broadcastChange('alertas');
      } catch (e) { console.error('saveAlertas error:', e.message); }
    }

    const tareaMsg  = tarea ? ` · ${tarea.nombre}` : '';
    const avanceMsg = esCorreccion
      ? ` · ${avancePrevio}% → ${avanceFinal}%`
      : avanceAgregado > 0 ? ` · +${Math.min(avanceAgregado, 100 - avancePrevio)}%` : '';
    // Al que reportó: solo confirmación limpia (sin precios ni alertas)
    const ccOkMsg = ccMsg && ccMsg.startsWith('\n💰') ? ccMsg : '';
    const accionMsg = esCorreccion ? '🔧 Corrección guardada' : '✅ Avance guardado';
    return `${accionMsg} en *${obra.nombre}*${tareaMsg}${avanceMsg}${mediaUrl ? ' · con foto' : ''}${ccOkMsg}`;
  }

  if (tipo === 'comando') {
    return await ejecutarComando(datos.comando, datos, user, ctx);
  }

  return '✅ Acción registrada correctamente.';
}

async function ejecutarComando(comando, datos, user, ctx) {
  if (comando === 'ayuda') {
    const esAdmin = user.user_rol === 'Admin';
    return (
      `📋 *Comandos disponibles:*\n\n` +
      `• *saldo* — Ver saldo de tus cajas\n` +
      `• *pendientes* — Aprobaciones pendientes\n` +
      (esAdmin ? `• *cheques* — Cheques próximos a vencer\n` : '') +
      (esAdmin ? `• *resumen [obra] [fecha]* — Resumen de una obra\n` : '') +
      `\nTambién podés:\n` +
      `• Mandar una foto o PDF de una factura\n` +
      `• Escribir un gasto (ej: "pagué $50k de materiales en Obra Belgrano")\n` +
      `• Reportar un ingreso\n` +
      `• Mandar foto de un cheque`
    );
  }

  if (comando === 'saldo') {
    const cajasUsuario = ctx.cajas.filter(c =>
      user.cajasVisibles.length === 0 || user.cajasVisibles.includes(c.id)
    );
    if (!cajasUsuario.length) return 'No tenés cajas asignadas.';
    const lineas = cajasUsuario.map(c =>
      `• ${c.nombre}: *$${Math.round(c.saldo || 0).toLocaleString('es-AR')}* ${c.moneda}`
    );
    return `💰 *Saldo de tus cajas:*\n\n${lineas.join('\n')}`;
  }

  if (comando === 'pendientes') {
    const pendingRows = await sbGet('shared_data', '?key=eq.whatsapp_pending&select=data');
    const pending = Array.isArray(pendingRows[0]?.data) ? pendingRows[0].data : [];
    const movsPendientes = pending.filter(p => p.tipoPendiente === 'movimiento');
    if (!movsPendientes.length) return '✅ No hay movimientos pendientes de aprobación.';
    const lineas = movsPendientes.slice(0, 5).map(p =>
      `• ${p.creadoPor}: $${Math.round(p.movimiento?.monto || 0).toLocaleString('es-AR')} — ${p.movimiento?.descripcion || '—'}`
    );
    return `⏳ *Pendientes de aprobación (${movsPendientes.length}):*\n\n${lineas.join('\n')}\n\nRevisalos en Kamak → Buzón WhatsApp.`;
  }

  if (comando === 'cheques') {
    if (user.user_rol !== 'Admin') return '❌ Este comando es solo para administradores.';
    const chequesData = await loadSharedData('cheques');
    const cheques = chequesData?.cheques || [];
    const hoy = new Date();
    const en7dias = new Date(hoy.getTime() + 7 * 24 * 60 * 60 * 1000);
    const proximos = cheques.filter(c => {
      if (c.estado !== 'cartera') return false;
      const venc = new Date(c.fechaVencimiento);
      return venc <= en7dias && venc >= hoy;
    });
    if (!proximos.length) return '✅ No hay cheques por vencer en los próximos 7 días.';
    const lineas = proximos.map(c =>
      `• ${c.banco} N°${c.numero} — $${Math.round(c.monto).toLocaleString('es-AR')} — Vence: ${c.fechaVencimiento}`
    );
    return `⚠️ *Cheques por vencer (próximos 7 días):*\n\n${lineas.join('\n')}`;
  }

  if (comando === 'resumen') {
    if (user.user_rol !== 'Admin') return '❌ Este comando es solo para administradores.';
    const obraId = datos.obraId;
    const fecha  = datos.fecha || new Date().toISOString().split('T')[0];
    const obra   = ctx.obras.find(o => o.id === obraId || o.nombre?.toLowerCase().includes(obraId?.toLowerCase()));
    if (!obra) return '❌ No encontré esa obra. Escribí el nombre completo.';
    const movData = await loadSharedData('movimientos');
    const movs    = (movData?.movimientos || []).filter(m => m.obraId === obra.id && m.fecha === fecha);
    if (!movs.length) return `📊 Sin movimientos en *${obra.nombre}* el ${fecha}.`;
    const gastos  = movs.filter(m => m.tipo === 'gasto');
    const ingresos = movs.filter(m => m.tipo === 'ingreso');
    const totalG  = gastos.reduce((s, m) => s + (m.monto || 0), 0);
    const totalI  = ingresos.reduce((s, m) => s + (m.monto || 0), 0);
    return (
      `📊 *Resumen ${obra.nombre} — ${fecha}*\n\n` +
      `Gastos (${gastos.length}): *$${Math.round(totalG).toLocaleString('es-AR')}*\n` +
      `Ingresos (${ingresos.length}): *$${Math.round(totalI).toLocaleString('es-AR')}*\n\n` +
      gastos.slice(0, 5).map(m => `• ${m.descripcion}: $${Math.round(m.monto).toLocaleString('es-AR')}`).join('\n')
    );
  }

  return '❓ Comando no reconocido. Escribí *ayuda* para ver los disponibles.';
}

// ── Flujo principal ───────────────────────────────────────────────────────────
async function handleMainFlow(phone, user, messageText, mediaId, mimeType, conv) {
  const ctx = await getSystemContext();

  let base64Media = null;
  let mediaUrl    = conv.data?.pendingMediaUrl || null;

  if (mediaId) {
    base64Media = await downloadMedia(mediaId);
    if (base64Media) {
      const ext      = mimeType === 'application/pdf' ? 'pdf' : 'jpg';
      const filepath = `${phone.replace(/\D/g, '')}-${Date.now()}.${ext}`;
      mediaUrl = await uploadToStorage(base64Media, mimeType, filepath);
      console.log(`MEDIA uploaded: ${mediaUrl}`);
    }
  }

  if (conv.state === 'confirmando' && conv.data?.accion) {
    const respLower = messageText.trim().toLowerCase();
    const confirma  = ['sí', 'si', 'dale', 'ok', 'confirmo', 'correcto', 's'].some(p => respLower.startsWith(p));
    const cancela   = ['no', 'cancelar', 'error', 'mal', 'n'].some(p => respLower.startsWith(p));

    if (confirma) {
      const resultado = await ejecutarAccion(conv.data.accion.tipo, conv.data.accion.datos, { ...user, phone }, ctx, mediaUrl || conv.data.pendingMediaUrl);
      await clearConversation(phone);
      await sendWA(phone, resultado);
      return;
    }
    if (cancela) {
      await clearConversation(phone);
      await sendWA(phone, '❌ Cancelado. ¿En qué más te puedo ayudar?');
      return;
    }
  }

  const updatedHistory = [
    ...conv.history,
    { rol: 'usuario', texto: messageText || '(foto)', ts: Date.now() },
  ];

  // ── BYPASS CORRECCIÓN: "me equivoqué", "corregir avance", etc. ──────────────
  const correccionDetectada = extractCorreccion(messageText || '', ctx.obras, ctx.detalles);
  if (correccionDetectada?.completo) {
    const { _obra, _tarea, cantidadAvance, unidad } = correccionDetectada;
    const pctNuevo = _tarea.cantidad ? Math.round((cantidadAvance / _tarea.cantidad) * 100) : null;
    const pctActual = _tarea.avance || 0;
    const confMsg =
      `🔧 *Corrección de avance:*\n\n` +
      `🏗 Obra: *${_obra.nombre}*\n` +
      `📐 Tarea: *${_tarea.nombre}*\n` +
      `📊 Avance actual: *${pctActual}%*\n` +
      `✏️ Nuevo valor: *${cantidadAvance}${unidad}*${pctNuevo != null ? ` → *${Math.min(pctNuevo, 100)}%*` : ''}\n\n` +
      `Esto *reemplaza* el avance anterior. ¿Confirmás? (sí/no)`;
    const newHist = [...updatedHistory, { rol: 'asistente', texto: confMsg, ts: Date.now() }];
    await saveConversation(phone, 'confirmando', { accion: { tipo: 'avance_obra', datos: correccionDetectada }, pendingMediaUrl: mediaUrl }, newHist);
    await sendWA(phone, confMsg);
    return;
  }

  // ── BYPASS CLAUDE: extracción directa cuando todo está en el texto ──────────
  // Si detectamos avance + obra + tarea + cantidad del propio mensaje, vamos directo
  // a confirmación sin preguntarle nada al usuario.
  const avanceDetectado = extractAvanceCompleto(messageText || '', ctx.obras, ctx.detalles);
  if (avanceDetectado?.completo && conv.state !== 'conversando') {
    const { _obra, _tarea, cantidadAvance, unidad } = avanceDetectado;
    const cantStr  = `${cantidadAvance}${unidad}`;
    const totalStr = _tarea.cantidad ? ` de ${_tarea.cantidad}${_tarea.unidad || unidad} total` : '';
    const avPct    = _tarea.cantidad ? ` (+${Math.round((cantidadAvance / _tarea.cantidad) * 100)}%)` : '';
    const confMsg  =
      `📋 *Confirmar avance:*\n\n` +
      `🏗 Obra: *${_obra.nombre}*\n` +
      `📐 Tarea: *${_tarea.nombre}*\n` +
      `📊 Cantidad: *${cantStr}*${totalStr}${avPct}\n` +
      (mediaUrl ? `📷 Con foto adjunta\n` : '') +
      `\n¿Confirmás? (sí/no)`;
    const newHist = [...updatedHistory, { rol: 'asistente', texto: confMsg, ts: Date.now() }];
    await saveConversation(phone, 'confirmando', { accion: { tipo: 'avance_obra', datos: avanceDetectado }, pendingMediaUrl: mediaUrl }, newHist);
    await sendWA(phone, confMsg);
    return;
  }

  const claudeRes = await callClaude(user, messageText, base64Media, mimeType, { ...conv, history: updatedHistory }, ctx, mediaUrl);

  const newHistory = [
    ...updatedHistory,
    { rol: 'asistente', texto: claudeRes.mensaje, ts: Date.now() },
  ];

  if (claudeRes.estado === 'ejecutar') {
    const resultado = await ejecutarAccion(claudeRes.accion.tipo, claudeRes.accion.datos, { ...user, phone }, ctx, mediaUrl);
    await saveConversation(phone, 'idle', {}, newHistory);
    await sendWA(phone, resultado);
    return;
  }

  if (claudeRes.estado === 'confirmando') {
    await saveConversation(phone, 'confirmando', { accion: claudeRes.accion, pendingMediaUrl: mediaUrl }, newHistory);
    await sendWA(phone, claudeRes.mensaje);
    return;
  }

  if (claudeRes.estado === 'cancelar') {
    await clearConversation(phone);
    await sendWA(phone, '❌ Cancelado. ¿En qué más te puedo ayudar?');
    return;
  }

  if (claudeRes.estado === 'comando') {
    const resultado = await ejecutarComando(claudeRes.accion?.datos?.comando, claudeRes.accion?.datos || {}, { ...user, phone }, ctx);
    await saveConversation(phone, 'idle', {}, newHistory);
    await sendWA(phone, resultado);
    return;
  }

  await saveConversation(phone, 'conversando', { ...(conv.data || {}), pendingMediaUrl: mediaUrl }, newHistory);
  await sendWA(phone, claudeRes.mensaje);
}

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Verificación del webhook (GET de Meta)
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, vars: { meta: !!META_TOKEN, phoneId: !!PHONE_NUMBER_ID, verifyToken: !!VERIFY_TOKEN, anthropic: !!ANTHROPIC_KEY, supabase: !!SUPABASE_URL } });
  }

  try {
    const body = req.body;
    if (body?.object !== 'whatsapp_business_account') return res.status(200).json({ ok: true });

    const entry   = body.entry?.[0];
    const change  = entry?.changes?.[0];
    if (change?.field !== 'messages') return res.status(200).json({ ok: true });

    const value   = change.value;
    const message = value?.messages?.[0];
    if (!message) return res.status(200).json({ ok: true });

    const phone       = message.from;
    const messageType = message.type;

    let text    = '';
    let mediaId = null;
    let mimeType = null;

    if (messageType === 'text') {
      text = message.text?.body || '';
    } else if (messageType === 'image') {
      mediaId  = message.image?.id;
      mimeType = message.image?.mime_type || 'image/jpeg';
      text     = message.image?.caption || '';
    } else if (messageType === 'document') {
      mediaId  = message.document?.id;
      mimeType = message.document?.mime_type || 'application/pdf';
      text     = message.document?.filename || '';
    } else {
      return res.status(200).json({ ok: true });
    }

    console.log(`MSG phone=${phone} type=${messageType} text=${text?.slice(0,30)}`);

    const conv = await loadConversation(phone);
    const user = await getLinkedUser(phone);
    console.log(`USER linked=${!!user} state=${conv?.state}`);

    if (!user) {
      await handleLinkingFlow(phone, text, conv);
    } else {
      await handleMainFlow(phone, user, text, mediaId, mimeType, conv);
    }

    console.log('DONE');
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
}
