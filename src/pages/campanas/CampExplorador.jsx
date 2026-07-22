import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import PageLayout from '../../components/layout/PageLayout';
import { Btn } from '../../components/ui';
import { T } from '../../theme';
import { useUsuarios } from '../../store/UsuariosContext';
import { useCampanas } from '../../store/CampanasContext';
import { supabase } from '../../lib/supabase';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { fmtN } from '../../lib/format';
import { ETAPA_PROSPECCION_META } from '../../lib/campanas/constants';
import FichaOperador from './FichaOperador';
import ColaLlamadas from './ColaLlamadas';
import RitmoCampana from './RitmoCampana';

// ─────────────────────────────────────────────────────────────────────────────
// EXPLORADOR JERÁRQUICO — LA pantalla del módulo Campañas (pivot de UX,
// decisión de Franco 2026-07-22): UNA página con el árbol
//   ⛽ Estaciones de servicio → Bandera → Operadores
// con los KPIs pegados a cada nivel. La ficha del operador abre en panel
// lateral (mobile: fullscreen), la cola de llamadas de Caro es una vista del
// mismo explorador y el "Ritmo de la campaña" vive en un panel colapsable.
// Datos: fetchResumenArbol() (un RPC, cero filas) para todos los counts del
// árbol + fetchOperadores() paginado (30 por rama) recién al expandir.
// P11: acá JAMÁS se muestran montos de obras — solo nombres.
// ─────────────────────────────────────────────────────────────────────────────

const PAGE = 30;

// Chips de filtro global de etapa (sin 'descartado': esas quedan bajo "Todas").
const CHIPS_ETAPA = [
  ['', 'Todas'],
  ['sin_contactar', 'Sin contactar'],
  ['contactado', 'Contactadas'],
  ['respondio', 'Respondieron'],
  ['en_conversacion', 'En conversación'],
  ['reunion', 'Reunión'],
  ['promovido', 'Promovidas'],
];

// ── Helpers puros ────────────────────────────────────────────────────────────

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

const pctResp = (respondieron, total) => (total > 0 ? Math.round((respondieron / total) * 100) : 0);

// ── Piezas chicas de presentación ────────────────────────────────────────────

// Número + label chiquito del mini-cluster de KPIs de cada rama.
function ParKpi({ v, l, color }) {
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <span style={{ fontFamily: T.fontMono, fontWeight: 700, fontSize: 12, color: color || T.ink }}>{v}</span>
      <span style={{ fontSize: 10, color: T.ink3 }}> {l}</span>
    </span>
  );
}

const SepKpi = () => <span style={{ color: T.ink3, opacity: 0.45, fontSize: 10 }}>·</span>;

// Mini-cluster "1.890 op · 12% resp · 2 reun · 1 obra" (derecha de cada rama).
// Con filtro de etapa activo, el primer par muestra "X de Y op" (X sale de
// por_etapa del resumen — sin refetch). Mobile: solo op + % resp.
function MiniKpis({ total, respondieron, reuniones, obras, porEtapa, etapaFiltro, isMobile }) {
  const opTxt = etapaFiltro
    ? `${fmtN(porEtapa?.[etapaFiltro] || 0)} de ${fmtN(total)}`
    : fmtN(total);
  return (
    <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'baseline', flexShrink: 0 }}>
      <ParKpi v={opTxt} l="op" />
      <SepKpi />
      <ParKpi v={`${pctResp(respondieron, total)}%`} l="resp" color={T.accent} />
      {!isMobile && (
        <>
          <SepKpi />
          <ParKpi v={fmtN(reuniones)} l="reun" color={T.accent2} />
          <SepKpi />
          <ParKpi v={fmtN(obras)} l={obras === 1 ? 'obra' : 'obras'} color={T.ok} />
        </>
      )}
    </span>
  );
}

// Chevron que rota al expandir (0.15s).
function Chevron({ abierto, dim }) {
  return (
    <span style={{
      width: 16, textAlign: 'center', fontSize: 11, color: dim ? T.faint2 : T.ink3, flexShrink: 0,
      display: 'inline-block', transform: abierto ? 'rotate(90deg)' : 'none',
      transition: 'transform 0.15s ease',
    }}>▸</span>
  );
}

// Contenedor de expansión animada (grid-template-rows 0fr → 1fr).
function Expandible({ abierto, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateRows: abierto ? '1fr' : '0fr', transition: 'grid-template-rows 0.25s ease' }}>
      <div style={{ overflow: 'hidden', minHeight: 0 }}>{children}</div>
    </div>
  );
}

