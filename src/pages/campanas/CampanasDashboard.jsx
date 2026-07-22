import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../../components/layout/PageLayout';
import PageHero from '../../components/ui/PageHero';
import { Box, Btn, Bar } from '../../components/ui';
import { T } from '../../theme';
import { useUsuarios } from '../../store/UsuariosContext';
import { useObras } from '../../store/ObrasContext';
import { useCampanas } from '../../store/CampanasContext';
import { supabase } from '../../lib/supabase';
import {
  kpisGenerales, comparativaListas, embudoConcrecion, seriePorSemana, statsLlamadasCaro,
} from '../../lib/campanas/kpis';
import { ESTADO_LLAMADA_META } from '../../lib/campanas/constants';
import { fmtN } from '../../lib/format';
import { useIsMobile } from '../../hooks/useMediaQuery';

// ─────────────────────────────────────────────────────────────────────────────
// Tablero de KPIs del módulo Campañas (lo que pidió Franco: comparar campañas,
// ver cuál rinde más y cuánto cuesta cada resultado — SIN montos de obras
// individuales; los únicos $ son costos de listas/campañas).
//
// Datos: todo llega vía useCampanas() (contarPorEtapa, fetchListas,
// fetchActividades, fetchOperadores, fetchEstaciones) + useObras() para cruzar
// las obras de operadores promovidos. Los cálculos son 100% de kpis.js (puras).
//
// LIMITACIÓN (honestidad de datos): el contrato del context solo permite traer
// las últimas N actividades (fetchActividades limit) — acá usamos 500. Si el
// rango elegido tiene más de 500 actividades, las semanas más viejas quedan
// subrepresentadas. Cuando el contrato sume fetch por rango de fechas, migrar.
// ─────────────────────────────────────────────────────────────────────────────

// Colores por canal para la serie semanal, elegidos dentro de la estética sobria
// del ERP y validados con el validador de paletas (dataviz): banda de luminancia,
// piso de croma, separación CVD adyacente ≥ 9, piso visión normal ≥ 15 y
// contraste ≥ 3:1 sobre T.paper — todo PASS. 'otro' queda FUERA de los slots
// categóricos: neutro (T.ink3) con línea punteada (codificación secundaria).
const CANAL_META = {
  llamada:  { label: 'Llamadas', color: '#12969a' },
  email:    { label: 'Email',    color: '#3f66b0' },
  linkedin: { label: 'LinkedIn', color: '#b97a1e' },
  whatsapp: { label: 'WhatsApp', color: '#2e7032' },
  otro:     { label: 'Otro',     color: '#9a9892', punteada: true },
};
const CANALES_FILTRO = ['llamada', 'email', 'linkedin', 'whatsapp'];

// Rampa secuencial del teal del ERP (claro → oscuro) para los 6 escalones.
const EMBUDO_COLORES = ['#8ccbcc', '#5eb5b6', '#37a4a5', '#1a9b9c', '#127e80', '#0d6465'];

const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const etiquetaSemana = (iso) => {
  const [, m, d] = String(iso || '').split('-');
  return m ? `${+d} ${MESES_CORTO[+m - 1] || ''}` : '';
};

// % con coma decimal (los pct de kpis.js vienen con 1 decimal).
const fmtPct = (v) => String(Number.isFinite(v) ? v : 0).replace('.', ',');

