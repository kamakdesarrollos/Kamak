import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../../components/layout/PageLayout';
import PageHero from '../../components/ui/PageHero';
import Modal from '../../components/ui/Modal';
import { Btn } from '../../components/ui';
import { T } from '../../theme';
import { useUsuarios } from '../../store/UsuariosContext';
import { useCampanas } from '../../store/CampanasContext';
import { ETAPAS_PROSPECCION, ETAPA_PROSPECCION_META, BANDERAS } from '../../lib/campanas/constants';
import { useIsMobile } from '../../hooks/useMediaQuery';

// Kanban de prospección por etapa (pre-embudo de camp_operadores). Cards de
// OPERADOR — acá NUNCA se muestran montos (P11). DnD HTML5 en desktop (patrón
// exacto de Pipeline.jsx) + bottom-sheet de etapas para mobile (touch no tiene
// DnD nativo) y como alternativa accesible en desktop (botón ⇢ de la card).
// Carga paginada por columna (30 por página + "Cargar más"): jamás la tabla
// entera. Todo movimiento pasa por setEtapaProspeccion (registra actividad y
// chequea colisión de tratativas — P6).

const PAGE_SIZE = 30;
const COL_VACIA = { rows: [], total: 0, page: 1, loading: false };

// Etapas "vivas" del pre-embudo (para el subtitle del hero).
const ETAPAS_ACTIVAS = ETAPAS_PROSPECCION.filter(e => e !== 'promovido' && e !== 'descartado');

