import { useEffect, useMemo, useRef, useState } from 'react';
import { Btn } from '../../components/ui';
import { T } from '../../theme';
import { useCampanas } from '../../store/CampanasContext';
import { supabase } from '../../lib/supabase';
import { seriePorSemana, serieRespuestasPorSemana } from '../../lib/campanas/kpis';
import { fmtN } from '../../lib/format';

// "Ritmo de la campaña" — panel colapsable del Explorador (CampExplorador).
// Rediseño total (2026-07): UNA curva suave de UNA métrica por vez (Respuestas
// o Toques por semana), estilo app financiera: titular grande con tendencia,
// spline Catmull-Rom con degradado, ejes casi invisibles, crosshair + tooltip
// y animación de trazo al entrar. Vista tabla accesible detrás del microlink
// "tabla". Carga sus propios datos al montarse (el Explorador lo monta recién
// cuando el usuario abre "📈 Ritmo", así que el costo es on-demand): últimas
// 500 actividades + respondido_at de los miembros de listas.

// Color único de TODO el gráfico (curva, degradado, dots). Teal validado con el
// validador de paletas del dataviz sobre superficie clara (mismo teal que ya
// estaba validado sobre T.paper en el dashboard viejo).
const COLOR = '#12969a';
const CARD_BG = '#ffffff'; // fondo de la card — el anillo de los dots lo usa

const METRICAS = {
  respuestas: { label: 'Respuestas', unidad: 'respuestas' },
  toques: { label: 'Toques', unidad: 'toques' },
};

const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const etiquetaSemana = (iso) => {
  const [, m, d] = String(iso || '').split('-');
  return m ? `${+d} ${MESES_CORTO[+m - 1] || ''}` : '';
};

const r2 = (v) => Math.round(v * 100) / 100;

