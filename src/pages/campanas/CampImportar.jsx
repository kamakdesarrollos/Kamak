import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../../components/layout/PageLayout';
import PageHero from '../../components/ui/PageHero';
import { Box, Btn, Chip, Label, Bar, Note, Table } from '../../components/ui';
import { T } from '../../theme';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useUsuarios } from '../../store/UsuariosContext';
import { useCampanas } from '../../store/CampanasContext';
import { supabase } from '../../lib/supabase';
import { planImportUnificado } from '../../lib/campanas/importUnificado';
import { parseLinkedInZip, planImportLinkedIn } from '../../lib/campanas/importLinkedIn';

// Importador de la "base viva" del módulo Campañas: importación INCREMENTAL
// permanente (nunca pisa datos ya cargados — solo crea lo nuevo y completa
// huecos). Tres fuentes:
//   📗 Planilla Unificado (.xlsx)  — la planilla madre de estaciones.
//   📇 CSV de decisores           — export LinkedIn / Sales Navigator
//                                    (mismas columnas → mismo planificador).
//   💼 ZIP de LinkedIn            — export oficial de datos (Settings →
//                                    Get a copy of your data).
// Flujo: elegir archivo → parsear client-side (xlsx/jszip) → PLAN puro
// (importUnificado / importLinkedIn) → PREVIEW → ejecutarImport (context) →
// resultado. Abajo, siempre visible, el historial de camp_import_runs.

// ── Metadatos de los tipos de import ─────────────────────────────────────────

const TIPOS_IMPORT = [
  {
    key: 'unificado',
    icono: '📗',
    titulo: 'Planilla Unificado (.xlsx)',
    desc: 'La planilla madre de estaciones: operadores, estaciones, decisores y estados de llamada. Suma lo nuevo y completa huecos, sin pisar lo cargado.',
    formatos: '.xlsx / .xls',
    accept: '.xlsx,.xls',
    re: /\.(xlsx|xls)$/i,
  },
  {
    key: 'decisores',
    icono: '📇',
    titulo: 'CSV de decisores',
    desc: 'Export de LinkedIn / Sales Navigator con decisores. Trae las mismas columnas que el Unificado: se cruza contra la base con el mismo dedup.',
    formatos: '.csv / .xlsx',
    accept: '.csv,.xlsx,.xls',
    re: /\.(csv|xlsx|xls)$/i,
  },
  {
    key: 'linkedin',
    icono: '💼',
    titulo: 'ZIP de LinkedIn',
    desc: 'El export oficial de tus datos (Settings → Get a copy of your data): mensajes, conexiones e invitaciones se vuelcan como actividades de cada decisor.',
    formatos: '.zip',
    accept: '.zip',
    re: /\.zip$/i,
  },
];

const TIPO_LABEL = { unificado: 'Unificado', decisores: 'CSV decisores', linkedin: 'LinkedIn ZIP' };

// Tipos de actividad que genera planImportLinkedIn → label + color para chips.
const TIPO_LINKEDIN_META = {
  linkedin_invitado:   { label: 'Invitación enviada',    color: '#41698c' },
  linkedin_acepto:     { label: 'Aceptó la invitación',  color: T.accent },
  linkedin_contactado: { label: 'Mensaje enviado',       color: '#41698c' },
  linkedin_respondio:  { label: 'Respondió',             color: T.ok },
};

const MAX_MUESTRA = 20;   // filas de muestra en el preview
const MAX_LISTA = 100;    // ítems renderizados en listas expandibles

// ── Helpers puros ────────────────────────────────────────────────────────────

const normNombre = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

const fmtFecha = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })} ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
};

// Suma los valores de un objeto {operadores: n, estaciones: n, decisores: n}.
const sumar = (obj) => Object.values(obj || {}).reduce((a, b) => a + (Number(b) || 0), 0);

