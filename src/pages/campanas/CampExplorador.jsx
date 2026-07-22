import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import PageLayout from '../../components/layout/PageLayout';
import { Btn } from '../../components/ui';
import { T } from '../../theme';
import { useUsuarios } from '../../store/UsuariosContext';
import { useCampanas, SIN_BANDERA } from '../../store/CampanasContext';
import { supabase } from '../../lib/supabase';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { fmtN } from '../../lib/format';
import { ETAPA_PROSPECCION_META } from '../../lib/campanas/constants';
import FichaOperador from './FichaOperador';
import ColaLlamadas from './ColaLlamadas';
import RitmoCampana from './RitmoCampana';
import VistaCampanas from './VistaCampanas';

// ─────────────────────────────────────────────────────────────────────────────
// EXPLORADOR JERÁRQUICO — LA pantalla del módulo Campañas (pivot de UX,
// decisión de Franco 2026-07-22): UNA página con el árbol
//   Rubro (⛽ Estaciones / 🏪 Franquicias / …) → Sección → Operadores
// con los KPIs pegados a cada nivel. SECCIÓN = combinación canónica de
// banderas del operador (RPC 0009): las multibandera ("YPF-SHELL-AXION") son
// una sección propia — el segmento premium — con chip "multi". Los rubros y
// las secciones se administran desde acá (⚙, solo Admin) contra la config
// compartida de shared_data ('campanas_config'): ocultar/agregar secciones y
// rubros sin tocar datos. La ficha del operador abre en panel lateral
// (mobile: fullscreen), la cola de llamadas de Caro es una vista del mismo
// explorador y el "Ritmo de la campaña" vive en un panel colapsable.
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

// Orden canónico de banderas (espejo del v_orden del RPC 0009): para nombrar
// secciones nuevas igual que las nombraría la DB cuando tengan operadores.
const BANDERAS_CANONICAS = [
  'YPF', 'Shell', 'Axion', 'Puma', 'ACA', 'Gulf', 'Refinor',
  'Voy con Energía', 'Dapsa', 'Wico', 'Rhasa', 'Líder Oil',
];

// Config del explorador (shared_data 'campanas_config') cuando nunca se guardó.
const DEFAULT_CONFIG = {
  rubros: [
    { key: 'estaciones', nombre: 'Estaciones de servicio', emoji: '⛽' },
    { key: 'franquicias', nombre: 'Franquicias', emoji: '🏪' },
  ],
};

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

const capitalizar = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// key de una rama del árbol (sección dentro de un rubro) para ramas/abiertas.
const ramaKey = (rubroKey, seccion) => `${rubroKey}::${seccion}`;

const posCanonica = (b) => {
  const i = BANDERAS_CANONICAS.findIndex((c) => c.toUpperCase() === String(b).toUpperCase());
  return i === -1 ? 999 : i;
};

const ordenarBanderas = (arr) => [...arr].sort((a, b) =>
  posCanonica(a) - posCanonica(b) || String(a).toUpperCase().localeCompare(String(b).toUpperCase()));

const nombreSeccion = (banderas) => banderas.map((b) => String(b).toUpperCase()).join('-');

