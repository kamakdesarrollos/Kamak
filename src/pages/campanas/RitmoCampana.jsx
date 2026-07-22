import { useEffect, useMemo, useRef, useState } from 'react';
import { Btn } from '../../components/ui';
import { T } from '../../theme';
import { useCampanas } from '../../store/CampanasContext';
import { supabase } from '../../lib/supabase';
import { seriePorSemana, serieRespuestasPorSemana } from '../../lib/campanas/kpis';
import { fmtN } from '../../lib/format';

// "Ritmo de la campaña" — panel colapsable del Explorador (CampExplorador).
// v3.1 (2026-07): hasta TRES curvas conviviendo — Respuestas (protagonista,
// teal con degradado), Toques (contexto, gris fino) y Reuniones (ámbar,
// apagada por defecto) — cada una toggleable desde chips-leyenda con su valor
// de la última semana. Se mantiene la estética validada: splines Catmull-Rom,
// ejes casi invisibles, animación de trazo, tooltip oscuro, card aireada.
// Etiquetas directas al final de cada curva visible; un solo eje Y compartido
// (todas son conteos) cuyo tope sigue a las curvas visibles. Vista tabla
// accesible (siempre las 3 métricas) detrás del microlink "tabla". Carga sus
// propios datos al montarse (el Explorador lo monta recién cuando el usuario
// abre "📈 Ritmo", así que el costo es on-demand): últimas 500 actividades +
// respondido_at de los miembros de listas.

const CARD_BG = '#ffffff'; // fondo de la card — anillos de dots y halos de etiquetas

// Las 3 curvas. Trío teal / gris / ámbar ya validado junto (CVD + contraste)
// con el validador dataviz sobre esta superficie. Solo la protagonista lleva
// degradado debajo; Toques es contexto (más finita, sin relleno).
const CURVAS = {
  respuestas: { label: 'Respuestas', unidad: 'respuestas', color: '#12969a', grosor: 2, area: true },
  toques: { label: 'Toques', unidad: 'toques', color: T.ink3, grosor: 1.5, area: false },
  reuniones: { label: 'Reuniones', unidad: 'reuniones', color: '#b97a1e', grosor: 2, area: false },
};
// Orden de UI (chips, tooltip, tabla, prioridad del titular)…
const ORDEN_CURVAS = ['respuestas', 'toques', 'reuniones'];
// …y orden de dibujo (la protagonista SIEMPRE arriba).
const ORDEN_DIBUJO = ['toques', 'reuniones', 'respuestas'];

const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const etiquetaSemana = (iso) => {
  const [, m, d] = String(iso || '').split('-');
  return m ? `${+d} ${MESES_CORTO[+m - 1] || ''}` : '';
};

const r2 = (v) => Math.round(v * 100) / 100;