// ── KPI tile (patrón VentasReportes.jsx:22-28 + variante destacada) ──────────
const Kpi = ({ label, value, sub, color, destacada }) => (
  <Box style={{
    padding: '12px 16px', maxWidth: '100%',
    ...(destacada ? { background: T.accentSoft, boxShadow: `inset 0 0 0 1.5px ${T.accent2}` } : {}),
  }}>
    <div style={{ fontSize: 9.5, color: destacada ? T.accent2 : T.ink3, fontFamily: T.fontMono, letterSpacing: 1, fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
    <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 'clamp(16px, 3.5vw, 22px)', color: color || T.ink, lineHeight: 1.1, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
    {sub && <div style={{ fontSize: 10.5, color: destacada ? T.accent2 : T.ink3, marginTop: 2, fontWeight: destacada ? 700 : 400 }}>{sub}</div>}
  </Box>
);

// ── GRÁFICO FOCAL 1 — Embudo de concreción ───────────────────────────────────
// Barras horizontales proporcionales al primer escalón (patrón artesanal con
// divs, como la barra apilada de Dashboard.jsx:339-344) + conversión % entre
// escalones. Vertical de por sí → funciona igual en mobile.
function EmbudoChart({ escalones, isMobile }) {
  const max = escalones[0]?.valor || 0;
  const labelW = isMobile ? 82 : 108;
  return (
    <div>
      {escalones.map((e, i) => {
        const pct = max > 0 ? (e.valor / max) * 100 : 0;
        return (
          <div key={e.key}>
            {i > 0 && (
              <div style={{ margin: '2px 0', paddingLeft: labelW + 8 }}>
                <span style={{ fontSize: 9.5, fontFamily: T.fontMono, color: T.ink3, fontWeight: 700 }}>
                  ↓ {fmtPct(e.conversionDesdeAnterior)}%
                </span>
              </div>
            )}
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              title={`${e.label}: ${fmtN(e.valor)}${i > 0 ? ` · ${fmtPct(e.conversionDesdeAnterior)}% del escalón anterior` : ''}`}
            >
              <span style={{ width: labelW, flexShrink: 0, fontSize: 11.5, color: T.ink2, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.label}</span>
              <div style={{ flex: 1, height: 22, background: T.faint, borderRadius: '0 4px 4px 0', overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.max(pct, e.valor > 0 ? 2 : 0)}%`,
                  height: '100%',
                  background: EMBUDO_COLORES[i] || EMBUDO_COLORES[EMBUDO_COLORES.length - 1],
                  borderRadius: '0 4px 4px 0',
                  transition: 'width 0.4s ease',
                }} />
              </div>
              <span style={{ width: 44, flexShrink: 0, textAlign: 'right', fontFamily: T.fontMono, fontWeight: 800, fontSize: 13, color: T.ink }}>{fmtN(e.valor)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── GRÁFICO FOCAL 2 — Serie semanal por canal (SVG artesanal, sin librerías) ─
// viewBox responsive, una línea por canal, puntos con tooltip nativo (<title>),
// grilla recesiva y leyenda con punto de color. Con un solo canal filtrado se
// suma un área suave bajo la línea.
function ChartLineaSemanal({ serie, canales }) {
  const W = 640; const H = 210; const padL = 34; const padR = 14; const padT = 14; const padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const maxDato = Math.max(0, ...serie.map((s) => Math.max(0, ...canales.map((c) => s.porCanal?.[c] || 0))));
  // Tope "lindo" múltiplo de 4 → los ticks (0, mitad, tope) son siempre enteros.
  const maxY = Math.max(4, Math.ceil(maxDato / 4) * 4);
  const x = (i) => (serie.length <= 1 ? padL + innerW / 2 : padL + (i / (serie.length - 1)) * innerW);
  const y = (v) => padT + innerH - (v / maxY) * innerH;
  const ticksY = [0, maxY / 2, maxY];
  const idxEtiquetas = new Set([0, Math.floor((serie.length - 1) / 2), serie.length - 1]);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Actividades por semana y canal">
        {ticksY.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={T.faint2} strokeWidth={1} strokeDasharray={t === 0 ? undefined : '2 3'} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill={T.ink3} fontFamily={T.fontMono}>{Math.round(t)}</text>
          </g>
        ))}
        {serie.map((s, i) => (idxEtiquetas.has(i) ? (
          <text key={s.semanaIso} x={x(i)} y={H - 8} textAnchor="middle" fontSize={9} fill={T.ink3} fontFamily={T.fontMono}>{etiquetaSemana(s.semanaIso)}</text>
        ) : null))}
        {canales.length === 1 && serie.length > 1 && (
          <path
            d={`M ${x(0)} ${y(0)} L ${serie.map((s, i) => `${x(i)} ${y(s.porCanal?.[canales[0]] || 0)}`).join(' L ')} L ${x(serie.length - 1)} ${y(0)} Z`}
            fill={CANAL_META[canales[0]]?.color || T.ink3}
            opacity={0.09}
          />
        )}
        {canales.map((c) => (
          <polyline
            key={c}
            points={serie.map((s, i) => `${x(i)},${y(s.porCanal?.[c] || 0)}`).join(' ')}
            fill="none"
            stroke={CANAL_META[c]?.color || T.ink3}
            strokeWidth={2}
            strokeDasharray={CANAL_META[c]?.punteada ? '5 4' : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {canales.map((c) => serie.map((s, i) => (
          <g key={`${c}-${s.semanaIso}`}>
            <circle cx={x(i)} cy={y(s.porCanal?.[c] || 0)} r={3} fill={CANAL_META[c]?.color || T.ink3} stroke={T.paper} strokeWidth={1.5} />
            {/* target de hover generoso (r=9) con tooltip nativo */}
            <circle cx={x(i)} cy={y(s.porCanal?.[c] || 0)} r={9} fill="transparent">
              <title>{`Semana del ${etiquetaSemana(s.semanaIso)} · ${CANAL_META[c]?.label || c}: ${s.porCanal?.[c] || 0}`}</title>
            </circle>
          </g>
        )))}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 6 }}>
        {canales.map((c) => (
          <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: T.ink2 }}>
            {CANAL_META[c]?.punteada
              ? <span style={{ width: 14, borderTop: `2px dashed ${CANAL_META[c].color}`, display: 'inline-block' }} />
              : <span style={{ width: 8, height: 8, borderRadius: '50%', background: CANAL_META[c]?.color || T.ink3, display: 'inline-block' }} />}
            {CANAL_META[c]?.label || c}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Comparativa de listas/campañas (tabla compacta con scroll propio) ────────
function TablaComparativa({ filas }) {
  const cols = '1.7fr 1fr 0.7fr 0.6fr 1.4fr 0.8fr 1fr 1fr';
  const th = { fontSize: 9, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 0.8, fontWeight: 700, textTransform: 'uppercase' };
  const mono = { fontFamily: T.fontMono, fontSize: 12, textAlign: 'right', color: T.ink };
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 640 }}>
        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '4px 0 6px', borderBottom: `1.5px solid ${T.faint2}` }}>
          <span style={th}>Lista</span>
          <span style={th}>Canal</span>
          <span style={{ ...th, textAlign: 'right' }}>Enviados</span>
          <span style={{ ...th, textAlign: 'right' }}>Resp.</span>
          <span style={th}>Tasa de respuesta</span>
          <span style={{ ...th, textAlign: 'right' }}>Reuniones</span>
          <span style={{ ...th, textAlign: 'right' }}>Costo/mes</span>
          <span style={{ ...th, textAlign: 'right' }}>$ / resp.</span>
        </div>
        {filas.map((f) => (
          <div key={f.listaId} style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: `1px dashed ${T.faint2}` }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.nombre || '—'}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: T.ink2, border: `1px solid ${T.faint2}`, borderRadius: 999, padding: '2px 8px', width: 'fit-content', whiteSpace: 'nowrap' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: CANAL_META[f.canal]?.color || T.ink3, flexShrink: 0 }} />
              {CANAL_META[f.canal]?.label || f.canal || '—'}
            </span>
            <span style={mono}>{fmtN(f.enviados)}</span>
            <span style={mono}>{fmtN(f.respondieron)}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ flex: 1, minWidth: 30 }}><Bar pct={Math.min(f.tasaRespuesta, 100)} accent h={5} /></span>
              <span style={{ fontFamily: T.fontMono, fontSize: 11.5, fontWeight: 700, color: T.ink, flexShrink: 0 }}>{fmtPct(f.tasaRespuesta)}%</span>
            </span>
            <span style={mono}>{fmtN(f.reuniones)}</span>
            <span style={{ ...mono, color: T.ink2 }}>{f.costoMensual > 0 ? `$ ${fmtN(f.costoMensual)}` : '—'}</span>
            <span style={{ ...mono, fontWeight: 700 }}>
              {f.respondieron > 0 && f.costoMensual > 0 ? `$ ${fmtN(Math.round(f.costoMensual / f.respondieron))}` : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Llamadas de Carolina: hoy/semana + distribución por resultado ────────────
function LlamadasCaro({ stats }) {
  const entradas = Object.entries(stats.porResultado || {}).sort((a, b) => b[1] - a[1]);
  const max = entradas[0]?.[1] || 0;
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        {[['Hoy', stats.hoy], ['Últimos 7 días', stats.semana]].map(([lab, v]) => (
          <div key={lab} style={{ flex: 1, background: T.faint, borderRadius: 6, padding: '8px 12px', minWidth: 0 }}>
            <div style={{ fontSize: 8.5, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 1.2, fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lab}</div>
            <div style={{ fontFamily: T.fontMono, fontSize: 20, fontWeight: 800, color: T.ink, marginTop: 2 }}>{fmtN(v)}</div>
          </div>
        ))}
      </div>
      {entradas.length === 0 && <div style={{ fontSize: 12, color: T.ink3 }}>Sin llamadas registradas en el rango.</div>}
      {entradas.map(([resultado, n]) => {
        const meta = ESTADO_LLAMADA_META[resultado] || { label: resultado, color: T.ink3 };
        return (
          <div key={resultado} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }} title={`${meta.label}: ${n}`}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
            <span style={{ width: 116, flexShrink: 0, fontSize: 11.5, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta.label}</span>
            <div style={{ flex: 1, height: 6, background: T.faint, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${max > 0 ? (n / max) * 100 : 0}%`, height: '100%', background: meta.color, borderRadius: 3 }} />
            </div>
            <span style={{ width: 28, flexShrink: 0, textAlign: 'right', fontFamily: T.fontMono, fontWeight: 700, fontSize: 12, color: T.ink }}>{n}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch agregado del tablero (a nivel módulo: NO toca estado de React — el
// efecto del componente setea estado en los callbacks .then/.catch).
// Devuelve el snapshot de datos o tira Error.

// Operadores promovidos: pagina hasta traerlos a TODOS (una sola página de 100
// truncaba embudo y "Obras ganadas" en silencio). Tope sano de 2.000; si el
// total real lo supera, la franja de honestidad lo declara.
const PROMOVIDOS_TOPE = 2000;
async function traerPromovidos(camp) {
  const pageSize = 1000;
  const filas = [];
  let total = 0;
  for (let page = 1; filas.length < PROMOVIDOS_TOPE; page++) {
    const { rows, total: t, error } = await camp.fetchOperadores({
      page, pageSize, filtros: { etapa: 'promovido' },
    });
    if (error) return { rows: filas, total, error };
    filas.push(...(rows || []));
    total = Math.max(t ?? 0, filas.length);
    if (!rows?.length || filas.length >= total) break;
  }
  return { rows: filas, total, error: null };
}

async function cargarDatos(camp) {
  const [conteo, listasR, actsR, promovidosR, leadsR] = await Promise.all([
    camp.contarPorEtapa(),
    camp.fetchListas(),
    // Últimas 500 actividades (ver LIMITACIÓN arriba).
    camp.fetchActividades({ limit: 500 }),
    // Operadores promovidos al embudo real → sus obra_id se cruzan con useObras.
    traerPromovidos(camp),
    // Solo el count de estaciones LEAD CALIENTE (pageSize 1, usamos total).
    camp.fetchEstaciones({ page: 1, pageSize: 1, filtros: { estadoLlamada: 'LEAD CALIENTE' } }),
  ]);
  const err = listasR.error || actsR.error || promovidosR.error || leadsR.error;
  if (err) throw new Error(err.message || 'Error consultando la base de campañas');

  // Miembros de listas: el contrato de CampanasContext no expone un fetch de
  // miembros con su estado (fetchDecisores solo embebe lista_id) → lectura
  // DIRECTA read-only de camp_lista_miembros, solo columnas de agregación.
  // Paginada de a 1000 con .range() (patrón traerTodo de CampImportar):
  // PostgREST capea cada request a 1000 filas aunque se pida un limit mayor.
  // Tope sano de 20.000; si el count exacto supera lo traído, la franja de
  // honestidad lo declara. Mover a una RPC de agregación server-side cuando
  // el contrato crezca.
  const listaIds = (listasR.rows || []).map((l) => l.id).filter(Boolean);
  const miembros = [];
  let miembrosTotal = 0;
  if (listaIds.length > 0) {
    const pageSize = 1000;
    for (let desde = 0; desde < 20000; desde += pageSize) {
      const { data, error, count } = await supabase
        .from('camp_lista_miembros')
        .select('lista_id, estado, enviado_at, respondido_at', { count: 'exact' })
        .in('lista_id', listaIds)
        .range(desde, desde + pageSize - 1);
      if (error) throw new Error(error.message);
      miembros.push(...(data || []));
      miembrosTotal = Math.max(count ?? 0, miembros.length);
      if (!data || data.length < pageSize || miembros.length >= miembrosTotal) break;
    }
  }

  return {
    conteo,
    listas: listasR.rows || [],
    actividades: actsR.rows || [],
    promovidos: promovidosR.rows || [],
    promovidosTotal: promovidosR.total ?? 0,
    leadsCalientes: leadsR.total ?? 0,
    miembros,
    miembrosTotal,
  };
}

export default function CampanasDashboard() {
  const { currentUser } = useUsuarios();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const camp = useCampanas();
  const { obras } = useObras();

  // Guard: solo Admin o usuarios con el permiso `campanas` (patrón Pipeline.jsx).
  const puede = currentUser?.rol === 'Admin' || !!currentUser?.permisos?.campanas;
  useEffect(() => { if (currentUser && !puede) navigate('/', { replace: true }); }, [currentUser, puede, navigate]);

  const [estado, setEstado] = useState('cargando'); // cargando | error | listo
  const [errorMsg, setErrorMsg] = useState('');
  const [datos, setDatos] = useState(null);

  // Filtros client-side (regla: NUNCA re-traer la tabla entera por un filtro).
  const [rangoSemanas, setRangoSemanas] = useState(8);
  const [canalFiltro, setCanalFiltro] = useState('');
  const [tick, setTick] = useState(0); // bump → recarga (Reintentar / Actualizar)

  // Carga inicial + recargas: setState solo en los callbacks .then/.catch
  // (regla react-hooks/set-state-in-effect) con flag de cancelación `vivo`.
  useEffect(() => {
    if (!currentUser || !puede || !camp) return undefined;
    let vivo = true;
    cargarDatos(camp)
      .then((d) => {
        if (!vivo) return;
        setDatos(d);
        setErrorMsg('');
        setEstado('listo');
      })
      .catch((e) => {
        if (!vivo) return;
        setErrorMsg(e?.message || 'Error desconocido');
        setEstado('error');
      });
    return () => { vivo = false; };
  }, [currentUser, puede, camp, tick]);

  // Para botones (Reintentar / Actualizar): muestra el "Cargando…" al instante
  // (setState en event handler, permitido) y re-dispara el efecto de carga.
  const recargar = useCallback(() => {
    setEstado('cargando');
    setErrorMsg('');
    setTick((t) => t + 1);
  }, []);

  // ── Derivaciones (todas con las funciones puras de kpis.js) ────────────────
  const actividades = useMemo(() => datos?.actividades || [], [datos]);

  // Inicio de la ventana del rango: lunes de hace (rango-1) semanas.
  const inicioRango = useMemo(() => {
    const hoy = new Date();
    const lunes = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    lunes.setDate(lunes.getDate() - ((lunes.getDay() + 6) % 7) - (rangoSemanas - 1) * 7);
    return lunes;
  }, [rangoSemanas]);

  const actividadesRango = useMemo(() => actividades.filter((a) => {
    const f = new Date(a?.fecha);
    return !Number.isNaN(f.getTime()) && f >= inicioRango;
  }), [actividades, inicioRango]);

  const kpis = useMemo(() => kpisGenerales({
    conteoPorEtapa: datos?.conteo || {},
    actividades: actividadesRango,
    estacionesStats: { porEstado: { 'LEAD CALIENTE': datos?.leadsCalientes || 0 } },
  }), [datos, actividadesRango]);

  // Obras del embudo real que nacieron de operadores promovidos: cruce por
  // obra_id (camp_operadores.obra_id ← promoverAEmbudo) contra useObras().
  // OJO: se pasan las obras ENTERAS (filter, sin re-mapear campos) para que
  // `estado` llegue a kpis.js — el escalón "Obra ganada" también cuenta las
  // obras con estado activa/finalizada (obras confirmadas sin drag ni cobro).
  const obrasPromovidas = useMemo(() => {
    const ids = new Set((datos?.promovidos || []).map((op) => op?.obra_id).filter(Boolean));
    if (ids.size === 0) return [];
    return (obras || []).filter((o) => ids.has(o.id));
  }, [obras, datos]);

  // El embudo es acumulativo (estados del pipeline) → usa TODAS las actividades
  // traídas, sin filtro de rango/canal, para no mezclar ventanas con los counts.
  const embudo = useMemo(() => embudoConcrecion({
    conteoPorEtapa: datos?.conteo || {},
    actividades,
    obrasPromovidas,
  }), [datos, actividades, obrasPromovidas]);

  const obrasGanadas = embudo.find((e) => e.key === 'obraGanada')?.valor || 0;

  const serie = useMemo(
    () => seriePorSemana({ actividades, semanas: rangoSemanas }),
    [actividades, rangoSemanas],
  );

  const canalesVisibles = useMemo(() => {
    if (canalFiltro) return [canalFiltro];
    const hayOtro = serie.some((s) => (s.porCanal?.otro || 0) > 0);
    return hayOtro ? [...CANALES_FILTRO, 'otro'] : CANALES_FILTRO;
  }, [canalFiltro, serie]);

  const comparativa = useMemo(() => {
    const filas = comparativaListas({
      listas: datos?.listas || [],
      miembros: datos?.miembros || [],
      actividades,
    });
    return canalFiltro ? filas.filter((f) => (f.canal || '') === canalFiltro) : filas;
  }, [datos, actividades, canalFiltro]);

  // Sin usuarioId por ahora: cuentan TODAS las llamadas del rango (cuando Caro
  // tenga usuario propio en app_users, pasarlo acá para filtrar).
  const llamadas = useMemo(() => statsLlamadasCaro({ actividades: actividadesRango }), [actividadesRango]);

  const serieVacia = serie.every((s) => (s.total || 0) === 0);

  const selStyle = {
    padding: '6px 10px', borderRadius: 4, border: `1.5px solid ${T.faint2}`,
    fontSize: 12, fontFamily: T.font, background: T.paper, cursor: 'pointer',
    maxWidth: '100%',
  };
  const tituloSeccion = { fontWeight: 700, fontSize: 13 };
  const subSeccion = { fontSize: 10.5, color: T.ink3, marginTop: 1, marginBottom: 10 };

  return (
    <PageLayout breadcrumb={[{ label: 'Inicio', to: '/' }, 'Campañas']} active="Campañas">
      <PageHero
        label="CAMPAÑAS"
        title="Tablero de campañas"
        subtitle={estado === 'listo'
          ? `${fmtN(kpis.contactados)} contactados · ${fmtPct(kpis.tasaRespuesta)}% de respuesta · ${fmtN(kpis.reuniones)} reuniones · ${fmtN(obrasGanadas)} obras ganadas`
          : 'KPIs, embudo de concreción y comparativa de listas'}
      />

      {estado === 'cargando' && (
        <div style={{ minHeight: '40vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.ink3, fontSize: 13 }}>
          Cargando tablero…
        </div>
      )}

      {estado === 'error' && (
        <Box style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>No se pudo cargar el tablero</div>
          <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 4, marginBottom: 12 }}>{errorMsg}</div>
          <Btn accent onClick={recargar}>↻ Reintentar</Btn>
        </Box>
      )}

      {estado === 'listo' && (
        <>
          {/* Filtros — re-alimentan la serie, la comparativa y las llamadas (client-side) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12, alignItems: 'center' }}>
            <select value={rangoSemanas} onChange={(e) => setRangoSemanas(Number(e.target.value))} style={selStyle}>
              <option value={4}>Últimas 4 semanas</option>
              <option value={8}>Últimas 8 semanas</option>
              <option value={12}>Últimas 12 semanas</option>
            </select>
            <select value={canalFiltro} onChange={(e) => setCanalFiltro(e.target.value)} style={selStyle}>
              <option value="">Todos los canales</option>
              {CANALES_FILTRO.map((c) => <option key={c} value={c}>{CANAL_META[c].label}</option>)}
            </select>
            <Btn sm onClick={recargar} style={{ marginLeft: isMobile ? 0 : 'auto' }}>↻ Actualizar</Btn>
          </div>

          {/* KPI tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
            <Kpi label="Contactados" value={fmtN(kpis.contactados)} sub="operadores con contacto" color={T.accent} />
            <Kpi label="Tasa de respuesta" value={`${fmtPct(kpis.tasaRespuesta)}%`} sub="sobre contactados" />
            <Kpi label="Reuniones" value={fmtN(kpis.reuniones)} sub="la métrica que paga" color={T.accent2} destacada />
            <Kpi label="Leads calientes" value={fmtN(kpis.leadsCalientes)} sub="estaciones lead caliente" color="#c2410c" />
            <Kpi label="Promovidos" value={fmtN(kpis.promovidos)} sub="pasaron al embudo real" color={T.ok} />
            <Kpi label="Obras ganadas" value={fmtN(obrasGanadas)} sub={`de ${fmtN(obrasPromovidas.length)} promovidas con obra`} color={T.ok} />
          </div>

          {/* Gráficos focales: embudo + serie semanal */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '5fr 7fr', gap: 12, marginBottom: 12 }}>
            <Box style={{ padding: 16 }}>
              <div style={tituloSeccion}>Embudo de concreción</div>
              <div style={subSeccion}>De contactar a ganar la obra — conversión entre escalones</div>
              <EmbudoChart escalones={embudo} isMobile={isMobile} />
            </Box>
            <Box style={{ padding: 16 }}>
              <div style={tituloSeccion}>Actividad semanal por canal</div>
              <div style={subSeccion}>{`Últimas ${rangoSemanas} semanas${canalFiltro ? ` · solo ${CANAL_META[canalFiltro].label}` : ''}`}</div>
              {serieVacia
                ? <div style={{ padding: '32px 0', textAlign: 'center', fontSize: 12, color: T.ink3 }}>Sin actividades registradas en el rango.</div>
                : <ChartLineaSemanal serie={serie} canales={canalesVisibles} />}
            </Box>
          </div>

          {/* Comparativa de listas + llamadas de Carolina */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '7fr 5fr', gap: 12 }}>
            <Box style={{ padding: 16 }}>
              <div style={tituloSeccion}>Comparativa de listas / campañas</div>
              <div style={subSeccion}>Ordenadas por tasa de respuesta — los $ son de la campaña, no de obras</div>
              {comparativa.length === 0
                ? <div style={{ fontSize: 12, color: T.ink3 }}>{canalFiltro ? 'Sin listas para este canal.' : 'Sin listas cargadas todavía.'}</div>
                : <TablaComparativa filas={comparativa} />}
              <div style={{ marginTop: 8, fontSize: 10.5, color: T.ink3, fontStyle: 'italic' }}>
                El $ por obra por canal se completa con las integraciones (Fase 2).
              </div>
            </Box>
            <Box style={{ padding: 16 }}>
              <div style={tituloSeccion}>Llamadas de Carolina</div>
              <div style={subSeccion}>Resultados de las llamadas del rango (todos los usuarios, por ahora)</div>
              <LlamadasCaro stats={llamadas} />
            </Box>
          </div>

          {/* Franja de honestidad de datos (regla 8 del proyecto) */}
          <div style={{ marginTop: 14, paddingTop: 8, borderTop: `1px dashed ${T.faint2}`, fontSize: 10.5, color: T.ink3, display: 'flex', flexWrap: 'wrap', gap: '2px 16px' }}>
            <span>Actividades consideradas: últimas 500 (las más recientes)</span>
            {(datos?.promovidos?.length ?? 0) < (datos?.promovidosTotal ?? 0) && (
              <span>{`Promovidos considerados: ${fmtN(datos.promovidos.length)} de ${fmtN(datos.promovidosTotal)} — embudo y obras ganadas parciales`}</span>
            )}
            {(datos?.miembros?.length ?? 0) < (datos?.miembrosTotal ?? 0) && (
              <span>{`Miembros de listas considerados: ${fmtN(datos.miembros.length)} de ${fmtN(datos.miembrosTotal)}`}</span>
            )}
            <span>Integraciones (Instantly · Meta · Google): Fase 2</span>
          </div>
        </>
      )}
    </PageLayout>
  );
}
