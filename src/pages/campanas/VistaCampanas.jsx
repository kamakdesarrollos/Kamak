import { useEffect, useMemo, useRef, useState } from 'react';
import { Btn } from '../../components/ui';
import { T } from '../../theme';
import { useUsuarios } from '../../store/UsuariosContext';
import { useCampanas } from '../../store/CampanasContext';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { fmtN, fmtMoney } from '../../lib/format';
import { comparativaListas } from '../../lib/campanas/kpis.js';

// ─────────────────────────────────────────────────────────────────────────────
// VISTA CAMPAÑAS — pedido de Franco: "poder identificar cada una de las
// campañas y el resultado de las mismas". Vive DENTRO del explorador (como la
// vista Llamadas: sin PageLayout, se monta en el área central) y sigue su
// lenguaje visual exacto: filas árbol con hairlines, chevron, expansión
// grid-rows, mini-cluster de KPIs a la derecha.
// Árbol de DOS niveles + detalle:
//   PLATAFORMA (✉ Instantly / 📣 Meta / 🔍 Google / 💼 LinkedIn / 📞 Llamadas
//   / 📁 Otras) con el agregado de sus campañas → CAMPAÑA (camp_listas) con su
//   cluster individual → DETALLE (desglose por estado + costo + Fase 2).
// Datos: fetchListas + fetchMiembrosListas (solo columnas de KPI, paginado) +
// fetchActividades (reuniones por lista_id); la agregación por campaña la hace
// comparativaListas (kpis.js) y acá solo se suma por plataforma.
// P11: el costo de campaña NO es monto de obra — lo ve todo el que tiene el
// permiso `campanas` (no se gatea por Admin).
// ─────────────────────────────────────────────────────────────────────────────

// Plataformas (nivel 1) en orden canónico de render. `canal` es el que se
// setea en camp_listas al CREAR una campaña desde esa plataforma; `chip` es el
// label del selector del form (Otras → "Otra").
const PLATAFORMAS = [
  { key: 'instantly', nombre: 'Instantly', hint: 'email', icono: '✉', canal: 'email' },
  { key: 'meta', nombre: 'Meta', icono: '📣', canal: 'ads' },
  { key: 'google', nombre: 'Google', icono: '🔍', canal: 'google' },
  { key: 'linkedin', nombre: 'LinkedIn', icono: '💼', canal: 'linkedin' },
  { key: 'llamadas', nombre: 'Llamadas', icono: '📞', canal: 'llamada' },
  { key: 'otras', nombre: 'Otras', chip: 'Otra', icono: '📁', canal: 'otro' },
];

// canal de la lista → plataforma que la agrupa (whatsapp Y ads viven en Meta).
const plataformaDeCanal = (canal) => {
  const c = String(canal || '').toLowerCase();
  if (c === 'email') return 'instantly';
  if (c === 'linkedin') return 'linkedin';
  if (c === 'whatsapp' || c === 'ads') return 'meta';
  if (c === 'llamada') return 'llamadas';
  if (c === 'google') return 'google';
  return 'otras';
};

const ICONO_CANAL = { email: '✉', linkedin: '💼', whatsapp: '💬', ads: '📣', llamada: '📞', google: '🔍', presencial: '🤝' };
// Colores por canal para las mini barras del detalle (paleta del módulo:
// mail azul apagado / WA T.ok / ads T.warn / llamada T.accent — constants.js).
const COLOR_CANAL = { email: '#41698c', linkedin: '#0d7475', whatsapp: '#3d7a4a', ads: '#d4923a', llamada: '#1a9b9c', google: '#b08968' };

const iconoCanal = (canal) => ICONO_CANAL[String(canal || '').toLowerCase()] || '📁';
const colorCanal = (canal) => COLOR_CANAL[String(canal || '').toLowerCase()] || T.ink3;

// "$ 1.234" o '—' si todavía no hay costo o no hay respuestas que dividir.
const costoPorRespuesta = (costo, respuestas) =>
  (costo > 0 && respuestas > 0 ? fmtMoney(costo / respuestas) : '—');