// Lunes (00:00 local) de la semana de una fecha, como YYYY-MM-DD — misma
// semana ISO que usa esqueletoSemanas en kpis.js (helper interno, no exportado),
// para que la agregación local de reuniones quede alineada con las otras series.
function lunesIsoDe(fechaCruda) {
  if (!fechaCruda) return null;
  const d = fechaCruda instanceof Date ? fechaCruda : new Date(fechaCruda);
  if (Number.isNaN(d.getTime())) return null;
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

// Reuniones por semana (pura): cuenta actividades tipo 'reunion' en las mismas
// semanas del esqueleto compartido. kpis.js no expone este agregado — se
// calcula acá client-side con las actividades ya cargadas.
function reunionesPorSemana(actividades, semanasIso) {
  const idx = new Map(semanasIso.map((iso, i) => [iso, i]));
  const valores = semanasIso.map(() => 0);
  for (const a of actividades || []) {
    if (a?.tipo !== 'reunion') continue;
    const i = idx.get(lunesIsoDe(a?.fecha));
    if (i != null) valores[i] += 1;
  }
  return valores;
}

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

// Separa verticalmente las etiquetas directas para que no se pisen: pasada
// hacia abajo (gap mínimo) + pasada hacia arriba si la última se pasó del piso.
// Muta los items (son objetos frescos de cada render) y los devuelve por y asc.
function acomodarEtiquetas(items, techo, piso, gap = 13) {
  const orden = [...items].sort((a, b) => a.y - b.y);
  for (let i = 0; i < orden.length; i += 1) {
    orden[i].y = Math.max(i === 0 ? techo : orden[i - 1].y + gap, orden[i].y);
  }
  for (let i = orden.length - 1; i >= 0; i -= 1) {
    orden[i].y = Math.min(i === orden.length - 1 ? piso : orden[i + 1].y - gap, orden[i].y);
  }
  return orden;
}

// ── Piezas chicas de UI ──────────────────────────────────────────────────────

// Selector segmentado discreto (pills chicas sobre fondo suave) — hoy solo
// para el rango de semanas.
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

// Chips-leyenda que reemplazan al viejo selector de métrica: punto de color +
// nombre + valor de la última semana; cada chip prende/apaga su curva. Mismo
// lenguaje pill discreto que el rango 4/8/12. La apagada queda gris con
// opacidad. El mínimo de una curva prendida lo garantiza el padre (toggleCurva).
function ChipsCurvas({ visibles, ultimos, onToggle }) {
  return (
    <div role="group" aria-label="Curvas del gráfico" style={{ display: 'inline-flex', gap: 2, background: T.faint, borderRadius: 999, padding: 2, flexWrap: 'wrap' }}>
      {ORDEN_CURVAS.map((k) => {
        const c = CURVAS[k];
        const on = !!visibles[k];
        return (
          <button
            key={k}
            type="button"
            onClick={() => onToggle(k)}
            aria-pressed={on}
            title={on ? `Ocultar ${c.label.toLowerCase()}` : `Mostrar ${c.label.toLowerCase()}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              border: 'none', borderRadius: 999, padding: '3px 10px', fontSize: 11, lineHeight: 1.5,
              fontFamily: T.font, cursor: 'pointer', whiteSpace: 'nowrap',
              background: on ? CARD_BG : 'transparent',
              color: on ? T.ink : T.ink3,
              fontWeight: on ? 700 : 500,
              opacity: on ? 1 : 0.6,
              boxShadow: on ? '0 1px 2px rgba(45,45,45,0.10)' : 'none',
              transition: 'background .15s ease, color .15s ease, opacity .15s ease',
            }}
          >
            <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: on ? c.color : T.ink3, flex: 'none' }} />
            {c.label}
            <span style={{ fontFamily: T.fontMono, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: on ? c.color : T.ink3 }}>
              {fmtN(ultimos[k] || 0)}
            </span>
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

// ── Las curvas ───────────────────────────────────────────────────────────────

// series: las 3 curvas en orden de UI [{ key, label, color, grosor, area,
// visible, gen, valores }] — se renderizan TODAS (las apagadas con opacity 0,
// para que apagar sea un fade rápido vía transición CSS), pero solo las
// visibles definen la escala, las etiquetas directas, los dots y el tooltip.
// claveRango reinicia el trazo animado al cambiar el rango; gen (contador por
// curva, lo sube el padre al prenderla) lo reinicia al prender esa curva —
// el cambio de key remonta el <g> y la animación CSS corre de nuevo.
function CurvaRitmo({ series, semanasIso, claveRango }) {
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
  const n = semanasIso.length;
  const visibles = series.filter((s) => s.visible); // en orden de UI
  const dibujo = ORDEN_DIBUJO.map((k) => series.find((s) => s.key === k)).filter(Boolean);

  const H = 210; const padL = 40; const padT = 16; const padB = 26;
  // Margen derecho elástico: lugar para la etiqueta directa más larga visible.
  const ultChars = Math.max(1, ...visibles.map((s) => fmtN(s.valores[n - 1] || 0).length));
  const padR = Math.max(18, 13 + ultChars * 7);
  const innerW = Math.max(ancho - padL - padR, 40);
  const innerH = H - padT - padB;
  const yBase = padT + innerH;
  // Un solo eje Y compartido (todas son conteos): tope = máximo de las curvas
  // VISIBLES — recalcula al togglear (sin transición de paths: simplicidad).
  const maxVal = Math.max(0, ...visibles.flatMap((s) => s.valores));
  const maxY = Math.max(4, Math.ceil(maxVal / 4) * 4); // múltiplo de 4 → mitad entera
  const paso = n > 1 ? innerW / (n - 1) : innerW;
  const xDe = (i) => padL + i * paso;
  const yDe = (v) => padT + innerH - (v / maxY) * innerH;

  // Etiquetas directas: el último valor de cada curva visible, en su color,
  // al extremo derecho — separadas verticalmente para que no se pisen.
  const etiquetas = acomodarEtiquetas(
    visibles.map((s) => ({
      key: s.key, color: s.color, gen: s.gen, valor: s.valores[n - 1] || 0, y: yDe(s.valores[n - 1] || 0),
    })),
    padT + 4,
    yBase + 2,
  );

  const bruto = pinIdx != null ? pinIdx : hoverIdx;
  const activo = bruto != null && bruto >= 0 && bruto < n ? bruto : null;
  const xAct = activo != null ? xDe(activo) : null;
  const ysAct = activo != null ? visibles.map((s) => yDe(s.valores[activo] || 0)) : [];
  const yActMin = ysAct.length > 0 ? Math.min(...ysAct) : 0;
  const yActMax = ysAct.length > 0 ? Math.max(...ysAct) : 0;
  // El tooltip crece con las curvas visibles: si arriba no entra, va debajo.
  const tooltipAbajo = yActMin - (30 + visibles.length * 17) - 10 < 0;

  const idxDesdeEvento = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.round((e.clientX - rect.left) / paso)));
  };

  return (
    <div ref={cajaRef} style={{ position: 'relative' }}>
      <svg
        width="100%" height={H} viewBox={`0 0 ${ancho} ${H}`} role="img"
        aria-label={`Curvas de ${visibles.map((s) => s.label.toLowerCase()).join(', ')} por semana, últimas ${n} semanas`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id="ritmoDegrade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CURVAS.respuestas.color} stopOpacity={0.16} />
            <stop offset="100%" stopColor={CURVAS.respuestas.color} stopOpacity={0} />
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
            key={`f-${semanasIso[i]}`}
            x={r2(xDe(i))} y={H - 8}
            textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
            fontSize={10} fill={T.ink3} fontFamily={T.fontMono}
          >
            {etiquetaSemana(semanasIso[i])}
          </text>
        ))}

        {/* Curvas (contexto abajo, protagonista arriba). Prender = remonta por
            key (gen) → trazo animado; apagar = mismo nodo, fade por opacity. */}
        {dibujo.map((s) => {
          const pts = s.valores.map((v, i) => ({ x: xDe(i), y: yDe(v || 0) }));
          const dCurva = trazoSuave(pts, padT, yBase);
          const fin = pts[n - 1];
          return (
            <g
              key={`${s.key}-${claveRango}-${s.gen}`}
              className="ritmoSerie"
              style={{ opacity: s.visible ? 1 : 0, pointerEvents: 'none' }}
              aria-hidden={s.visible ? undefined : true}
            >
              {s.area && (
                <path
                  className="ritmoArea"
                  d={`${dCurva} L ${r2(xDe(n - 1))} ${yBase} L ${r2(xDe(0))} ${yBase} Z`}
                  fill="url(#ritmoDegrade)"
                />
              )}
              <path
                className="ritmoCurva" d={dCurva} fill="none" stroke={s.color} strokeWidth={s.grosor}
                strokeLinecap="round" strokeLinejoin="round" pathLength={1}
              />
              <circle
                className="ritmoDotFin" cx={r2(fin.x)} cy={r2(fin.y)} r={s.grosor >= 2 ? 4 : 3.5}
                fill={s.color} stroke={CARD_BG} strokeWidth={2}
              />
            </g>
          );
        })}

        {/* Etiquetas directas con halo papel (paint-order) para legibilidad */}
        {etiquetas.map((et) => (
          <text
            key={`et-${et.key}-${claveRango}-${et.gen}`}
            className="ritmoEtiqueta"
            x={r2(xDe(n - 1) + 7)} y={r2(et.y + 3.5)}
            fontSize={11} fontFamily={T.fontMono} fontWeight={700}
            fill={et.color} stroke={CARD_BG} strokeWidth={3.5} strokeLinejoin="round" paintOrder="stroke"
          >
            {fmtN(et.valor)}
          </text>
        ))}

        {/* Crosshair + un dot por curva visible en la semana activa */}
        {activo != null && (
          <g style={{ pointerEvents: 'none' }}>
            <line x1={r2(xAct)} x2={r2(xAct)} y1={padT} y2={yBase} stroke={T.faint2} strokeWidth={1} />
            {dibujo.filter((s) => s.visible).map((s) => (
              <circle
                key={s.key} cx={r2(xAct)} cy={r2(yDe(s.valores[activo] || 0))} r={4}
                fill={s.color} stroke={CARD_BG} strokeWidth={2}
              />
            ))}
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

      {/* Tooltip flotante: semana + una fila por curva visible */}
      {activo != null && (
        <div
          style={{
            position: 'absolute',
            left: Math.max(76, Math.min(ancho - 76, xAct)),
            top: tooltipAbajo ? yActMax + 14 : yActMin - 10,
            transform: tooltipAbajo ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
            background: T.ink, color: T.paper, borderRadius: 8, padding: '6px 10px',
            fontSize: 11, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 5,
            boxShadow: '0 6px 18px rgba(45,45,45,0.22)',
          }}
        >
          <div style={{ opacity: 0.72 }}>Sem. del {etiquetaSemana(semanasIso[activo])}</div>
          {visibles.map((s) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
              <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: s.color, flex: 'none' }} />
              <span style={{ opacity: 0.85 }}>{s.label}</span>
              <span style={{ fontFamily: T.fontMono, fontWeight: 700, marginLeft: 'auto', paddingLeft: 12 }}>
                {fmtN(s.valores[activo] || 0)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Vista tabla accesible (gemela sobria: semana × las 3 métricas) ───────────
// Siempre muestra las 3 columnas, esté la curva prendida o no — es tabla.

function TablaRitmo({ semanasIso, series }) {
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
          {series.map((s) => (
            <th key={s.key} style={{ ...th, textAlign: 'right' }}>{s.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {semanasIso.map((iso, i) => (
          <tr key={iso}>
            <td style={{ ...td, color: T.ink2 }}>{etiquetaSemana(iso)}</td>
            {series.map((s) => (
              <td
                key={s.key}
                style={{ ...td, textAlign: 'right', fontFamily: T.fontMono, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
              >
                {fmtN(s.valores[i] || 0)}
              </td>
            ))}
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
  // Curvas prendidas + "generación" por curva (sube al prenderla → remonta el
  // <g> por key y el trazo se vuelve a dibujar).
  const [visibles, setVisibles] = useState({ respuestas: true, toques: true, reuniones: false });
  const [gen, setGen] = useState({ respuestas: 0, toques: 0, reuniones: 0 });
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

  const semanasIso = useMemo(() => serie.map((s) => s.semanaIso), [serie]);
  // Los valores de las 3 curvas, alineados por semana (mismo esqueleto).
  const valores = useMemo(() => ({
    respuestas: serieRespuestas.map((s) => s.respuestas || 0),
    toques: serie.map((s) => s.total || 0),
    reuniones: reunionesPorSemana(actividades, serie.map((s) => s.semanaIso)),
  }), [serie, serieRespuestas, actividades]);

  const series = useMemo(() => ORDEN_CURVAS.map((k) => ({
    key: k, ...CURVAS[k], visible: !!visibles[k], gen: gen[k] || 0, valores: valores[k],
  })), [visibles, gen, valores]);

  const toggleCurva = (k) => {
    if (visibles[k] && ORDEN_CURVAS.filter((c) => visibles[c]).length === 1) return; // mínimo una prendida
    if (!visibles[k]) setGen((g) => ({ ...g, [k]: (g[k] || 0) + 1 })); // prender → trazo animado
    setVisibles((v) => ({ ...v, [k]: !v[k] }));
  };

  const n = semanasIso.length;
  const ultimos = Object.fromEntries(ORDEN_CURVAS.map((k) => [k, n > 0 ? valores[k][n - 1] || 0 : 0]));
  // El titular es LA métrica (Respuestas); si está apagada, la primera visible.
  const claveTitular = ORDEN_CURVAS.find((k) => visibles[k]) || 'respuestas';
  const valoresTitular = valores[claveTitular];
  const valorActual = n > 0 ? valoresTitular[n - 1] || 0 : 0;
  const valorPrevio = n > 1 ? valoresTitular[n - 2] || 0 : null;

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
          {/* Titular grande + chips de curvas + rango */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px 16px', flexWrap: 'wrap', marginBottom: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span className="ritmoTitular" style={{ fontFamily: T.fontMono, fontWeight: 700, color: T.ink, lineHeight: 1.05, letterSpacing: -0.5 }}>
                  {fmtN(valorActual)}
                </span>
                <Tendencia actual={valorActual} previa={valorPrevio} />
              </div>
              <div style={{ fontSize: 11, color: T.ink3, marginTop: 3 }}>{CURVAS[claveTitular].unidad} esta semana</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <ChipsCurvas visibles={visibles} ultimos={ultimos} onToggle={toggleCurva} />
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
            ? <TablaRitmo semanasIso={semanasIso} series={series} />
            : <CurvaRitmo series={series} semanasIso={semanasIso} claveRango={semanas} />}

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
        .ritmoSerie { transition: opacity .18s ease; }
        .ritmoCurva { stroke-dasharray: 1; animation: ritmoTrazo 0.6s ease-out both; }
        .ritmoArea { animation: ritmoAparece 0.6s ease-out both; }
        .ritmoDotFin { animation: ritmoAparece 0.35s ease-out 0.4s both; }
        .ritmoEtiqueta { animation: ritmoAparece 0.35s ease-out 0.4s both; }
        .ritmoCard { padding: 22px 24px; }
        .ritmoTitular { font-size: 30px; }
        @media (max-width: 640px) {
          .ritmoCard { padding: 18px 16px; }
          .ritmoTitular { font-size: 24px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ritmoCurva, .ritmoArea, .ritmoDotFin, .ritmoEtiqueta { animation: none; }
          .ritmoSerie { transition: none; }
        }
      `}</style>
    </div>
  );
}
