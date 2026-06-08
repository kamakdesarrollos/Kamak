import { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn, Chip, Stat } from '../components/ui';
import Modal from '../components/ui/Modal';
import { T } from '../theme';
import { useUsuarios } from '../store/UsuariosContext';
import { useMovimientos } from '../store/MovimientosContext';
import { useObras } from '../store/ObrasContext';
import { useProveedores } from '../store/ProveedoresContext';
import { useIsMobile } from '../hooks/useMediaQuery';
import { calcSaldoCaja } from '../lib/caja';
import { parseExtractoFile } from '../lib/parseExtractoBancario';
import { matchearExtracto, esGastoBancario } from '../lib/matchExtracto';
import useSyncedSharedData from '../lib/useSyncedSharedData';

// ── helpers de formato ────────────────────────────────────────────────────────
const fmtN = (n) => Math.round(Math.abs(n || 0)).toLocaleString('es-AR');
const fmtMonto = (n, sym = '$') => `${(n || 0) < 0 ? '−' : ''}${sym} ${fmtN(n)}`;
const fmtFecha = (iso) => { if (!iso) return '—'; const [, m, d] = String(iso).split('-'); return `${d}/${m}`; };
const fmtFechaLarga = (iso) => { if (!iso) return '—'; const [y, m, d] = String(iso).split('-'); return `${d}/${m}/${y}`; };
const NEG = '#dc2626';

const inputSt = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };

// Categorías de clasificación de una línea no coincidente (decisión del usuario).
const CATEGORIAS = [
  { key: 'gasto-bancario', label: 'Gasto bancario', categoria: 'gasto-bancario' },
  { key: 'otros-gastos',   label: 'Otros gastos',   categoria: 'general' },
  { key: 'gasto-obra',     label: 'Gasto de obra',  categoria: 'materiales' },
];

