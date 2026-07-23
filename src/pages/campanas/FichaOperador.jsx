import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Btn } from '../../components/ui';
import { T } from '../../theme';
import { useUsuarios } from '../../store/UsuariosContext';
import { useCampanas } from '../../store/CampanasContext';
import { useClientes } from '../../store/ClientesContext';
import { useObras } from '../../store/ObrasContext';
import { useComercial } from '../../store/ComercialContext';
import { supabase } from '../../lib/supabase';
import {
  ESTADO_LLAMADA_META, ETAPAS_PROSPECCION, ETAPA_PROSPECCION_META, CANALES, BANDERAS,
} from '../../lib/campanas/constants';

// Ficha del operador — componente standalone y reutilizable (sin asunciones de
// página: nada de useSearchParams; el caller maneja rutas, apertura y cierre).
//
//   <FichaOperador
//     operador={op}                        // fila de camp_operadores
//     onClose={fn}                         // cerrar (✕ / ← / overlay / Escape)
//     onPatch={(id, changes) => void}      // sincronizar mutaciones con el caller
//     vista="panel" | "fullscreen"         // panel lateral 480px | mobile a pantalla completa
//   />
//
// Incluye: datos de contacto, anti-colisión (tomar/liberar/forzar), etapa +
// promover al embudo, vincular con obra EXISTENTE (camino nuevo), datos del
// operador editables (banderas / cuántas estaciones / rubro — pedido de Franco),
// estaciones con estado + "Caro anotó", decisores con LinkedIn, timeline y
// registro de actividad manual.
// P11: acá JAMÁS se muestran montos de obras — solo nombres.

// ── Helpers puros ─────────────────────────────────────────────────────────────

const tiempoRelativo = (iso) => {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '—';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d} d`;
  const mes = Math.floor(d / 30);
  if (mes < 12) return `hace ${mes} mes${mes > 1 ? 'es' : ''}`;
  const a = Math.floor(mes / 12);
  return `hace ${a} año${a > 1 ? 's' : ''}`;
};

const urlAbs = (u) => (/^https?:\/\//i.test(u || '') ? u : `https://${u}`);

// yyyy-mm-dd LOCAL de mañana (default del input date de "Agendar llamada").
const fechaManana = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Título del evento según el tipo de seguimiento (ampliación de Franco: "no
// solamente llamadas, pueden ser otros contactos"). Tipos = TIPOS_ACTIVIDAD;
// cualquier otro cae en el genérico "Seguimiento".
const TITULO_AGENDA = {
  llamada: (n) => `📞 Llamar a ${n}`,
  email: (n) => `✉️ Escribir a ${n}`,
  whatsapp: (n) => `💬 WhatsApp a ${n}`,
  linkedin: (n) => `💼 LinkedIn a ${n}`,
  reunion: (n) => `🤝 Reunión con ${n}`,
};
const tituloAgenda = (tipo, nombre) =>
  (TITULO_AGENDA[tipo] || ((n) => `📌 Seguimiento: ${n}`))(nombre);

// POST /api/campana/agendar → evento en el Google Calendar del que llama, con
// alarma (el endpoint además registra la actividad — acá NO se registra nada).
// Mismo patrón de fetch autenticado que UsuariosContext.updateUsuario y que
// ColaLlamadas. Respuestas: {ok, htmlLink} | {skipped:'…'} | {error}.
const agendarEnCalendario = async (body) => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return { error: { message: 'No hay sesión activa.' } };
    const r = await fetch('/api/campana/agendar', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const resp = await r.json().catch(() => ({}));
    if (!r.ok || resp?.error) return { error: { message: resp?.error || `Error ${r.status} al agendar` } };
    return resp;
  } catch (e) {
    return { error: { message: e?.message || 'Error de red al agendar' } };
  }
};

// Para buscar obras sin pelearse con tildes/mayúsculas. El rango es
// U+0300-U+036F (diacríticos combinantes) construido con fromCharCode para
// mantener el fuente 100% ASCII.
const DIACRITICOS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');
const normalizar = (s) => String(s || '')
  .normalize('NFD').replace(DIACRITICOS, '').toLowerCase();

const CONFIANZA_META = {
  alta:  { label: 'Alta',  color: T.ok },
  media: { label: 'Media', color: T.warn },
  baja:  { label: 'Baja',  color: T.ink3 },
};

// Rubros del operador (nivel 1 del explorador, migración 0007). Por ahora
// hardcodeados: cuando el explorador tenga su config de rubros, esta lista
// sale de esa config en vez de vivir acá.
const RUBROS = [
  ['estaciones', '⛽ Estaciones de servicio'],
  ['franquicias', '🏪 Franquicias'],
];
const rubroLabel = (r) => RUBROS.find(([v]) => v === r)?.[1] || r || '—';

// Tipos de actividad manual (canal: reunión/nota → 'otro'; el resto = el tipo).
const TIPOS_ACTIVIDAD = [
  ['llamada', '📞 Llamada'],
  ['email', '✉️ Email'],
  ['linkedin', '💼 LinkedIn'],
  ['whatsapp', '💬 WhatsApp'],
  ['reunion', '🤝 Reunión'],
  ['nota', '📝 Nota'],
];

const ICONO_TIPO = {
  llamada: '📞', email: '✉️', linkedin: '💼', whatsapp: '💬', reunion: '🤝',
  nota: '📝', cambio_etapa: '↔️', tomado: '🔒', liberado: '🔓', promovido: '▶️',
  obra_vinculada: '🔗', import: '📥', alta_estacion: '⛽', agenda: '📅',
};
const ICONO_CANAL = { llamada: '📞', email: '✉️', linkedin: '💼', whatsapp: '💬', presencial: '🤝', otro: '📝' };
const iconoActividad = (a) => ICONO_TIPO[a.tipo] || ICONO_CANAL[a.canal] || '•';

// ── Estilos compartidos ──────────────────────────────────────────────────────

const selSt = {
  padding: '7px 10px', border: `1px solid ${T.faint2}`, borderRadius: 7,
  fontSize: 12.5, fontFamily: T.font, background: '#fff', color: T.ink, outline: 'none',
};
const inputSt = {
  padding: '8px 12px', border: `1px solid ${T.faint2}`, borderRadius: 7,
  fontSize: 13, fontFamily: T.font, outline: 'none', background: '#fff', color: T.ink,
};
const tituloSeccionSt = {
  fontSize: 10.5, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase',
  color: T.ink3, marginBottom: 10,
};
const vacioSt = { fontSize: 12, color: T.ink3 };
const etiquetaCampoSt = {
  fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase',
  color: T.ink3, marginBottom: 6,
};
const headerBtnSt = {
  cursor: 'pointer', background: 'transparent', border: 'none', color: 'inherit',
  padding: 0, lineHeight: 1, opacity: 0.7, transition: 'opacity 0.15s ease', flexShrink: 0,
};

