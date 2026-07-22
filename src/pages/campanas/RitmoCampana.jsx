import { useEffect, useMemo, useState } from 'react';
import { Btn } from '../../components/ui';
import { T } from '../../theme';
import { useCampanas } from '../../store/CampanasContext';
import { supabase } from '../../lib/supabase';
import { seriePorSemana, serieRespuestasPorSemana } from '../../lib/campanas/kpis';
import { fmtN } from '../../lib/format';

// "Ritmo de la campaña" — panel colapsable del Explorador (CampExplorador).
// El gráfico es COPIA fiel del ChartRitmo de CampanasDashboard.jsx (que muere
// en la próxima ola y no se toca): barras apiladas de toques por canal + línea
// de Respuestas en el MISMO eje, leyenda interactiva, tooltip fijable y vista
// tabla accesible. Este componente además carga sus propios datos al montarse
// (el Explorador lo monta recién cuando el usuario abre "📈 Ritmo", así que el
// costo es on-demand): últimas 500 actividades + respondido_at de los miembros
// de listas (para la serie de respuestas).

// Colores por canal (validados con el validador de paletas del dataviz sobre
// T.paper — mismos del dashboard). Asignación FIJA por entidad; 'otro' queda
// fuera de los slots categóricos: gris recesivo, plegado al final del apilado.
const CANAL_META = {
  llamada:  { label: 'Llamadas', color: '#12969a' },
  email:    { label: 'Email',    color: '#3f66b0' },
  linkedin: { label: 'LinkedIn', color: '#b97a1e' },
  whatsapp: { label: 'WhatsApp', color: '#2e7032' },
  otro:     { label: 'Otro',     color: '#9a9892' },
};
const CANALES_FILTRO = ['llamada', 'email', 'linkedin', 'whatsapp'];

// Orden fijo del apilado (abajo → arriba); 'otro' se pliega al final.
const STACK_ORDEN = ['llamada', 'email', 'linkedin', 'whatsapp', 'otro'];

const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const etiquetaSemana = (iso) => {
  const [, m, d] = String(iso || '').split('-');
  return m ? `${+d} ${MESES_CORTO[+m - 1] || ''}` : '';
};

// % con coma decimal (los pct vienen con 1 decimal).
const fmtPct = (v) => String(Number.isFinite(v) ? v : 0).replace('.', ',');

// Rect con SOLO las esquinas de arriba redondeadas (cap del segmento superior).
function pathTopeRedondeado(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, h, w / 2));
  return `M ${x} ${y + h} L ${x} ${y + rr} Q ${x} ${y} ${x + rr} ${y} `
    + `L ${x + w - rr} ${y} Q ${x + w} ${y} ${x + w} ${y + rr} L ${x + w} ${y + h} Z`;
}

// Delta del mini-strip: ▲ ok / ▼ warn / = neutro, siempre con el número.
function DeltaSemana({ d, sufijo }) {
  if (d === 0) return <span style={{ color: T.ink3, fontWeight: 700, fontSize: 11 }}>= {sufijo}</span>;
  return (
    <span style={{ color: d > 0 ? T.ok : T.warn, fontWeight: 800, fontSize: 11, fontFamily: T.fontMono, whiteSpace: 'nowrap' }}>
      {d > 0 ? '▲' : '▼'} {fmtN(Math.abs(d))} {sufijo}
    </span>
  );
}