// ── Mini-form: clasificar y crear un movimiento desde una línea sin match ──────
function AgregarMovimientoModal({ linea, caja, onClose, onCrear }) {
  const isMobile = useIsMobile();
  const { obras } = useObras();
  const { proveedores } = useProveedores();
  const esGasto = (linea.monto || 0) < 0; // débito → gasto; crédito → ingreso

  // Auto-sugerencia: si la descripción parece un gasto del banco, arrancar en
  // "Gasto bancario"; sino "Otros gastos". Un crédito (ingreso) no es gasto
  // bancario, así que para esos arranca en "Otros gastos".
  const sugerido = esGasto && esGastoBancario(linea.descripcion) ? 'gasto-bancario' : 'otros-gastos';
  const [cat, setCat] = useState(sugerido);
  const [obraId, setObraId] = useState('');
  const [proveedor, setProveedor] = useState('');
  const [descripcion, setDescripcion] = useState(linea.descripcion || '');

  const esObra = cat === 'gasto-obra';
  const obraSel = obras.find(o => o.id === obraId);

  const crear = () => {
    const catDef = CATEGORIAS.find(c => c.key === cat) || CATEGORIAS[1];
    onCrear({
      tipo: esGasto ? 'gasto' : 'ingreso',
      fecha: linea.fecha,
      descripcion: descripcion.trim() || linea.descripcion || (esGasto ? 'Gasto' : 'Ingreso'),
      monto: Math.abs(linea.monto || 0),
      cajaId: caja.id,
      cajaDestinoId: null,
      obraId: esObra ? (obraId || null) : null,
      obraNombre: esObra ? (obraSel?.nombre || 'General') : 'General',
      proveedor: esObra ? proveedor.trim() : '',
      categoria: catDef.categoria,
      medioPago: caja.tipo === 'billetera' ? 'Billetera' : 'Banco',
      referencia: '',
      fondoReparo: false,
      conciliado: true, // se crea ya conciliado contra esta línea del extracto
    });
    onClose();
  };

  return (
    <Modal
      title={esGasto ? 'Agregar gasto' : 'Agregar ingreso'}
      subtitle={`${fmtFechaLarga(linea.fecha)} · ${fmtMonto(linea.monto, caja.moneda === 'USD' ? 'U$S' : '$')}`}
      width={420}
      onClose={onClose}
      footer={<>
        <Btn sm onClick={onClose}>Cancelar</Btn>
        <Btn sm fill onClick={crear}>Crear movimiento</Btn>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, color: T.ink2, background: T.faint, borderRadius: 4, padding: '6px 9px' }}>
          Línea del extracto: <strong>{linea.descripcion || '(sin descripción)'}</strong>
        </div>

        <div>
          <label style={labelSt}>Clasificación</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CATEGORIAS.map(c => {
              // Para ingresos no tiene sentido "Gasto bancario"; ocultarlo.
              if (!esGasto && c.key === 'gasto-bancario') return null;
              const on = cat === c.key;
              const auto = c.key === sugerido && esGasto;
              return (
                <button key={c.key} type="button" onClick={() => setCat(c.key)}
                  style={{
                    padding: '6px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
                    fontFamily: T.font, fontWeight: on ? 700 : 500,
                    border: `1.4px solid ${on ? T.accent : T.faint2}`,
                    background: on ? T.accentSoft : T.paper, color: on ? T.accent2 : T.ink,
                  }}>
                  {c.label}{auto ? ' ★' : ''}
                </button>
              );
            })}
          </div>
          {sugerido === 'gasto-bancario' && (
            <div style={{ fontSize: 10, color: T.ok, marginTop: 4 }}>★ Sugerido: parece un gasto del banco (comisión/impuesto/etc.)</div>
          )}
        </div>

        <div>
          <label style={labelSt}>Descripción</label>
          <input style={inputSt} value={descripcion} onChange={e => setDescripcion(e.target.value)} />
        </div>

        {esObra && (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
            <div>
              <label style={labelSt}>Obra</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={obraId} onChange={e => setObraId(e.target.value)}>
                <option value="">— General —</option>
                {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelSt}>Proveedor</label>
              <input style={inputSt} value={proveedor} onChange={e => setProveedor(e.target.value)}
                placeholder="Nombre del proveedor" list="conc-provs" />
              <datalist id="conc-provs">
                {proveedores.map(p => <option key={p.id} value={p.nombre} />)}
              </datalist>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Fila genérica (línea del extracto) ────────────────────────────────────────
function LineaRow({ linea, caja, right }) {
  const sym = caja.moneda === 'USD' ? 'U$S' : '$';
  const neg = (linea.monto || 0) < 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: `1px solid ${T.faint2}`, fontSize: 12 }}>
      <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink3, width: 44, flexShrink: 0 }}>{fmtFecha(linea.fecha)}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{linea.descripcion || '(sin descripción)'}</span>
      <span style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 13, color: neg ? NEG : T.ok, textAlign: 'right', width: 110, flexShrink: 0 }}>
        {fmtMonto(linea.monto, sym)}
      </span>
      {right && <span style={{ flexShrink: 0 }}>{right}</span>}
    </div>
  );
}