// "3 op · 12 est · 5 dec" a partir del bloque nuevos/actualizados del resumen.
const desglose = (obj) => {
  const partes = [];
  if (obj?.operadores) partes.push(`${obj.operadores} op`);
  if (obj?.estaciones) partes.push(`${obj.estaciones} est`);
  if (obj?.decisores) partes.push(`${obj.decisores} dec`);
  return partes.join(' · ');
};

// Resumen legible del jsonb de camp_import_runs (y de la pantalla de resultado).
function resumenLegible(resumen) {
  if (!resumen || typeof resumen !== 'object') return '—';
  const partes = [];
  const n = (k, label) => { const v = Number(resumen[k]) || 0; if (v) partes.push(`${v} ${label}`); };
  n('operadores', 'operadores');
  n('estaciones', 'estaciones');
  n('decisores', 'decisores');
  n('actividades', 'actividades');
  const errores = Array.isArray(resumen.errores) ? resumen.errores.length : 0;
  if (errores) partes.push(`${errores} filas con error`);
  return partes.length ? partes.join(' · ') : 'sin cambios';
}

// Import dinámico de SheetJS (patrón src/lib/parseExtractoBancario.js): no se
// carga la lib hasta que realmente se importa un archivo.
async function cargarXlsx() {
  const mod = await import('xlsx');
  return mod.read ? mod : mod.default;
}

// Elige la hoja a importar: preferimos "LISTOS PARA ENVIAR" (la hoja curada de
// la planilla madre) si existe y tiene datos; si no, la primera hoja con datos.
function elegirFilas(XLSX, wb) {
  const nombres = wb.SheetNames || [];
  const preferida = nombres.find((n) => String(n).trim().toUpperCase() === 'LISTOS PARA ENVIAR');
  const orden = preferida ? [preferida, ...nombres.filter((n) => n !== preferida)] : nombres;
  for (const nombre of orden) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[nombre] || {});
    if (rows.length) return { hoja: nombre, rows };
  }
  return null;
}

// Trae TODAS las páginas de un fetch paginado del contrato (fetchOperadores /
// fetchEstaciones / fetchDecisores) para el dedup del planificador. Hoy la
// base son ~4.070 estaciones, entra cómoda en memoria. OJO: con >10k filas
// conviene mover el dedup al server (RPC) en Fase 2 en vez de seguir
// paginando acá — el tope duro de 30 páginas (30k) es solo un freno de mano.
async function traerTodo(fetchFn, params = {}) {
  const pageSize = 1000;
  const filas = [];
  for (let page = 1; page <= 30; page++) {
    const { rows, total, error } = await fetchFn({ ...params, page, pageSize });
    if (error) throw new Error(`No pude traer los datos existentes para comparar (${error.message || 'error de conexión'}).`);
    filas.push(...(rows || []));
    if (!rows?.length || filas.length >= (total ?? 0)) break;
  }
  return filas;
}