const hoverOn = (e) => { e.currentTarget.style.opacity = '1'; };
const hoverOff = (e) => { e.currentTarget.style.opacity = '0.7'; };

// ── Sub-componentes de presentación ──────────────────────────────────────────

function Seccion({ titulo, extra, children }) {
  return (
    <section style={{ borderTop: `1px solid ${T.faint2}`, paddingTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={tituloSeccionSt}>{titulo}</span>
        {extra}
      </div>
      {children}
    </section>
  );
}

// Link de acción discreto (con hover subrayado).
function LinkAccion({ onClick, children, style }) {
  return (
    <span
      onClick={onClick}
      onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
      onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
      style={{ fontSize: 12, color: T.accent, fontWeight: 700, cursor: 'pointer', ...style }}
    >{children}</span>
  );
}

function PillEtapa({ etapa }) {
  const m = ETAPA_PROSPECCION_META[etapa] || { label: etapa || '—', color: T.ink3 };
  return (
    <span style={{ background: m.color, color: '#fff', borderRadius: 999, padding: '3px 11px', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {m.label}
    </span>
  );
}

function PillEstado({ estado }) {
  const m = ESTADO_LLAMADA_META[estado] || { label: estado || '—', color: T.ink3 };
  return (
    <span style={{ background: m.color, color: '#fff', borderRadius: 999, padding: '2px 10px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {m.label}
    </span>
  );
}

function PillConfianza({ confianza, verificado }) {
  const m = CONFIANZA_META[String(confianza || '').toLowerCase()];
  if (!m && !verificado) return null;
  return (
    <span style={{
      border: `1px solid ${m?.color || T.ok}`, color: m?.color || T.ok,
      borderRadius: 999, padding: '2px 10px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
    }}>
      {m ? m.label : 'Verificado'}{verificado ? ' ✓' : ''}
    </span>
  );
}

function TagBandera({ children }) {
  return (
    <span style={{
      fontSize: 9.5, fontWeight: 700, border: `1px solid ${T.faint2}`, borderRadius: 999,
      padding: '2px 8px', background: T.faint, color: T.ink2, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

// Pill toggleable (edición de "Datos"): prendida = fondo suave del accent.
function ChipToggle({ activo, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1.5px solid ${activo ? T.accent : T.faint2}`,
        background: activo ? T.accentSoft : 'transparent',
        color: activo ? T.accent2 : T.ink2,
        borderRadius: 999, padding: '4px 11px', fontSize: 11, fontWeight: 700,
        fontFamily: T.font, cursor: 'pointer', whiteSpace: 'nowrap',
        transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
      }}
    >
      {children}
    </button>
  );
}

// Banner warn de anti-colisión (P6): tomado por OTRO usuario, o una mutación
// rebotó con {error:{colision}}.
function BannerColision({ ownerNombre, canal }) {
  return (
    <div style={{
      background: '#fdf3e4', border: `1.5px solid ${T.warn}`, borderRadius: 9,
      padding: '11px 14px', fontSize: 12.5, color: T.ink,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <span style={{ fontSize: 16, flexShrink: 0 }}>🔒</span>
      <span>En tratativas con <b>{ownerNombre}</b> por <b>{canal}</b> — coordiná antes de tocar este operador.</span>
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────

export default function FichaOperador({ operador, onClose, onPatch, vista = 'panel' }) {
  const {
    fetchEstaciones, fetchDecisores, fetchActividades,
    registrarActividad, setEtapaProspeccion, actualizarOperador, crearEstacion, chequearColision,
    tomarOperador, liberarOperador, promoverAEmbudo, vincularObra,
  } = useCampanas();
  const { currentUser, usuarios } = useUsuarios();
  const { addCliente } = useClientes();
  const { obras, addObra } = useObras();
  const { addActividad } = useComercial();
  const navigate = useNavigate();

  const esPanel = vista !== 'fullscreen';
  const myId = currentUser?.id || null;
  const esAdmin = currentUser?.rol === 'Admin';

  // ficha = null mientras carga. El componente NO exige key={operador.id}: la
  // carga guarda el opId al que pertenece y se DERIVA null si no coincide con
  // el operador actual (mismatch = cargando), sin resets síncronos en effects.
  const [fichaRaw, setFichaRaw] = useState(null);    // { opId, estaciones, decisores, acts }
  const ficha = fichaRaw && fichaRaw.opId === operador.id ? fichaRaw : null;
  const [colision, setColision] = useState(null);    // {ownerId, canal} devuelto por el context
  const [errorFicha, setErrorFicha] = useState(null);
  const [nuevaAct, setNuevaAct] = useState({ tipo: 'llamada', texto: '' });
  const [guardando, setGuardando] = useState(false);
  const [canalToma, setCanalToma] = useState('llamada');
  const [promoviendo, setPromoviendo] = useState(false);
  const [promovidoOk, setPromovidoOk] = useState(false);
  const [vinculando, setVinculando] = useState(false);   // picker de obra abierto
  const [busqObra, setBusqObra] = useState('');
  const [guardandoVinculo, setGuardandoVinculo] = useState(false);
  // Sección "Datos" (banderas / estaciones / rubro): lectura por defecto, el
  // draft nace recién al tocar "✎ Editar" (nunca en un effect).
  const [draftDatos, setDraftDatos] = useState(null);    // { banderas, modoEst, nEstaciones, rubro } | null = leyendo
  const [otraBandera, setOtraBandera] = useState('');
  const [guardandoDatos, setGuardandoDatos] = useState(false);
  // Alta de estación ("+ estación" — pedido de Franco: agregarle una boca a un
  // cliente): el draft nace recién al tocar el link, nunca en un effect.
  const [draftEst, setDraftEst] = useState(null);        // { nombre, bandera, localidad, provincia, telefono } | null
  const [avisoEst, setAvisoEst] = useState(null);        // warn inline (dedup / validación)
  const [guardandoEst, setGuardandoEst] = useState(false);
  // "📅 Agendar llamada" (pedido de Franco: "llamar el 25/7 a las 10am y que
  // se me ponga en el calendario con una alarma"): el draft nace al tocar el
  // link, nunca en un effect.
  const [draftAgenda, setDraftAgenda] = useState(null);  // { tipo, fecha, hora, nota } | null
  const [avisoAgenda, setAvisoAgenda] = useState(null);  // { tipo:'ok'|'skip'|'warn', texto?, htmlLink? } | null
  const [guardandoAgenda, setGuardandoAgenda] = useState(false);

  // Transición de entrada (translateX + opacity).
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setAbierto(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Reset del estado por-operador SIN exigir remount (patrón oficial
  // "adjusting state when a prop changes"): si cambió el operador, se limpia
  // durante el render — React re-renderiza de inmediato antes de pintar.
  const [opIdActual, setOpIdActual] = useState(operador.id);
  if (opIdActual !== operador.id) {
    setOpIdActual(operador.id);
    setColision(null);
    setErrorFicha(null);
    setPromovidoOk(false);
    setVinculando(false);
    setBusqObra('');
    setNuevaAct({ tipo: 'llamada', texto: '' });
    setDraftDatos(null);
    setOtraBandera('');
    setDraftEst(null);
    setAvisoEst(null);
    setDraftAgenda(null);
    setAvisoAgenda(null);
  }

  // Carga de la ficha (estaciones + decisores + timeline) al abrir o al
  // cambiar de operador.
  useEffect(() => {
    let vivo = true;
    Promise.all([
      fetchEstaciones({ operadorId: operador.id, page: 1, pageSize: 100 }),
      fetchDecisores({ operadorId: operador.id, page: 1, pageSize: 100 }),
      fetchActividades({ operadorId: operador.id, limit: 100 }),
    ]).then(([est, dec, act]) => {
      if (!vivo) return;
      setFichaRaw({ opId: operador.id, estaciones: est.rows || [], decisores: dec.rows || [], acts: act.rows || [] });
    });
    return () => { vivo = false; };
  }, [operador.id, fetchEstaciones, fetchDecisores, fetchActividades]);

  // Escape cierra en ambas vistas.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cargando = !ficha;
  const estaciones = ficha?.estaciones || [];
  const decisores = ficha?.decisores || [];
  const acts = ficha?.acts || [];

  const nombreUsuario = useCallback((id) => {
    if (!id) return '—';
    return (usuarios || []).find((u) => u.id === id)?.nombre
      || (id === 'bot' ? 'Bot' : id === 'sistema' ? 'Sistema' : id);
  }, [usuarios]);

  const recargarActividades = useCallback(() => {
    fetchActividades({ operadorId: operador.id, limit: 100 })
      .then(({ rows }) => setFichaRaw((f) => (f && f.opId === operador.id ? { ...f, acts: rows || [] } : f)));
  }, [fetchActividades, operador.id]);

  const soyOwner = !!operador.en_tratativas && operador.owner_user_id === myId;
  const tomadoPorOtro = !!operador.en_tratativas && !!operador.owner_user_id && operador.owner_user_id !== myId;
  const ownerNombre = nombreUsuario(colision?.ownerId || operador.owner_user_id);
  const canalTratativas = colision?.canal || operador.canal_activo || 'otro canal';

  // Todas las mutaciones pasan por acá: si el context rebota con {error:{colision}}
  // mostramos el banner y NO aplicamos nada (regla dura del contrato).
  const manejarError = (error) => {
    if (error?.colision) { setColision(error.colision); return true; }
    if (error) { setErrorFicha(error.message || 'No se pudo completar la acción'); return true; }
    setErrorFicha(null);
    return false;
  };

  const tomar = async (force) => {
    if (force && !window.confirm(`Está en tratativas con ${ownerNombre}. ¿Forzar la toma igual?`)) return;
    const { error } = await tomarOperador(operador.id, { usuario: myId, canal: canalToma, force });
    if (manejarError(error)) return;
    setColision(null);
    onPatch(operador.id, { en_tratativas: true, owner_user_id: myId, canal_activo: canalToma });
    recargarActividades();
  };

  const liberar = async () => {
    const { error } = await liberarOperador(operador.id, { usuario: myId });
    if (manejarError(error)) return;
    setColision(null);
    onPatch(operador.id, { en_tratativas: false, owner_user_id: null, canal_activo: null });
    recargarActividades();
  };

  const moverEtapa = async (nueva) => {
    if (!nueva || nueva === operador.etapa_prospeccion) return;
    const { error } = await setEtapaProspeccion(operador.id, nueva, { usuario: myId });
    if (manejarError(error)) return;
    onPatch(operador.id, { etapa_prospeccion: nueva });
    recargarActividades();
  };

  const guardarActividad = async () => {
    const texto = nuevaAct.texto.trim();
    if (!texto || guardando) return;
    setGuardando(true);
    const canal = (nuevaAct.tipo === 'reunion' || nuevaAct.tipo === 'nota') ? 'otro' : nuevaAct.tipo;
    const { error } = await registrarActividad({
      operadorId: operador.id, tipo: nuevaAct.tipo, canal, texto, usuario: myId,
    });
    setGuardando(false);
    if (manejarError(error)) return;   // colisión → banner y NO se guarda (el texto queda)
    setNuevaAct((a) => ({ ...a, texto: '' }));
    recargarActividades();
  };

  // Camino 1: promover al embudo (crea cliente + obra NUEVA — patrón Pipeline).
  const promover = async () => {
    if (promoviendo) return;
    if (!window.confirm('Crea cliente + oportunidad en el embudo comercial. ¿Dale?')) return;
    setPromoviendo(true);
    const r = await promoverAEmbudo(operador.id, { usuario: myId, addCliente, addObra });
    setPromoviendo(false);
    if (manejarError(r.error)) return;
    // La ficha 360 del cliente nuevo no nace vacía: dejamos rastro en
    // crm_actividades con el contexto del operador (patrón Pipeline.jsx).
    if (r.clienteId) {
      const banderas = (operador.banderas || []);
      addActividad({
        clienteId: r.clienteId,
        obraId: r.obraId || null,
        tipo: 'primer_contacto',
        texto: `Promovido desde campañas — ${operador.nombre || 'operador'} (${operador.n_estaciones ?? '?'} estaciones${banderas.length ? ', ' + banderas.join('/') : ''})`,
        usuario: myId,
      });
    }
    onPatch(operador.id, { etapa_prospeccion: 'promovido', cliente_id: r.clienteId || null, obra_id: r.obraId || null });
    setPromovidoOk(true);
    recargarActividades();
  };

  // Camino 2: vincular con una obra EXISTENTE (decisión de Franco: los dos
  // caminos conviven — promover crea obra nueva, vincular apunta a una que ya está).
  const obraVinculada = useMemo(
    () => (operador.obra_id ? (obras || []).find((o) => o.id === operador.obra_id) || null : null),
    [obras, operador.obra_id],
  );

  const obrasFiltradas = useMemo(() => {
    const q = normalizar(busqObra);
    const todas = obras || [];
    const rs = q ? todas.filter((o) => normalizar(o.nombre).includes(q)) : todas;
    return rs.slice(0, 8);
  }, [obras, busqObra]);

  const vincular = async (obra) => {
    if (guardandoVinculo) return;
    if (!window.confirm(`Vincula este operador con la obra "${obra.nombre}". ¿Dale?`)) return;
    if (typeof vincularObra !== 'function') {
      setErrorFicha('Vincular con obra no está disponible en esta versión.');
      return;
    }
    setGuardandoVinculo(true);
    const r = await vincularObra(operador.id, { obraId: obra.id, clienteId: obra.clienteId || null, usuario: myId });
    setGuardandoVinculo(false);
    if (manejarError(r?.error)) return;
    onPatch(operador.id, { obra_id: obra.id, cliente_id: obra.clienteId || null });
    setVinculando(false);
    setBusqObra('');
    recargarActividades();
  };

  // ── Sección "Datos": banderas + cuántas estaciones + rubro (pedido de Franco) ──

  const abrirEdicionDatos = () => {
    const n = operador.n_estaciones;
    setDraftDatos({
      banderas: [...(operador.banderas || [])],
      modoEst: n === 1 ? '1' : n > 1 ? 'varias' : null,   // null = sin dato
      nEstaciones: n ?? '',
      rubro: operador.rubro || 'estaciones',
    });
    setOtraBandera('');
  };

  const cerrarEdicionDatos = () => { setDraftDatos(null); setOtraBandera(''); };

  const toggleBandera = (b) => {
    setDraftDatos((d) => (d ? {
      ...d,
      banderas: d.banderas.includes(b) ? d.banderas.filter((x) => x !== b) : [...d.banderas, b],
    } : d));
  };

  // "otra…": si ya la conocemos (chip listado o ya prendida, aun con otra
  // grafía/tildes) prendemos la canónica en vez de duplicar.
  const agregarOtraBandera = () => {
    const b = otraBandera.trim();
    if (!b) return;
    setDraftDatos((d) => {
      if (!d) return d;
      const canonica = [...BANDERAS, ...d.banderas].find((x) => normalizar(x) === normalizar(b)) || b;
      return d.banderas.includes(canonica) ? d : { ...d, banderas: [...d.banderas, canonica] };
    });
    setOtraBandera('');
  };

  const elegirModoEst = (modo) => {
    setDraftDatos((d) => {
      if (!d) return d;
      if (modo === '1') return { ...d, modoEst: '1', nEstaciones: 1 };
      const n = Number(d.nEstaciones);
      return { ...d, modoEst: 'varias', nEstaciones: n > 1 ? d.nEstaciones : Math.max(2, estaciones.length) };
    });
  };

  const guardarDatos = async () => {
    if (!draftDatos || guardandoDatos) return;
    // n_estaciones exacto según el toggle; "Varias" con el input vacío/inválido = sin dato.
    let nEst = operador.n_estaciones ?? null;
    if (draftDatos.modoEst === '1') nEst = 1;
    else if (draftDatos.modoEst === 'varias') {
      const n = Math.round(Number(draftDatos.nEstaciones));
      nEst = Number.isFinite(n) && n >= 2 ? n : null;
    }
    // UN solo actualizarOperador con lo que realmente cambió.
    const antes = operador.banderas || [];
    const cambios = {};
    if (antes.length !== draftDatos.banderas.length || draftDatos.banderas.some((b) => !antes.includes(b))) {
      cambios.banderas = draftDatos.banderas;
      cambios.multibandera = draftDatos.banderas.length > 1;   // misma regla que importUnificado
    }
    if (nEst !== (operador.n_estaciones ?? null)) cambios.n_estaciones = nEst;
    if (draftDatos.rubro !== (operador.rubro || 'estaciones')) cambios.rubro = draftDatos.rubro;
    if (Object.keys(cambios).length === 0) { cerrarEdicionDatos(); return; }
    setGuardandoDatos(true);
    // P6: mismo contrato que el resto — colisión → banner y NO se guarda nada.
    const col = await chequearColision(operador.id, myId);
    if (col) { setGuardandoDatos(false); manejarError({ colision: col }); return; }
    const { error } = await actualizarOperador(operador.id, cambios);
    setGuardandoDatos(false);
    if (manejarError(error)) return;
    onPatch(operador.id, cambios);
    cerrarEdicionDatos();
  };

  // ── Alta de estación ("+ estación": Franco quiere agregarle bocas a un cliente) ──

  const abrirAltaEstacion = () => {
    setDraftEst({
      nombre: '',
      bandera: (operador.banderas || [])[0] || null,   // preseleccionada la primera del operador
      localidad: '', provincia: '', telefono: '',
    });
    setAvisoEst(null);
  };

  const cerrarAltaEstacion = () => { setDraftEst(null); setAvisoEst(null); };

  const guardarEstacion = async () => {
    if (!draftEst || guardandoEst) return;
    const nombre = draftEst.nombre.trim();
    if (!nombre) { setAvisoEst('Poné el nombre de la boca.'); return; }
    const data = { nombre };
    if (draftEst.bandera) data.bandera = draftEst.bandera;
    if (draftEst.localidad.trim()) data.localidad = draftEst.localidad.trim();
    if (draftEst.provincia.trim()) data.provincia = draftEst.provincia.trim();
    if (draftEst.telefono.trim()) data.telefono = draftEst.telefono.trim();
    setGuardandoEst(true);
    const r = await crearEstacion(operador.id, data, { usuario: myId });
    setGuardandoEst(false);
    if (r?.error?.colision) { manejarError(r.error); return; }   // P6 → banner existente
    if (r?.error) { setAvisoEst(r.error.message || 'No se pudo crear la boca.'); return; }  // dedup → warn inline

    // Creada: al tope de la lista local (sin re-fetch) + cerrar el form.
    if (r.data) {
      setFichaRaw((f) => (f && f.opId === operador.id ? { ...f, estaciones: [r.data, ...f.estaciones] } : f));
    }
    cerrarAltaEstacion();

    // Cambios al operador derivados del alta, en UN solo actualizarOperador
    // (+ onPatch con los mismos cambios para que el caller no re-fetchee):
    // · bandera que el operador NO tiene → confirm; si acepta se agrega (con
    //   multibandera recalculado); si cancela, la boca queda con esa bandera
    //   igual y el operador no cambia.
    // · n_estaciones numérico que quedó por DEBAJO de las cargadas → se corrige
    //   a las cargadas (la realidad de la ficha manda).
    // Sin re-chequeo de colisión: crearEstacion acaba de pasar el P6 recién.
    const cambiosOp = {};
    const b = draftEst.bandera;
    const banderasOp = operador.banderas || [];
    if (b && !banderasOp.includes(b)) {
      const nuevas = [...banderasOp, b];
      if (window.confirm(`¿Le agrego la bandera ${b} al operador? (se va a mudar a la sección ${nuevas.join('-')} del árbol)`)) {
        cambiosOp.banderas = nuevas;
        cambiosOp.multibandera = nuevas.length > 1;   // misma regla que importUnificado
      }
    }
    const cargadas = estaciones.length + 1;   // las de la ficha + la recién creada
    if (typeof operador.n_estaciones === 'number' && operador.n_estaciones < cargadas) {
      cambiosOp.n_estaciones = cargadas;
    }
    if (Object.keys(cambiosOp).length > 0) {
      const { error } = await actualizarOperador(operador.id, cambiosOp);
      if (!manejarError(error)) onPatch(operador.id, cambiosOp);
    }
    recargarActividades();
  };

  // ── Agendar seguimiento en Google Calendar (evento + alarma vía /api/campana/agendar) ──
  // Ampliación de Franco: "no solamente llamadas, pueden ser otros contactos"
  // → el form lleva selector de tipo (reusa TIPOS_ACTIVIDAD) y el título del
  // evento se arma según el tipo.

  const abrirAgenda = () => {
    setDraftAgenda({ tipo: 'llamada', fecha: fechaManana(), hora: '10:00', nota: '' });
    setAvisoAgenda(null);
  };

  const cerrarAgenda = () => setDraftAgenda(null);

  const guardarAgenda = async () => {
    if (!draftAgenda || guardandoAgenda) return;
    if (!draftAgenda.fecha || !draftAgenda.hora) {
      setAvisoAgenda({ tipo: 'warn', texto: 'Elegí fecha y hora para el seguimiento.' });
      return;
    }
    const cuando = new Date(`${draftAgenda.fecha}T${draftAgenda.hora}`);   // huso local
    if (Number.isNaN(cuando.getTime())) {
      setAvisoAgenda({ tipo: 'warn', texto: 'Fecha u hora inválida.' });
      return;
    }
    setGuardandoAgenda(true);
    const nota = draftAgenda.nota.trim();
    // Primer teléfono cargado entre las estaciones del operador (si hay).
    const conTel = estaciones.find((e) => e.telefono || e.telefono_norm);
    const tel = conTel ? (conTel.telefono || `+${conTel.telefono_norm}`) : '';
    const descripcion = [
      tel ? `Tel: ${tel}` : '',
      nota ? `Nota: ${nota}` : '',
      `Ficha: ${window.location.origin}/campanas?op=${operador.id}`,
    ].filter(Boolean).join('\n');
    const r = await agendarEnCalendario({
      titulo: tituloAgenda(draftAgenda.tipo, operador.nombre || 'operador'),
      descripcion,
      fechaHoraISO: cuando.toISOString(),
      operadorId: operador.id,
      canal: draftAgenda.tipo,
      usuario: myId,
    });
    setGuardandoAgenda(false);
    if (r?.error) {
      // Warn inline: el form queda abierto con lo tipeado para reintentar.
      setAvisoAgenda({ tipo: 'warn', texto: r.error.message || 'No se pudo agendar.' });
      return;
    }
    setDraftAgenda(null);
    if (r?.skipped) {
      setAvisoAgenda({ tipo: 'skip', texto: 'Calendario no configurado todavía.' });
      return;
    }
    setAvisoAgenda({ tipo: 'ok', htmlLink: r?.htmlLink || null });
    // El endpoint ya registró la actividad tipo 'agenda' → solo refrescamos.
    recargarActividades();
  };

  const razones = (operador.razones_sociales || []).join(' · ');
  const emails = operador.emails || [];
  const puedePromover = operador.etapa_prospeccion !== 'promovido' && operador.etapa_prospeccion !== 'descartado';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300 }}>
      {/* overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0, background: 'rgba(20,18,15,0.45)',
          opacity: abierto ? 1 : 0, transition: 'opacity 0.18s ease',
        }}
      />

      {/* panel lateral 480px / fullscreen */}
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0,
        width: esPanel ? 'min(480px, 94vw)' : '100%',
        background: T.paper,
        borderLeft: esPanel ? `1.5px solid ${T.ink}` : 'none',
        boxShadow: esPanel ? '-10px 0 30px rgba(20,18,15,0.16)' : 'none',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        transform: abierto ? 'translateX(0)' : 'translateX(28px)',
        opacity: abierto ? 1 : 0,
        transition: 'transform 0.18s ease, opacity 0.18s ease',
      }}>
        {/* Header oscuro (patrón Modal). Fullscreen: ← a la izquierda. */}
        <div style={{ padding: '16px 20px', background: T.dark, color: T.paper, display: 'flex', alignItems: 'flex-start', gap: 12, flexShrink: 0 }}>
          {!esPanel && (
            <button
              type="button" aria-label="Volver" onClick={onClose}
              onMouseEnter={hoverOn} onMouseLeave={hoverOff}
              style={{ ...headerBtnSt, fontSize: 22, marginTop: 4 }}
            >←</button>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 9, color: T.accent, fontFamily: T.fontMono, letterSpacing: 2, fontWeight: 700, marginBottom: 3 }}>
              FICHA DEL OPERADOR
            </div>
            <div style={{ fontWeight: 800, fontSize: 19, lineHeight: 1.25, overflowWrap: 'anywhere' }}>
              {operador.nombre || 'Operador'}
            </div>
            {razones && <div style={{ fontSize: 11.5, opacity: 0.65, marginTop: 3 }}>{razones}</div>}
          </div>
          {esPanel && (
            <button
              type="button" aria-label="Cerrar" onClick={onClose}
              onMouseEnter={hoverOn} onMouseLeave={hoverOff}
              style={{ ...headerBtnSt, fontSize: 20 }}
            >✕</button>
          )}
        </div>

        {/* Body scrolleable */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Chips: etapa + banderas + confianza + estaciones */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
            <PillEtapa etapa={operador.etapa_prospeccion} />
            {(operador.banderas || []).map((b) => <TagBandera key={b}>{b}</TagBandera>)}
            <PillConfianza confianza={operador.confianza} verificado={operador.verificado} />
            {operador.n_estaciones != null && (
              <span style={{ fontSize: 10.5, color: T.ink3, fontFamily: T.fontMono }}>
                {operador.n_estaciones} {operador.n_estaciones === 1 ? 'estación' : 'estaciones'}
              </span>
            )}
          </div>

          {/* Anti-colisión: banner si está tomado por otro (o rebotó una mutación) */}
          {(tomadoPorOtro || colision) && <BannerColision ownerNombre={ownerNombre} canal={canalTratativas} />}

          {/* Tratativas: tomar / liberar / forzar */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {!operador.en_tratativas && (
              <>
                <select value={canalToma} onChange={(e) => setCanalToma(e.target.value)} style={selSt}>
                  {CANALES.map((c) => <option key={c} value={c}>{ICONO_CANAL[c] || ''} {c}</option>)}
                </select>
                <Btn sm accent onClick={() => tomar(false)}>🔒 Tomar</Btn>
              </>
            )}
            {soyOwner && (
              <>
                <span style={{ fontSize: 12, color: T.ink2 }}>Lo tenés tomado vía <b>{operador.canal_activo || '—'}</b></span>
                <Btn sm onClick={liberar}>🔓 Liberar</Btn>
              </>
            )}
            {tomadoPorOtro && esAdmin && (
              <>
                <select value={canalToma} onChange={(e) => setCanalToma(e.target.value)} style={selSt}>
                  {CANALES.map((c) => <option key={c} value={c}>{ICONO_CANAL[c] || ''} {c}</option>)}
                </select>
                <Btn sm style={{ color: T.warn, borderColor: T.warn }} onClick={() => tomar(true)}>⚠ Forzar toma</Btn>
              </>
            )}
          </div>

          {errorFicha && <div style={{ fontSize: 12, color: '#b91c1c' }}>{errorFicha}</div>}

          {/* Contacto */}
          <Seccion titulo="Contacto">
            <div style={{ background: T.faint, borderRadius: 9, padding: '12px 14px', fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {operador.web && (
                <div>
                  <span style={{ color: T.ink3 }}>Web: </span>
                  <a href={urlAbs(operador.web)} target="_blank" rel="noreferrer" style={{ color: T.accent, fontWeight: 600 }}>{operador.web} ↗</a>
                </div>
              )}
              {emails.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: T.ink3 }}>Emails:</span>
                  {emails.map((e) => (
                    <a key={e} href={`mailto:${e}`} style={{ color: T.accent, fontFamily: T.fontMono, fontSize: 11.5 }}>{e}</a>
                  ))}
                </div>
              )}
              {operador.notas && <div style={{ color: T.ink2, fontStyle: 'italic' }}>“{operador.notas}”</div>}
              {!operador.web && emails.length === 0 && !operador.notas && <div style={vacioSt}>Sin datos de contacto cargados.</div>}
            </div>
          </Seccion>

          {/* Etapa + promover al embudo (camino: crear obra nueva) */}
          <Seccion titulo="Etapa">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                value={operador.etapa_prospeccion || 'sin_contactar'}
                onChange={(e) => moverEtapa(e.target.value)}
                style={selSt}
              >
                {ETAPAS_PROSPECCION.map((et) => <option key={et} value={et}>{ETAPA_PROSPECCION_META[et].label}</option>)}
              </select>
              {puedePromover && (
                <Btn sm fill onClick={promover} disabled={promoviendo} style={{ opacity: promoviendo ? 0.5 : 1 }}>
                  ▶ Promover al embudo
                </Btn>
              )}
              {/* El embudo es solo-Admin: el link solo se le muestra a Admin */}
              {!puedePromover && operador.etapa_prospeccion === 'promovido' && esAdmin && !promovidoOk && (
                <LinkAccion onClick={() => navigate('/comercial')}>Ver en el embudo →</LinkAccion>
              )}
            </div>
            {promovidoOk && (
              <div style={{
                background: '#e8f2ea', border: `1.5px solid ${T.ok}`, borderRadius: 9,
                padding: '10px 14px', fontSize: 12.5, color: T.ok, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10,
              }}>
                ✓ Cliente y oportunidad creados en el embudo comercial.
                {esAdmin && (
                  <LinkAccion onClick={() => navigate('/comercial')} style={{ textDecoration: 'underline' }}>
                    Ver en el embudo →
                  </LinkAccion>
                )}
              </div>
            )}
          </Seccion>

          {/* Obra (camino: vincular con una obra EXISTENTE). P11: solo nombres. */}
          <Seccion titulo="Obra">
            {operador.obra_id ? (
              <div style={{ background: T.faint, borderRadius: 9, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 15, flexShrink: 0 }}>🏗️</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.ink, flex: 1, minWidth: 120 }}>
                  {obraVinculada?.nombre || 'Obra vinculada'}
                  {obraVinculada?.cliente && <span style={{ fontWeight: 400, color: T.ink2 }}> · {obraVinculada.cliente}</span>}
                </span>
                {/* Obras es solo-Admin para navegar: los demás ven el nombre y listo */}
                {esAdmin && obraVinculada && (
                  <LinkAccion onClick={() => navigate(`/obras?q=${encodeURIComponent(obraVinculada.nombre)}`)}>
                    Abrir obra →
                  </LinkAccion>
                )}
              </div>
            ) : !vinculando ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Btn sm onClick={() => setVinculando(true)}>🔗 Vincular con obra</Btn>
                <span style={{ fontSize: 11, color: T.ink3 }}>Apunta a una obra que ya existe (sin crear nada).</span>
              </div>
            ) : (
              <div style={{ border: `1px solid ${T.faint2}`, borderRadius: 9, background: '#fff', overflow: 'hidden' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 12px', borderBottom: `1px solid ${T.faint2}` }}>
                  <input
                    autoFocus
                    value={busqObra}
                    onChange={(e) => setBusqObra(e.target.value)}
                    placeholder="⌕ Buscar obra por nombre…"
                    style={{ ...inputSt, flex: 1, minWidth: 0, border: 'none', padding: '2px 0', borderRadius: 0 }}
                  />
                  <LinkAccion onClick={() => { setVinculando(false); setBusqObra(''); }} style={{ color: T.ink3 }}>
                    Cancelar
                  </LinkAccion>
                </div>
                {obrasFiltradas.length === 0 && (
                  <div style={{ ...vacioSt, padding: '12px 14px' }}>Sin obras que coincidan.</div>
                )}
                {obrasFiltradas.map((o) => (
                  <div
                    key={o.id}
                    onClick={() => vincular(o)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = T.faint; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    style={{
                      padding: '9px 14px', borderBottom: `1px solid ${T.faint}`, cursor: 'pointer',
                      opacity: guardandoVinculo ? 0.5 : 1, transition: 'background 0.12s ease',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{o.nombre}</span>
                    {o.cliente && <span style={{ fontSize: 11, color: T.ink2 }}> · {o.cliente}</span>}
                  </div>
                ))}
              </div>
            )}
          </Seccion>

          {/* Datos del operador: banderas + cuántas estaciones + rubro. Lectura
              por defecto; "✎ Editar" abre los controles (pedido de Franco). */}
          <Seccion
            titulo="Datos"
            extra={!draftDatos && <LinkAccion onClick={abrirEdicionDatos}>✎ Editar</LinkAccion>}
          >
            {!draftDatos ? (
              <div style={{ background: T.faint, borderRadius: 9, padding: '12px 14px', fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <span style={{ color: T.ink3 }}>Banderas:</span>
                  {(operador.banderas || []).length > 0
                    ? (operador.banderas || []).map((b) => <TagBandera key={b}>{b}</TagBandera>)
                    : <span style={vacioSt}>sin bandera</span>}
                </div>
                <div>
                  <span style={{ color: T.ink3 }}>Estaciones: </span>
                  <span style={{ fontFamily: T.fontMono, fontSize: 12, fontWeight: 600 }}>{operador.n_estaciones ?? '—'}</span>
                  {!cargando && estaciones.length > 0 && estaciones.length !== operador.n_estaciones && (
                    <span style={{ fontSize: 11, color: T.ink3 }}> · cargadas: {estaciones.length}</span>
                  )}
                </div>
                <div>
                  <span style={{ color: T.ink3 }}>Rubro: </span>
                  <span style={{ fontWeight: 600 }}>{rubroLabel(operador.rubro || 'estaciones')}</span>
                </div>
              </div>
            ) : (
              <div style={{ border: `1px solid ${T.faint2}`, borderRadius: 9, background: '#fff', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Banderas: chips de TODAS las conocidas + las custom del draft */}
                <div>
                  <div style={etiquetaCampoSt}>Banderas</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {[...BANDERAS, ...draftDatos.banderas.filter((b) => !BANDERAS.includes(b))].map((b) => (
                      <ChipToggle key={b} activo={draftDatos.banderas.includes(b)} onClick={() => toggleBandera(b)}>
                        {b}
                      </ChipToggle>
                    ))}
                    <input
                      value={otraBandera}
                      onChange={(e) => setOtraBandera(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') agregarOtraBandera(); }}
                      placeholder="otra…"
                      style={{ ...inputSt, padding: '4px 11px', fontSize: 11, width: 84, borderRadius: 999 }}
                    />
                    {otraBandera.trim() && (
                      <LinkAccion onClick={agregarOtraBandera} style={{ fontSize: 11 }}>+ agregar</LinkAccion>
                    )}
                  </div>
                  {draftDatos.banderas.length === 0 && (
                    <div style={{ fontSize: 11, color: T.warn, marginTop: 6 }}>
                      Sin banderas: va a aparecer en “Sin bandera” en el explorador.
                    </div>
                  )}
                </div>
                {/* Estaciones: 1 / Varias (+ número exacto) */}
                <div>
                  <div style={etiquetaCampoSt}>Estaciones</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <ChipToggle activo={draftDatos.modoEst === '1'} onClick={() => elegirModoEst('1')}>1</ChipToggle>
                    <ChipToggle activo={draftDatos.modoEst === 'varias'} onClick={() => elegirModoEst('varias')}>Varias</ChipToggle>
                    {draftDatos.modoEst === 'varias' && (
                      <input
                        type="number" min={2}
                        value={draftDatos.nEstaciones}
                        onChange={(e) => setDraftDatos((d) => (d ? { ...d, nEstaciones: e.target.value } : d))}
                        style={{ ...inputSt, padding: '4px 10px', fontSize: 12, width: 64, fontFamily: T.fontMono }}
                      />
                    )}
                    {!cargando && estaciones.length > 0 && estaciones.length !== Number(draftDatos.nEstaciones) && (
                      <span style={{ fontSize: 11, color: T.ink3 }}>cargadas: {estaciones.length}</span>
                    )}
                  </div>
                </div>
                {/* Rubro */}
                <div>
                  <div style={etiquetaCampoSt}>Rubro</div>
                  <select
                    value={draftDatos.rubro}
                    onChange={(e) => setDraftDatos((d) => (d ? { ...d, rubro: e.target.value } : d))}
                    style={selSt}
                  >
                    {RUBROS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Btn sm accent onClick={guardarDatos} disabled={guardandoDatos} style={{ opacity: guardandoDatos ? 0.5 : 1 }}>
                    Guardar
                  </Btn>
                  <Btn sm onClick={cerrarEdicionDatos} disabled={guardandoDatos}>Cancelar</Btn>
                </div>
              </div>
            )}
          </Seccion>

          {cargando && <div style={{ ...vacioSt, padding: '10px 0' }}>Cargando ficha…</div>}

          {/* Estaciones del operador */}
          {!cargando && (
            <Seccion
              titulo={`Estaciones (${estaciones.length})`}
              extra={!draftEst && <LinkAccion onClick={abrirAltaEstacion}>+ estación</LinkAccion>}
            >
              {draftEst && (
                <div
                  // Escape cierra SOLO el form (stopPropagation frena el
                  // listener de document que cierra la ficha entera).
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); cerrarAltaEstacion(); } }}
                  style={{
                    border: `1px solid ${T.faint2}`, borderRadius: 9, background: '#fff',
                    padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 10,
                  }}
                >
                  <div>
                    <div style={etiquetaCampoSt}>Nombre *</div>
                    <input
                      autoFocus
                      value={draftEst.nombre}
                      onChange={(e) => setDraftEst((d) => (d ? { ...d, nombre: e.target.value } : d))}
                      onKeyDown={(e) => { if (e.key === 'Enter') guardarEstacion(); }}
                      placeholder="Estación / boca…"
                      style={{ ...inputSt, width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>
                  {/* Bandera: chips de las conocidas + las custom del operador */}
                  <div>
                    <div style={etiquetaCampoSt}>Bandera</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {[...BANDERAS, ...(operador.banderas || []).filter((b) => !BANDERAS.includes(b))].map((b) => (
                        <ChipToggle
                          key={b}
                          activo={draftEst.bandera === b}
                          onClick={() => setDraftEst((d) => (d ? { ...d, bandera: d.bandera === b ? null : b } : d))}
                        >
                          {b}
                        </ChipToggle>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={etiquetaCampoSt}>Localidad</div>
                      <input
                        value={draftEst.localidad}
                        onChange={(e) => setDraftEst((d) => (d ? { ...d, localidad: e.target.value } : d))}
                        onKeyDown={(e) => { if (e.key === 'Enter') guardarEstacion(); }}
                        style={{ ...inputSt, padding: '6px 10px', fontSize: 12, width: '100%', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={etiquetaCampoSt}>Provincia</div>
                      <input
                        value={draftEst.provincia}
                        onChange={(e) => setDraftEst((d) => (d ? { ...d, provincia: e.target.value } : d))}
                        onKeyDown={(e) => { if (e.key === 'Enter') guardarEstacion(); }}
                        style={{ ...inputSt, padding: '6px 10px', fontSize: 12, width: '100%', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>
                  <div>
                    <div style={etiquetaCampoSt}>Teléfono</div>
                    <input
                      value={draftEst.telefono}
                      onChange={(e) => setDraftEst((d) => (d ? { ...d, telefono: e.target.value } : d))}
                      onKeyDown={(e) => { if (e.key === 'Enter') guardarEstacion(); }}
                      placeholder="011 4444-5555 (opcional)"
                      style={{ ...inputSt, padding: '6px 10px', fontSize: 12, fontFamily: T.fontMono, width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>
                  {avisoEst && <div style={{ fontSize: 11, color: T.warn }}>{avisoEst}</div>}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Btn sm accent onClick={guardarEstacion} disabled={guardandoEst} style={{ opacity: guardandoEst ? 0.5 : 1 }}>
                      Guardar
                    </Btn>
                    <Btn sm onClick={cerrarAltaEstacion} disabled={guardandoEst}>Cancelar</Btn>
                  </div>
                </div>
              )}
              {estaciones.length === 0 && !draftEst && <div style={vacioSt}>Sin estaciones cargadas.</div>}
              <div style={{ display: 'grid', gridTemplateColumns: esPanel ? 'repeat(auto-fill, minmax(200px, 1fr))' : '1fr', gap: 10 }}>
                {estaciones.map((est) => (
                  <div key={est.id} style={{ background: '#fff', border: `1px solid ${T.faint2}`, borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, minWidth: 0 }}>{est.nombre || 'Estación'}</div>
                      {est.bandera && <TagBandera>{est.bandera}</TagBandera>}
                    </div>
                    <div style={{ fontSize: 11, color: T.ink2, marginTop: 2 }}>
                      {[est.localidad, est.provincia].filter(Boolean).join(', ') || '—'}
                    </div>
                    {est.telefono && (
                      <div style={{ fontFamily: T.fontMono, fontSize: 11.5, color: T.ink, marginTop: 5 }}>📞 {est.telefono}</div>
                    )}
                    <div style={{ marginTop: 8 }}><PillEstado estado={est.estado_llamada} /></div>
                    {est.estado_original && (
                      <div style={{ fontSize: 10.5, color: T.ink3, fontStyle: 'italic', marginTop: 6 }}>
                        Caro anotó: “{est.estado_original}”
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Seccion>
          )}

          {/* Decisores */}
          {!cargando && (
            <Seccion titulo={`Decisores (${decisores.length})`}>
              {decisores.length === 0 && <div style={vacioSt}>Sin decisores identificados.</div>}
              {decisores.map((d) => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 2px', borderBottom: `1px solid ${T.faint2}`, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{d.nombre || '—'}</span>
                    {d.cargo && <span style={{ fontSize: 11, color: T.ink2 }}> · {d.cargo}</span>}
                    <div style={{ fontSize: 11, display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 3 }}>
                      {d.linkedin_url && (
                        <a href={urlAbs(d.linkedin_url)} target="_blank" rel="noreferrer" style={{ color: '#41698c', fontWeight: 700, textDecoration: 'none' }}>
                          💼 LinkedIn ↗
                        </a>
                      )}
                      {d.email && (
                        <a href={`mailto:${d.email}`} style={{ color: T.accent, fontFamily: T.fontMono, fontSize: 10.5 }}>{d.email}</a>
                      )}
                    </div>
                  </div>
                  <PillConfianza confianza={d.confianza} verificado={d.verificado} />
                </div>
              ))}
            </Seccion>
          )}

          {/* Actividad: agendar seguimiento (Calendar) + registrar + timeline (últimas 100) */}
          {!cargando && (
            <Seccion
              titulo={`Actividad (${acts.length})`}
              extra={!draftAgenda && <LinkAccion onClick={abrirAgenda}>📅 Agendar seguimiento</LinkAccion>}
            >
              {draftAgenda && (
                <div
                  // Escape cierra SOLO el form (stopPropagation frena el
                  // listener de document que cierra la ficha entera).
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); cerrarAgenda(); } }}
                  style={{
                    border: `1px solid ${T.faint2}`, borderRadius: 9, background: '#fff',
                    padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 10,
                  }}
                >
                  <div>
                    <div style={etiquetaCampoSt}>Tipo</div>
                    <select
                      value={draftAgenda.tipo}
                      onChange={(e) => setDraftAgenda((d) => (d ? { ...d, tipo: e.target.value } : d))}
                      style={selSt}
                    >
                      {TIPOS_ACTIVIDAD.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  {/* Fecha + hora concretas (inputs nativos = mobile-friendly). */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={etiquetaCampoSt}>Fecha</div>
                      <input
                        type="date"
                        value={draftAgenda.fecha}
                        onChange={(e) => setDraftAgenda((d) => (d ? { ...d, fecha: e.target.value } : d))}
                        style={{ ...inputSt, padding: '6px 10px', fontSize: 12, fontFamily: T.fontMono, width: '100%', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div style={{ width: 108, flexShrink: 0 }}>
                      <div style={etiquetaCampoSt}>Hora</div>
                      <input
                        type="time"
                        value={draftAgenda.hora}
                        onChange={(e) => setDraftAgenda((d) => (d ? { ...d, hora: e.target.value } : d))}
                        style={{ ...inputSt, padding: '6px 10px', fontSize: 12, fontFamily: T.fontMono, width: '100%', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>
                  <div>
                    <div style={etiquetaCampoSt}>Nota</div>
                    <input
                      value={draftAgenda.nota}
                      onChange={(e) => setDraftAgenda((d) => (d ? { ...d, nota: e.target.value } : d))}
                      onKeyDown={(e) => { if (e.key === 'Enter') guardarAgenda(); }}
                      placeholder="pedir por Juan… (opcional)"
                      style={{ ...inputSt, width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ fontSize: 11, color: T.ink3 }}>
                    Crea el evento con alarma en tu Google Calendar y queda en el timeline.
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Btn sm accent onClick={guardarAgenda} disabled={guardandoAgenda} style={{ opacity: guardandoAgenda ? 0.5 : 1 }}>
                      {guardandoAgenda ? 'Agendando…' : '📅 Agendar'}
                    </Btn>
                    <Btn sm onClick={cerrarAgenda} disabled={guardandoAgenda}>Cancelar</Btn>
                  </div>
                </div>
              )}
              {avisoAgenda && (
                <div style={{
                  borderRadius: 9, padding: '10px 14px', fontSize: 12.5, fontWeight: 600, marginBottom: 10,
                  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                  ...(avisoAgenda.tipo === 'ok'
                    ? { background: '#e8f2ea', border: `1.5px solid ${T.ok}`, color: T.ok }
                    : avisoAgenda.tipo === 'skip'
                      ? { background: T.faint, border: `1px solid ${T.faint2}`, color: T.ink3 }
                      : { background: '#fdf3e4', border: `1.5px solid ${T.warn}`, color: T.ink }),
                }}>
                  {avisoAgenda.tipo === 'ok' ? (
                    <>
                      📅 Agendado
                      {avisoAgenda.htmlLink && (
                        <a href={avisoAgenda.htmlLink} target="_blank" rel="noreferrer" style={{ color: T.ok, fontWeight: 700 }}>
                          ver evento ↗
                        </a>
                      )}
                    </>
                  ) : avisoAgenda.tipo === 'skip' ? (
                    `📅 ${avisoAgenda.texto}`
                  ) : (
                    `⚠️ ${avisoAgenda.texto}`
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <select value={nuevaAct.tipo} onChange={(e) => setNuevaAct((a) => ({ ...a, tipo: e.target.value }))} style={selSt}>
                  {TIPOS_ACTIVIDAD.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <input
                  value={nuevaAct.texto}
                  onChange={(e) => setNuevaAct((a) => ({ ...a, texto: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') guardarActividad(); }}
                  placeholder="Registrar actividad…"
                  style={{ ...inputSt, flex: 1, minWidth: 0 }}
                />
                <Btn sm accent onClick={guardarActividad} disabled={guardando} style={{ opacity: guardando ? 0.5 : 1 }}>Guardar</Btn>
              </div>
              {acts.length === 0 && <div style={vacioSt}>Sin actividad registrada.</div>}
              {acts.map((a) => (
                <div key={a.id} style={{ display: 'flex', gap: 12, padding: '9px 2px', borderBottom: `1px solid ${T.faint2}` }}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>{iconoActividad(a)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: T.ink, overflowWrap: 'anywhere' }}>{a.texto || a.resultado || a.tipo}</div>
                    <div style={{ fontSize: 10.5, color: T.ink3, fontFamily: T.fontMono, marginTop: 2 }}>
                      {tiempoRelativo(a.fecha)} · {nombreUsuario(a.usuario)}
                    </div>
                  </div>
                </div>
              ))}
            </Seccion>
          )}
        </div>
      </div>
    </div>
  );
}