// Spline Catmull-Rom → cubic bezier (NUNCA segmentos rectos). Los puntos de
// control se acotan en Y al área de dibujo para que la curva no "sobregire"
// por debajo de la baseline cerca de semanas en cero.
function trazoSuave(pts, yTecho, yPiso) {
  if (pts.length < 2) return '';
  const acotar = (v) => Math.max(yTecho, Math.min(yPiso, v));
  let d = `M ${r2(pts[0].x)} ${r2(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    d += ` C ${r2(p1.x + (p2.x - p0.x) / 6)} ${r2(acotar(p1.y + (p2.y - p0.y) / 6))}`
      + ` ${r2(p2.x - (p3.x - p1.x) / 6)} ${r2(acotar(p2.y - (p3.y - p1.y) / 6))}`
      + ` ${r2(p2.x)} ${r2(p2.y)}`;
  }
  return d;
}

// Índices de las 3-4 fechas del eje X: primera, última y 1-2 intermedias.
function indicesFechas(n) {
  if (n <= 4) return Array.from({ length: n }, (_, i) => i);
  return [...new Set([0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1])];
}

// ── Piezas chicas de UI ──────────────────────────────────────────────────────

// Selector segmentado discreto (pills chicas sobre fondo suave).
function Pills({ opciones, valor, onElegir, etiqueta }) {
  return (
    <div role="group" aria-label={etiqueta} style={{ display: 'inline-flex', gap: 2, background: T.faint, borderRadius: 999, padding: 2 }}>
      {opciones.map((op) => {
        const activa = op.valor === valor;
        return (
          <button
            key={op.valor}
            type="button"
            onClick={() => onElegir(op.valor)}
            aria-pressed={activa}
            style={{
              border: 'none', borderRadius: 999, padding: '3px 10px', fontSize: 11, lineHeight: 1.5,
              fontFamily: T.font, cursor: 'pointer', whiteSpace: 'nowrap',
              background: activa ? CARD_BG : 'transparent',
              color: activa ? T.ink : T.ink3,
              fontWeight: activa ? 700 : 500,
              boxShadow: activa ? '0 1px 2px rgba(45,45,45,0.10)' : 'none',
              transition: 'background .15s ease, color .15s ease',
            }}
          >
            {op.label}
          </button>
        );
      })}
    </div>
  );
}

// Flecha de tendencia del titular: ▲ ok / ▼ warn, % vs semana anterior.
function Tendencia({ actual, previa }) {
  const estilo = (color) => ({ color, fontFamily: T.fontMono, fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' });
  if (!Number.isFinite(previa) || (previa === 0 && actual === 0)) return null;
  if (previa === 0) return <span title="La semana anterior no tuvo registros" style={estilo(T.ok)}>▲</span>;
  const pct = Math.round(((actual - previa) / previa) * 100);
  if (pct === 0) return <span title="vs semana anterior" style={estilo(T.ink3)}>= 0%</span>;
  return (
    <span title="vs semana anterior" style={estilo(pct > 0 ? T.ok : T.warn)}>
      {pct > 0 ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  );
}

// ── La curva ─────────────────────────────────────────────────────────────────

// filas: [{ semanaIso, valor }] (siempre ≥ 4: el esqueleto de kpis.js rellena
// con ceros). claveAnim reinicia la animación de trazo al cambiar métrica/rango.
function CurvaRitmo({ filas, unidad, claveAnim }) {
  const cajaRef = useRef(null);
  const [ancho, setAncho] = useState(640);
  const [hoverIdx, setHoverIdx] = useState(null);
  const [pinIdx, setPinIdx] = useState(null); // tap fija; tap afuera suelta

  // Ancho real de la caja → coordenadas SVG 1:1 con px CSS (texto siempre nítido).
  useEffect(() => {
    const el = cajaRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entradas) => {
      const w = entradas[0]?.contentRect?.width || 0;
      if (w > 0) setAncho(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Tap/click fuera del gráfico suelta el tooltip fijado (el overlay hace
  // stopPropagation para que fijar/alternar no se auto-cierre).
  useEffect(() => {
    if (pinIdx == null) return undefined;
    const soltar = () => setPinIdx(null);
    document.addEventListener('pointerdown', soltar);
    return () => document.removeEventListener('pointerdown', soltar);
  }, [pinIdx]);

  // ── Geometría ──────────────────────────────────────────────────────────────
  const n = filas.length;
  const H = 210; const padL = 40; const padR = 18; const padT = 16; const padB = 26;
  const innerW = Math.max(ancho - padL - padR, 40);
  const innerH = H - padT - padB;
  const yBase = padT + innerH;
  const maxVal = Math.max(0, ...filas.map((f) => f.valor));
  const maxY = Math.max(4, Math.ceil(maxVal / 4) * 4); // múltiplo de 4 → mitad entera
  const paso = n > 1 ? innerW / (n - 1) : innerW;
  const xDe = (i) => padL + i * paso;
  const yDe = (v) => padT + innerH - (v / maxY) * innerH;

  const puntos = filas.map((f, i) => ({ x: xDe(i), y: yDe(f.valor) }));
  const dCurva = trazoSuave(puntos, padT, yBase);
  const dArea = `${dCurva} L ${r2(xDe(n - 1))} ${yBase} L ${r2(xDe(0))} ${yBase} Z`;
  const ultimo = puntos[n - 1];

  const bruto = pinIdx != null ? pinIdx : hoverIdx;
  const activo = bruto != null && bruto >= 0 && bruto < n ? bruto : null;
  const pAct = activo != null ? puntos[activo] : null;

  const idxDesdeEvento = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.round((e.clientX - rect.left) / paso)));
  };

  return (
    <div ref={cajaRef} style={{ position: 'relative' }}>
      <svg
        width="100%" height={H} viewBox={`0 0 ${ancho} ${H}`} role="img"
        aria-label={`Curva de ${unidad} por semana, últimas ${n} semanas`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id="ritmoDegrade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLOR} stopOpacity={0.16} />
            <stop offset="100%" stopColor={COLOR} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Ejes casi invisibles: 3 hairlines con número chiquito; 3-4 fechas */}
        {[0, maxY / 2, maxY].map((t) => (
          <g key={t}>
            <line x1={padL} x2={ancho - padR} y1={r2(yDe(t))} y2={r2(yDe(t))} stroke={T.faint} strokeWidth={1} />
            <text x={padL - 8} y={r2(yDe(t)) + 3} textAnchor="end" fontSize={10} fill={T.ink3} fontFamily={T.fontMono}>
              {fmtN(t)}
            </text>
          </g>
        ))}
        {indicesFechas(n).map((i) => (
          <text
            key={`f-${filas[i].semanaIso}`}
            x={r2(xDe(i))} y={H - 8}
            textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
            fontSize={10} fill={T.ink3} fontFamily={T.fontMono}
          >
            {etiquetaSemana(filas[i].semanaIso)}
          </text>
        ))}

        {/* Área + curva + dot final — la key reinicia el trazo animado */}
        <g key={claveAnim}>
          <path className="ritmoArea" d={dArea} fill="url(#ritmoDegrade)" />
          <path
            className="ritmoCurva" d={dCurva} fill="none" stroke={COLOR} strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round" pathLength={1}
          />
          <circle className="ritmoDotFin" cx={r2(ultimo.x)} cy={r2(ultimo.y)} r={4} fill={COLOR} stroke={CARD_BG} strokeWidth={2} />
        </g>

        {/* Crosshair + dot de la semana activa (hover o fijada) */}
        {pAct != null && (
          <g style={{ pointerEvents: 'none' }}>
            <line x1={r2(pAct.x)} x2={r2(pAct.x)} y1={padT} y2={yBase} stroke={T.faint2} strokeWidth={1} />
            <circle cx={r2(pAct.x)} cy={r2(pAct.y)} r={4} fill={COLOR} stroke={CARD_BG} strokeWidth={2} />
          </g>
        )}

        {/* Overlay de interacción: toda el área es hit target; teclado ←/→/Esc */}
        <rect
          x={padL} y={padT} width={innerW} height={innerH} fill="transparent"
          style={{ cursor: 'crosshair', touchAction: 'pan-y' }} tabIndex={0}
          aria-label="Explorar semanas: flechas izquierda y derecha; Escape suelta"
          onPointerMove={(e) => setHoverIdx(idxDesdeEvento(e))}
          onPointerLeave={() => setHoverIdx(null)}
          onPointerDown={(e) => {
            e.stopPropagation();
            const i = idxDesdeEvento(e);
            setPinIdx((p) => (p === i ? null : i));
          }}
          onFocus={() => setHoverIdx(n - 1)}
          onBlur={() => setHoverIdx(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setPinIdx(null); return; }
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const d = e.key === 'ArrowLeft' ? -1 : 1;
            setPinIdx((p) => Math.max(0, Math.min(n - 1, (p != null ? p : n - 1) + d)));
          }}
        />
      </svg>

      {/* Tooltip flotante minimalista: semana + valor */}
      {activo != null && (
        <div
          style={{
            position: 'absolute',
            left: Math.max(64, Math.min(ancho - 64, pAct.x)),
            top: pAct.y < 52 ? pAct.y + 14 : pAct.y - 10,
            transform: pAct.y < 52 ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
            background: T.ink, color: T.paper, borderRadius: 8, padding: '5px 10px',
            fontSize: 11, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 5,
            boxShadow: '0 6px 18px rgba(45,45,45,0.22)',
          }}
        >
          <span style={{ opacity: 0.72 }}>Sem. del {etiquetaSemana(filas[activo].semanaIso)}</span>
          <span style={{ fontFamily: T.fontMono, fontWeight: 700, marginLeft: 8 }}>{fmtN(filas[activo].valor)}</span>
          <span style={{ opacity: 0.72, marginLeft: 4 }}>{unidad}</span>
        </div>
      )}
    </div>
  );
}

// ── Vista tabla accesible (gemela sobria de la curva: semana × valor) ────────

function TablaRitmo({ filas, etiquetaValor }) {
  const th = {
    fontSize: 9, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 0.8, fontWeight: 700,
    textTransform: 'uppercase', padding: '4px 8px', borderBottom: `1.5px solid ${T.faint2}`, whiteSpace: 'nowrap',
  };
  const td = {
    fontSize: 11.5, color: T.ink, padding: '5px 8px', borderBottom: `1px dashed ${T.faint2}`, whiteSpace: 'nowrap',
  };
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr>
          <th style={{ ...th, textAlign: 'left' }}>Semana</th>
          <th style={{ ...th, textAlign: 'right' }}>{etiquetaValor}</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((f) => (
          <tr key={f.semanaIso}>
            <td style={{ ...td, color: T.ink2 }}>{etiquetaSemana(f.semanaIso)}</td>
            <td style={{ ...td, textAlign: 'right', fontFamily: T.fontMono, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {fmtN(f.valor)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Carga de datos (módulo: no toca estado de React) ─────────────────────────
// Últimas 500 actividades + respondido_at de miembros de listas. Los miembros
// se leen DIRECTO de camp_lista_miembros (el contrato del context no expone un
// fetch con estado), paginados de a 1000 (PostgREST capea cada request), tope
// sano de 10.000 — mismo patrón del dashboard que este panel reemplaza.
async function cargarDatosRitmo(camp) {
  const [actsR, listasR] = await Promise.all([
    camp.fetchActividades({ limit: 500 }),
    camp.fetchListas(),
  ]);
  const err = actsR.error || listasR.error;
  if (err) throw new Error(err.message || 'Error consultando la base de campañas');

  const listaIds = (listasR.rows || []).map((l) => l.id).filter(Boolean);
  const miembros = [];
  if (listaIds.length > 0) {
    const pageSize = 1000;
    for (let desde = 0; desde < 10000; desde += pageSize) {
      const { data, error } = await supabase
        .from('camp_lista_miembros')
        .select('lista_id, respondido_at')
        .in('lista_id', listaIds)
        .range(desde, desde + pageSize - 1);
      if (error) throw new Error(error.message);
      miembros.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
  }
  return { actividades: actsR.rows || [], miembros };
}

// ── Panel ────────────────────────────────────────────────────────────────────

export default function RitmoCampana() {
  const camp = useCampanas();
  const [carga, setCarga] = useState({ estado: 'cargando', datos: null, error: '' });
  const [metrica, setMetrica] = useState('respuestas');
  const [semanas, setSemanas] = useState(8);
  const [vistaTabla, setVistaTabla] = useState(false);
  const [tick, setTick] = useState(0); // bump → recarga (Reintentar)

  // setState SOLO en .then/.catch (regla react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!camp) return undefined;
    let vivo = true;
    cargarDatosRitmo(camp)
      .then((datos) => { if (vivo) setCarga({ estado: 'listo', datos, error: '' }); })
      .catch((e) => { if (vivo) setCarga({ estado: 'error', datos: null, error: e?.message || 'Error inesperado' }); });
    return () => { vivo = false; };
  }, [camp, tick]);

  const reintentar = () => {
    setCarga({ estado: 'cargando', datos: null, error: '' });
    setTick((t) => t + 1);
  };

  const actividades = useMemo(() => carga.datos?.actividades || [], [carga.datos]);
  const serie = useMemo(() => seriePorSemana({ actividades, semanas }), [actividades, semanas]);
  const serieRespuestas = useMemo(
    () => serieRespuestasPorSemana({ actividades, miembros: carga.datos?.miembros || [], semanas }),
    [actividades, carga.datos, semanas],
  );
  const serieVacia = serie.every((s) => (s.total || 0) === 0)
    && serieRespuestas.every((s) => (s.respuestas || 0) === 0);

  // La única serie que se dibuja: la métrica activa, semana × valor.
  const filas = useMemo(() => (
    metrica === 'toques'
      ? serie.map((s) => ({ semanaIso: s.semanaIso, valor: s.total || 0 }))
      : serieRespuestas.map((s) => ({ semanaIso: s.semanaIso, valor: s.respuestas || 0 }))
  ), [metrica, serie, serieRespuestas]);

  const n = filas.length;
  const valorActual = n > 0 ? filas[n - 1].valor : 0;
  const valorPrevio = n > 1 ? filas[n - 2].valor : null;
  const { unidad, label } = METRICAS[metrica];

  return (
    <div
      className="ritmoCard"
      style={{
        background: CARD_BG, borderRadius: 12, border: `1px solid ${T.faint}`,
        boxShadow: '0 1px 2px rgba(45,45,45,0.04), 0 10px 30px rgba(45,45,45,0.05)',
      }}
    >
      {/* Título de sección chiquito, uppercase */}
      <div style={{
        fontSize: 10, fontFamily: T.fontMono, fontWeight: 700, letterSpacing: 1.2,
        textTransform: 'uppercase', color: T.ink3, marginBottom: 14,
      }}>
        Ritmo de la campaña
      </div>

      {carga.estado === 'cargando' && (
        <div style={{ height: 220, borderRadius: 8, background: T.faint, animation: 'ritmoPulso 1.3s ease-in-out infinite' }} />
      )}

      {carga.estado === 'error' && (
        <div style={{ padding: '28px 12px', textAlign: 'center' }}>
          <div style={{ fontSize: 12.5, color: T.ink2, marginBottom: 10 }}>
            No pudimos traer el ritmo{carga.error ? ` (${carga.error})` : ''}.
          </div>
          <Btn sm accent onClick={reintentar}>↻ Reintentar</Btn>
        </div>
      )}

      {carga.estado === 'listo' && serieVacia && (
        <div style={{ padding: '36px 8px', textAlign: 'center', fontSize: 12.5, color: T.ink2, lineHeight: 1.6 }}>
          Todavía no hay movimiento en estas semanas.<br />
          <span style={{ fontSize: 11.5, color: T.ink3 }}>
            Apenas se registren toques o respuestas, acá se dibuja la curva sola.
          </span>
        </div>
      )}

      {carga.estado === 'listo' && !serieVacia && (
        <>
          {/* Titular grande + selectores discretos */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px 16px', flexWrap: 'wrap', marginBottom: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span className="ritmoTitular" style={{ fontFamily: T.fontMono, fontWeight: 700, color: T.ink, lineHeight: 1.05, letterSpacing: -0.5 }}>
                  {fmtN(valorActual)}
                </span>
                <Tendencia actual={valorActual} previa={valorPrevio} />
              </div>
              <div style={{ fontSize: 11, color: T.ink3, marginTop: 3 }}>{unidad} esta semana</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Pills
                etiqueta="Métrica de la curva"
                valor={metrica}
                onElegir={(v) => setMetrica(v)}
                opciones={[
                  { valor: 'respuestas', label: 'Respuestas' },
                  { valor: 'toques', label: 'Toques' },
                ]}
              />
              <Pills
                etiqueta="Rango de semanas"
                valor={semanas}
                onElegir={(v) => setSemanas(v)}
                opciones={[
                  { valor: 4, label: '4 sem' },
                  { valor: 8, label: '8 sem' },
                  { valor: 12, label: '12 sem' },
                ]}
              />
            </div>
          </div>

          {vistaTabla
            ? <TablaRitmo filas={filas} etiquetaValor={label} />
            : <CurvaRitmo filas={filas} unidad={unidad} claveAnim={`${metrica}-${semanas}`} />}

          {/* Pie: franja de honestidad discretísima + microlink tabla/curva */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginTop: 10 }}>
            <span style={{ fontSize: 10, color: T.ink3, opacity: 0.85 }}>
              Sobre las últimas 500 actividades (las más recientes).
            </span>
            <button
              type="button"
              onClick={() => setVistaTabla((v) => !v)}
              title={vistaTabla ? 'Volver a la curva' : 'Ver los números en tabla'}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontSize: 10.5, color: T.ink3, fontFamily: T.font, textDecoration: 'underline dotted',
              }}
            >
              {vistaTabla ? 'curva' : 'tabla'}
            </button>
          </div>
        </>
      )}

      <style>{`
        @keyframes ritmoPulso { 0%, 100% { opacity: 0.6; } 50% { opacity: 0.3; } }
        @keyframes ritmoTrazo { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
        @keyframes ritmoAparece { from { opacity: 0; } to { opacity: 1; } }
        .ritmoCurva { stroke-dasharray: 1; animation: ritmoTrazo 0.6s ease-out both; }
        .ritmoArea { animation: ritmoAparece 0.6s ease-out both; }
        .ritmoDotFin { animation: ritmoAparece 0.35s ease-out 0.4s both; }
        .ritmoCard { padding: 22px 24px; }
        .ritmoTitular { font-size: 30px; }
        @media (max-width: 640px) {
          .ritmoCard { padding: 18px 16px; }
          .ritmoTitular { font-size: 24px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ritmoCurva, .ritmoArea, .ritmoDotFin { animation: none; }
        }
      `}</style>
    </div>
  );
}