// Actividades linkedin_* ya importadas (para el diff de planImportLinkedIn).
// El contrato de CampanasContext no expone un fetch de actividades por TIPO
// (fetchActividades filtra solo por operador) → query local mínima. Podría
// moverse al context como fetchActividadesPorTipo en Fase 2.
async function traerActividadesLinkedIn() {
  const pageSize = 1000;
  const filas = [];
  for (let desde = 0; desde < 30000; desde += pageSize) {
    const { data, error } = await supabase
      .from('camp_actividades')
      .select('tipo, decisor_id, fecha, datos')
      .like('tipo', 'linkedin_%')
      .range(desde, desde + pageSize - 1);
    if (error) throw new Error(`No pude traer las actividades ya importadas (${error.message || 'error de conexión'}).`);
    filas.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return filas;
}

// Adapta el plan del Unificado al formato que ejecuta el context:
// - a los operadores nuevos les agregamos nombre_norm (clave de búsqueda/dedup
//   que la DB espera y el planificador puro no setea).
// - 'actualizar' y 'saltear' solo reciben _nombre para mostrar en el preview
//   (ejecutarImport lo ignora): los 'actualizar' viajan con el id + data
//   PARCIAL tal cual — ejecutarImport los aplica como update por id con SOLO
//   el delta, así lo tocado en la DB mientras el preview estaba abierto
//   (tomas, estados de llamada, etapas) nunca se pisa con el snapshot.
function completarPlanUnificado(plan, existentes) {
  const porId = (arr) => new Map((arr || []).map((r) => [r.id, r]));
  const mapas = {
    operadores: porId(existentes.operadores),
    estaciones: porId(existentes.estaciones),
    decisores: porId(existentes.decisores),
  };
  const completar = (items, mapa, esOperador) => (items || []).map((it) => {
    if (it.accion === 'crear') {
      if (!esOperador) return it;
      return { ...it, data: { ...it.data, nombre_norm: normNombre(it.data?.nombre) } };
    }
    const base = it.id ? mapa.get(it.id) : null;
    return base ? { ...it, _nombre: base.nombre || '' } : it; // solo display
  });
  return {
    ...plan,
    operadores: completar(plan.operadores, mapas.operadores, true),
    estaciones: completar(plan.estaciones, mapas.estaciones, false),
    decisores: completar(plan.decisores, mapas.decisores, false),
  };
}

// Adapta el plan puro de planImportLinkedIn al formato de ejecutarImport:
// filas de camp_actividades colgadas del decisor y de su operador.
function armarPlanLinkedIn(plan, opPorDecisor, usuarioId) {
  const ahoraIso = new Date().toISOString();
  return {
    actividades: (plan?.actividades || []).map((a) => ({
      accion: 'crear',
      data: {
        tipo: a.tipo,
        canal: 'linkedin',
        decisor_id: a.decisorId || null,
        operador_id: (opPorDecisor || {})[a.decisorId] || null,
        resultado: null,
        texto: TIPO_LINKEDIN_META[a.tipo]?.label || a.tipo,
        usuario: usuarioId || null,
        fecha: a.fecha || ahoraIso,
        datos: a.datos || {},
      },
    })),
    resumen: plan?.resumen || {},
  };
}

// Muestra del preview: primeras MAX_MUESTRA filas del plan, entidad por entidad.
function armarMuestraUnificado(plan) {
  const items = [];
  const empujar = (ent, arr) => {
    for (const it of arr || []) {
      if (items.length >= MAX_MUESTRA) return;
      items.push({
        ent,
        nombre: it.data?.nombre || it._nombre || '—',
        accion: it.accion,
        detalle: it.motivo || [it.data?.bandera, it.data?.localidad, it.data?.cargo].filter(Boolean).join(' · '),
      });
    }
  };
  empujar('Operador', plan?.operadores);
  empujar('Estación', plan?.estaciones);
  empujar('Decisor', plan?.decisores);
  return items;
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

function ChipAccion({ accion }) {
  if (accion === 'crear') return <Chip ok>crear</Chip>;
  if (accion === 'actualizar') return <Chip warn>actualizar</Chip>;
  return <Chip style={{ color: T.ink3 }}>saltear</Chip>;
}

function TarjetaTipo({ meta, onArchivo }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      className="k-box"
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); onArchivo(e.dataTransfer.files?.[0] || null); }}
      style={{
        padding: 18,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: drag ? T.accentSoft : undefined,
        outline: drag ? `2px dashed ${T.accent}` : 'none',
        outlineOffset: -6,
        transition: 'background .15s ease',
      }}
    >
      <div style={{ fontSize: 30, lineHeight: 1 }}>{meta.icono}</div>
      <div style={{ fontWeight: 800, fontSize: 14, color: T.ink }}>{meta.titulo}</div>
      <div style={{ fontSize: 12, color: T.ink2, lineHeight: 1.45, flex: 1 }}>{meta.desc}</div>
      <div style={{ fontSize: 10.5, color: T.ink3, fontFamily: T.fontMono }}>
        {meta.formatos} — clic o arrastrá el archivo acá
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={meta.accept}
        style={{ display: 'none' }}
        onChange={(e) => { onArchivo(e.target.files?.[0] || null); e.target.value = ''; }}
      />
    </div>
  );
}

