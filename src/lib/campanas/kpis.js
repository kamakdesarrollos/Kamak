// KPIs del módulo Campañas — funciones PURAS de agregación para el tablero.
// NO importa nada del módulo: todo llega por parámetro (etapas/estados como strings).
// Todas toleran arrays vacíos, argumentos ausentes y campos faltantes.

const DIA_MS = 24 * 60 * 60 * 1000;
const CANALES_SERIE = ['llamada', 'email', 'linkedin', 'whatsapp'];
const ETAPAS_RESPONDIO = ['respondio', 'en_conversacion', 'reunion', 'promovido'];

// ── helpers internos ─────────────────────────────────────────────────────────

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** % con 1 decimal; 0 si el denominador es 0. */
const pct = (parte, total) => (total > 0 ? Math.round((parte / total) * 1000) / 10 : 0);

/** Date válida o null (acepta Date, string ISO, epoch). */
function parseFecha(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const esMismoDia = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Últimos 7 días (o el día de hoy, aunque la hora sea posterior a `ahora`). */
function enUltimos7Dias(fecha, ahora) {
  const diff = ahora.getTime() - fecha.getTime();
  return esMismoDia(fecha, ahora) || (diff >= 0 && diff < 7 * DIA_MS);
}

/** Lunes (00:00 local) de la semana de `d`. */
function lunesDeSemana(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function fmtYmd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Canal efectivo de una actividad: canal explícito, o linkedin_* → 'linkedin', o el tipo si coincide con un canal; sino 'otro'. */
function canalDe(a) {
  const tipo = String(a?.tipo || '');
  const canal = a?.canal || (tipo.startsWith('linkedin') ? 'linkedin' : tipo);
  return CANALES_SERIE.includes(canal) ? canal : 'otro';
}

const usuarioDe = (a) => a?.usuario_id ?? a?.usuarioId ?? a?.usuario;
const listaIdDe = (x) => x?.lista_id ?? x?.listaId;
const operadorIdDe = (a) => a?.operador_id ?? a?.operadorId;

function contarLlamadas(llamadas, ahora) {
  let hoy = 0;
  let semana = 0;
  for (const a of llamadas) {
    const f = parseFecha(a?.fecha);
    if (!f) continue;
    if (esMismoDia(f, ahora)) hoy += 1;
    if (enUltimos7Dias(f, ahora)) semana += 1;
  }
  return { hoy, semana };
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * KPIs generales del tablero.
 * @returns {{ contactados, tasaRespuesta, reuniones, leadsCalientes, promovidos, llamadasHoy, llamadasSemana }}
 */
export function kpisGenerales({ conteoPorEtapa = {}, actividades = [], estacionesStats = {}, ahora = new Date() } = {}) {
  const conteo = conteoPorEtapa || {};
  const acts = actividades || [];

  const contactados = Object.entries(conteo)
    .filter(([etapa]) => etapa !== 'sin_contactar')
    .reduce((suma, [, n]) => suma + num(n), 0);

  const respondieron = ETAPAS_RESPONDIO.reduce((suma, etapa) => suma + num(conteo[etapa]), 0);

  const reunionesAct = acts.filter((a) => a?.tipo === 'reunion').length;
  const { hoy: llamadasHoy, semana: llamadasSemana } = contarLlamadas(
    acts.filter((a) => a?.tipo === 'llamada'),
    ahora,
  );

  return {
    contactados,
    tasaRespuesta: pct(respondieron, contactados),
    reuniones: Math.max(reunionesAct, num(conteo.reunion)),
    leadsCalientes: num(estacionesStats?.porEstado?.['LEAD CALIENTE']),
    promovidos: num(conteo.promovido),
    llamadasHoy,
    llamadasSemana,
  };
}

/**
 * Comparativa entre listas/campañas, ordenada por tasa de respuesta desc.
 * @returns {Array<{ listaId, nombre, canal, enviados, respondieron, tasaRespuesta, reuniones, costoMensual }>}
 */
export function comparativaListas({ listas = [], miembros = [], actividades = [] } = {}) {
  const acts = actividades || [];
  return (listas || [])
    .map((lista) => {
      const listaId = lista?.id ?? listaIdDe(lista);
      const propios = (miembros || []).filter((m) => listaIdDe(m) === listaId);
      const enviados = propios.filter(
        (m) => m?.enviado_at || m?.enviadoAt || m?.estado === 'enviado' || m?.estado === 'respondio',
      ).length;
      const respondieron = propios.filter(
        (m) => m?.estado === 'respondio' || m?.respondido_at || m?.respondidoAt,
      ).length;
      return {
        listaId,
        nombre: lista?.nombre ?? '',
        canal: lista?.canal ?? '',
        enviados,
        respondieron,
        tasaRespuesta: pct(respondieron, enviados),
        reuniones: acts.filter((a) => a?.tipo === 'reunion' && listaIdDe(a) === listaId).length,
        costoMensual: num(lista?.costo_mensual ?? lista?.costoMensual),
      };
    })
    .sort((a, b) => b.tasaRespuesta - a.tasaRespuesta);
}

/**
 * Embudo de concreción en 6 escalones: Contacto → Respondió → WhatsApp → Reunión → Presupuesto → Obra ganada.
 * `conversionDesdeAnterior`: % (1 decimal) sobre el escalón previo; null en el primero; 0 si el anterior es 0.
 * @returns {Array<{ key, label, valor, conversionDesdeAnterior }>}
 */
export function embudoConcrecion({ conteoPorEtapa = {}, actividades = [], obrasPromovidas = [] } = {}) {
  const conteo = conteoPorEtapa || {};
  const obras = obrasPromovidas || [];
  const n = (etapa) => num(conteo[etapa]);

  const respondio = ETAPAS_RESPONDIO.reduce((suma, etapa) => suma + n(etapa), 0);
  const operadoresWhatsapp = new Set(
    (actividades || []).filter((a) => canalDe(a) === 'whatsapp').map(operadorIdDe).filter(Boolean),
  );

  const escalones = [
    { key: 'contacto', label: 'Contacto', valor: n('contactado') + respondio },
    { key: 'respondio', label: 'Respondió', valor: respondio },
    { key: 'whatsapp', label: 'WhatsApp', valor: operadoresWhatsapp.size },
    { key: 'reunion', label: 'Reunión', valor: n('reunion') + n('promovido') },
    { key: 'presupuesto', label: 'Presupuesto', valor: obras.length },
    {
      key: 'obraGanada',
      label: 'Obra ganada',
      // Ganada = etapa de venta 'ganado' O estado real de obra activa/finalizada:
      // cubre la obra confirmada desde Obras sin arrastrar la card del embudo
      // (mismo criterio que etapaEfectiva de ventaEtapa.js, sin el edge 'perdido').
      valor: obras.filter(
        (o) => o?.venta?.etapa === 'ganado' || o?.estado === 'activa' || o?.estado === 'finalizada',
      ).length,
    },
  ];

  return escalones.map((e, i) => ({
    ...e,
    conversionDesdeAnterior: i === 0 ? null : pct(e.valor, escalones[i - 1].valor),
  }));
}

/**
 * Serie de actividades por semana ISO (lunes local, YYYY-MM-DD) para las últimas `semanas` (incluida la actual),
 * rellenando con ceros las semanas sin datos. Orden cronológico ascendente.
 * @returns {Array<{ semanaIso, porCanal: { llamada, email, linkedin, whatsapp, otro }, total }>}
 */
export function seriePorSemana({ actividades = [], semanas = 8, ahora = new Date() } = {}) {
  const cantidad = Math.max(1, num(semanas) || 8);
  const lunesActual = lunesDeSemana(ahora);
  const porSemana = new Map();
  const serie = [];

  for (let i = cantidad - 1; i >= 0; i--) {
    const lunes = new Date(lunesActual);
    lunes.setDate(lunes.getDate() - i * 7);
    const fila = {
      semanaIso: fmtYmd(lunes),
      porCanal: { llamada: 0, email: 0, linkedin: 0, whatsapp: 0, otro: 0 },
      total: 0,
    };
    porSemana.set(fila.semanaIso, fila);
    serie.push(fila);
  }

  for (const a of actividades || []) {
    const f = parseFecha(a?.fecha);
    if (!f) continue;
    const fila = porSemana.get(fmtYmd(lunesDeSemana(f)));
    if (!fila) continue; // fuera de la ventana
    fila.porCanal[canalDe(a)] += 1;
    fila.total += 1;
  }

  return serie;
}

/**
 * Stats de llamadas de un usuario (o de todos si no se pasa `usuarioId`).
 * `porResultado` cuenta TODAS las llamadas recibidas (el rango lo define el caller al traerlas).
 * @returns {{ hoy, semana, porResultado: Record<string, number> }}
 */
export function statsLlamadasCaro({ actividades = [], usuarioId, ahora = new Date() } = {}) {
  const llamadas = (actividades || []).filter(
    (a) => a?.tipo === 'llamada' && (!usuarioId || usuarioDe(a) === usuarioId),
  );

  const porResultado = {};
  for (const a of llamadas) {
    if (a?.resultado) porResultado[a.resultado] = (porResultado[a.resultado] || 0) + 1;
  }

  return { ...contarLlamadas(llamadas, ahora), porResultado };
}