// Convierte un hex (#rrggbb) a rgba con alpha — para tintes suaves de columna.
const tint = (hex, a) => {
  const h = (hex || '#000000').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

// "hace 3 d" / "hace 2 h" / "recién" desde un ISO timestamp.
const tiempoDesde = (iso) => {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d} d`;
  const meses = Math.floor(d / 30);
  return `hace ${meses} ${meses === 1 ? 'mes' : 'meses'}`;
};

// ── Card de operador (estética exacta de las cards de Pipeline) ───────────────
function CardOperador({ op, meta, isMobile, isDragging, hayDrag, lockDe, onDragStart, onDragEnd, onAbrirMover }) {
  const banderas = Array.isArray(op.banderas) ? op.banderas.filter(Boolean) : [];
  const visibles = banderas.slice(0, 3);
  const extra = banderas.length - visibles.length;
  // Decisores SOLO si el row ya los trae embebidos (nunca un fetch extra por card).
  const nDec = Array.isArray(op.camp_decisores) ? op.camp_decisores.length : null;
  const lock = !!lockDe;
  return (
    <div
      draggable={!isMobile}
      onDragStart={isMobile ? undefined : onDragStart}
      onDragEnd={isMobile ? undefined : onDragEnd}
      onClick={() => { if (isMobile) onAbrirMover(); }}
      title={lock
        ? `En tratativas con ${lockDe}${op.canal_activo ? ` por ${op.canal_activo}` : ''}`
        : (isMobile ? 'Tocar para mover de etapa' : 'Arrastrar para mover de etapa')}
      style={{
        background: '#fff',
        border: lock ? `1.5px dashed ${T.ink3}` : `1px solid ${T.faint2}`,
        borderLeft: `3px solid ${meta.color}`,
        borderRadius: 7,
        padding: '9px 11px 9px 12px',
        marginBottom: 9,
        minWidth: 0,
        cursor: isMobile ? 'pointer' : 'grab',
        boxShadow: isDragging ? '0 10px 20px -6px rgba(20,18,15,0.38)' : '0 1px 2px rgba(20,18,15,0.06)',
        opacity: isDragging ? 0.55 : 1,
        transform: isDragging ? 'rotate(-1.5deg)' : 'none',
        transition: 'box-shadow .15s, opacity .15s, transform .1s',
      }}
      onMouseEnter={e => { if (!hayDrag) e.currentTarget.style.boxShadow = '0 4px 12px -4px rgba(20,18,15,0.20)'; }}
      onMouseLeave={e => { if (!hayDrag) e.currentTarget.style.boxShadow = '0 1px 2px rgba(20,18,15,0.06)'; }}
    >
      {/* Nombre + lock + botón mover (accesibilidad desktop) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {lock && <span style={{ fontSize: 10, flexShrink: 0 }}>🔒</span>}
        <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: T.ink, lineHeight: 1.25, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {op.nombre || 'Sin nombre'}
        </div>
        {!isMobile && (
          <button
            onClick={(e) => { e.stopPropagation(); onAbrirMover(); }}
            title="Mover de etapa"
            style={{ flexShrink: 0, border: `1px solid ${T.faint2}`, background: '#fff', color: T.ink2, borderRadius: 5, fontSize: 11, lineHeight: 1, padding: '3px 6px', cursor: 'pointer', fontFamily: T.font }}
          >⇢</button>
        )}
      </div>

      {/* Chips: banderas + estaciones + decisores (si vinieron en el row) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
        {visibles.map(b => (
          <span key={b} style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, color: T.ink2, background: T.faint, borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap' }}>{b}</span>
        ))}
        {extra > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: T.ink3 }}>+{extra}</span>}
        {(op.n_estaciones ?? 0) > 0 && (
          <span style={{ fontFamily: T.fontMono, fontSize: 9.5, fontWeight: 700, color: T.ink3, whiteSpace: 'nowrap' }}>{op.n_estaciones} est.</span>
        )}
        {nDec > 0 && (
          <span style={{ fontFamily: T.fontMono, fontSize: 9.5, fontWeight: 700, color: T.ink3, whiteSpace: 'nowrap' }}>{nDec} decisor{nDec > 1 ? 'es' : ''}</span>
        )}
      </div>

      {/* Footer: último touch + canal activo si está tomado */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 7, gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 10, color: T.ink3, whiteSpace: 'nowrap' }}>{tiempoDesde(op.updated_at)}</span>
        {lock && op.canal_activo && (
          <span style={{ fontSize: 9, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{op.canal_activo}</span>
        )}
      </div>
    </div>
  );
}

// ── Sheet "mover de etapa": bottom-sheet en mobile / panel centrado en desktop ─
function SheetMover({ op, isMobile, onElegir, onClose }) {
  const actual = op.etapa_prospeccion || 'sin_contactar';
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,0.4)', zIndex: 1000, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: T.paper,
          width: isMobile ? '100%' : 360,
          maxWidth: '100%',
          borderRadius: isMobile ? '14px 14px 0 0' : 10,
          padding: '14px 16px 18px',
          maxHeight: '75vh',
          overflowY: 'auto',
          boxShadow: '0 -8px 30px rgba(20,18,15,0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: T.ink3 }}>Mover de etapa</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{op.nombre || 'Sin nombre'}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            style={{ border: 'none', background: 'transparent', fontSize: 18, color: T.ink2, cursor: 'pointer', padding: 4, lineHeight: 1 }}
          >✕</button>
        </div>
        {ETAPAS_PROSPECCION.map(et => {
          const meta = ETAPA_PROSPECCION_META[et];
          const esActual = et === actual;
          return (
            <button
              key={et}
              disabled={esActual}
              onClick={() => onElegir(et)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '11px 12px', marginBottom: 7, borderRadius: 8,
                border: esActual ? `1.5px solid ${meta.color}` : `1px solid ${T.faint2}`,
                background: esActual ? tint(meta.color, 0.12) : '#fff',
                cursor: esActual ? 'default' : 'pointer',
                fontFamily: T.font, textAlign: 'left',
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: T.ink }}>{meta.label}</span>
              {esActual && <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: meta.color }}>Actual</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Mini-modal de motivo al descartar ─────────────────────────────────────────
function MotivoDescarteModal({ nombre, onClose, onConfirm }) {
  const [motivo, setMotivo] = useState('');
  const listo = motivo.trim().length > 0;
  const confirmar = () => { if (listo) onConfirm(motivo.trim()); };
  return (
    <Modal
      title="Descartar operador"
      subtitle={nombre}
      onClose={onClose}
      width={400}
      footer={(
        <>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill onClick={confirmar} style={{ opacity: listo ? 1 : 0.45, cursor: listo ? 'pointer' : 'default' }}>Descartar</Btn>
        </>
      )}
    >
      <div style={{ fontSize: 12.5, color: T.ink2, marginBottom: 10 }}>
        ¿Por qué se descarta? Queda registrado en la actividad del operador.
      </div>
      <input
        autoFocus
        value={motivo}
        onChange={e => setMotivo(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') confirmar(); }}
        placeholder="Motivo (ej: no interesa, cerró la estación…)"
        style={{ width: '100%', padding: '8px 10px', border: `1px solid ${T.faint2}`, borderRadius: 6, fontSize: 13, fontFamily: T.font, outline: 'none', boxSizing: 'border-box' }}
      />
    </Modal>
  );
}

// ── Skeleton de card mientras carga la columna ────────────────────────────────
function SkeletonCard({ alto = 62 }) {
  return (
    <div style={{ height: alto, background: T.faint, borderRadius: 7, marginBottom: 9, animation: 'campKanbanPulse 1.2s ease-in-out infinite' }} />
  );
}

export default function CampKanban() {
  const { currentUser, usuarios } = useUsuarios();
  const campanas = useCampanas();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // Guard: solo Admin o usuarios con el permiso `campanas` (patrón Pipeline.jsx).
  const puede = currentUser?.rol === 'Admin' || !!currentUser?.permisos?.campanas;
  const isAdmin = currentUser?.rol === 'Admin';
  useEffect(() => { if (currentUser && !puede) navigate('/', { replace: true }); }, [currentUser, puede, navigate]);

  const { fetchOperadores, setEtapaProspeccion, registrarActividad } = campanas || {};

  // Estado por columna en UN solo mapa {etapa: {rows, total, page, loading}}.
  const [cols, setCols] = useState({});
  const [counts, setCounts] = useState(null);      // counts REALES por etapa (total del fetch de cada columna)
  const [drag, setDrag] = useState(null);          // operadorId arrastrándose
  const [dragOver, setDragOver] = useState(null);  // etapa bajo el cursor
  const [bandera, setBandera] = useState('');
  const [busqueda, setBusqueda] = useState('');    // input crudo
  const [busq, setBusq] = useState('');            // debounced
  const [sheetOp, setSheetOp] = useState(null);    // operador → sheet de etapas
  const [descarte, setDescarte] = useState(null);  // operador → modal de motivo
  const [aviso, setAviso] = useState(null);        // banner de error/colisión
  const reqRef = useRef(0);                        // descarta responses viejas al refiltrar

  // Debounce de la búsqueda (no pegarle a Supabase por tecla).
  useEffect(() => {
    const t = setTimeout(() => setBusq(busqueda.trim()), 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  const filtrosBase = useMemo(() => {
    const f = {};
    if (bandera) f.bandera = bandera;
    if (busq) f.busqueda = busq;
    return f;
  }, [bandera, busq]);

  // Reset sincrónico al cambiar los filtros (patrón "adjust state during
  // render" de react.dev — no en un efecto, evita renders en cascada): así no
  // se ven columnas/counts viejos mientras llega lo nuevo.
  const [filtrosAplicados, setFiltrosAplicados] = useState(null);
  if (filtrosAplicados !== filtrosBase) {
    setFiltrosAplicados(filtrosBase);
    setCols({});
    setCounts(null);
  }

  const cargarColumna = useCallback(async (etapa, page, fBase, req) => {
    if (!fetchOperadores) return;
    setCols(prev => ({ ...prev, [etapa]: { ...(prev[etapa] || COL_VACIA), loading: true } }));
    const { rows, total, error } = await fetchOperadores({
      page,
      pageSize: PAGE_SIZE,
      filtros: { ...fBase, etapa },
      orden: '-updated_at',
    });
    if (req !== reqRef.current) return; // el filtro ya cambió: response vieja, afuera
    setCols(prev => {
      const ant = prev[etapa] || COL_VACIA;
      const previas = page === 1 ? [] : ant.rows;
      const vistos = new Set(previas.map(r => r.id));
      const rowsNuevas = [...previas, ...rows.filter(r => !vistos.has(r.id))];
      return { ...prev, [etapa]: { rows: rowsNuevas, total: error ? ant.total : total, page, loading: false } };
    });
    // Count de la etapa derivado del total del propio fetch (mismos filtros,
    // mismo momento): reemplaza a contarPorEtapa acá, que duplicaba en 7
    // queries extra lo que las columnas ya traen. Los ajustes optimistas ±1
    // de aplicarMovimientoLocal siguen operando sobre este mismo mapa.
    if (!error) setCounts(prev => ({ ...(prev || {}), [etapa]: total }));
    if (error) setAviso(error.message || 'Error cargando operadores');
  }, [fetchOperadores]);

  // Carga inicial + recarga completa al cambiar filtros: primera página de
  // cada columna (el reset visual ya ocurrió en el render). Los counts salen
  // del total que devuelve cada fetch — sin queries de conteo aparte.
  useEffect(() => {
    if (!puede || !fetchOperadores) return;
    reqRef.current += 1;
    const req = reqRef.current;
    ETAPAS_PROSPECCION.forEach(et => { cargarColumna(et, 1, filtrosBase, req); });
  }, [puede, filtrosBase, fetchOperadores, cargarColumna]);

  // El banner de aviso se va solo.
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 7000);
    return () => clearTimeout(t);
  }, [aviso]);

  const nombreUsuario = useCallback(
    (id) => (usuarios || []).find(u => u.id === id)?.nombre || 'otro usuario',
    [usuarios],
  );

  // Movimiento local optimista (y su reverso si el server rechaza).
  const aplicarMovimientoLocal = useCallback((op, desde, hacia, tocarFecha) => {
    setCols(prev => {
      const cDesde = prev[desde] || COL_VACIA;
      const cHacia = prev[hacia] || COL_VACIA;
      const movida = { ...op, etapa_prospeccion: hacia, ...(tocarFecha ? { updated_at: new Date().toISOString() } : {}) };
      return {
        ...prev,
        [desde]: { ...cDesde, rows: cDesde.rows.filter(r => r.id !== op.id), total: Math.max(0, cDesde.total - 1) },
        [hacia]: { ...cHacia, rows: [movida, ...cHacia.rows.filter(r => r.id !== op.id)], total: cHacia.total + 1 },
      };
    });
    setCounts(prev => (prev
      ? { ...prev, [desde]: Math.max(0, (prev[desde] || 0) - 1), [hacia]: (prev[hacia] || 0) + 1 }
      : prev));
  }, []);

  // Mueve de verdad: optimista → setEtapaProspeccion → revert si colisión/error.
  // Admin puede forzar la colisión con confirm. El motivo (descarte) se registra
  // como actividad aparte (el cambio de etapa ya lo registra el context).
  const mover = useCallback(async (op, etapaDestino, { motivo } = {}) => {
    const origen = op.etapa_prospeccion || 'sin_contactar';
    if (!setEtapaProspeccion || origen === etapaDestino) return;
    const uid = currentUser?.id || null;
    aplicarMovimientoLocal(op, origen, etapaDestino, true);
    const revertir = () => aplicarMovimientoLocal({ ...op, etapa_prospeccion: etapaDestino }, etapaDestino, origen, false);

    let res = await setEtapaProspeccion(op.id, etapaDestino, { usuario: uid });
    let forzado = false;
    if (res?.error?.colision) {
      const { ownerId, canal } = res.error.colision;
      const quien = nombreUsuario(ownerId);
      const porCanal = canal ? ` por ${canal}` : '';
      if (isAdmin && window.confirm(`En tratativas con ${quien}${porCanal}. ¿Forzar el movimiento igual?`)) {
        res = await setEtapaProspeccion(op.id, etapaDestino, { usuario: uid, force: true });
        forzado = true;
      }
      if (res?.error) {
        revertir();
        setAviso(res.error.colision
          ? `En tratativas con ${quien}${porCanal} — no se movió.`
          : (res.error.message || 'No se pudo mover el operador'));
        return;
      }
    } else if (res?.error) {
      revertir();
      setAviso(res.error.message || 'No se pudo mover el operador');
      return;
    }
    if (etapaDestino === 'descartado' && motivo && registrarActividad) {
      await registrarActividad({
        operadorId: op.id,
        tipo: 'nota',
        texto: `Motivo de descarte: ${motivo}`,
        usuario: uid,
        force: forzado,
      });
    }
  }, [setEtapaProspeccion, registrarActividad, currentUser, isAdmin, aplicarMovimientoLocal, nombreUsuario]);

  // Reglas de destino compartidas por DnD y sheet: promovido NO desde acá
  // (la promoción crea cliente+obra y va con confirm desde la ficha) y
  // descartado pide motivo primero.
  const intentarMover = useCallback((op, etapaDestino) => {
    if (etapaDestino === 'promovido') {
      window.alert('Promovélo desde su ficha en Contactos: la promoción crea el cliente y la obra.');
      return;
    }
    if (etapaDestino === 'descartado') { setDescarte(op); return; }
    mover(op, etapaDestino);
  }, [mover]);

  const buscarOperador = (id) => {
    for (const et of ETAPAS_PROSPECCION) {
      const r = (cols[et]?.rows || []).find(x => x.id === id);
      if (r) return r;
    }
    return null;
  };

  const onDrop = (etapaDestino) => {
    const id = drag;
    setDrag(null); setDragOver(null);
    if (!id) return;
    const op = buscarOperador(id);
    if (!op || (op.etapa_prospeccion || 'sin_contactar') === etapaDestino) return;
    intentarMover(op, etapaDestino);
  };

  const elegirEtapaSheet = (etapa) => {
    const op = sheetOp;
    setSheetOp(null);
    if (!op || (op.etapa_prospeccion || 'sin_contactar') === etapa) return;
    intentarMover(op, etapa);
  };

  // counts se llena de a una etapa por vez (cada fetch de columna aporta la
  // suya): el subtitle recién muestra números cuando TODAS reportaron — el
  // equivalente exacto al momento en que antes resolvía contarPorEtapa.
  const countsListos = !!counts && ETAPAS_PROSPECCION.every(e => counts[e] !== undefined);
  const enProspeccion = countsListos ? ETAPAS_ACTIVAS.reduce((s, e) => s + (counts[e] || 0), 0) : null;
  const subtitle = countsListos
    ? `${enProspeccion} operadores en prospección · ${counts.en_conversacion || 0} en conversación · ${counts.reunion || 0} ${(counts.reunion || 0) === 1 ? 'reunión' : 'reuniones'}`
    : 'Operadores por etapa: sin contactar → contactado → … → promovido';

  const selSt = { padding: '6px 8px', border: `1px solid ${T.faint2}`, borderRadius: 6, fontSize: 12.5, fontFamily: T.font, background: '#fff', color: T.ink };

  return (
    <PageLayout breadcrumb={[{ label: 'Inicio', to: '/' }, 'Campañas']} active="Campañas">
      <style>{'@keyframes campKanbanPulse { 0%, 100% { opacity: .45 } 50% { opacity: .9 } }'}</style>
      <PageHero
        label="CAMPAÑAS"
        title="Kanban de prospección"
        subtitle={subtitle}
      />

      {/* Banner de colisión / error */}
      {aviso && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: tint('#b91c1c', 0.08), border: '1px solid #b91c1c', color: '#b91c1c', borderRadius: 7, padding: '8px 12px', fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>
          <span style={{ flex: 1, minWidth: 0 }}>{aviso}</span>
          <button onClick={() => setAviso(null)} aria-label="Cerrar aviso" style={{ border: 'none', background: 'transparent', color: '#b91c1c', fontSize: 14, cursor: 'pointer', padding: 0, lineHeight: 1 }}>✕</button>
        </div>
      )}

      {/* Filtros: bandera + búsqueda (refiltran TODAS las columnas) */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '2px 0 12px', flexWrap: 'wrap' }}>
        <select value={bandera} onChange={e => setBandera(e.target.value)} style={selSt}>
          <option value="">Todas las banderas</option>
          {BANDERAS.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <input
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar operador…"
          style={{ ...selSt, flex: isMobile ? '1 1 140px' : '0 1 240px', minWidth: 120, outline: 'none' }}
        />
        {(bandera || busqueda) && (
          <Btn sm onClick={() => { setBandera(''); setBusqueda(''); }}>Limpiar</Btn>
        )}
      </div>

      {/* Tablero Kanban — scroll horizontal, columnas por etapa */}
      <div style={{
        display: 'flex',
        gap: 12,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        padding: isMobile ? '4px 0 18px' : '4px 2px 18px',
        alignItems: 'flex-start',
      }}>
        {ETAPAS_PROSPECCION.map(etapa => {
          const col = cols[etapa] || COL_VACIA;
          const meta = ETAPA_PROSPECCION_META[etapa];
          const isOver = !!drag && dragOver === etapa;
          const nReal = counts?.[etapa] ?? (col.loading ? '…' : (col.total ?? 0));
          const faltan = Math.max(0, (col.total || 0) - col.rows.length);
          return (
            <div
              key={etapa}
              onDragOver={e => e.preventDefault()}
              onDragEnter={() => { if (drag) setDragOver(etapa); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(null); }}
              onDrop={() => onDrop(etapa)}
              style={{
                flex: isMobile ? '0 0 220px' : '0 0 246px',
                background: isOver ? tint(meta.color, 0.10) : '#fbf9f1',
                border: isOver ? `1.5px dashed ${meta.color}` : `1px solid ${T.faint2}`,
                borderRadius: 10,
                padding: isMobile ? 8 : 11,
                minHeight: 300,
                boxShadow: '0 1px 0 rgba(0,0,0,0.03)',
                transition: 'background .15s, border-color .15s',
              }}
            >
              {/* Header de columna: punto de color + label + badge con el count REAL */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 13 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 800, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.4, color: T.ink, flex: 1, minWidth: 0 }}>{meta.label}</span>
                <span style={{ fontFamily: T.fontMono, fontSize: 11, fontWeight: 700, color: '#fff', background: meta.color, borderRadius: 10, padding: '1px 7px', minWidth: 20, textAlign: 'center' }}>{nReal}</span>
              </div>

              {/* Cards de operador */}
              {col.rows.map(op => {
                const lockDe = op.en_tratativas && op.owner_user_id && op.owner_user_id !== currentUser?.id
                  ? nombreUsuario(op.owner_user_id)
                  : null;
                return (
                  <CardOperador
                    key={op.id}
                    op={op}
                    meta={meta}
                    isMobile={isMobile}
                    isDragging={drag === op.id}
                    hayDrag={!!drag}
                    lockDe={lockDe}
                    onDragStart={() => setDrag(op.id)}
                    onDragEnd={() => { setDrag(null); setDragOver(null); }}
                    onAbrirMover={() => setSheetOp(op)}
                  />
                );
              })}

              {/* Skeletons de primera carga */}
              {col.loading && col.rows.length === 0 && (
                <>
                  <SkeletonCard />
                  <SkeletonCard alto={54} />
                  <SkeletonCard alto={58} />
                </>
              )}

              {/* Estado vacío */}
              {!col.loading && col.rows.length === 0 && (
                <div style={{
                  border: `1.5px dashed ${T.faint2}`, borderRadius: 7,
                  color: T.ink3, fontSize: 11, textAlign: 'center', padding: '22px 8px',
                }}>
                  Nada acá
                </div>
              )}

              {/* Cargar más (paginado por columna) */}
              {col.rows.length > 0 && col.loading && (
                <div style={{ textAlign: 'center', fontSize: 11, color: T.ink3, padding: '6px 0' }}>Cargando…</div>
              )}
              {!col.loading && faltan > 0 && (
                <button
                  onClick={() => cargarColumna(etapa, col.page + 1, filtrosBase, reqRef.current)}
                  style={{ width: '100%', fontSize: 11, fontWeight: 700, color: meta.color, background: tint(meta.color, 0.08), border: `1px solid ${tint(meta.color, 0.45)}`, borderRadius: 5, padding: '5px 6px', cursor: 'pointer', fontFamily: T.font }}
                >Cargar más ({faltan})</button>
              )}
            </div>
          );
        })}
      </div>

      {sheetOp && (
        <SheetMover
          op={sheetOp}
          isMobile={isMobile}
          onElegir={elegirEtapaSheet}
          onClose={() => setSheetOp(null)}
        />
      )}

      {descarte && (
        <MotivoDescarteModal
          nombre={descarte.nombre || 'Sin nombre'}
          onClose={() => setDescarte(null)}
          onConfirm={(motivo) => {
            const op = descarte;
            setDescarte(null);
            mover(op, 'descartado', { motivo });
          }}
        />
      )}
    </PageLayout>
  );
}