function Tile({ label, value, sub, color }) {
  return (
    <Box style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <Label>{label}</Label>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || T.ink, lineHeight: 1.1 }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, color: T.ink3 }}>{sub}</div> : null}
    </Box>
  );
}

function Desplegable({ titulo, children }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <Box style={{ padding: 0, overflow: 'hidden', marginBottom: 10 }}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        style={{
          width: '100%', textAlign: 'left', background: 'none', border: 'none',
          padding: '9px 14px', cursor: 'pointer', fontSize: 13, fontFamily: T.font,
          color: T.ink, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        <span style={{ fontSize: 11, color: T.ink3 }}>{abierto ? '▼' : '►'}</span>
        {titulo}
      </button>
      {abierto && (
        <div style={{ padding: '4px 14px 10px', borderTop: `1px dashed ${T.faint2}`, maxHeight: 280, overflowY: 'auto' }}>
          {children}
        </div>
      )}
    </Box>
  );
}

// Tabla con scroll horizontal propio (las tablas nunca desbordan la página).
function TablaScroll({ minWidth = 640, children }) {
  return (
    <div style={{ overflowX: 'auto', marginBottom: 10 }}>
      <div style={{ minWidth }}>{children}</div>
    </div>
  );
}

function HistorialImports({ rows, cargando, error, nombreUsuario }) {
  return (
    <div>
      <Label style={{ marginBottom: 6 }}>Historial de imports</Label>
      {error && <Note style={{ color: '#b91c1c' }}>{error}</Note>}
      {!error && cargando && <div style={{ fontSize: 12.5, color: T.ink3, padding: '8px 0' }}>Cargando historial…</div>}
      {!error && !cargando && rows.length === 0 && (
        <div style={{ fontSize: 12.5, color: T.ink3, padding: '8px 0' }}>Todavía no hubo imports — el primero queda registrado acá.</div>
      )}
      {!error && rows.length > 0 && (
        <TablaScroll minWidth={680}>
          <Table
            cols={[
              { label: 'Fecha', flex: 1, mono: true },
              { label: 'Archivo', flex: 2 },
              { label: 'Tipo', flex: 1 },
              { label: 'Resumen', flex: 2.4 },
              { label: 'Usuario', flex: 1 },
            ]}
            rows={rows.map((r) => [
              fmtFecha(r.fecha),
              r.archivo || '—',
              TIPO_LABEL[r.tipo] || r.tipo || '—',
              { v: resumenLegible(r.resumen), dim: true },
              nombreUsuario(r.usuario),
            ])}
          />
        </TablaScroll>
      )}
    </div>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────

export default function CampImportar() {
  const { currentUser, usuarios } = useUsuarios();
  const { fetchOperadores, fetchEstaciones, fetchDecisores, ejecutarImport } = useCampanas();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // Guard: solo Admin o usuarios con el permiso `campanas` (patrón Pipeline.jsx).
  const puede = currentUser?.rol === 'Admin' || !!currentUser?.permisos?.campanas;
  useEffect(() => { if (currentUser && !puede) navigate('/', { replace: true }); }, [currentUser, puede, navigate]);

  // paso: elegir → parseando → preview → importando → resultado
  const [paso, setPaso] = useState('elegir');
  const [tipo, setTipo] = useState(null);          // 'unificado' | 'decisores' | 'linkedin'
  const [archivo, setArchivo] = useState(null);    // File
  const [detalle, setDetalle] = useState('');      // "hoja X · N filas" / CSVs hallados
  const [plan, setPlan] = useState(null);          // plan (unificado ya completado / linkedin puro)
  const [opPorDecisor, setOpPorDecisor] = useState({});       // decisorId → operador_id (linkedin)
  const [nombrePorDecisor, setNombrePorDecisor] = useState({}); // decisorId → nombre (preview linkedin)
  const [error, setError] = useState(null);
  const [progreso, setProgreso] = useState({ hecho: 0, total: 0 });
  const [resultado, setResultado] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [histCargando, setHistCargando] = useState(true);
  const [histError, setHistError] = useState(null);
  const [histTick, setHistTick] = useState(0); // bump → recarga el historial (post-import)

  // Historial de camp_import_runs. El contrato de CampanasContext no expone un
  // fetch de import_runs → query local mínima (candidata a moverse al context
  // en Fase 2). histCargando arranca en true y solo se apaga acá: las recargas
  // posteriores (histTick) refrescan en silencio, sin parpadeo de "Cargando…".
  useEffect(() => {
    if (!currentUser || !puede) return undefined;
    let vivo = true;
    supabase
      .from('camp_import_runs').select('*')
      .order('fecha', { ascending: false }).limit(20)
      .then(({ data, error: e }) => {
        if (!vivo) return;
        setHistorial(data || []);
        setHistError(e ? 'No pude cargar el historial de imports.' : null);
        setHistCargando(false);
      });
    return () => { vivo = false; };
  }, [currentUser, puede, histTick]);

  const reset = () => {
    setPaso('elegir'); setTipo(null); setArchivo(null); setDetalle('');
    setPlan(null); setOpPorDecisor({}); setNombrePorDecisor({});
    setError(null); setResultado(null); setProgreso({ hecho: 0, total: 0 });
  };

  // ── Parseo client-side + armado del plan ──────────────────────────────────
  const manejarArchivo = async (tipoKey, file) => {
    if (!file) return;
    const meta = TIPOS_IMPORT.find((m) => m.key === tipoKey);
    if (meta && !meta.re.test(file.name)) {
      setError(`"${file.name}" no parece un archivo de ${meta.titulo}. Esperaba ${meta.formatos}.`);
      return;
    }
    setError(null); setTipo(tipoKey); setArchivo(file); setPaso('parseando');
    try {
      if (tipoKey === 'linkedin') {
        const { default: JSZip } = await import('jszip');
        let zip;
        try { zip = await JSZip.loadAsync(await file.arrayBuffer()); }
        catch { throw new Error('No pude abrir el ZIP. ¿Está dañado o no es un .zip de verdad?'); }
        const rawFiles = await parseLinkedInZip(zip);
        const hallados = ['messages', 'connections', 'invitations'].filter((k) => rawFiles[k]);
        if (!hallados.length) {
          throw new Error('El ZIP no trae messages.csv, Connections.csv ni Invitations.csv. ¿Es el export oficial de LinkedIn (Settings → Get a copy of your data)?');
        }
        const decisores = await traerTodo(fetchDecisores);
        const actividadesPrevias = await traerActividadesLinkedIn();
        const p = planImportLinkedIn(rawFiles, {
          decisores,
          actividadesPrevias,
          miNombre: currentUser?.nombre || '',
        });
        const ops = {}; const nombres = {};
        for (const d of decisores) { ops[d.id] = d.operador_id || null; nombres[d.id] = d.nombre || '—'; }
        setOpPorDecisor(ops); setNombrePorDecisor(nombres);
        setDetalle(hallados.map((k) => `${k}.csv`).join(' · '));
        setPlan(p);
      } else {
        // Unificado y CSV de decisores: mismas columnas → mismo planificador.
        // XLSX.read también lee CSV (patrón src/pages/obra/AdjuntarPresupuestoModal.jsx).
        const XLSX = await cargarXlsx();
        let wb;
        try { wb = XLSX.read(await file.arrayBuffer(), { type: 'array' }); }
        catch { throw new Error('No pude leer el archivo. ¿Está dañado o abierto en Excel? Cerralo y probá de nuevo.'); }
        const elegida = elegirFilas(XLSX, wb);
        if (!elegida) throw new Error('La planilla no tiene ninguna hoja con datos. Revisá que la primera fila sean los encabezados (Bandera, Estacion, Operador…).');
        const [operadores, estaciones, decisores] = await Promise.all([
          traerTodo(fetchOperadores),
          traerTodo(fetchEstaciones),
          traerTodo(fetchDecisores),
        ]);
        const puro = planImportUnificado(elegida.rows, { existentes: { operadores, estaciones, decisores } });
        setDetalle(`hoja "${elegida.hoja}" · ${elegida.rows.length} filas`);
        setPlan(completarPlanUnificado(puro, { operadores, estaciones, decisores }));
      }
      setPaso('preview');
    } catch (e) {
      setError(e?.message || 'Algo salió mal leyendo el archivo. Probá de nuevo.');
      setPaso('elegir');
    }
  };

  // ── Ejecutar el plan ──────────────────────────────────────────────────────
  const importar = async () => {
    if (!plan) return;
    setError(null); setProgreso({ hecho: 0, total: 0 }); setPaso('importando');
    const planEjec = tipo === 'linkedin'
      ? armarPlanLinkedIn(plan, opPorDecisor, currentUser?.id)
      : plan;
    const { error: e, resumen } = await ejecutarImport(planEjec, {
      usuario: currentUser?.id || null,
      archivo: archivo?.name || '',
      tipo,
      onProgress: (hecho, total) => setProgreso({ hecho, total }),
    });
    if (e) {
      setError(`El import falló a mitad de camino (${e.message || 'error de conexión'}). Lo que ya entró no se duplica si reintentás: volvé a apretar Importar.`);
      setPaso('preview');
      return;
    }
    setResultado(resumen);
    setPaso('resultado');
    setHistTick((t) => t + 1); // refrescar el historial con el run recién creado
  };

  // ── Derivados para el preview ─────────────────────────────────────────────
  const esLinkedIn = tipo === 'linkedin';
  const r = plan?.resumen || {};
  const errores = Array.isArray(r.errores) ? r.errores : [];
  const hayAlgo = esLinkedIn
    ? (plan?.actividades?.length || 0) > 0
    : sumar(r.nuevos) + sumar(r.actualizados) > 0;
  const muestra = paso === 'preview' && plan && !esLinkedIn ? armarMuestraUnificado(plan) : [];
  const nombreUsuario = (id) => usuarios?.find((u) => u.id === id)?.nombre || id || '—';
  const pct = progreso.total ? Math.round((progreso.hecho / progreso.total) * 100) : 0;

  return (
    <PageLayout breadcrumb={[{ label: 'Inicio', to: '/' }, { label: 'Campañas', to: '/campanas' }, 'Importar']} active="Campañas">
      <PageHero
        label="CAMPAÑAS"
        title="Importar datos"
        subtitle="La base viva: sumá estaciones, decisores y actividad de LinkedIn sin pisar lo ya cargado"
      />

      {error && (
        <Box style={{ padding: '10px 14px', marginBottom: 12, background: '#fdf1ef', color: '#b91c1c', fontSize: 13 }}>
          ⚠️ {error}
        </Box>
      )}

      {/* ── Paso 1: elegir tipo + archivo ─────────────────────────────────── */}
      {paso === 'elegir' && (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
            gap: 12,
            marginBottom: 10,
          }}>
            {TIPOS_IMPORT.map((meta) => (
              <TarjetaTipo key={meta.key} meta={meta} onArchivo={(f) => manejarArchivo(meta.key, f)} />
            ))}
          </div>
          <Note style={{ marginBottom: 16 }}>
            Import incremental: primero se arma un plan y lo revisás — nada toca la base hasta que aprietes “Importar todo”.
          </Note>
        </>
      )}

      {/* ── Paso 2: parseando ─────────────────────────────────────────────── */}
      {paso === 'parseando' && (
        <Box style={{ padding: 24, marginBottom: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 26 }}>🔍</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>Leyendo {archivo?.name}…</div>
          <div style={{ fontSize: 12.5, color: T.ink2, marginTop: 4 }}>
            Comparando contra la base para armar el plan — todavía no se guarda nada.
          </div>
        </Box>
      )}

      {/* ── Paso 3: PREVIEW ───────────────────────────────────────────────── */}
      {paso === 'preview' && plan && (
        <>
          <Box style={{ padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Chip accent>{TIPO_LABEL[tipo]}</Chip>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{archivo?.name}</span>
            {detalle && <span style={{ fontSize: 12, color: T.ink3, fontFamily: T.fontMono }}>{detalle}</span>}
          </Box>

          {/* Tarjetas resumen */}
          {esLinkedIn ? (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(6, 1fr)', gap: 10, marginBottom: 12 }}>
              <Tile label="Invitados" value={r.invitados || 0} />
              <Tile label="Contactados" value={r.contactados || 0} />
              <Tile label="Aceptaron" value={r.aceptaron || 0} color={T.accent} />
              <Tile label="Respondieron" value={r.respondieron || 0} color={T.ok} />
              <Tile label="Ya importadas" value={r.duplicadosSalteados || 0} color={T.ink3} sub="se saltean" />
              <Tile label="Sin match" value={r.sinMatch || 0} color={r.sinMatch ? T.warn : T.ink3} />
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
              <Tile label="Nuevos" value={sumar(r.nuevos)} color={T.ok} sub={desglose(r.nuevos) || '—'} />
              <Tile label="Actualizados" value={sumar(r.actualizados)} color={T.warn} sub={desglose(r.actualizados) || 'completan huecos'} />
              <Tile label="Salteados" value={sumar(r.salteados)} color={T.ink3} sub="ya estaban iguales" />
              <Tile label="Errores" value={errores.length} color={errores.length ? '#b91c1c' : T.ink3} sub={errores.length ? 'filas ilegibles' : '—'} />
            </div>
          )}

          {/* Muestra */}
          {esLinkedIn ? (
            (plan.actividades?.length || 0) > 0 && (
              <>
                <Label style={{ marginBottom: 6 }}>Muestra — primeras {Math.min(MAX_MUESTRA, plan.actividades.length)} de {plan.actividades.length} actividades</Label>
                <TablaScroll minWidth={560}>
                  <Table
                    cols={[
                      { label: 'Actividad', flex: 1.4 },
                      { label: 'Decisor', flex: 1.4 },
                      { label: 'Fecha', flex: 0.8, mono: true },
                    ]}
                    rows={plan.actividades.slice(0, MAX_MUESTRA).map((a) => [
                      <Chip key="c" style={{ color: TIPO_LINKEDIN_META[a.tipo]?.color }}>{TIPO_LINKEDIN_META[a.tipo]?.label || a.tipo}</Chip>,
                      nombrePorDecisor[a.decisorId] || '—',
                      fmtFecha(a.fecha),
                    ])}
                  />
                </TablaScroll>
              </>
            )
          ) : (
            muestra.length > 0 && (
              <>
                <Label style={{ marginBottom: 6 }}>Muestra — primeras {muestra.length} filas del plan</Label>
                <TablaScroll minWidth={620}>
                  <Table
                    cols={[
                      { label: 'Entidad', flex: 0.7 },
                      { label: 'Nombre', flex: 1.8 },
                      { label: 'Acción', flex: 0.7 },
                      { label: 'Detalle', flex: 1.4 },
                    ]}
                    rows={muestra.map((m) => [
                      { v: m.ent, dim: true },
                      m.nombre,
                      <ChipAccion key="a" accion={m.accion} />,
                      { v: m.detalle || '—', dim: true },
                    ])}
                  />
                </TablaScroll>
              </>
            )
          )}

          {/* Errores (unificado/decisores) */}
          {!esLinkedIn && errores.length > 0 && (
            <Desplegable titulo={`⚠️ ${errores.length} filas con error — se saltean, el resto se importa igual`}>
              {errores.slice(0, MAX_LISTA).map((e, i) => (
                <div key={i} style={{ fontSize: 12.5, padding: '3px 0', borderBottom: `1px dashed ${T.faint}` }}>
                  <span style={{ fontFamily: T.fontMono, color: T.ink3 }}>fila {e.fila}</span> — {e.motivo}
                </div>
              ))}
              {errores.length > MAX_LISTA && (
                <div style={{ fontSize: 12, color: T.ink3, paddingTop: 6 }}>…y {errores.length - MAX_LISTA} más.</div>
              )}
            </Desplegable>
          )}

          {/* Sin match (linkedin) */}
          {esLinkedIn && (plan.sinMatch?.length || 0) > 0 && (
            <Desplegable titulo={`🕵️ ${plan.sinMatch.length} personas sin match — no encontré a estas personas entre tus decisores`}>
              {plan.sinMatch.slice(0, MAX_LISTA).map((p, i) => (
                <div key={i} style={{ fontSize: 12.5, padding: '3px 0', borderBottom: `1px dashed ${T.faint}` }}>
                  {p.nombre}
                  <span style={{ color: T.ink3 }}> · {p.origen}{p.url ? ` · ${p.url}` : ''}</span>
                </div>
              ))}
              {plan.sinMatch.length > MAX_LISTA && (
                <div style={{ fontSize: 12, color: T.ink3, paddingTop: 6 }}>…y {plan.sinMatch.length - MAX_LISTA} más.</div>
              )}
              <div style={{ fontSize: 11.5, color: T.ink3, paddingTop: 8 }}>
                Cargalos primero con el CSV de decisores y volvé a importar el ZIP: el diff no duplica lo ya importado.
              </div>
            </Desplegable>
          )}

          <div style={{ display: 'flex', gap: 10, margin: '14px 0 18px', flexWrap: 'wrap' }}>
            <Btn fill accent onClick={importar} disabled={!hayAlgo}
              style={{ fontSize: 14, padding: '10px 26px', opacity: hayAlgo ? 1 : 0.45 }}>
              ⬇ Importar todo
            </Btn>
            <Btn onClick={reset} style={{ padding: '10px 18px' }}>Cancelar</Btn>
            {!hayAlgo && (
              <span style={{ fontSize: 12.5, color: T.ink3, alignSelf: 'center' }}>
                No hay nada nuevo para importar — la base ya está al día con este archivo.
              </span>
            )}
          </div>
        </>
      )}

      {/* ── Paso 4: importando ────────────────────────────────────────────── */}
      {paso === 'importando' && (
        <Box style={{ padding: 24, marginBottom: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Importando {archivo?.name}…</div>
          <Bar pct={pct} accent h={9} style={{ maxWidth: 420, margin: '0 auto' }} />
          <div style={{ fontSize: 12.5, color: T.ink2, marginTop: 8, fontFamily: T.fontMono }}>
            {progreso.hecho} / {progreso.total || '…'} filas ({pct}%)
          </div>
          <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 4 }}>No cierres la pestaña hasta que termine.</div>
        </Box>
      )}

      {/* ── Paso 5: resultado ─────────────────────────────────────────────── */}
      {paso === 'resultado' && (
        <Box style={{ padding: 28, marginBottom: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 34, lineHeight: 1 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 800, marginTop: 8 }}>
            Importados: {resumenLegible(resultado)}
          </div>
          <div style={{ fontSize: 12.5, color: T.ink2, marginTop: 4 }}>
            Quedó registrado en el historial de abajo.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
            <Btn fill accent onClick={() => navigate('/campanas/contactos')} style={{ padding: '10px 22px' }}>
              Ver contactos
            </Btn>
            <Btn onClick={reset} style={{ padding: '10px 18px' }}>Importar otro archivo</Btn>
          </div>
        </Box>
      )}

      {/* ── Historial (siempre visible) ───────────────────────────────────── */}
      <div style={{ marginTop: 6 }}>
        <HistorialImports rows={historial} cargando={histCargando} error={histError} nombreUsuario={nombreUsuario} />
      </div>
    </PageLayout>
  );
}