const slugRubro = (nombre) => String(nombre || '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// Normaliza la config guardada al shape de trabajo:
//   { rubros: [{ key, nombre, emoji, oculto, seccionesOcultas, seccionesExtra }] }
// Compat: el comentario del context (pre-0009) documentaba banderasOcultas /
// banderasExtra como string[] — se leen ambos nombres (una bandera suelta se
// traduce a su sección de una bandera) y SIEMPRE se guarda el shape nuevo.
const normalizarConfig = (raw) => {
  const rubros = Array.isArray(raw?.rubros) && raw.rubros.length ? raw.rubros : DEFAULT_CONFIG.rubros;
  return {
    rubros: rubros.filter((r) => r && r.key).map((r) => ({
      key: String(r.key),
      nombre: r.nombre || capitalizar(String(r.key)),
      emoji: r.emoji || '📁',
      oculto: !!r.oculto,
      seccionesOcultas: (r.seccionesOcultas || r.banderasOcultas || []).filter(Boolean),
      seccionesExtra: (r.seccionesExtra
        || (r.banderasExtra || []).map((b) => (typeof b === 'string' ? { seccion: b.toUpperCase(), banderas: [b] } : b)))
        .filter((x) => x && x.seccion),
    })),
  };
};

// Merge RPC + config → árbol renderizable. La config manda nombre/emoji/orden/
// oculto; los rubros con datos que no están en la config se muestran igual (al
// final, con nombre derivado). Secciones = las del RPC menos las ocultas, más
// las extra (con 0 operadores — sirven para crear operadores ahí).
const armarArbol = (rpcRubros, config) => {
  const cfg = config || normalizarConfig(null);
  const datosPorKey = new Map((rpcRubros || []).map((r) => [r.rubro, r]));
  const armarRubro = (c, datos) => {
    const ocultas = new Set(c.seccionesOcultas || []);
    const nombresRpc = new Set((datos?.secciones || []).map((s) => s.seccion));
    const secciones = [
      ...(datos?.secciones || []).filter((s) => !ocultas.has(s.seccion)),
      ...(c.seccionesExtra || [])
        .filter((x) => !nombresRpc.has(x.seccion) && !ocultas.has(x.seccion))
        .map((x) => ({
          seccion: x.seccion, banderas: x.banderas || [], multibandera: (x.banderas || []).length > 1,
          total: 0, por_etapa: {}, respondieron: 0, reuniones: 0, obras: 0, extra: true,
        })),
    ];
    return {
      key: c.key, nombre: c.nombre || c.key, emoji: c.emoji || '📁', oculto: !!c.oculto,
      total: datos?.total || 0, por_etapa: datos?.por_etapa || {},
      respondieron: datos?.respondieron || 0, reuniones: datos?.reuniones || 0, obras: datos?.obras || 0,
      secciones, nOcultas: (c.seccionesOcultas || []).length,
    };
  };
  const out = cfg.rubros.map((c) => armarRubro(c, datosPorKey.get(c.key)));
  const enConfig = new Set(cfg.rubros.map((c) => c.key));
  for (const r of rpcRubros || []) {
    if (!enConfig.has(r.rubro)) out.push(armarRubro({ key: r.rubro, nombre: capitalizar(r.rubro), emoji: '📁' }, r));
  }
  return out;
};

// Banderas candidatas para armar una sección nueva en un rubro: las canónicas
// (solo estaciones) + todas las que ya aparecen en sus secciones.
const candidatasDe = (r) => {
  const out = [];
  const push = (b) => { if (b && !out.some((x) => x.toUpperCase() === String(b).toUpperCase())) out.push(b); };
  if (r.key === 'estaciones') BANDERAS_CANONICAS.forEach(push);
  r.secciones.forEach((s) => (s.banderas || []).forEach(push));
  return ordenarBanderas(out);
};

// ── Piezas chicas de presentación ────────────────────────────────────────────

const INPUT_MINI = {
  padding: '6px 10px', borderRadius: 8, border: `1.5px solid ${T.faint2}`,
  fontSize: 12, fontFamily: T.font, color: T.ink, background: '#fff', outline: 'none',
};

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

// Chip sobrio de sección multibandera (borde, sin relleno): el segmento
// premium — operadores con varias banderas a la vez.
function ChipMulti() {
  return (
    <span
      title="Sección multibandera — operadores con varias banderas"
      style={{
        fontSize: 9, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase',
        border: `1px solid ${T.ink3}`, borderRadius: 999, padding: '1px 7px',
        color: T.ink2, flexShrink: 0, whiteSpace: 'nowrap',
      }}
    >multi</span>
  );
}

// "✕ ocultar" del modo administración (secciones y rubros).
function BtnOcultar({ onClick, title }) {
  return (
    <span
      onClick={onClick}
      title={title}
      style={{
        fontSize: 10, fontWeight: 700, color: T.ink3, border: `1px solid ${T.faint2}`,
        borderRadius: 999, padding: '2px 8px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
      }}
    >✕ ocultar</span>
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

// Fila fantasma "+ operador" al pie de la lista de una sección: click → input
// de nombre + toggle [1|Varias] (n_estaciones). Enter guarda, Escape cancela.
function FilaNuevoOperador({ alto, onCrear }) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState('');
  const [varias, setVarias] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const cancelar = () => { setEditando(false); setNombre(''); setVarias(false); };

  const guardar = async () => {
    const n = nombre.trim();
    if (!n || guardando) return;
    setGuardando(true);
    const { error } = await onCrear(n, varias ? null : 1);
    setGuardando(false);
    if (error) {
      window.alert(`No se pudo crear el operador${error.message ? ` (${error.message})` : ''}.`);
      return;
    }
    cancelar();
  };

  if (!editando) {
    return (
      <div
        className="ce-fila"
        onClick={() => setEditando(true)}
        style={{
          height: alto - 8, display: 'flex', alignItems: 'center', gap: 10,
          padding: '0 8px 0 2px', cursor: 'pointer', borderRadius: 6, color: T.ink3,
          transition: 'background 0.15s ease',
        }}
      >
        <span style={{ width: 9, textAlign: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>+</span>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>operador</span>
      </div>
    );
  }
  return (
    <div style={{ height: alto, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 0 2px' }}>
      <input
        autoFocus
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') guardar();
          if (e.key === 'Escape') cancelar();
        }}
        placeholder="Nombre del operador…"
        disabled={guardando}
        style={{ ...INPUT_MINI, flex: 1, minWidth: 0, borderColor: T.accent }}
      />
      <span style={{ display: 'inline-flex', border: `1.5px solid ${T.faint2}`, borderRadius: 999, overflow: 'hidden', flexShrink: 0 }}>
        {[[false, '1'], [true, 'Varias']].map(([v, l]) => (
          <button
            key={l}
            type="button"
            onClick={() => setVarias(v)}
            title="¿Cuántas estaciones tiene?"
            style={{
              border: 'none', padding: '5px 10px', fontSize: 11, fontWeight: 700, fontFamily: T.font,
              cursor: 'pointer', background: varias === v ? T.ink : 'transparent',
              color: varias === v ? T.paper : T.ink3,
            }}
          >{l}</button>
        ))}
      </span>
      <LinkAccion onClick={guardar} style={{ color: guardando || !nombre.trim() ? T.ink3 : T.accent }}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </LinkAccion>
      {!guardando && <LinkAccion onClick={cancelar} style={{ color: T.ink3 }}>✕</LinkAccion>}
    </div>
  );
}

// Alta de sección (modo admin): chips de banderas conocidas + campo libre para
// una nueva. El nombre se arma igual que en el RPC (orden canónico, MAYÚSCULAS).
function FormNuevaSeccion({ candidatas, onCrear, onCancelar }) {
  const [sel, setSel] = useState([]);
  const [texto, setTexto] = useState('');

  const toggle = (b) => setSel((prev) => (prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]));

  const agregarTexto = () => {
    const b = texto.trim();
    if (!b) return false;
    setSel((prev) => (prev.some((x) => x.toUpperCase() === b.toUpperCase()) ? prev : [...prev, b]));
    setTexto('');
    return true;
  };

  const crear = () => {
    const pendiente = texto.trim();
    const todas = pendiente && !sel.some((x) => x.toUpperCase() === pendiente.toUpperCase())
      ? [...sel, pendiente] : sel;
    if (todas.length) onCrear(todas);
  };

  const opciones = [...candidatas];
  sel.forEach((b) => { if (!opciones.some((x) => x.toUpperCase() === b.toUpperCase())) opciones.push(b); });

  return (
    <div style={{
      border: `1px dashed ${T.faint2}`, borderRadius: 10, padding: '10px 12px',
      margin: '4px 0 8px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0,
    }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {opciones.map((b) => {
          const activa = sel.includes(b);
          return (
            <button
              key={b}
              type="button"
              onClick={() => toggle(b)}
              style={{
                border: `1.5px solid ${activa ? T.ink : T.faint2}`,
                background: activa ? T.ink : 'transparent',
                color: activa ? T.paper : T.ink2,
                borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 700,
                fontFamily: T.font, cursor: 'pointer',
              }}
            >{b}</button>
          );
        })}
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !agregarTexto()) crear();
            if (e.key === 'Escape') onCancelar();
          }}
          placeholder="otra bandera…"
          style={{
            width: 110, padding: '4px 10px', borderRadius: 999, border: `1.5px dashed ${T.faint2}`,
            fontSize: 11, fontFamily: T.font, color: T.ink, background: 'transparent', outline: 'none',
          }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
        <span style={{
          fontSize: 10.5, color: T.ink3, fontFamily: T.fontMono, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {sel.length ? `→ ${nombreSeccion(ordenarBanderas(sel))}` : 'Elegí una o más banderas'}
        </span>
        <LinkAccion onClick={crear} style={{ marginLeft: 'auto', color: sel.length || texto.trim() ? T.accent : T.ink3 }}>
          Crear sección
        </LinkAccion>
        <LinkAccion onClick={onCancelar} style={{ color: T.ink3 }}>✕</LinkAccion>
      </div>
    </div>
  );
}

// Alta de rubro (modo admin): emoji + nombre. Enter guarda, Escape cancela.
function FormNuevoRubro({ onCrear, onCancelar }) {
  const [nombre, setNombre] = useState('');
  const [emoji, setEmoji] = useState('');
  const crear = () => { if (nombre.trim()) onCrear(nombre.trim(), emoji.trim()); };
  const teclas = (e) => {
    if (e.key === 'Enter') crear();
    if (e.key === 'Escape') onCancelar();
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <input
        value={emoji} onChange={(e) => setEmoji(e.target.value)} onKeyDown={teclas}
        placeholder="🏪" maxLength={4}
        style={{ ...INPUT_MINI, width: 36, textAlign: 'center', padding: '6px 4px' }}
      />
      <input
        autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} onKeyDown={teclas}
        placeholder="Nombre del rubro…"
        style={{ ...INPUT_MINI, width: 180 }}
      />
      <LinkAccion onClick={crear} style={{ color: nombre.trim() ? T.accent : T.ink3 }}>Guardar</LinkAccion>
      <LinkAccion onClick={onCancelar} style={{ color: T.ink3 }}>✕</LinkAccion>
    </span>
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
  const {
    fetchResumenArbol, fetchOperadores, fetchConfigExplorador, guardarConfigExplorador, crearOperador,
  } = useCampanas();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // Guard: solo Admin o usuarios con el permiso `campanas` (patrón Pipeline.jsx).
  const puede = currentUser?.rol === 'Admin' || !!currentUser?.permisos?.campanas;
  useEffect(() => { if (currentUser && !puede) navigate('/', { replace: true }); }, [currentUser, puede, navigate]);

  const myId = currentUser?.id || null;
  const esAdmin = currentUser?.rol === 'Admin';

  // ── Resumen del árbol (RPC: global + rubros → secciones, cero filas) ──────
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

  // Refetch silencioso (tras crear un operador): pisa los counts sin volver a
  // los skeletons — el árbol queda en pantalla con los números frescos.
  const refrescarResumen = useCallback(() => {
    fetchResumenArbol().then(({ data, error }) => {
      if (!error && data) setResumen({ data, error: null });
    });
  }, [fetchResumenArbol]);

  // ── Config compartida del explorador (shared_data 'campanas_config') ──────
  // Se carga junto al resumen; null = todavía no llegó (el árbol espera a las
  // dos). Config vacía/rota → default (estaciones + franquicias).
  const [config, setConfig] = useState(null);
  useEffect(() => {
    if (!puede) return undefined;
    let vivo = true;
    fetchConfigExplorador().then(({ data }) => {
      if (vivo) setConfig(normalizarConfig(data));
    });
    return () => { vivo = false; };
  }, [puede, fetchConfigExplorador]);

  // Árbol renderizable = RPC + config (merge puro, memoizado).
  const arbol = useMemo(() => armarArbol(resumen?.data?.rubros || [], config), [resumen, config]);

  // Lookup rama-key → { rubro, seccion } (para refetch por etapa y ColaLlamadas).
  const seccionPorKey = useMemo(() => {
    const m = new Map();
    for (const r of arbol) {
      if (r.oculto) continue;
      for (const s of r.secciones) m.set(ramaKey(r.key, s.seccion), { rubro: r, seccion: s });
    }
    return m;
  }, [arbol]);

  // ── Estado del árbol ──────────────────────────────────────────────────────
  // rubrosAbiertos null = default: abiertos los rubros que tienen operadores.
  const [rubrosAbiertos, setRubrosAbiertos] = useState(null);
  const [abiertas, setAbiertas] = useState(() => new Set()); // rama-keys de sección expandidas
  const [etapaFiltro, setEtapaFiltro] = useState('');
  // rama-key → { clave (etapa del fetch), rows, total, page, error, cargandoMas }
  const [ramas, setRamas] = useState({});
  const seqRef = useRef(0);
  const pedidosRef = useRef({}); // rama-key → token del último pedido en vuelo

  // ── Modo administración (solo Admin: ⚙ junto al título) ───────────────────
  const [modoAdmin, setModoAdmin] = useState(false);
  const [formSeccionRubro, setFormSeccionRubro] = useState(null); // key del rubro con el form abierto
  const [formRubro, setFormRubro] = useState(false);

  const cargarRama = useCallback((key, seccion, etapa, { append = false, page = 1 } = {}) => {
    const clave = etapa || '';
    const token = ++seqRef.current;
    pedidosRef.current[key] = token;
    // Sección "Sin bandera" = grupo sintético del RPC → filtro bandera SIN_BANDERA
    // (banderas null/vacías). El resto filtra por igualdad EXACTA del array de
    // banderas de la sección (las combos multibandera son secciones propias).
    const filtros = seccion.seccion === SIN_BANDERA
      ? { bandera: SIN_BANDERA }
      : { banderasExactas: seccion.banderas || [] };
    fetchOperadores({
      page, pageSize: PAGE,
      filtros: { ...filtros, ...(etapa ? { etapa } : {}) },
      orden: 'etapa',
    })
      .then(({ rows, total, error }) => {
        if (pedidosRef.current[key] !== token) return; // respuesta vieja
        setRamas((prev) => {
          const previa = prev[key];
          const base = append && previa && previa.clave === clave ? previa.rows : [];
          if (error) {
            return {
              ...prev,
              [key]: {
                clave, page: previa?.clave === clave ? previa.page : 1,
                rows: previa?.clave === clave ? previa.rows : [],
                total: previa?.clave === clave ? previa.total : 0,
                error, cargandoMas: false,
              },
            };
          }
          return { ...prev, [key]: { clave, page, rows: [...base, ...(rows || [])], total, error: null, cargandoMas: false } };
        });
      })
      .catch((e) => {
        if (pedidosRef.current[key] !== token) return;
        setRamas((prev) => ({
          ...prev,
          [key]: {
            clave, page: 1,
            rows: prev[key]?.clave === clave ? prev[key].rows : [],
            total: prev[key]?.clave === clave ? prev[key].total : 0,
            error: { message: e?.message || 'Error de red' }, cargandoMas: false,
          },
        }));
      });
  }, [fetchOperadores]);

  const toggleRama = (rubro, seccion) => {
    const key = ramaKey(rubro.key, seccion.seccion);
    const abriendo = !abiertas.has(key);
    setAbiertas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    const r = ramas[key];
    if (abriendo && (!r || r.clave !== (etapaFiltro || '') || r.error)) cargarRama(key, seccion, etapaFiltro);
  };

  const elegirEtapa = (etapa) => {
    if (etapa === etapaFiltro) return;
    setEtapaFiltro(etapa);
    // Las ramas abiertas refetchean con el filtro nuevo (mientras llega, el
    // mismatch de clave las muestra con skeleton — derivado, sin flags).
    abiertas.forEach((key) => {
      const nodo = seccionPorKey.get(key);
      if (nodo) cargarRama(key, nodo.seccion, etapa);
    });
  };

  const cargarMas = (key, seccion) => {
    const r = ramas[key];
    if (!r || r.cargandoMas) return;
    setRamas((prev) => ({ ...prev, [key]: { ...prev[key], cargandoMas: true } }));
    cargarRama(key, seccion, etapaFiltro, { append: true, page: (r.page || 1) + 1 });
  };

  // ── Alta manual de operador en una sección (todos los que entran acá) ─────
  const crearOperadorEnSeccion = async (rubro, seccion, nombre, nEstaciones) => {
    const { data, error } = await crearOperador({
      nombre,
      banderas: seccion.seccion === SIN_BANDERA ? [] : (seccion.banderas || []),
      rubro: rubro.key,
      n_estaciones: nEstaciones,
    }, { usuario: myId });
    if (error) return { error };
    const key = ramaKey(rubro.key, seccion.seccion);
    setRamas((prev) => {
      const r = prev[key];
      if (!r) return prev;
      return { ...prev, [key]: { ...r, rows: [data, ...r.rows], total: (r.total || 0) + 1 } };
    });
    refrescarResumen();
    return { error: null };
  };

  // ── Administración de la config (guarda entera + auditoría en el context) ──
  const rubrosCfg = () => (config || normalizarConfig(null)).rubros;

  // Materializa en la config un rubro que hasta ahora solo existía por datos
  // del RPC (para poder ocultarlo / colgarle secciones).
  const conRubro = (rubros, r) => (rubros.some((x) => x.key === r.key)
    ? rubros
    : [...rubros, { key: r.key, nombre: r.nombre, emoji: r.emoji, oculto: false, seccionesOcultas: [], seccionesExtra: [] }]);

  const guardarYSetear = async (rubrosNuevos) => {
    const previa = config;
    const nueva = { rubros: rubrosNuevos };
    setConfig(nueva); // optimista: el árbol refresca al toque
    const { error } = await guardarConfigExplorador(nueva, { usuario: myId });
    if (error) {
      setConfig(previa);
      window.alert(`No se pudo guardar la configuración${error.message ? ` (${error.message})` : ''}.`);
    }
  };

  const ocultarSeccion = (rubro, seccion) => {
    if (seccion.total > 0
      && !window.confirm(`Se oculta de la vista, los ${fmtN(seccion.total)} operadores no se tocan. ¿Ocultar "${seccion.seccion}"?`)) return;
    const key = ramaKey(rubro.key, seccion.seccion);
    setAbiertas((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    guardarYSetear(conRubro(rubrosCfg(), rubro).map((c) => {
      if (c.key !== rubro.key) return c;
      // Una sección extra (sin operadores) se borra directo; una con datos del
      // RPC va a seccionesOcultas (restaurable con "mostrar ocultas").
      return seccion.extra
        ? { ...c, seccionesExtra: c.seccionesExtra.filter((x) => x.seccion !== seccion.seccion) }
        : {
            ...c,
            seccionesOcultas: c.seccionesOcultas.includes(seccion.seccion)
              ? c.seccionesOcultas : [...c.seccionesOcultas, seccion.seccion],
          };
    }));
  };

  const restaurarOcultas = (rubro) => {
    guardarYSetear(rubrosCfg().map((c) => (c.key === rubro.key ? { ...c, seccionesOcultas: [] } : c)));
  };

  const agregarSeccion = (rubro, banderasElegidas) => {
    const vistas = new Set();
    const banderas = ordenarBanderas(banderasElegidas.map((b) => String(b).trim()).filter(Boolean))
      .filter((b) => {
        const u = b.toUpperCase();
        if (vistas.has(u)) return false;
        vistas.add(u);
        return true;
      });
    if (!banderas.length) return;
    const seccion = nombreSeccion(banderas);
    const cfgPrevio = rubrosCfg().find((x) => x.key === rubro.key);
    // Si estaba oculta, "agregarla" = restaurarla.
    if (cfgPrevio?.seccionesOcultas?.includes(seccion)) {
      guardarYSetear(rubrosCfg().map((c) => (c.key === rubro.key
        ? { ...c, seccionesOcultas: c.seccionesOcultas.filter((x) => x !== seccion) } : c)));
      setFormSeccionRubro(null);
      return;
    }
    if (rubro.secciones.some((s) => s.seccion === seccion)) {
      window.alert(`La sección "${seccion}" ya existe en ${rubro.nombre}.`);
      return;
    }
    guardarYSetear(conRubro(rubrosCfg(), rubro).map((c) => (c.key === rubro.key
      ? { ...c, seccionesExtra: [...c.seccionesExtra, { seccion, banderas }] } : c)));
    setFormSeccionRubro(null);
  };

  const ocultarRubro = (rubro) => {
    if (rubro.total > 0
      && !window.confirm(`Se oculta de la vista, los ${fmtN(rubro.total)} operadores no se tocan. ¿Ocultar "${rubro.nombre}"?`)) return;
    setAbiertas((prev) => {
      const next = new Set([...prev].filter((k) => !k.startsWith(`${rubro.key}::`)));
      return next.size === prev.size ? prev : next;
    });
    guardarYSetear(conRubro(rubrosCfg(), rubro).map((c) => (c.key === rubro.key ? { ...c, oculto: true } : c)));
  };

  const mostrarRubrosOcultos = () => {
    guardarYSetear(rubrosCfg().map((c) => (c.oculto ? { ...c, oculto: false } : c)));
  };

  const agregarRubro = (nombre, emoji) => {
    const key = slugRubro(nombre);
    if (!key) return;
    const existentes = new Set([
      ...rubrosCfg().map((x) => x.key),
      ...(resumen?.data?.rubros || []).map((x) => x.rubro),
    ]);
    if (existentes.has(key)) {
      window.alert(`Ya existe un rubro "${key}".`);
      return;
    }
    guardarYSetear([
      ...rubrosCfg(),
      { key, nombre: nombre.trim(), emoji: emoji || '📁', oculto: false, seccionesOcultas: [], seccionesExtra: [] },
    ]);
    setFormRubro(false);
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

  // ── Vistas: árbol ↔ cola de llamadas ↔ campañas · Ritmo colapsable ────────
  const [vista, setVista] = useState('arbol'); // 'arbol' | 'llamadas' | 'campanas'
  const [ritmoAbierto, setRitmoAbierto] = useState(false);
  const [ritmoMontado, setRitmoMontado] = useState(false); // monta el panel recién al 1er open

  const toggleRitmo = () => {
    if (!ritmoMontado) setRitmoMontado(true);
    setRitmoAbierto((v) => !v);
  };

  const escribirBusqueda = (v) => {
    setBusquedaInput(v);
    // Buscar desde llamadas/campañas te devuelve al árbol (donde viven los resultados).
    if (vista !== 'arbol' && v.trim().length >= 2) setVista('arbol');
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
  const resumenCargando = !resumen;
  const resumenError = resumen?.error || null;
  const arbolCargando = resumenCargando || !config; // el árbol espera resumen + config
  const arbolVacio = !!resumen?.data && (!global || !global.total) && (resumen?.data?.rubros || []).length === 0;
  const rubrosVisibles = arbol.filter((r) => !r.oculto);
  const nRubrosOcultos = arbol.length - rubrosVisibles.length;
  // Rubros abiertos por defecto: los que tienen operadores (estaciones hoy).
  const rubrosAbiertosEf = rubrosAbiertos || new Set(rubrosVisibles.filter((r) => r.total > 0).map((r) => r.key));
  const toggleRubro = (key) => {
    const next = new Set(rubrosAbiertosEf);
    if (next.has(key)) next.delete(key); else next.add(key);
    setRubrosAbiertos(next);
  };
  // Única sección abierta y de UNA sola bandera → filtra la cola de llamadas.
  // Combos multibandera y "Sin bandera" (grupo sintético del RPC) → sin filtro.
  const nodoUnico = abiertas.size === 1 ? seccionPorKey.get([...abiertas][0]) : null;
  const seccionUnica = nodoUnico?.seccion || null;
  const banderaUnica = seccionUnica && seccionUnica.seccion !== SIN_BANDERA
    && (seccionUnica.banderas || []).length === 1
    ? seccionUnica.banderas[0] : null;
  const claveRama = etapaFiltro || '';
  const altoFila = isMobile ? 52 : 44;

  const limpiarBusquedaUI = () => { setBusquedaInput(''); setBusqueda(''); };

  // ── Sub-render: una sección de un rubro con sus operadores ────────────────
  const renderSeccion = (rubro, s) => {
    const key = ramaKey(rubro.key, s.seccion);
    const abierta = abiertas.has(key);
    const rama = ramas[key];
    const ramaVigente = rama && rama.clave === claveRama;
    // "Cargando" DERIVADO del mismatch de clave (sin flags en effects): recién
    // abierta sin datos, o refetch en vuelo por cambio de filtro de etapa.
    const cargandoRama = abierta && !ramaVigente;
    const conFiltroVacia = ramaVigente && !rama.error && rama.rows.length === 0;
    return (
      <div key={key}>
        <div
          className="ce-fila"
          onClick={() => toggleRama(rubro, s)}
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
            {s.seccion}
          </span>
          {s.multibandera && <ChipMulti />}
          {modoAdmin && (
            <BtnOcultar
              title={`Ocultar la sección ${s.seccion}`}
              onClick={(e) => { e.stopPropagation(); ocultarSeccion(rubro, s); }}
            />
          )}
          <MiniKpis
            total={s.total} respondieron={s.respondieron} reuniones={s.reuniones}
            obras={s.obras} porEtapa={s.por_etapa} etapaFiltro={etapaFiltro} isMobile={isMobile}
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
                  Se nos cayó la carga de {s.seccion}{rama.error.message ? ` (${rama.error.message})` : ''}.{' '}
                  <LinkAccion onClick={() => cargarRama(key, s, etapaFiltro)}>Reintentar</LinkAccion>
                </div>
              )}
              {!cargandoRama && conFiltroVacia && (
                <div style={{ padding: '12px 4px', fontSize: 12, color: T.ink3 }}>
                  {etapaFiltro ? 'Ningún operador en esta etapa.' : 'Sin operadores cargados en esta sección.'}
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
                  <LinkAccion onClick={() => cargarMas(key, s)} style={{ color: rama.cargandoMas ? T.ink3 : T.accent }}>
                    {rama.cargandoMas ? 'Cargando…' : `Cargar más (quedan ${fmtN(rama.total - rama.rows.length)})`}
                  </LinkAccion>
                </div>
              )}
              {!cargandoRama && ramaVigente && !rama.error && (
                <FilaNuevoOperador
                  alto={altoFila}
                  onCrear={(nombre, nEst) => crearOperadorEnSeccion(rubro, s, nombre, nEst)}
                />
              )}
            </div>
          )}
        </Expandible>
      </div>
    );
  };

  // ── Sub-render: un rubro (nodo raíz) con sus secciones ────────────────────
  const renderRubro = (r) => {
    const abierto = rubrosAbiertosEf.has(r.key);
    return (
      <div key={r.key}>
        <div
          className="ce-fila"
          onClick={() => toggleRubro(r.key)}
          style={{
            height: 52, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            borderBottom: `1px solid ${T.faint2}`, borderRadius: 6, padding: '0 8px 0 0',
            transition: 'background 0.15s ease',
          }}
        >
          <Chevron abierto={abierto} />
          <span style={{ fontSize: 15, flexShrink: 0 }}>{r.emoji}</span>
          <span style={{ fontSize: 15, fontWeight: 800, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            {r.nombre}
          </span>
          {modoAdmin && (
            <BtnOcultar
              title={`Ocultar el rubro ${r.nombre}`}
              onClick={(e) => { e.stopPropagation(); ocultarRubro(r); }}
            />
          )}
          <MiniKpis
            total={r.total} respondieron={r.respondieron} reuniones={r.reuniones}
            obras={r.obras} porEtapa={r.por_etapa} etapaFiltro={etapaFiltro} isMobile={isMobile}
          />
        </div>
        <Expandible abierto={abierto}>
          <div style={{ marginLeft: 8, borderLeft: `1px solid ${T.faint2}`, paddingLeft: 14 }}>
            {r.secciones.map((s) => renderSeccion(r, s))}
            {r.secciones.length === 0 && !modoAdmin && (
              <div style={{ padding: '14px 4px', fontSize: 12, color: T.ink3, fontStyle: 'italic' }}>
                Sin secciones todavía.
              </div>
            )}
            {modoAdmin && (
              <div style={{ padding: '10px 4px', display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {formSeccionRubro === r.key
                  ? (
                    <FormNuevaSeccion
                      candidatas={candidatasDe(r)}
                      onCrear={(banderas) => agregarSeccion(r, banderas)}
                      onCancelar={() => setFormSeccionRubro(null)}
                    />
                  )
                  : <LinkAccion onClick={() => setFormSeccionRubro(r.key)}>+ Agregar sección</LinkAccion>}
                {r.nOcultas > 0 && formSeccionRubro !== r.key && (
                  <LinkAccion onClick={() => restaurarOcultas(r)} style={{ color: T.ink3 }}>
                    mostrar ocultas ({r.nOcultas})
                  </LinkAccion>
                )}
              </div>
            )}
          </div>
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
  } else if (vista === 'campanas') {
    areaCentral = (
      <div key="campanas" style={{ animation: 'ceIn 0.22s ease' }}>
        <VistaCampanas />
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
        {arbolCargando && !resumenError && <SkeletonRamas alto={50} />}
        {resumenError && (
          <div style={{ textAlign: 'center', padding: '44px 16px' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🤦</div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>No pudimos armar el árbol</div>
            <div style={{ fontSize: 12, color: T.ink3, marginTop: 4, marginBottom: 14 }}>{resumenError.message || 'Error inesperado'}</div>
            <Btn sm accent onClick={reintentarResumen}>↻ Reintentar</Btn>
          </div>
        )}
        {!arbolCargando && !resumenError && arbolVacio && (
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
        {!arbolCargando && !resumenError && !arbolVacio && global && (
          <div>
            {rubrosVisibles.map(renderRubro)}
            {modoAdmin && (
              <div style={{ padding: '12px 4px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                {formRubro
                  ? <FormNuevoRubro onCrear={agregarRubro} onCancelar={() => setFormRubro(false)} />
                  : <LinkAccion onClick={() => setFormRubro(true)}>+ Agregar rubro</LinkAccion>}
                {nRubrosOcultos > 0 && !formRubro && (
                  <LinkAccion onClick={mostrarRubrosOcultos} style={{ color: T.ink3 }}>
                    mostrar rubros ocultos ({nRubrosOcultos})
                  </LinkAccion>
                )}
              </div>
            )}
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
          {esAdmin && (
            <button
              type="button"
              onClick={() => setModoAdmin((v) => !v)}
              title={modoAdmin ? 'Salir del modo administración' : 'Administrar rubros y secciones'}
              className="ce-accion"
              style={{
                border: 'none', background: modoAdmin ? T.ink : 'transparent',
                color: modoAdmin ? T.paper : T.ink3, opacity: modoAdmin ? 1 : 0.65,
                borderRadius: 999, width: 26, height: 26, fontSize: 13, cursor: 'pointer',
                padding: 0, lineHeight: 1, flexShrink: 0,
              }}
            >⚙</button>
          )}
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
            <BotonAccion
              activo={vista === 'campanas'}
              onClick={() => setVista((v) => (v === 'campanas' ? 'arbol' : 'campanas'))}
              title="Campañas por plataforma y sus resultados"
            >💰 Campañas</BotonAccion>
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