// Input de costo → numeric o null (opcional: vacío/0 = sin costo cargado).
const parseCosto = (s) => {
  const n = Number(String(s || '').replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Agregación pura: listas+miembros+actividades → árbol renderizable
//   [{ ...plataforma, campanas: [fila], miembros, respondieron, tasa, reuniones, costoMensual }]
// Solo plataformas CON campañas. La fila de campaña reusa comparativaListas
// (enviados / respondieron / tasaRespuesta / reuniones / costoMensual, tasa
// desc) y le suma miembros + desglose por estado para el detalle.
const armarArbol = ({ listas, miembros, actividades }) => {
  const listaPorId = new Map((listas || []).map((l) => [l.id, l]));
  const desglosePorLista = new Map();
  for (const m of miembros || []) {
    const d = desglosePorLista.get(m.lista_id) || { pendiente: 0, enviado: 0, respondio: 0, total: 0 };
    if (m.estado === 'respondio' || m.estado === 'respondido' || m.respondido_at) d.respondio += 1;
    else if (m.estado === 'enviado' || m.enviado_at) d.enviado += 1;
    else d.pendiente += 1;
    d.total += 1;
    desglosePorLista.set(m.lista_id, d);
  }
  const filas = comparativaListas({ listas, miembros, actividades }).map((k) => {
    const desglose = desglosePorLista.get(k.listaId) || { pendiente: 0, enviado: 0, respondio: 0, total: 0 };
    return { ...k, lista: listaPorId.get(k.listaId) || null, miembros: desglose.total, desglose };
  });
  return PLATAFORMAS.map((p) => {
    const campanas = filas.filter((f) => plataformaDeCanal(f.canal) === p.key);
    if (!campanas.length) return null;
    const suma = (fn) => campanas.reduce((acc, f) => acc + fn(f), 0);
    const enviados = suma((f) => f.enviados);
    const respondieron = suma((f) => f.respondieron);
    return {
      ...p,
      campanas,
      miembros: suma((f) => f.miembros),
      respondieron,
      // tasa promedio PONDERADA (Σ respondieron / Σ enviados, no promedio de %).
      tasa: enviados > 0 ? Math.round((respondieron / enviados) * 100) : 0,
      reuniones: suma((f) => f.reuniones),
      costoMensual: suma((f) => f.costoMensual),
    };
  }).filter(Boolean);
};

// ── Piezas chicas de presentación (mismo lenguaje que CampExplorador) ─────────

const INPUT_MINI = {
  padding: '6px 10px', borderRadius: 8, border: `1.5px solid ${T.faint2}`,
  fontSize: 12, fontFamily: T.font, color: T.ink, background: '#fff', outline: 'none',
};

function ParKpi({ v, l, color }) {
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <span style={{ fontFamily: T.fontMono, fontWeight: 700, fontSize: 12, color: color || T.ink }}>{v}</span>
      <span style={{ fontSize: 10, color: T.ink3 }}> {l}</span>
    </span>
  );
}

const SepKpi = () => <span style={{ color: T.ink3, opacity: 0.45, fontSize: 10 }}>·</span>;

// Mini-cluster a la derecha de cada fila. Mobile: en 2 líneas (2 pares + 2 pares).
function ClusterKpis({ pares, isMobile }) {
  const lineas = isMobile ? [pares.slice(0, 2), pares.slice(2)] : [pares];
  return (
    <span style={{
      marginLeft: 'auto', display: 'flex', flexDirection: 'column',
      alignItems: 'flex-end', gap: 3, flexShrink: 0,
    }}>
      {lineas.map((linea, i) => (
        <span key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          {linea.map((p, j) => (
            <span key={p.l} style={{ display: 'inline-flex', gap: 8, alignItems: 'baseline' }}>
              {j > 0 && <SepKpi />}
              <ParKpi v={p.v} l={p.l} color={p.color} />
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

function Chevron({ abierto }) {
  return (
    <span style={{
      width: 16, textAlign: 'center', fontSize: 11, color: T.ink3, flexShrink: 0,
      display: 'inline-block', transform: abierto ? 'rotate(90deg)' : 'none',
      transition: 'transform 0.15s ease',
    }}>▸</span>
  );
}

function Expandible({ abierto, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateRows: abierto ? '1fr' : '0fr', transition: 'grid-template-rows 0.25s ease' }}>
      <div style={{ overflow: 'hidden', minHeight: 0 }}>{children}</div>
    </div>
  );
}

function FilaSkeleton({ alto, ancho }) {
  return (
    <div style={{ height: alto, display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${T.faint}` }}>
      <span className="vc-skel" style={{ width: 14, height: 14, borderRadius: 4, background: T.faint2, flexShrink: 0 }} />
      <span className="vc-skel" style={{ height: 10, borderRadius: 4, background: T.faint2, width: `${ancho}%` }} />
      <span className="vc-skel" style={{ height: 8, borderRadius: 4, background: T.faint, width: 110, marginLeft: 'auto' }} />
    </div>
  );
}

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

// Chip sobrio del canal de la campaña (mismo estilo que el chip de bandera).
function ChipCanal({ canal }) {
  if (!canal) return null;
  return (
    <span style={{
      fontSize: 9.5, fontWeight: 700, border: `1px solid ${T.faint2}`, borderRadius: 999,
      padding: '2px 8px', background: T.faint, color: T.ink2, whiteSpace: 'nowrap', flexShrink: 0,
    }}>{canal}</span>
  );
}

function ChipPausada() {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase',
      border: `1px solid ${T.faint2}`, borderRadius: 999, padding: '1px 7px',
      color: T.ink3, flexShrink: 0, whiteSpace: 'nowrap',
    }}>pausada</span>
  );
}

// Barra proporcional del desglose por estado (color del canal, opacidad según
// qué tan "avanzado" es el estado).
function BarraEstado({ label, n, total, color, opacidad }) {
  const w = total > 0 && n > 0 ? Math.max(2, Math.round((n / total) * 100)) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: 440 }}>
      <span style={{ fontSize: 11, color: T.ink2, width: 74, flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, height: 6, borderRadius: 999, background: T.faint, overflow: 'hidden' }}>
        <span style={{
          display: 'block', height: '100%', width: `${w}%`, background: color,
          opacity: opacidad, borderRadius: 999, transition: 'width 0.25s ease',
        }} />
      </span>
      <span style={{ fontFamily: T.fontMono, fontSize: 11.5, fontWeight: 700, color: T.ink, width: 52, textAlign: 'right', flexShrink: 0 }}>
        {fmtN(n)}
      </span>
    </div>
  );
}

// Detalle expandido de una campaña (nivel 3): desglose por estado + costo.
function DetalleCampana({ f }) {
  const color = colorCanal(f.canal);
  const barras = [
    ['pendiente', f.desglose.pendiente, 0.3],
    ['enviado', f.desglose.enviado, 0.6],
    ['respondió', f.desglose.respondio, 1],
  ];
  return (
    <div style={{
      marginLeft: 8, borderLeft: `1px solid ${T.faint2}`, padding: '10px 8px 6px 14px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {f.miembros > 0
        ? barras.map(([label, n, op]) => (
          <BarraEstado key={label} label={label} n={n} total={f.miembros} color={color} opacidad={op} />
        ))
        : (
          <div style={{ fontSize: 11.5, color: T.ink3 }}>
            Sin miembros todavía — se suman desde Importar o al armar la lista.
          </div>
        )}
      <div style={{ fontSize: 11.5, color: T.ink2, marginTop: 2 }}>
        Costo mensual:{' '}
        <b style={{ fontFamily: T.fontMono, color: T.ink }}>
          {f.costoMensual > 0 ? fmtMoney(f.costoMensual) : '—'}
        </b>
        {f.costoMensual > 0 && f.respondieron > 0 && (
          <span style={{ color: T.ink3 }}> · {costoPorRespuesta(f.costoMensual, f.respondieron)} por respuesta</span>
        )}
      </div>
      <div style={{ fontSize: 10.5, color: T.ink3, fontStyle: 'italic', paddingBottom: 4 }}>
        El gasto real de la plataforma se enciende con la integración (Fase 2).
      </div>
    </div>
  );
}

// Fila de una CAMPAÑA (nivel 2): icono por canal + nombre + chips + ✎ + cluster.
function FilaCampana({ f, abierto, isMobile, onClick, onEditar }) {
  const pausada = f.lista?.activa === false;
  const pares = [
    { v: fmtN(f.miembros), l: f.miembros === 1 ? 'miembro' : 'miembros' },
    { v: fmtN(f.respondieron), l: `resp (${Math.round(f.tasaRespuesta)}%)`, color: T.accent },
    { v: fmtN(f.reuniones), l: 'reun', color: T.accent2 },
    { v: costoPorRespuesta(f.costoMensual, f.respondieron), l: '/resp', color: T.ok },
  ];
  return (
    <div
      className="vc-fila"
      onClick={onClick}
      style={{
        height: isMobile ? 58 : 48, display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 8px 0 0', cursor: 'pointer', borderBottom: `1px solid ${T.faint}`,
        borderRadius: 6, transition: 'background 0.15s ease', opacity: pausada ? 0.72 : 1,
      }}
    >
      <Chevron abierto={abierto} />
      <span style={{ fontSize: 13, flexShrink: 0 }}>{iconoCanal(f.canal)}</span>
      <span style={{
        fontSize: 13.5, fontWeight: 700, color: T.ink, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {f.nombre || '—'}
      </span>
      {!isMobile && <ChipCanal canal={f.canal} />}
      {pausada && <ChipPausada />}
      <span
        onClick={(e) => { e.stopPropagation(); onEditar(); }}
        title="Editar campaña (nombre / costo / activa)"
        style={{ fontSize: 12, color: T.ink3, cursor: 'pointer', flexShrink: 0, padding: '2px 4px' }}
      >✎</span>
      {f.miembros === 0
        ? (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: T.ink3, fontStyle: 'italic', whiteSpace: 'nowrap', flexShrink: 0 }}>
            sin miembros todavía
          </span>
        )
        : <ClusterKpis pares={pares} isMobile={isMobile} />}
    </div>
  );
}

// Fila de una PLATAFORMA (nivel 1) con el cluster AGREGADO de sus campañas.
function FilaPlataforma({ p, abierta, isMobile, onClick }) {
  const pares = [
    { v: fmtN(p.miembros), l: p.miembros === 1 ? 'miembro' : 'miembros' },
    { v: fmtN(p.respondieron), l: `resp (${p.tasa}%)`, color: T.accent },
    { v: fmtN(p.reuniones), l: 'reun', color: T.accent2 },
    { v: p.costoMensual > 0 ? fmtMoney(p.costoMensual) : '—', l: '/mes', color: T.ok },
  ];
  return (
    <div
      className="vc-fila"
      onClick={onClick}
      style={{
        height: isMobile ? 62 : 50, display: 'flex', alignItems: 'center', gap: 8,
        cursor: 'pointer', borderBottom: `1px solid ${T.faint2}`, borderRadius: 6,
        padding: '0 8px 0 0', transition: 'background 0.15s ease',
      }}
    >
      <Chevron abierto={abierta} />
      <span style={{ fontSize: 15, flexShrink: 0 }}>{p.icono}</span>
      <span style={{ fontSize: 14.5, fontWeight: 800, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
        {p.nombre}
      </span>
      {p.hint && !isMobile && (
        <span style={{ fontSize: 10.5, color: T.ink3, whiteSpace: 'nowrap', flexShrink: 0 }}>({p.hint})</span>
      )}
      <ClusterKpis pares={pares} isMobile={isMobile} />
    </div>
  );
}

// Chips del selector de plataforma del form de alta.
function ChipsPlataforma({ sel, onSel }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {PLATAFORMAS.map((p) => {
        const activa = sel === p.key;
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onSel(p.key)}
            style={{
              border: `1.5px solid ${activa ? T.ink : T.faint2}`,
              background: activa ? T.ink : 'transparent',
              color: activa ? T.paper : T.ink2,
              borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 700,
              fontFamily: T.font, cursor: 'pointer', whiteSpace: 'nowrap',
              transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
            }}
          >{p.icono} {p.chip || p.nombre}</button>
        );
      })}
    </div>
  );
}

// Input chico de costo mensual (opcional) con el $ adentro.
function InputCosto({ value, onChange, onKeyDown, disabled }) {
  return (
    <span style={{ position: 'relative', flexShrink: 0 }}>
      <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: T.ink3, pointerEvents: 'none' }}>$</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
        onKeyDown={onKeyDown}
        placeholder="costo/mes"
        inputMode="numeric"
        disabled={disabled}
        style={{ ...INPUT_MINI, width: 92, paddingLeft: 19 }}
      />
    </span>
  );
}

// Fila fantasma "+ campaña" → form inline (nombre* + plataforma chips + costo
// opcional). Desde el pie de una plataforma expandida viene preseleccionada.
function FilaNuevaCampana({ alto, plataformaInicial = null, abiertoInicial = false, onCrear }) {
  const [editando, setEditando] = useState(abiertoInicial);
  const [nombre, setNombre] = useState('');
  const [plat, setPlat] = useState(plataformaInicial);
  const [costo, setCosto] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cancelar = () => {
    setEditando(abiertoInicial);
    setNombre('');
    setPlat(plataformaInicial);
    setCosto('');
  };

  const valido = !!nombre.trim() && !!plat;

  const guardar = async () => {
    if (!valido || guardando) return;
    const p = PLATAFORMAS.find((x) => x.key === plat);
    setGuardando(true);
    const { error } = await onCrear({ nombre: nombre.trim(), canal: p.canal, costo: parseCosto(costo) });
    setGuardando(false);
    if (error) {
      window.alert(`No se pudo crear la campaña${error.message ? ` (${error.message})` : ''}.`);
      return;
    }
    cancelar();
  };

  const teclas = (e) => {
    if (e.key === 'Enter') guardar();
    if (e.key === 'Escape') cancelar();
  };

  if (!editando) {
    return (
      <div
        className="vc-fila"
        onClick={() => setEditando(true)}
        style={{
          height: alto - 8, display: 'flex', alignItems: 'center', gap: 10,
          padding: '0 8px 0 2px', cursor: 'pointer', borderRadius: 6, color: T.ink3,
          transition: 'background 0.15s ease',
        }}
      >
        <span style={{ width: 9, textAlign: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>+</span>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>campaña</span>
      </div>
    );
  }
  return (
    <div style={{
      border: `1px dashed ${T.faint2}`, borderRadius: 10, padding: '10px 12px',
      margin: '6px 0 8px', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          autoFocus
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={teclas}
          placeholder="Nombre de la campaña…"
          disabled={guardando}
          style={{ ...INPUT_MINI, flex: '1 1 170px', minWidth: 150, borderColor: T.accent }}
        />
        <InputCosto value={costo} onChange={setCosto} onKeyDown={teclas} disabled={guardando} />
      </div>
      <ChipsPlataforma sel={plat} onSel={setPlat} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
        <span style={{
          fontSize: 10.5, color: T.ink3, fontFamily: T.fontMono, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {plat
            ? `→ canal ${PLATAFORMAS.find((x) => x.key === plat).canal}`
            : 'Elegí la plataforma'}
        </span>
        <LinkAccion onClick={guardar} style={{ marginLeft: 'auto', color: valido && !guardando ? T.accent : T.ink3 }}>
          {guardando ? 'Guardando…' : 'Crear campaña'}
        </LinkAccion>
        {!guardando && <LinkAccion onClick={cancelar} style={{ color: T.ink3 }}>✕</LinkAccion>}
      </div>
    </div>
  );
}

// Form inline de edición de una campaña (reemplaza su fila): nombre / costo /
// activa. El canal no se toca — mover una campaña de plataforma no es editar.
function FormEditarCampana({ lista, onGuardar, onCancelar }) {
  const [nombre, setNombre] = useState(lista.nombre || '');
  const [costo, setCosto] = useState(lista.costo_mensual != null ? String(lista.costo_mensual) : '');
  const [activa, setActiva] = useState(lista.activa !== false);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    const n = nombre.trim();
    if (!n || guardando) return;
    setGuardando(true);
    const { error } = await onGuardar({ nombre: n, costo_mensual: parseCosto(costo), activa });
    setGuardando(false);
    if (error) {
      window.alert(`No se pudo guardar la campaña${error.message ? ` (${error.message})` : ''}.`);
      return;
    }
    onCancelar();
  };

  const teclas = (e) => {
    if (e.key === 'Enter') guardar();
    if (e.key === 'Escape') onCancelar();
  };

  return (
    <div style={{
      border: `1px dashed ${T.faint2}`, borderRadius: 10, padding: '8px 12px',
      margin: '4px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
    }}>
      <input
        autoFocus
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        onKeyDown={teclas}
        placeholder="Nombre de la campaña…"
        disabled={guardando}
        style={{ ...INPUT_MINI, flex: '1 1 160px', minWidth: 140, borderColor: T.accent }}
      />
      <InputCosto value={costo} onChange={setCosto} onKeyDown={teclas} disabled={guardando} />
      <span style={{ display: 'inline-flex', border: `1.5px solid ${T.faint2}`, borderRadius: 999, overflow: 'hidden', flexShrink: 0 }}>
        {[[true, 'Activa'], [false, 'Pausada']].map(([v, l]) => (
          <button
            key={l}
            type="button"
            onClick={() => setActiva(v)}
            style={{
              border: 'none', padding: '5px 10px', fontSize: 11, fontWeight: 700, fontFamily: T.font,
              cursor: 'pointer', background: activa === v ? T.ink : 'transparent',
              color: activa === v ? T.paper : T.ink3,
            }}
          >{l}</button>
        ))}
      </span>
      <LinkAccion onClick={guardar} style={{ color: guardando || !nombre.trim() ? T.ink3 : T.accent }}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </LinkAccion>
      {!guardando && <LinkAccion onClick={onCancelar} style={{ color: T.ink3 }}>✕</LinkAccion>}
    </div>
  );
}

// ── Vista ────────────────────────────────────────────────────────────────────

export default function VistaCampanas({ onError }) {
  const { currentUser } = useUsuarios();
  const { fetchListas, fetchMiembrosListas, fetchActividades, crearLista, actualizarLista } = useCampanas();
  const isMobile = useIsMobile();
  const myId = currentUser?.id || null;

  // Aviso opcional al padre cuando falla la carga (latest-ref: no re-dispara
  // el effect de datos si el caller pasa una función inline).
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // null = cargando · { error } = falló · { listas, miembros, actividades } = ok
  const [datos, setDatos] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let vivo = true;
    const fallar = (error) => {
      if (!vivo) return;
      setDatos({ error });
      onErrorRef.current?.(error);
    };
    (async () => {
      const rListas = await fetchListas();
      if (rListas.error) { fallar(rListas.error); return; }
      const listas = rListas.rows || [];
      const [rMiembros, rActs] = await Promise.all([
        fetchMiembrosListas(listas.map((l) => l.id)),
        fetchActividades({ limit: 500 }),
      ]);
      const error = rMiembros.error || rActs.error || null;
      if (!vivo) return;
      if (error) { fallar(error); return; }
      setDatos({ listas, miembros: rMiembros.rows || [], actividades: rActs.rows || [], error: null });
    })().catch((e) => fallar({ message: e?.message || 'Error de red' }));
    return () => { vivo = false; };
  }, [fetchListas, fetchMiembrosListas, fetchActividades, tick]);

  const reintentar = () => {
    setDatos(null);
    setTick((t) => t + 1);
  };

  const arbol = useMemo(
    () => (datos && !datos.error && datos.listas ? armarArbol(datos) : []),
    [datos],
  );

  // ── Estado del árbol ──────────────────────────────────────────────────────
  // abiertasPlat null = default: TODAS las plataformas abiertas (la lista es
  // corta y Franco quiere el resultado de un vistazo).
  const [abiertasPlat, setAbiertasPlat] = useState(null);
  const [abiertas, setAbiertas] = useState(() => new Set()); // listaIds con detalle abierto
  const [editando, setEditando] = useState(null);            // listaId en edición

  const abiertasPlatEf = abiertasPlat || new Set(arbol.map((p) => p.key));

  const togglePlataforma = (key) => {
    const next = new Set(abiertasPlatEf);
    if (next.has(key)) next.delete(key); else next.add(key);
    setAbiertasPlat(next);
  };

  const toggleDetalle = (listaId) => {
    setAbiertas((prev) => {
      const next = new Set(prev);
      if (next.has(listaId)) next.delete(listaId); else next.add(listaId);
      return next;
    });
  };

  // ── Mutaciones (context) + patch local sin refetch ────────────────────────
  const crear = async ({ nombre, canal, costo }) => {
    const { data, error } = await crearLista(
      { nombre, canal, costo_mensual: costo, activa: true },
      { usuario: myId },
    );
    if (error) return { error };
    setDatos((d) => (d && !d.error && d.listas ? { ...d, listas: [data, ...d.listas] } : d));
    // La plataforma de la campaña nueva queda abierta para que la fila se vea.
    setAbiertasPlat((prev) => {
      if (!prev) return prev; // null = todas abiertas, la nueva incluida
      const next = new Set(prev);
      next.add(plataformaDeCanal(canal));
      return next;
    });
    return { error: null };
  };

  const editar = async (id, changes) => {
    const { data, error } = await actualizarLista(id, changes);
    if (error) return { error };
    setDatos((d) => (d && !d.error && d.listas
      ? { ...d, listas: d.listas.map((l) => (l.id === id ? { ...l, ...(data || changes) } : l)) }
      : d));
    return { error: null };
  };

  // ── Derivados de render ───────────────────────────────────────────────────
  const cargando = !datos;
  const error = datos?.error || null;
  const vacio = !!datos && !error && (datos.listas || []).length === 0;
  const altoFila = isMobile ? 58 : 48;

  const renderCampana = (f) => {
    const abierto = abiertas.has(f.listaId);
    return (
      <div key={f.listaId}>
        {editando === f.listaId
          ? (
            <FormEditarCampana
              lista={f.lista || {}}
              onGuardar={(changes) => editar(f.listaId, changes)}
              onCancelar={() => setEditando(null)}
            />
          )
          : (
            <FilaCampana
              f={f} abierto={abierto} isMobile={isMobile}
              onClick={() => toggleDetalle(f.listaId)}
              onEditar={() => setEditando(f.listaId)}
            />
          )}
        <Expandible abierto={abierto && editando !== f.listaId}>
          <DetalleCampana f={f} />
        </Expandible>
      </div>
    );
  };

  const renderPlataforma = (p) => {
    const abierta = abiertasPlatEf.has(p.key);
    return (
      <div key={p.key}>
        <FilaPlataforma p={p} abierta={abierta} isMobile={isMobile} onClick={() => togglePlataforma(p.key)} />
        <Expandible abierto={abierta}>
          <div style={{ marginLeft: 8, borderLeft: `1px solid ${T.faint2}`, paddingLeft: 14, paddingTop: 2, paddingBottom: 6 }}>
            {p.campanas.map(renderCampana)}
            <FilaNuevaCampana alto={altoFila} plataformaInicial={p.key} onCrear={crear} />
          </div>
        </Expandible>
      </div>
    );
  };

  return (
    <div>
      {cargando && (
        <div>
          {[46, 34, 52, 28].map((w, i) => <FilaSkeleton key={i} alto={50} ancho={w} />)}
        </div>
      )}

      {!cargando && error && (
        <div style={{ textAlign: 'center', padding: '44px 16px' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🤦</div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>No pudimos traer las campañas</div>
          <div style={{ fontSize: 12, color: T.ink3, marginTop: 4, marginBottom: 14 }}>{error.message || 'Error inesperado'}</div>
          <Btn sm accent onClick={reintentar}>↻ Reintentar</Btn>
        </div>
      )}

      {!cargando && !error && vacio && (
        <div>
          <div style={{ textAlign: 'center', padding: '40px 16px 6px', color: T.ink3 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📣</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>Todavía no hay campañas para medir</div>
            <div style={{ fontSize: 12.5, color: T.ink2, marginTop: 6 }}>
              Cargá la primera acá abajo y empezá a ver qué plataforma te trae respuestas.
            </div>
          </div>
          <div style={{ maxWidth: 520, margin: '10px auto 0' }}>
            <FilaNuevaCampana alto={altoFila} abiertoInicial onCrear={crear} />
          </div>
        </div>
      )}

      {!cargando && !error && !vacio && (
        <div>
          {arbol.map(renderPlataforma)}
          {/* "+ campaña" global, siempre visible al pie (el usuario elige la plataforma). */}
          <FilaNuevaCampana alto={altoFila} onCrear={crear} />
        </div>
      )}

      <style>{`
        @keyframes vcPulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 0.28; } }
        .vc-skel { animation: vcPulse 1.3s ease-in-out infinite; }
        .vc-fila:hover { background: rgba(234, 230, 218, 0.55); }
      `}</style>
    </div>
  );
}