function ChartRitmo({ serie, respuestas, canales }) {
  const [ocultos, setOcultos] = useState(() => new Set()); // canales apagados desde la leyenda
  const [lineaOculta, setLineaOculta] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(null);
  const [pinIdx, setPinIdx] = useState(null); // tooltip fijado por tap/click
  const [vistaTabla, setVistaTabla] = useState(false);

  // Tap/click fuera del gráfico cierra el tooltip fijado (la columna hace
  // stopPropagation para que fijar/alternar no se auto-cierre).
  useEffect(() => {
    if (pinIdx == null) return undefined;
    const cerrar = () => setPinIdx(null);
    document.addEventListener('pointerdown', cerrar);
    return () => document.removeEventListener('pointerdown', cerrar);
  }, [pinIdx]);

  // Respuestas indexadas por semanaIso (robusto ante cualquier desalineación).
  const respPorSemana = useMemo(
    () => new Map((respuestas || []).map((r) => [r.semanaIso, r.respuestas || 0])),
    [respuestas],
  );

  const enLeyenda = STACK_ORDEN.filter((c) => canales.includes(c));
  const visibles = useMemo(
    () => STACK_ORDEN.filter((c) => canales.includes(c) && !ocultos.has(c)),
    [canales, ocultos],
  );

  // Todo (barras, línea, titulares, tooltip y tabla) sale de la MISMA rebanada
  // visible → los números siempre acuerdan entre sí.
  const semanas = useMemo(() => serie.map((s) => {
    const porCanal = visibles.map((c) => ({ canal: c, v: s.porCanal?.[c] || 0 }));
    const toques = porCanal.reduce((suma, x) => suma + x.v, 0);
    return { semanaIso: s.semanaIso, porCanal, toques, respuestas: respPorSemana.get(s.semanaIso) || 0 };
  }), [serie, respPorSemana, visibles]);

  const n = semanas.length;

  // ── Geometría (viewBox 1:1 con px al ancho mínimo → mobile scrollea) ───────
  const bandW = 56; const barW = 18; const GAP = 2;
  const padL = 36; const padR = 20; const padT = 18; const padB = 24; const innerH = 168;
  const W = padL + padR + n * bandW;
  const H = padT + innerH + padB;
  const maxDato = Math.max(0, ...semanas.map((s) => Math.max(s.toques, lineaOculta ? 0 : s.respuestas)));
  // Tope múltiplo de 4 → ticks (0, mitad, tope) siempre enteros. UN solo eje.
  const maxY = Math.max(4, Math.ceil(maxDato / 4) * 4);
  const cx = (i) => padL + (i + 0.5) * bandW;
  const yPx = (v) => padT + innerH - (v / maxY) * innerH;
  const ticksY = [0, maxY / 2, maxY];

  const activo = (() => {
    const idx = pinIdx != null ? pinIdx : hoverIdx;
    return idx != null && idx >= 0 && idx < n ? idx : null;
  })();
  const semActiva = activo != null ? semanas[activo] : null;
  const tasaDe = (s) => (s.toques > 0 ? `${fmtPct(Math.round((s.respuestas / s.toques) * 1000) / 10)}%` : '—');

  const actual = n > 0 ? semanas[n - 1] : null;
  const previa = n > 1 ? semanas[n - 2] : null;

  const toggleCanal = (c) => setOcultos((prev) => {
    const sig = new Set(prev);
    if (sig.has(c)) sig.delete(c); else sig.add(c);
    return sig;
  });

  const chip = (off) => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: T.ink2,
    border: `1px solid ${T.faint2}`, borderRadius: 999, padding: '3px 9px',
    background: 'transparent', cursor: 'pointer', fontFamily: T.font, opacity: off ? 0.45 : 1,
  });
  const filaTooltip = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '1.5px 0', whiteSpace: 'nowrap' };
  const th = {
    fontSize: 9, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 0.8, fontWeight: 700,
    textTransform: 'uppercase', textAlign: 'right', padding: '4px 8px',
    borderBottom: `1.5px solid ${T.faint2}`, whiteSpace: 'nowrap',
  };
  const td = {
    fontFamily: T.fontMono, fontSize: 11.5, color: T.ink, textAlign: 'right', padding: '5px 8px',
    borderBottom: `1px dashed ${T.faint2}`, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
  };

  return (
    <div>
      {/* Mini-strip de titulares: esta semana + delta vs la anterior */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px', marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: T.ink3 }}>Esta semana:</span>
        <span style={{ fontFamily: T.fontMono, fontSize: 12.5, fontWeight: 800, color: T.ink, whiteSpace: 'nowrap' }}>
          {fmtN(actual?.toques || 0)} toques · {fmtN(actual?.respuestas || 0)} respuestas
        </span>
        {previa && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <DeltaSemana d={actual.toques - previa.toques} sufijo="toques" />
            <DeltaSemana d={actual.respuestas - previa.respuestas} sufijo="resp." />
            <span style={{ fontSize: 10.5, color: T.ink3 }}>vs semana anterior</span>
          </span>
        )}
        <Btn sm onClick={() => setVistaTabla((v) => !v)} style={{ marginLeft: 'auto' }} title="Alternar entre gráfico y tabla">
          {vistaTabla ? '↩ Gráfico' : '⊞ Tabla'}
        </Btn>
      </div>

      {vistaTabla ? (
        /* Vista tabla — gemela accesible del gráfico (mismos números) */
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 420 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>Semana</th>
                {visibles.map((c) => (
                  <th key={c} style={th}>
                    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: CANAL_META[c].color, marginRight: 5 }} />
                    {CANAL_META[c].label}
                  </th>
                ))}
                <th style={th}>Toques</th>
                {!lineaOculta && <th style={th}>Respuestas</th>}
                {!lineaOculta && <th style={th}>Tasa</th>}
              </tr>
            </thead>
            <tbody>
              {semanas.map((s) => (
                <tr key={s.semanaIso}>
                  <td style={{ ...td, fontFamily: T.font, textAlign: 'left', color: T.ink2 }}>{etiquetaSemana(s.semanaIso)}</td>
                  {s.porCanal.map(({ canal, v }) => <td key={canal} style={td}>{fmtN(v)}</td>)}
                  <td style={{ ...td, fontWeight: 700 }}>{fmtN(s.toques)}</td>
                  {!lineaOculta && <td style={{ ...td, fontWeight: 700 }}>{fmtN(s.respuestas)}</td>}
                  {!lineaOculta && <td style={{ ...td, color: T.ink2 }}>{tasaDe(s)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* Gráfico — scrollea horizontal en su propio contenedor si no entra */
        <div style={{ overflowX: 'auto' }}>
          <div style={{ position: 'relative', minWidth: W }}>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} aria-label="Ritmo de la campaña: toques por canal y respuestas por semana">
              {/* Grilla recesiva: hairlines sólidas, ticks enteros, un solo eje */}
              {ticksY.map((t) => (
                <g key={t}>
                  <line x1={padL} x2={W - padR} y1={yPx(t)} y2={yPx(t)} stroke={T.faint2} strokeWidth={1} />
                  <text x={padL - 6} y={yPx(t) + 3} textAnchor="end" fontSize={9} fill={T.ink3} fontFamily={T.fontMono}>{t}</text>
                </g>
              ))}
              {/* Banda de la semana activa (suave, detrás de las marcas) */}
              {activo != null && (
                <rect x={padL + activo * bandW} y={padT} width={bandW} height={innerH} fill={T.faint} opacity={0.6} />
              )}
              {/* Barras apiladas: gap de 2px color papel entre segmentos, cap 4px solo arriba */}
              {semanas.map((s, i) => {
                const segs = s.porCanal.filter((x) => x.v > 0);
                let acumulado = 0;
                return (
                  <g key={s.semanaIso}>
                    {segs.map((seg, j) => {
                      const yTope = yPx(acumulado + seg.v);
                      const yBase = yPx(acumulado);
                      acumulado += seg.v;
                      const esTope = j === segs.length - 1;
                      const top = esTope ? yTope : yTope + GAP; // el gap muestra el papel
                      const h = Math.max(yBase - top, 0.75);
                      const xBar = cx(i) - barW / 2;
                      return esTope
                        ? <path key={seg.canal} d={pathTopeRedondeado(xBar, top, barW, h, 4)} fill={CANAL_META[seg.canal].color} />
                        : <rect key={seg.canal} x={xBar} y={top} width={barW} height={h} fill={CANAL_META[seg.canal].color} />;
                    })}
                  </g>
                );
              })}
              {/* Línea de Respuestas en el MISMO eje: 2px tinta, markers 8px con anillo papel */}
              {!lineaOculta && n > 1 && (
                <polyline
                  points={semanas.map((s, i) => `${cx(i)},${yPx(s.respuestas)}`).join(' ')}
                  fill="none" stroke={T.ink} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                />
              )}
              {!lineaOculta && semanas.map((s, i) => (
                <circle key={`r-${s.semanaIso}`} cx={cx(i)} cy={yPx(s.respuestas)} r={4} fill={T.ink} stroke={T.paper} strokeWidth={2} />
              ))}
              {/* Label directo SOLO del último valor de la línea (el resto: eje + tooltip) */}
              {!lineaOculta && n > 0 && (
                <text x={cx(n - 1)} y={Math.max(yPx(semanas[n - 1].respuestas) - 9, 10)} textAnchor="middle" fontSize={10} fontWeight={700} fontFamily={T.fontMono} fill={T.ink}>
                  {fmtN(semanas[n - 1].respuestas)}
                </text>
              )}
              {/* Etiquetas de semana */}
              {semanas.map((s, i) => (
                <text key={`x-${s.semanaIso}`} x={cx(i)} y={H - 8} textAnchor="middle" fontSize={9} fill={T.ink3} fontFamily={T.fontMono}>
                  {etiquetaSemana(s.semanaIso)}
                </text>
              ))}
              {/* Hit targets: la COLUMNA entera (56px), no las marcas — hover + tap fija */}
              {semanas.map((s, i) => (
                <rect
                  key={`hit-${s.semanaIso}`}
                  x={padL + i * bandW} y={padT} width={bandW} height={innerH}
                  fill="transparent" style={{ cursor: 'pointer' }} tabIndex={0}
                  aria-label={`Semana del ${etiquetaSemana(s.semanaIso)}: ${fmtN(s.toques)} toques, ${fmtN(s.respuestas)} respuestas`}
                  onPointerEnter={() => setHoverIdx(i)}
                  onPointerLeave={() => setHoverIdx(null)}
                  onPointerDown={(e) => { e.stopPropagation(); setPinIdx((p) => (p === i ? null : i)); }}
                  onFocus={() => setHoverIdx(i)}
                  onBlur={() => setHoverIdx(null)}
                />
              ))}
            </svg>
            {/* Tooltip HTML de la columna activa (hover o fijado) */}
            {semActiva != null && (
              <div style={{
                position: 'absolute', top: 6,
                left: `${((padL + (activo + 0.5) * bandW) / W) * 100}%`,
                transform: activo <= 1 ? 'translateX(-10%)' : activo >= n - 2 ? 'translateX(-90%)' : 'translateX(-50%)',
                background: T.paper, border: `1px solid ${T.faint2}`, borderRadius: 6,
                boxShadow: '0 4px 14px rgba(45,45,45,0.14)', padding: '8px 10px',
                minWidth: 168, zIndex: 5, pointerEvents: 'none',
              }}>
                <div style={{ fontSize: 9.5, fontFamily: T.fontMono, fontWeight: 700, letterSpacing: 0.6, color: T.ink3, textTransform: 'uppercase', marginBottom: 5, whiteSpace: 'nowrap' }}>
                  Semana del {etiquetaSemana(semActiva.semanaIso)}
                </div>
                {semActiva.porCanal.map(({ canal, v }) => (
                  <div key={canal} style={filaTooltip}>
                    <span style={{ width: 10, height: 3, borderRadius: 2, background: CANAL_META[canal].color, flexShrink: 0 }} />
                    <span style={{ flex: 1, color: T.ink2 }}>{CANAL_META[canal].label}</span>
                    <span style={{ fontFamily: T.fontMono, fontWeight: 800, color: T.ink }}>{fmtN(v)}</span>
                  </div>
                ))}
                <div style={{ borderTop: `1px solid ${T.faint2}`, margin: '5px 0' }} />
                <div style={filaTooltip}>
                  <span style={{ flex: 1, color: T.ink2, fontWeight: 700 }}>Toques</span>
                  <span style={{ fontFamily: T.fontMono, fontWeight: 800, color: T.ink }}>{fmtN(semActiva.toques)}</span>
                </div>
                {!lineaOculta && (
                  <div style={filaTooltip}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.ink, flexShrink: 0 }} />
                    <span style={{ flex: 1, color: T.ink2, fontWeight: 700 }}>Respuestas</span>
                    <span style={{ fontFamily: T.fontMono, fontWeight: 800, color: T.ink }}>{fmtN(semActiva.respuestas)}</span>
                  </div>
                )}
                {!lineaOculta && (
                  <div style={filaTooltip}>
                    <span style={{ flex: 1, color: T.ink2 }}>Tasa de la semana</span>
                    <span style={{ fontFamily: T.fontMono, fontWeight: 800, color: T.ink }}>{tasaDe(semActiva)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Leyenda interactiva: click = mostrar/ocultar; el color sigue a la entidad */}
      {!vistaTabla && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {enLeyenda.map((c) => {
            const off = ocultos.has(c);
            return (
              <button key={c} type="button" onClick={() => toggleCanal(c)} style={chip(off)} title={off ? `Mostrar ${CANAL_META[c].label}` : `Ocultar ${CANAL_META[c].label}`}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: off ? 'transparent' : CANAL_META[c].color, border: `1.5px solid ${CANAL_META[c].color}`, boxSizing: 'border-box' }} />
                {CANAL_META[c].label}
              </button>
            );
          })}
          <button type="button" onClick={() => setLineaOculta((v) => !v)} style={chip(lineaOculta)} title={lineaOculta ? 'Mostrar Respuestas' : 'Ocultar Respuestas'}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: lineaOculta ? 'transparent' : T.ink, border: `1.5px solid ${T.ink}`, boxSizing: 'border-box' }} />
            Respuestas
          </button>
        </div>
      )}
    </div>
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
  const [semanas, setSemanas] = useState(8);
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
  const canales = useMemo(() => {
    const hayOtro = serie.some((s) => (s.porCanal?.otro || 0) > 0);
    return hayOtro ? [...CANALES_FILTRO, 'otro'] : CANALES_FILTRO;
  }, [serie]);
  const serieVacia = serie.every((s) => (s.total || 0) === 0)
    && serieRespuestas.every((s) => (s.respuestas || 0) === 0);

  return (
    <div style={{ background: '#fff', border: `1px solid ${T.faint2}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: T.ink }}>Ritmo de la campaña</div>
          <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 1 }}>
            Toques por canal y respuestas — últimas {semanas} semanas
          </div>
        </div>
        <select
          value={semanas}
          onChange={(e) => setSemanas(Number(e.target.value))}
          style={{
            marginLeft: 'auto', padding: '5px 9px', borderRadius: 999, border: `1.5px solid ${T.faint2}`,
            fontSize: 11.5, fontFamily: T.font, background: T.paper, color: T.ink2, cursor: 'pointer', outline: 'none',
          }}
        >
          <option value={4}>4 semanas</option>
          <option value={8}>8 semanas</option>
          <option value={12}>12 semanas</option>
        </select>
      </div>

      {carga.estado === 'cargando' && (
        <div style={{ height: 190, borderRadius: 8, background: T.faint, animation: 'ritmoPulso 1.3s ease-in-out infinite' }} />
      )}
      {carga.estado === 'error' && (
        <div style={{ padding: '28px 12px', textAlign: 'center' }}>
          <div style={{ fontSize: 12.5, color: T.ink2, marginBottom: 10 }}>
            No pudimos traer el ritmo{carga.error ? ` (${carga.error})` : ''}.
          </div>
          <Btn sm accent onClick={reintentar}>↻ Reintentar</Btn>
        </div>
      )}
      {carga.estado === 'listo' && (serieVacia
        ? <div style={{ padding: '32px 0', textAlign: 'center', fontSize: 12, color: T.ink3 }}>Sin actividades registradas en el rango.</div>
        : <ChartRitmo serie={serie} respuestas={serieRespuestas} canales={canales} />)}

      {carga.estado === 'listo' && !serieVacia && (
        <div style={{ marginTop: 10, paddingTop: 7, borderTop: `1px dashed ${T.faint2}`, fontSize: 10, color: T.ink3 }}>
          Actividades consideradas: últimas 500 (las más recientes).
        </div>
      )}
      <style>{`@keyframes ritmoPulso { 0%, 100% { opacity: 0.6; } 50% { opacity: 0.3; } }`}</style>
    </div>
  );
}