// ── Cabecera de grupo plegable ────────────────────────────────────────────────
function GroupHeader({ icon, title, count, color, open, onToggle }) {
  return (
    <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}`, cursor: 'pointer', userSelect: 'none' }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontWeight: 700, fontSize: 13, color: color || T.ink }}>{title}</span>
      <Chip style={{ fontSize: 10 }}>{count}</Chip>
      <span style={{ marginLeft: 'auto', fontSize: 11, color: T.ink3 }}>{open ? '▾' : '▸'}</span>
    </div>
  );
}

export default function Conciliacion() {
  const { currentUser } = useUsuarios();
  const navigate = useNavigate();
  const isAdmin = currentUser?.rol === 'Admin';
  const isMobile = useIsMobile();
  const [searchParams] = useSearchParams();

  const { cajas, movimientos, addMovimiento, updateMovimiento } = useMovimientos();

  // Historial de conciliaciones (colección nueva, persistida en shared_data).
  const [historial, setHistorial] = useSyncedSharedData('conciliaciones', [], { lsKey: 'kamak_conciliaciones_v1', skipMarkReady: true });

  // Guard: solo Admin (conciliación bancaria es operación financiera).
  useEffect(() => {
    if (currentUser && !isAdmin) navigate('/', { replace: true });
  }, [currentUser, isAdmin, navigate]);

  // Cajas de banco/billetera (las únicas conciliables contra un extracto).
  const cajasBanco = useMemo(
    () => cajas.filter(c => (c.tipo === 'banco' || c.tipo === 'billetera') && c.activa),
    [cajas]
  );

  const cajaIdRuta = searchParams.get('cajaId');
  const [cajaId, setCajaId] = useState(cajaIdRuta || '');
  // Si llega por ruta y existe, seleccionarla.
  useEffect(() => {
    if (cajaIdRuta && cajasBanco.some(c => c.id === cajaIdRuta)) setCajaId(cajaIdRuta);
  }, [cajaIdRuta, cajasBanco]);

  const caja = useMemo(() => cajas.find(c => c.id === cajaId) || null, [cajas, cajaId]);

  // Estado del extracto cargado + resultado del match.
  const [parseRes, setParseRes] = useState(null);   // salida de parseExtractoFile
  const [fileName, setFileName] = useState('');
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  // Confirmaciones manuales de los "parecidos": idx → movimientoId aceptado.
  const [confirmados, setConfirmados] = useState({});   // { [idx]: movimientoId }
  const [rechazados, setRechazados] = useState({});     // { [idx]: true } "no, es otro"
  // Línea para la que se abrió el mini-form de agregar.
  const [agregando, setAgregando] = useState(null);     // { ...linea }
  // Movimientos creados/clasificados en ESTA sesión, por idx de línea.
  const [creados, setCreados] = useState({});           // { [idx]: movimientoId }
  const [confirmada, setConfirmada] = useState(false);

  const fileRef = useRef(null);

  // Movimientos de la caja seleccionada (cajaId u origen/destino de traspaso).
  const movsCaja = useMemo(
    () => caja ? movimientos.filter(m => m.cajaId === caja.id || m.cajaDestinoId === caja.id) : [],
    [movimientos, caja]
  );

  // Match en vivo: líneas del extracto vs movimientos de la caja.
  const match = useMemo(() => {
    if (!parseRes || !caja) return null;
    return matchearExtracto(parseRes.lineas, movsCaja, {
      cajaId: caja.id,
      periodoDesde: parseRes.periodoDesde,
      periodoHasta: parseRes.periodoHasta,
    });
  }, [parseRes, caja, movsCaja]);

  // Reset al cambiar de caja o de archivo.
  const resetSesion = () => {
    setParseRes(null); setFileName(''); setErrorMsg('');
    setConfirmados({}); setRechazados({}); setCreados({}); setConfirmada(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const onSelectCaja = (id) => { setCajaId(id); resetSesion(); };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCargando(true); setErrorMsg(''); setConfirmada(false);
    setConfirmados({}); setRechazados({}); setCreados({});
    try {
      const res = await parseExtractoFile(file);
      setParseRes(res);
      setFileName(file.name);
      if (!res.lineas.length) {
        setErrorMsg(res.errores?.[0] || 'No se encontraron movimientos en el archivo.');
      }
    } catch (err) {
      setErrorMsg('No se pudo leer el archivo: ' + (err?.message || err));
      setParseRes(null);
    } finally {
      setCargando(false);
    }
  };

  // ── Acciones sobre "parecidos" ──────────────────────────────────────────────
  const aceptarParecido = (idx, movimientoId) => {
    setConfirmados(prev => ({ ...prev, [idx]: movimientoId }));
    setRechazados(prev => { const n = { ...prev }; delete n[idx]; return n; });
  };
  const rechazarParecido = (idx) => {
    setRechazados(prev => ({ ...prev, [idx]: true }));
    setConfirmados(prev => { const n = { ...prev }; delete n[idx]; return n; });
  };

  // ── Crear movimiento desde una línea sin match ──────────────────────────────
  const crearMovimiento = (idx, data) => {
    const id = addMovimiento(data);
    setCreados(prev => ({ ...prev, [idx]: id }));
  };

  // ── Derivar grupos para la UI a partir del match + decisiones del usuario ────
  const grupos = useMemo(() => {
    if (!match) return null;
    const coincidentes = [];
    const parecidos = [];
    const noCoincidentes = [];
    for (const l of match.lineas) {
      // Una línea "parecida" que el usuario aceptó pasa a coincidente.
      if (confirmados[l.idx]) { coincidentes.push({ ...l, movimientoId: confirmados[l.idx], _manual: true }); continue; }
      if (l.estado === 'coincide') { coincidentes.push(l); continue; }
      if (l.estado === 'parecido' && !rechazados[l.idx]) { parecidos.push(l); continue; }
      // parecido rechazado o no_coincide → no coincidente (se puede agregar)
      noCoincidentes.push(l);
    }
    // Los movimientos que YA quedaron "tomados" (coincidentes o confirmados) no
    // deberían figurar como huérfanos.
    const tomados = new Set(coincidentes.map(c => c.movimientoId).filter(Boolean));
    const huerfanos = match.huerfanos.filter(m => !tomados.has(m.id));
    return { coincidentes, parecidos, noCoincidentes, huerfanos };
  }, [match, confirmados, rechazados]);

  // ── Resumen / saldos ────────────────────────────────────────────────────────
  const resumen = useMemo(() => {
    if (!caja || !parseRes) return null;
    const saldoApp = calcSaldoCaja(caja, movimientos);
    const saldoBanco = parseRes.saldoFinal;
    const diferencia = saldoBanco != null ? Math.round(saldoBanco - saldoApp) : null;
    const totalDebitos = parseRes.lineas.filter(l => l.monto < 0).reduce((s, l) => s + Math.abs(l.monto), 0);
    const totalCreditos = parseRes.lineas.filter(l => l.monto > 0).reduce((s, l) => s + l.monto, 0);
    return { saldoApp, saldoBanco, diferencia, totalDebitos, totalCreditos };
  }, [caja, parseRes, movimientos]);

  // IDs de movimientos a marcar conciliado:true al confirmar = los de líneas
  // coincidentes (auto + parecidos aceptados) + los creados en esta sesión.
  const movsAConciliar = useMemo(() => {
    if (!grupos) return [];
    const ids = new Set();
    grupos.coincidentes.forEach(c => { if (c.movimientoId) ids.add(c.movimientoId); });
    Object.values(creados).forEach(id => ids.add(id));
    return [...ids];
  }, [grupos, creados]);

  const sym = caja?.moneda === 'USD' ? 'U$S' : '$';

  const confirmarConciliacion = () => {
    if (!caja || !parseRes || !grupos) return;
    // 1) marcar conciliados los movimientos resueltos.
    movsAConciliar.forEach(id => updateMovimiento(id, { conciliado: true, conciliadoEn: new Date().toISOString().split('T')[0] }));
    // 2) guardar la conciliación en el historial.
    const registro = {
      id: `conc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      cajaId: caja.id,
      cajaNombre: caja.nombre,
      moneda: caja.moneda,
      fecha: new Date().toISOString().split('T')[0],
      periodoDesde: parseRes.periodoDesde,
      periodoHasta: parseRes.periodoHasta,
      archivo: fileName,
      banco: parseRes.banco || '',
      saldoBanco: resumen?.saldoBanco ?? null,
      saldoApp: resumen?.saldoApp ?? null,
      diferencia: resumen?.diferencia ?? null,
      totalLineas: parseRes.lineas.length,
      coincidentes: grupos.coincidentes.length,
      parecidos: grupos.parecidos.length,
      noCoincidentes: grupos.noCoincidentes.length,
      huerfanos: grupos.huerfanos.length,
      movimientosConciliados: movsAConciliar,
      creadoPor: currentUser?.nombre || currentUser?.email || 'Admin',
    };
    setHistorial(prev => [registro, ...(prev || [])]);
    setConfirmada(true);
  };

  if (!isAdmin) return null;

  const tieneExtracto = !!(parseRes && parseRes.lineas.length && caja);

  return (
    <PageLayout breadcrumb={[{ label: 'Cajas', to: '/cajas' }, 'Conciliación']} active="Cajas">
      {/* Encabezado + selección de caja + carga de archivo */}
      <Box style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'stretch' : 'flex-end', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div className="k-h" style={{ fontSize: isMobile ? 20 : 24 }}>Conciliación bancaria</div>
            <div style={{ fontSize: 12, color: T.ink2, marginTop: 2 }}>
              Cruzá el extracto del banco contra los movimientos del sistema.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 10, marginTop: 12, alignItems: isMobile ? 'stretch' : 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={labelSt}>Caja de banco / billetera</label>
            <select style={{ ...inputSt, cursor: 'pointer' }} value={cajaId} onChange={e => onSelectCaja(e.target.value)}>
              <option value="">— Seleccioná una caja —</option>
              {cajasBanco.map(c => <option key={c.id} value={c.id}>{c.nombre} · {c.moneda}</option>)}
            </select>
            {cajasBanco.length === 0 && (
              <div style={{ fontSize: 10, color: T.warn, marginTop: 3 }}>No hay cajas de tipo Banco o Billetera.</div>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelSt}>Extracto del banco (.csv / .xlsx)</label>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.xlsm,text/csv"
              disabled={!caja || cargando} onChange={onFile}
              style={{ ...inputSt, padding: 5, cursor: caja ? 'pointer' : 'not-allowed', opacity: caja ? 1 : 0.5 }} />
            {!caja && <div style={{ fontSize: 10, color: T.ink3, marginTop: 3 }}>Elegí primero la caja.</div>}
          </div>
        </div>

        {cargando && <div style={{ marginTop: 10, fontSize: 12, color: T.accent }}>Leyendo el extracto…</div>}
        {errorMsg && (
          <div style={{ marginTop: 10, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
            {errorMsg}
          </div>
        )}
        {parseRes && parseRes.errores?.length > 0 && parseRes.lineas.length > 0 && (
          <div style={{ marginTop: 10, background: '#fff7ed', border: '1px solid #fed7aa', color: '#b45309', borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
            {parseRes.errores.length} fila(s) del archivo no se pudieron interpretar (se ignoraron).
          </div>
        )}
      </Box>

      {/* Resumen / saldos */}
      {resumen && (
        <Box style={{ padding: 0, marginBottom: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(150px, 1fr))', background: '#fbf9f1' }}>
            <div style={{ padding: '10px 14px', borderRight: `1px solid ${T.faint2}` }}>
              <Stat label="Saldo banco (extracto)" value={resumen.saldoBanco != null ? fmtMonto(resumen.saldoBanco, sym) : '—'} />
            </div>
            <div style={{ padding: '10px 14px', borderRight: `1px solid ${T.faint2}` }}>
              <Stat label="Saldo sistema (app)" value={fmtMonto(resumen.saldoApp, sym)} />
            </div>
            <div style={{ padding: '10px 14px', borderRight: `1px solid ${T.faint2}`, background: resumen.diferencia ? '#fff7ed' : '#f0fdf4' }}>
              <Stat label="Diferencia"
                value={resumen.diferencia != null ? fmtMonto(resumen.diferencia, sym) : '—'}
                accent />
            </div>
            <div style={{ padding: '10px 14px', borderRight: `1px solid ${T.faint2}` }}>
              <Stat label="Débitos del período" value={fmtMonto(-resumen.totalDebitos, sym)} />
            </div>
            <div style={{ padding: '10px 14px' }}>
              <Stat label="Créditos del período" value={fmtMonto(resumen.totalCreditos, sym)} />
            </div>
          </div>
          {resumen.saldoBanco == null && (
            <div style={{ padding: '6px 14px', fontSize: 11, color: T.ink3, borderTop: `1px solid ${T.faint2}` }}>
              El extracto no traía columna de saldo, no se puede calcular la diferencia automáticamente.
            </div>
          )}
          {resumen.diferencia === 0 && (
            <div style={{ padding: '6px 14px', fontSize: 11, color: T.ok, borderTop: `1px solid ${T.faint2}`, fontWeight: 600 }}>
              ✓ El saldo del banco coincide exactamente con el del sistema.
            </div>
          )}
        </Box>
      )}

      {/* Grupos de match */}
      {grupos && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Coincidentes */}
          <GrupoCoincidentes grupo={grupos.coincidentes} caja={caja} movsCaja={movsCaja} />

          {/* Parecidos */}
          <GrupoParecidos grupo={grupos.parecidos} caja={caja} movsCaja={movsCaja}
            onAceptar={aceptarParecido} onRechazar={rechazarParecido} />

          {/* No coincidentes */}
          <GrupoNoCoincidentes grupo={grupos.noCoincidentes} caja={caja} sym={sym}
            creados={creados} onAgregar={(linea) => setAgregando(linea)} />

          {/* Huérfanos */}
          <GrupoHuerfanos grupo={grupos.huerfanos} caja={caja} sym={sym} />
        </div>
      )}

      {/* Acción de confirmar */}
      {tieneExtracto && (
        <div style={{
          position: isMobile ? 'static' : 'sticky', bottom: 0, marginTop: 14,
          background: T.paper, borderTop: `1.5px solid ${T.faint2}`, padding: '12px 0',
          display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'center', gap: 10, justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 12, color: T.ink2 }}>
            {confirmada
              ? <span style={{ color: T.ok, fontWeight: 700 }}>✓ Conciliación guardada · {movsAConciliar.length} movimiento(s) marcados como conciliados.</span>
              : <>Se marcarán <strong>{movsAConciliar.length}</strong> movimiento(s) como conciliados y se guardará esta conciliación en el historial.</>}
          </div>
          <Btn fill onClick={confirmarConciliacion} style={{ opacity: confirmada ? 0.5 : 1 }}>
            {confirmada ? 'Conciliación confirmada' : 'Confirmar conciliación'}
          </Btn>
        </div>
      )}

      {/* Historial de conciliaciones de esta caja */}
      {caja && (historial || []).some(h => h.cajaId === caja.id) && (
        <Box style={{ padding: 0, marginTop: 16, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}`, fontWeight: 700, fontSize: 13 }}>
            Historial de conciliaciones · {caja.nombre}
          </div>
          {(historial || []).filter(h => h.cajaId === caja.id).map(h => (
            <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: `1px solid ${T.faint2}`, fontSize: 12, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: T.fontMono, color: T.ink3, fontSize: 11 }}>{fmtFechaLarga(h.fecha)}</span>
              <span style={{ color: T.ink2 }}>{h.periodoDesde ? `${fmtFecha(h.periodoDesde)}–${fmtFecha(h.periodoHasta)}` : 's/período'}</span>
              <span style={{ flex: 1, minWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.ink3 }}>{h.archivo}</span>
              <Chip ok style={{ fontSize: 10 }}>{h.coincidentes} conc.</Chip>
              {h.diferencia != null && (
                <span style={{ fontFamily: T.fontMono, fontWeight: 700, color: h.diferencia ? T.warn : T.ok }}>
                  dif {fmtMonto(h.diferencia, h.moneda === 'USD' ? 'U$S' : '$')}
                </span>
              )}
            </div>
          ))}
        </Box>
      )}

      {/* Mini-form de clasificar/agregar */}
      {agregando && caja && (
        <AgregarMovimientoModal
          linea={agregando}
          caja={caja}
          onClose={() => setAgregando(null)}
          onCrear={(data) => crearMovimiento(agregando.idx, data)}
        />
      )}
    </PageLayout>
  );
}

// ── Grupo: COINCIDENTES ───────────────────────────────────────────────────────
function GrupoCoincidentes({ grupo, caja, movsCaja }) {
  const [open, setOpen] = useState(true);
  const movById = useMemo(() => new Map(movsCaja.map(m => [m.id, m])), [movsCaja]);
  return (
    <Box style={{ padding: 0, overflow: 'hidden' }}>
      <GroupHeader icon="✅" title="Coincidentes" count={grupo.length} color={T.ok} open={open} onToggle={() => setOpen(o => !o)} />
      {open && (grupo.length === 0
        ? <div style={{ padding: 16, fontSize: 12, color: T.ink3, textAlign: 'center' }}>Sin coincidencias automáticas.</div>
        : grupo.map(l => {
            const mov = movById.get(l.movimientoId);
            return (
              <div key={l.idx} style={{ borderLeft: `3px solid ${T.ok}` }}>
                <LineaRow linea={l} caja={caja}
                  right={l._manual ? <Chip ok style={{ fontSize: 10 }}>confirmado</Chip> : <Chip ok style={{ fontSize: 10 }}>auto</Chip>} />
                {mov && (
                  <div style={{ padding: '4px 12px 8px 56px', fontSize: 11, color: T.ink2, background: '#f6faf6' }}>
                    ↔ {fmtFecha(mov.fecha)} · {mov.descripcion}
                    {mov.proveedor ? ` · ${mov.proveedor}` : ''}
                    {mov.obraNombre && mov.obraNombre !== 'General' ? ` · ${mov.obraNombre}` : ''}
                  </div>
                )}
              </div>
            );
          }))}
    </Box>
  );
}

// ── Grupo: PARECIDOS (pedir confirmación) ─────────────────────────────────────
function GrupoParecidos({ grupo, caja, movsCaja, onAceptar, onRechazar }) {
  const [open, setOpen] = useState(true);
  const movById = useMemo(() => new Map(movsCaja.map(m => [m.id, m])), [movsCaja]);
  return (
    <Box style={{ padding: 0, overflow: 'hidden' }}>
      <GroupHeader icon="⚠️" title="Parecidos (revisar)" count={grupo.length} color={T.warn} open={open} onToggle={() => setOpen(o => !o)} />
      {open && (grupo.length === 0
        ? <div style={{ padding: 16, fontSize: 12, color: T.ink3, textAlign: 'center' }}>Sin parecidos pendientes.</div>
        : grupo.map(l => (
            <div key={l.idx} style={{ borderLeft: `3px solid ${T.warn}`, borderBottom: `1px solid ${T.faint2}` }}>
              <LineaRow linea={l} caja={caja} />
              <div style={{ padding: '4px 12px 10px 56px', background: '#fffdf5' }}>
                <div style={{ fontSize: 11, color: T.ink2, marginBottom: 6 }}>
                  {l.candidatos.length > 1 ? `${l.candidatos.length} candidatos posibles:` : 'Posible coincidencia:'}
                </div>
                {l.candidatos.map(c => {
                  const mov = movById.get(c.movimientoId);
                  if (!mov) return null;
                  return (
                    <div key={c.movimientoId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, flex: 1, minWidth: 160 }}>
                        {fmtFecha(mov.fecha)} · {mov.descripcion}
                        {mov.proveedor ? ` · ${mov.proveedor}` : ''}
                        <span style={{ color: T.ink3 }}> · {c.dias === 0 ? 'misma fecha' : `${c.dias}d`} · sim {Math.round((c.similitud || 0) * 100)}%</span>
                      </span>
                      <Btn sm fill onClick={() => onAceptar(l.idx, c.movimientoId)}>Es el mismo</Btn>
                    </div>
                  );
                })}
                <div style={{ marginTop: 4 }}>
                  <Btn sm onClick={() => onRechazar(l.idx)}>No, es otro</Btn>
                </div>
              </div>
            </div>
          )))}
    </Box>
  );
}

// ── Grupo: NO COINCIDENTES (clasificar + agregar) ─────────────────────────────
function GrupoNoCoincidentes({ grupo, caja, sym, creados, onAgregar }) {
  const [open, setOpen] = useState(true);
  return (
    <Box style={{ padding: 0, overflow: 'hidden' }}>
      <GroupHeader icon="❌" title="No coincidentes" count={grupo.length} color={NEG} open={open} onToggle={() => setOpen(o => !o)} />
      {open && (grupo.length === 0
        ? <div style={{ padding: 16, fontSize: 12, color: T.ink3, textAlign: 'center' }}>Todas las líneas del extracto tienen su movimiento.</div>
        : grupo.map(l => {
            const yaCreado = creados[l.idx];
            const auto = (l.monto || 0) < 0 && esGastoBancario(l.descripcion);
            return (
              <div key={l.idx} style={{ borderLeft: `3px solid ${NEG}` }}>
                <LineaRow linea={l} caja={caja}
                  right={yaCreado
                    ? <Chip ok style={{ fontSize: 10 }}>✓ agregado</Chip>
                    : <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {auto && <Chip accent style={{ fontSize: 9 }}>gasto banco?</Chip>}
                        <Btn sm fill onClick={() => onAgregar(l)}>➕ Agregar</Btn>
                      </span>} />
              </div>
            );
          }))}
    </Box>
  );
}

// ── Grupo: HUÉRFANOS (informativo) ────────────────────────────────────────────
function GrupoHuerfanos({ grupo, caja, sym }) {
  const [open, setOpen] = useState(false);
  return (
    <Box style={{ padding: 0, overflow: 'hidden' }}>
      <GroupHeader icon="👻" title="Huérfanos (en el sistema, no en el banco)" count={grupo.length} color={T.ink2} open={open} onToggle={() => setOpen(o => !o)} />
      {open && (grupo.length === 0
        ? <div style={{ padding: 16, fontSize: 12, color: T.ink3, textAlign: 'center' }}>No hay movimientos huérfanos en el período.</div>
        : <>
            <div style={{ padding: '6px 12px', fontSize: 11, color: T.ink3, background: '#faf8f1' }}>
              Movimientos del sistema dentro del período que ninguna línea del extracto matcheó. Revisalos: pueden estar mal cargados, duplicados o todavía no impactados en el banco.
            </div>
            {grupo.map(m => {
              const neg = m.tipo === 'gasto';
              return (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: `1px solid ${T.faint2}`, fontSize: 12, borderLeft: `3px solid ${T.ink2}` }}>
                  <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink3, width: 44, flexShrink: 0 }}>{fmtFecha(m.fecha)}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.descripcion}{m.proveedor ? ` · ${m.proveedor}` : ''}{m.obraNombre && m.obraNombre !== 'General' ? ` · ${m.obraNombre}` : ''}
                  </span>
                  <span style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 13, color: neg ? NEG : T.ok, textAlign: 'right', width: 110, flexShrink: 0 }}>
                    {neg ? '−' : '+'}{sym} {fmtN(m.monto)}
                  </span>
                </div>
              );
            })}
          </>)}
    </Box>
  );
}