// Fila skeleton con pulso sutil (para ramas cargando).
function FilaSkeleton({ alto, ancho }) {
  return (
    <div style={{ height: alto, display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${T.faint}` }}>
      <span className="ce-skel" style={{ width: 9, height: 9, borderRadius: '50%', background: T.faint2, flexShrink: 0 }} />
      <span className="ce-skel" style={{ height: 10, borderRadius: 4, background: T.faint2, width: `${ancho}%` }} />
      <span className="ce-skel" style={{ height: 8, borderRadius: 4, background: T.faint, width: 44, marginLeft: 'auto' }} />
    </div>
  );
}

function SkeletonRamas({ alto }) {
  return (
    <div>
      {[52, 38, 61, 44, 30].map((w, i) => <FilaSkeleton key={i} alto={alto} ancho={w} />)}
    </div>
  );
}

// Fila de OPERADOR: semáforo de etapa (LA señal dominante) + nombre + chips
// discretos + "hace 3 d". El "→" aparece solo al hover (CSS .ce-fila).
function FilaOperador({ op, isMobile, conBandera, myId, nombreUsuario, onClick }) {
  const meta = ETAPA_PROSPECCION_META[op.etapa_prospeccion] || { label: op.etapa_prospeccion || '—', color: T.ink3 };
  const ajeno = !!(op.en_tratativas && op.owner_user_id && op.owner_user_id !== myId);
  return (
    <div
      className="ce-fila"
      onClick={onClick}
      style={{
        height: isMobile ? 52 : 44, display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 8px 0 2px', cursor: 'pointer', borderBottom: `1px solid ${T.faint}`,
        borderRadius: 6, transition: 'background 0.15s ease',
      }}
    >
      <span
        title={meta.label}
        style={{ width: 9, height: 9, borderRadius: '50%', background: meta.color, flexShrink: 0 }}
      />
      <span style={{
        fontSize: 13.5, fontWeight: 600, color: T.ink, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {op.nombre || '—'}
      </span>
      {conBandera && (op.banderas || []).length > 0 && (
        <span style={{
          fontSize: 9.5, fontWeight: 700, border: `1px solid ${T.faint2}`, borderRadius: 999,
          padding: '2px 8px', background: T.faint, color: T.ink2, whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {op.banderas[0]}{op.banderas.length > 1 ? ` +${op.banderas.length - 1}` : ''}
        </span>
      )}
      {!isMobile && op.n_estaciones != null && (
        <span style={{ fontSize: 10.5, color: T.ink3, fontFamily: T.fontMono, whiteSpace: 'nowrap', flexShrink: 0 }}>
          {op.n_estaciones} est.
        </span>
      )}
      {ajeno && (
        <span
          title={`En tratativas con ${nombreUsuario(op.owner_user_id)}${op.canal_activo ? ` vía ${op.canal_activo}` : ''}`}
          style={{ fontSize: 12, flexShrink: 0, cursor: 'help' }}
        >🔒</span>
      )}
      {op.obra_id && <span title="Con obra vinculada" style={{ fontSize: 12, flexShrink: 0 }}>🔗</span>}
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: T.ink3, fontFamily: T.fontMono, whiteSpace: 'nowrap' }}>
          {tiempoRelativo(op.updated_at)}
        </span>
        <span className="ce-arrow" style={{ color: T.accent, fontWeight: 700, fontSize: 13 }}>→</span>
      </span>
    </div>
  );
}

// Botón de acción de la cabecera (pill, con estado activo para los toggles).
function BotonAccion({ activo, onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="ce-accion"
      style={{
        border: `1.5px solid ${activo ? T.ink : T.faint2}`,
        background: activo ? T.ink : 'transparent',
        color: activo ? T.paper : T.ink2,
        borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 700,
        fontFamily: T.font, cursor: 'pointer', whiteSpace: 'nowrap',
        transition: 'background 0.18s ease, color 0.18s ease, border-color 0.18s ease, transform 0.12s ease',
      }}
    >
      {children}
    </button>
  );
}

// Chip del filtro global de etapa (color del semáforo de esa etapa).
function ChipEtapa({ valor, label, activo, onClick }) {
  const color = valor ? (ETAPA_PROSPECCION_META[valor]?.color || T.ink2) : T.ink2;
  return (
    <button
      type="button"
      onClick={onClick}
      className="ce-accion"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        border: `1.5px solid ${activo ? color : T.faint2}`,
        background: activo ? `${color}1c` : 'transparent',
        color: activo ? T.ink : T.ink2,
        borderRadius: 999, padding: '5px 12px', fontSize: 11.5, fontWeight: 700,
        fontFamily: T.font, cursor: 'pointer', whiteSpace: 'nowrap',
        transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.12s ease',
      }}
    >
      {valor !== '' && (
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, opacity: activo ? 1 : 0.55, flexShrink: 0 }} />
      )}
      {label}
    </button>
  );
}

// Tira de KPIs globales: números grandes, labels chiquitos, separadores sutiles
// — sin cajas. Mobile: grilla de 3 columnas (2 filas).
function TiraKpis({ global, isMobile }) {
  const items = [
    { label: 'Operadores', v: global.total, color: T.ink },
    { label: 'Respondieron', v: global.respondieron, color: T.accent },
    { label: 'Reuniones ⭐', v: global.reuniones, color: T.accent2 },
    { label: 'Leads 🔥', v: global.leads_calientes, color: '#c2410c' },
    { label: 'Obras', v: global.obras_vinculadas, color: T.ok },
  ];
  if (isMobile) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px 10px' }}>
        {items.map((k) => (
          <div key={k.label}>
            <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 22, lineHeight: 1.1, color: k.color }}>{fmtN(k.v)}</div>
            <div style={{ fontSize: 10, color: T.ink3, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, marginTop: 3, whiteSpace: 'nowrap' }}>{k.label}</div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
      {items.map((k, i) => (
        <div key={k.label} style={{ paddingRight: 26, marginRight: 26, borderRight: i < items.length - 1 ? `1px solid ${T.faint2}` : 'none' }}>
          <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 28, lineHeight: 1.05, color: k.color }}>{fmtN(k.v)}</div>
          <div style={{ fontSize: 10, color: T.ink3, textTransform: 'uppercase', letterSpacing: 1.2, fontWeight: 700, marginTop: 4, whiteSpace: 'nowrap' }}>{k.label}</div>
        </div>
      ))}
    </div>
  );
}

function TiraKpisSkeleton({ isMobile }) {
  return (
    <div style={{ display: 'flex', gap: 26 }}>
      {Array.from({ length: isMobile ? 3 : 5 }).map((_, i) => (
        <div key={i}>
          <div className="ce-skel" style={{ width: 64, height: 26, borderRadius: 6, background: T.faint2 }} />
          <div className="ce-skel" style={{ width: 48, height: 8, borderRadius: 4, background: T.faint, marginTop: 7 }} />
        </div>
      ))}
    </div>
  );
}

// Link de acción discreto (reintentos, cargar más).
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

// ── Página ───────────────────────────────────────────────────────────────────

export default function CampExplorador() {
  const { currentUser, usuarios } = useUsuarios();
  const { fetchResumenArbol, fetchOperadores } = useCampanas();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // Guard: solo Admin o usuarios con el permiso `campanas` (patrón Pipeline.jsx).
  const puede = currentUser?.rol === 'Admin' || !!currentUser?.permisos?.campanas;
  useEffect(() => { if (currentUser && !puede) navigate('/', { replace: true }); }, [currentUser, puede, navigate]);

  const myId = currentUser?.id || null;

  // ── Resumen del árbol (RPC: global + banderas, cero filas) ────────────────
  const [resumen, setResumen] = useState(null); // { data, error }
  const [resumenTick, setResumenTick] = useState(0);
  useEffect(() => {
    if (!puede) return undefined;
    let vivo = true;
    fetchResumenArbol().then(({ data, error }) => {
      if (vivo) setResumen({ data, error });
    });
    return () => { vivo = false; };
  }, [puede, fetchResumenArbol, resumenTick]);

  const reintentarResumen = () => {
    setResumen(null);
    setResumenTick((t) => t + 1);
  };

  // ── Estado del árbol ──────────────────────────────────────────────────────
  const [raizAbierta, setRaizAbierta] = useState(true);
  const [abiertas, setAbiertas] = useState(() => new Set()); // banderas expandidas
  const [etapaFiltro, setEtapaFiltro] = useState('');
  // bandera → { clave (etapa del fetch), rows, total, page, error, cargandoMas }
  const [ramas, setRamas] = useState({});
  const seqRef = useRef(0);
  const pedidosRef = useRef({}); // bandera → token del último pedido en vuelo

  const cargarRama = useCallback((bandera, etapa, { append = false, page = 1 } = {}) => {
    const clave = etapa || '';
    const token = ++seqRef.current;
    pedidosRef.current[bandera] = token;
    fetchOperadores({
      page, pageSize: PAGE,
      filtros: { bandera, ...(etapa ? { etapa } : {}) },
      orden: 'etapa',
    })
      .then(({ rows, total, error }) => {
        if (pedidosRef.current[bandera] !== token) return; // respuesta vieja
        setRamas((prev) => {
          const previa = prev[bandera];
          const base = append && previa && previa.clave === clave ? previa.rows : [];
          if (error) {
            return {
              ...prev,
              [bandera]: {
                clave, page: previa?.clave === clave ? previa.page : 1,
                rows: previa?.clave === clave ? previa.rows : [],
                total: previa?.clave === clave ? previa.total : 0,
                error, cargandoMas: false,
              },
            };
          }
          return { ...prev, [bandera]: { clave, page, rows: [...base, ...(rows || [])], total, error: null, cargandoMas: false } };
        });
      })
      .catch((e) => {
        if (pedidosRef.current[bandera] !== token) return;
        setRamas((prev) => ({
          ...prev,
          [bandera]: {
            clave, page: 1,
            rows: prev[bandera]?.clave === clave ? prev[bandera].rows : [],
            total: prev[bandera]?.clave === clave ? prev[bandera].total : 0,
            error: { message: e?.message || 'Error de red' }, cargandoMas: false,
          },
        }));
      });
  }, [fetchOperadores]);

  const toggleRama = (bandera) => {
    const abriendo = !abiertas.has(bandera);
    setAbiertas((prev) => {
      const next = new Set(prev);
      if (next.has(bandera)) next.delete(bandera); else next.add(bandera);
      return next;
    });
    const r = ramas[bandera];
    if (abriendo && (!r || r.clave !== (etapaFiltro || '') || r.error)) cargarRama(bandera, etapaFiltro);
  };

  const elegirEtapa = (etapa) => {
    if (etapa === etapaFiltro) return;
    setEtapaFiltro(etapa);
    // Las ramas abiertas refetchean con el filtro nuevo (mientras llega, el
    // mismatch de clave las muestra con skeleton — derivado, sin flags).
    abiertas.forEach((bandera) => cargarRama(bandera, etapa));
  };

  const cargarMas = (bandera) => {
    const r = ramas[bandera];
    if (!r || r.cargandoMas) return;
    setRamas((prev) => ({ ...prev, [bandera]: { ...prev[bandera], cargandoMas: true } }));
    cargarRama(bandera, etapaFiltro, { append: true, page: (r.page || 1) + 1 });
  };

  // ── Búsqueda global (debounce 300ms; ≥2 chars → resultados planos) ────────
  const [busquedaInput, setBusquedaInput] = useState('');
  const [busqueda, setBusqueda] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(busquedaInput.trim()), 300);
    return () => clearTimeout(t);
  }, [busquedaInput]);

  const modoBusqueda = busqueda.length >= 2;
  const claveBusqueda = `${busqueda}|${etapaFiltro}`;
  const [busqRes, setBusqRes] = useState(null); // { clave, rows, total, page, error, cargandoMas }
  const [busqTick, setBusqTick] = useState(0);  // bump → re-dispara la búsqueda (Reintentar)
  useEffect(() => {
    if (!puede || busqueda.length < 2) return undefined;
    const clave = `${busqueda}|${etapaFiltro}`;
    let vivo = true;
    fetchOperadores({
      page: 1, pageSize: PAGE,
      filtros: { busqueda, ...(etapaFiltro ? { etapa: etapaFiltro } : {}) },
      orden: 'etapa',
    })
      .then(({ rows, total, error }) => {
        if (vivo) setBusqRes({ clave, rows: rows || [], total, error: error || null, page: 1, cargandoMas: false });
      })
      .catch((e) => {
        if (vivo) setBusqRes({ clave, rows: [], total: 0, error: { message: e?.message || 'Error de red' }, page: 1, cargandoMas: false });
      });
    return () => { vivo = false; };
  }, [puede, busqueda, etapaFiltro, fetchOperadores, busqTick]);

  const busqCargando = modoBusqueda && (!busqRes || busqRes.clave !== claveBusqueda);

  const reintentarBusqueda = () => {
    setBusqRes(null);
    setBusqTick((t) => t + 1);
  };

  const cargarMasBusqueda = () => {
    if (!busqRes || busqCargando || busqRes.cargandoMas) return;
    const clave = busqRes.clave;
    const page = (busqRes.page || 1) + 1;
    setBusqRes((r) => ({ ...r, cargandoMas: true }));
    fetchOperadores({
      page, pageSize: PAGE,
      filtros: { busqueda, ...(etapaFiltro ? { etapa: etapaFiltro } : {}) },
      orden: 'etapa',
    }).then(({ rows, total, error }) => {
      setBusqRes((r) => (r && r.clave === clave
        ? {
            ...r, cargandoMas: false,
            page: error ? r.page : page,
            rows: error ? r.rows : [...r.rows, ...(rows || [])],
            total: error ? r.total : total,
          }
        : r));
    });
  };

  // ── Vistas: árbol ↔ cola de llamadas · Ritmo colapsable ───────────────────
  const [vista, setVista] = useState('arbol'); // 'arbol' | 'llamadas'
  const [ritmoAbierto, setRitmoAbierto] = useState(false);
  const [ritmoMontado, setRitmoMontado] = useState(false); // monta el panel recién al 1er open

  const toggleRitmo = () => {
    if (!ritmoMontado) setRitmoMontado(true);
    setRitmoAbierto((v) => !v);
  };

  const escribirBusqueda = (v) => {
    setBusquedaInput(v);
    // Buscar desde la vista llamadas te devuelve al árbol (donde viven los resultados).
    if (vista === 'llamadas' && v.trim().length >= 2) setVista('arbol');
  };

  // ── Ficha del operador (panel lateral / fullscreen) + deep link ?op= ──────
  const [sel, setSel] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const opParam = searchParams.get('op');
  const opAbiertoRef = useRef(null); // último ?op= ya resuelto (evita reabrir)

  useEffect(() => {
    if (!opParam) { opAbiertoRef.current = null; return undefined; }
    if (!puede || opAbiertoRef.current === opParam) return undefined;
    opAbiertoRef.current = opParam;
    let vivo = true;
    // Lectura directa mínima por id (fetchOperadores no filtra por id — mismo
    // patrón de CampContactos). Id inexistente → silencio.
    supabase.from('camp_operadores').select('*').eq('id', opParam).maybeSingle()
      .then(({ data }) => { if (vivo && data) setSel(data); });
    return () => { vivo = false; };
  }, [puede, opParam]);

  const cerrarFicha = useCallback(() => {
    setSel(null);
    opAbiertoRef.current = null;
    setSearchParams((prev) => {
      if (!prev.has('op')) return prev;
      const next = new URLSearchParams(prev);
      next.delete('op');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // "Ver ficha" desde la cola de llamadas: primero memoria, sino lectura por id.
  const verFichaDesdeCola = (operadorId) => {
    if (!operadorId) return;
    const enRamas = Object.values(ramas).flatMap((r) => r.rows || []).find((x) => x.id === operadorId);
    const local = enRamas || (busqRes?.rows || []).find((x) => x.id === operadorId);
    if (local) { setSel(local); return; }
    supabase.from('camp_operadores').select('*').eq('id', operadorId).maybeSingle()
      .then(({ data }) => { if (data) setSel(data); });
  };

  // Sincroniza mutaciones de la ficha con las filas en memoria (sin refetch).
  const patchOperador = useCallback((id, cambios) => {
    setSel((s) => (s && s.id === id ? { ...s, ...cambios } : s));
    setRamas((prev) => {
      let cambio = false;
      const next = {};
      for (const [b, r] of Object.entries(prev)) {
        if ((r.rows || []).some((x) => x.id === id)) {
          cambio = true;
          next[b] = { ...r, rows: r.rows.map((x) => (x.id === id ? { ...x, ...cambios } : x)) };
        } else next[b] = r;
      }
      return cambio ? next : prev;
    });
    setBusqRes((r) => ((r?.rows || []).some((x) => x.id === id)
      ? { ...r, rows: r.rows.map((x) => (x.id === id ? { ...x, ...cambios } : x)) }
      : r));
  }, []);

  const nombreUsuario = useCallback((id) => {
    if (!id) return '—';
    return (usuarios || []).find((u) => u.id === id)?.nombre
      || (id === 'bot' ? 'Bot' : id === 'sistema' ? 'Sistema' : id);
  }, [usuarios]);

  // ── Derivados de render ───────────────────────────────────────────────────
  const global = resumen?.data?.global || null;
  const banderas = resumen?.data?.banderas || [];
  const resumenCargando = !resumen;
  const resumenError = resumen?.error || null;
  const arbolVacio = !!resumen?.data && (!global || !global.total) && banderas.length === 0;
  const banderaUnica = abiertas.size === 1 ? [...abiertas][0] : null;
  const claveRama = etapaFiltro || '';
  const altoFila = isMobile ? 52 : 44;

  const limpiarBusquedaUI = () => { setBusquedaInput(''); setBusqueda(''); };

  // ── Sub-render: una rama de bandera con sus operadores ────────────────────
  const renderRama = (b) => {
    const abierta = abiertas.has(b.bandera);
    const rama = ramas[b.bandera];
    const ramaVigente = rama && rama.clave === claveRama;
    // "Cargando" DERIVADO del mismatch de clave (sin flags en effects): recién
    // abierta sin datos, o refetch en vuelo por cambio de filtro de etapa.
    const cargandoRama = abierta && !ramaVigente;
    const conFiltroVacia = ramaVigente && !rama.error && rama.rows.length === 0;
    return (
      <div key={b.bandera}>
        <div
          className="ce-fila"
          onClick={() => toggleRama(b.bandera)}
          style={{
            height: isMobile ? 52 : 50, display: 'flex', alignItems: 'center', gap: 8,
            cursor: 'pointer', borderBottom: `1px solid ${T.faint2}`, borderRadius: 6,
            padding: '0 8px 0 0', transition: 'background 0.15s ease',
          }}
        >
          <Chevron abierto={abierta} />
          <span style={{
            fontSize: 14, fontWeight: 700, color: T.ink, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {b.bandera}
          </span>
          <MiniKpis
            total={b.total} respondieron={b.respondieron} reuniones={b.reuniones}
            obras={b.obras} porEtapa={b.por_etapa} etapaFiltro={etapaFiltro} isMobile={isMobile}
          />
        </div>
        <Expandible abierto={abierta}>
          {(rama || abierta) && (
            <div style={{ marginLeft: 8, borderLeft: `1px solid ${T.faint2}`, paddingLeft: 14, paddingTop: 2, paddingBottom: abierta ? 6 : 0 }}>
              {cargandoRama && (
                <div>
                  {[58, 42, 66, 35].map((w, i) => <FilaSkeleton key={i} alto={altoFila} ancho={w} />)}
                </div>
              )}
              {!cargandoRama && ramaVigente && rama.error && (
                <div style={{ padding: '12px 4px', fontSize: 12, color: T.ink2 }}>
                  Se nos cayó la carga de {b.bandera}{rama.error.message ? ` (${rama.error.message})` : ''}.{' '}
                  <LinkAccion onClick={() => cargarRama(b.bandera, etapaFiltro)}>Reintentar</LinkAccion>
                </div>
              )}
              {!cargandoRama && conFiltroVacia && (
                <div style={{ padding: '12px 4px', fontSize: 12, color: T.ink3 }}>
                  {etapaFiltro ? 'Ningún operador en esta etapa.' : 'Sin operadores cargados en esta bandera.'}
                </div>
              )}
              {!cargandoRama && ramaVigente && !rama.error && rama.rows.map((op) => (
                <FilaOperador
                  key={op.id} op={op} isMobile={isMobile} myId={myId}
                  nombreUsuario={nombreUsuario} onClick={() => setSel(op)}
                />
              ))}
              {!cargandoRama && ramaVigente && !rama.error && rama.total > rama.rows.length && (
                <div style={{ padding: '10px 4px' }}>
                  <LinkAccion onClick={() => cargarMas(b.bandera)} style={{ color: rama.cargandoMas ? T.ink3 : T.accent }}>
                    {rama.cargandoMas ? 'Cargando…' : `Cargar más (quedan ${fmtN(rama.total - rama.rows.length)})`}
                  </LinkAccion>
                </div>
              )}
            </div>
          )}
        </Expandible>
      </div>
    );
  };

  // ── Sub-render: área central según vista ──────────────────────────────────
  let areaCentral;
  if (vista === 'llamadas') {
    areaCentral = (
      <div key="llamadas" style={{ animation: 'ceIn 0.22s ease', maxWidth: 560, margin: '0 auto' }}>
        <ColaLlamadas compacto onVerFicha={verFichaDesdeCola} filtroBandera={banderaUnica} />
      </div>
    );
  } else if (modoBusqueda) {
    areaCentral = (
      <div key="busqueda" style={{ animation: 'ceIn 0.22s ease' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '0 0 8px', borderBottom: `1px solid ${T.faint2}` }}>
          <span style={{ fontSize: 12.5, color: T.ink2 }}>
            Resultados para <b style={{ color: T.ink }}>“{busqueda}”</b>
          </span>
          {!busqCargando && !busqRes?.error && (
            <span style={{ fontSize: 11, color: T.ink3, fontFamily: T.fontMono }}>{fmtN(busqRes?.total || 0)}</span>
          )}
          <LinkAccion onClick={limpiarBusquedaUI} style={{ marginLeft: 'auto', color: T.ink3 }}>✕ Limpiar</LinkAccion>
        </div>
        {busqCargando && (
          <div>
            {[55, 40, 63, 34].map((w, i) => <FilaSkeleton key={i} alto={altoFila} ancho={w} />)}
          </div>
        )}
        {!busqCargando && busqRes?.error && (
          <div style={{ padding: '16px 4px', fontSize: 12.5, color: T.ink2 }}>
            No pudimos buscar{busqRes.error.message ? ` (${busqRes.error.message})` : ''}.{' '}
            <LinkAccion onClick={reintentarBusqueda}>Reintentar</LinkAccion>
          </div>
        )}
        {!busqCargando && !busqRes?.error && busqRes?.rows.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 16px', color: T.ink3 }}>
            <div style={{ fontSize: 26, marginBottom: 6 }}>🔍</div>
            <div style={{ fontSize: 13, color: T.ink2 }}>Nada que coincida con “{busqueda}”.</div>
          </div>
        )}
        {!busqCargando && !busqRes?.error && busqRes?.rows.map((op) => (
          <FilaOperador
            key={op.id} op={op} isMobile={isMobile} myId={myId} conBandera
            nombreUsuario={nombreUsuario} onClick={() => setSel(op)}
          />
        ))}
        {!busqCargando && !busqRes?.error && busqRes && busqRes.total > busqRes.rows.length && (
          <div style={{ padding: '10px 4px' }}>
            <LinkAccion onClick={cargarMasBusqueda} style={{ color: busqRes.cargandoMas ? T.ink3 : T.accent }}>
              {busqRes.cargandoMas ? 'Cargando…' : `Cargar más (quedan ${fmtN(busqRes.total - busqRes.rows.length)})`}
            </LinkAccion>
          </div>
        )}
      </div>
    );
  } else {
    areaCentral = (
      <div key="arbol" style={{ animation: 'ceIn 0.22s ease' }}>
        {resumenCargando && <SkeletonRamas alto={50} />}
        {resumenError && (
          <div style={{ textAlign: 'center', padding: '44px 16px' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🤦</div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>No pudimos armar el árbol</div>
            <div style={{ fontSize: 12, color: T.ink3, marginTop: 4, marginBottom: 14 }}>{resumenError.message || 'Error inesperado'}</div>
            <Btn sm accent onClick={reintentarResumen}>↻ Reintentar</Btn>
          </div>
        )}
        {!resumenCargando && !resumenError && arbolVacio && (
          <div style={{ textAlign: 'center', padding: '52px 16px', color: T.ink3 }}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>⛽</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>Todavía no hay operadores cargados</div>
            <div style={{ fontSize: 12.5, color: T.ink2, marginTop: 6 }}>
              Importá tu base desde{' '}
              <Link to="/campanas/importar" style={{ color: T.accent, fontWeight: 700 }}>Campañas → Importar</Link>
              {' '}y el árbol se arma solo.
            </div>
          </div>
        )}
        {!resumenCargando && !resumenError && !arbolVacio && global && (
          <div>
            {/* Nodo raíz: ⛽ Estaciones de servicio (expandido por defecto) */}
            <div
              className="ce-fila"
              onClick={() => setRaizAbierta((v) => !v)}
              style={{
                height: 52, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                borderBottom: `1px solid ${T.faint2}`, borderRadius: 6, padding: '0 8px 0 0',
                transition: 'background 0.15s ease',
              }}
            >
              <Chevron abierto={raizAbierta} />
              <span style={{ fontSize: 15, flexShrink: 0 }}>⛽</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                Estaciones de servicio
              </span>
              <MiniKpis
                total={global.total} respondieron={global.respondieron} reuniones={global.reuniones}
                obras={global.obras_vinculadas} porEtapa={global.por_etapa} etapaFiltro={etapaFiltro} isMobile={isMobile}
              />
            </div>
            <Expandible abierto={raizAbierta}>
              <div style={{ marginLeft: 8, borderLeft: `1px solid ${T.faint2}`, paddingLeft: 14 }}>
                {banderas.map(renderRama)}
              </div>
            </Expandible>

            {/* Rubro futuro (deshabilitado): la campaña a franquicias */}
            <div style={{
              height: 52, display: 'flex', alignItems: 'center', gap: 8,
              padding: '0 8px 0 0', borderBottom: `1px solid ${T.faint2}`, opacity: 0.55, cursor: 'default',
            }}>
              <Chevron abierto={false} dim />
              <span style={{ fontSize: 15, flexShrink: 0, filter: 'grayscale(1)' }}>🍔</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: T.ink3 }}>Franquicias</span>
              <span style={{ fontSize: 10.5, color: T.ink3, fontStyle: 'italic', marginLeft: 6 }}>próximamente</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <PageLayout breadcrumb={[{ label: 'Inicio', to: '/' }, 'Campañas']} active="Campañas">
      {/* Columna centrada con AIRE. Con la ficha abierta en desktop, el árbol
          se comprime a la izquierda (padding-right animado) mientras el panel
          entra por la derecha. */}
      <div style={{
        maxWidth: 1100, margin: '0 auto', padding: isMobile ? '4px 2px 32px' : '8px 6px 48px',
        transition: 'padding-right 0.25s ease',
        paddingRight: sel && !isMobile ? 'min(340px, 30vw)' : undefined,
      }}>
        {/* ── Cabecera compacta: título chico + acciones ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: T.ink, margin: 0, letterSpacing: 0.2 }}>Campañas</h1>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ position: 'relative', flex: isMobile ? '1 1 100%' : '0 1 240px', minWidth: 170, order: isMobile ? 2 : 0 }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, opacity: 0.5, pointerEvents: 'none' }}>🔎</span>
              <input
                value={busquedaInput}
                onChange={(e) => escribirBusqueda(e.target.value)}
                placeholder="Buscar operador…"
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '8px 30px 8px 32px',
                  borderRadius: 999, border: `1.5px solid ${T.faint2}`, fontSize: 12.5,
                  fontFamily: T.font, color: T.ink, background: '#fff', outline: 'none',
                  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = T.accent;
                  e.currentTarget.style.boxShadow = `0 0 0 3px ${T.accentSoft}`;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = T.faint2;
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
              {busquedaInput && (
                <span
                  onClick={limpiarBusquedaUI}
                  style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: T.ink3, cursor: 'pointer' }}
                >✕</span>
              )}
            </span>
            <BotonAccion
              activo={vista === 'llamadas'}
              onClick={() => setVista((v) => (v === 'llamadas' ? 'arbol' : 'llamadas'))}
              title="Cola de llamadas del día"
            >☎ Llamadas</BotonAccion>
            <BotonAccion activo={ritmoAbierto} onClick={toggleRitmo} title="Ritmo de la campaña por semana">
              📈 Ritmo
            </BotonAccion>
            <BotonAccion onClick={() => navigate('/campanas/importar')} title="Importar planilla / export de LinkedIn">
              ⬇ Importar
            </BotonAccion>
          </div>
        </div>

        {/* ── Tira de KPIs globales ── */}
        <div style={{ marginTop: isMobile ? 18 : 22 }}>
          {resumenCargando && <TiraKpisSkeleton isMobile={isMobile} />}
          {!resumenCargando && !resumenError && global && <TiraKpis global={global} isMobile={isMobile} />}
        </div>

        {/* ── Ritmo (colapsable, cerrado por defecto: la pantalla arranca limpia) ── */}
        <Expandible abierto={ritmoAbierto}>
          {ritmoMontado && <div style={{ paddingTop: 16 }}><RitmoCampana /></div>}
        </Expandible>

        {/* ── Filtro global de etapa (solo aplica al árbol / búsqueda) ── */}
        {vista === 'arbol' && !arbolVacio && !resumenError && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: isMobile ? 16 : 22, marginBottom: 4 }}>
            {CHIPS_ETAPA.map(([valor, label]) => (
              <ChipEtapa
                key={valor || 'todas'} valor={valor} label={label}
                activo={etapaFiltro === valor} onClick={() => elegirEtapa(valor)}
              />
            ))}
          </div>
        )}

        {/* ── Área central: árbol / resultados / cola de llamadas ── */}
        <div style={{ marginTop: 12 }}>
          {areaCentral}
        </div>
      </div>

      {/* Ficha del operador — componente existente, montado tal cual */}
      {sel && (
        <FichaOperador
          operador={sel}
          onClose={cerrarFicha}
          onPatch={patchOperador}
          vista={isMobile ? 'fullscreen' : 'panel'}
        />
      )}

      <style>{`
        @keyframes ceIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes cePulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 0.28; } }
        .ce-skel { animation: cePulse 1.3s ease-in-out infinite; }
        .ce-fila:hover { background: rgba(234, 230, 218, 0.55); }
        .ce-fila .ce-arrow { opacity: 0; transform: translateX(-4px); transition: opacity 0.15s ease, transform 0.15s ease; }
        .ce-fila:hover .ce-arrow { opacity: 1; transform: none; }
        .ce-accion:hover { transform: translateY(-1px); }
      `}</style>
    </PageLayout>
  );
}
