import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn, Chip } from '../components/ui';
import PageHero from '../components/ui/PageHero';
import { T } from '../theme';
import { useMovimientos } from '../store/MovimientosContext';
import { useProveedores } from '../store/ProveedoresContext';
import { useDolar } from '../store/DolarContext';
import { useUsuarios } from '../store/UsuariosContext';
import { useCheques } from '../store/ChequesContext';
import TraspasoModal from './modales/TraspasoModal';
import { puedeVerCaja } from '../lib/permisosCaja';
import { useIsMobile } from '../hooks/useMediaQuery';

const inputSt = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };
const fmtN = (n) => Math.round(Math.abs(n)).toLocaleString('es-AR');
// Monto CON signo: un saldo negativo se muestra "-$ 1.212" (no se le come el signo).
const fmtMonto = (n, sym = '$') => `${(n || 0) < 0 ? '-' : ''}${sym} ${fmtN(n)}`;
const NEG = '#dc2626'; // rojo inequívoco para saldos en negativo

const TIPO_LABEL = { efectivo: 'Efectivo', banco: 'Banco', billetera: 'Billetera', obra: 'Caja de obra', rendicion: 'Rendición' };
const fmtFecha = (iso) => { if (!iso) return ''; const [, m, d] = iso.split('-'); return `${d}/${m}`; };

const fmtFechaLarga = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

function CajaMovimientosModal({ caja, onClose }) {
  const isMobile = useIsMobile();
  const { movimientos } = useMovimientos();
  const { cheques } = useCheques();
  const { proveedores } = useProveedores();
  const navigate = useNavigate();
  const [tab, setTab] = useState('movimientos');

  const movs = useMemo(() =>
    movimientos.filter(m => m.cajaId === caja.id || m.cajaDestinoId === caja.id)
      .sort((a, b) => b.fecha.localeCompare(a.fecha)),
    [movimientos, caja.id]
  );

  const chequesEnCaja = useMemo(() =>
    cheques.filter(c => c.cajaId === caja.id && c.estado === 'cartera')
      .sort((a, b) => (a.fechaVencimiento || '').localeCompare(b.fechaVencimiento || '')),
    [cheques, caja.id]
  );

  const isUSD = caja.moneda === 'USD';
  const simbolo = isUSD ? 'USD' : '$';
  const totalCheques = chequesEnCaja.reduce((s, c) => s + (c.monto || 0), 0);

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: isMobile ? '100%' : 580, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, fontFamily: T.font }}>{caja.nombre}</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              {TIPO_LABEL[caja.tipo] || caja.tipo}{caja.propietario ? ` · ${caja.propietario}` : ''} · {caja.moneda}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, opacity: 0.6 }}>Saldo</div>
              <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 18, color: (caja.saldo || 0) < 0 ? NEG : T.accent }}>
                {fmtMonto(caja.saldo || 0, simbolo)}
              </div>
            </div>
            {chequesEnCaja.length > 0 && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, opacity: 0.6 }}>Cheques en cartera</div>
                <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 18, color: '#1a9b9c' }}>
                  $ {fmtN(totalCheques)}
                </div>
              </div>
            )}
            <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: `2px solid ${T.faint2}`, flexShrink: 0 }}>
          {[
            { key: 'movimientos', label: `Movimientos (${movs.length})` },
            { key: 'cheques',     label: `Cheques en cartera (${chequesEnCaja.length})` },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ padding: '8px 16px', border: 'none', background: 'transparent', fontFamily: T.font, fontSize: 12, fontWeight: tab === t.key ? 700 : 400, color: tab === t.key ? T.accent : T.ink2, cursor: 'pointer', borderBottom: tab === t.key ? `2px solid ${T.accent}` : '2px solid transparent', marginBottom: -2 }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ overflow: 'auto', flex: 1 }}>

          {tab === 'movimientos' && (
            movs.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: T.ink3, fontSize: 13 }}>Sin movimientos registrados</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 90px', padding: '6px 14px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}`, fontSize: 10, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  <span>Fecha</span><span>Descripción</span><span style={{ textAlign: 'right' }}>Importe</span>
                </div>
                {movs.map(m => {
                  const isIngreso = m.tipo === 'ingreso';
                  const isDestino = m.cajaDestinoId === caja.id;
                  const color = (isIngreso || isDestino) ? T.ok : T.warn;
                  const signo = (isIngreso || isDestino) ? '+' : '−';
                  return (
                    <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 90px', padding: '9px 14px', borderBottom: `1px solid ${T.faint2}`, alignItems: 'center', fontSize: 12 }}>
                      <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink3 }}>{fmtFecha(m.fecha)}</span>
                      <div>
                        <div style={{ fontWeight: 600 }}>{m.descripcion}</div>
                        <div style={{ fontSize: 10, color: T.ink3, marginTop: 1, display: 'flex', gap: 5 }}>
                          <span style={{ background: T.faint2, borderRadius: 2, padding: '0 4px' }}>{m.tipo}</span>
                          {m.obraNombre && m.obraNombre !== 'General' && (
                            m.obraId
                              ? <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => { onClose(); navigate(`/obras/${m.obraId}/presupuesto`); }}>{m.obraNombre}</span>
                              : <span>{m.obraNombre}</span>
                          )}
                          {m.proveedor && (() => {
                            const prov = proveedores.find(p => p.nombre === m.proveedor || p.id === m.proveedorId);
                            return prov
                              ? <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }} onClick={e => { e.stopPropagation(); onClose(); navigate(`/proveedores/${prov.id}`); }}>· {m.proveedor}</span>
                              : <span>· {m.proveedor}</span>;
                          })()}
                        </div>
                      </div>
                      <span style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 13, color, textAlign: 'right' }}>
                        {signo}{simbolo} {fmtN(m.monto)}
                      </span>
                    </div>
                  );
                })}
              </>
            )
          )}

          {tab === 'cheques' && (
            chequesEnCaja.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: T.ink3, fontSize: 13 }}>Sin cheques en cartera para esta caja</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 90px', padding: '6px 14px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}`, fontSize: 10, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  <span>Cobro</span><span>Banco / N°</span><span>Emisor</span><span style={{ textAlign: 'right' }}>Monto</span>
                </div>
                {chequesEnCaja.map(c => (
                  <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 90px', padding: '9px 14px', borderBottom: `1px solid ${T.faint2}`, alignItems: 'center', fontSize: 12 }}>
                    <div>
                      <div style={{ fontFamily: T.fontMono, fontSize: 11 }}>{fmtFechaLarga(c.fechaVencimiento)}</div>
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{c.banco || '—'}</div>
                      <div style={{ fontSize: 10, color: T.ink3, fontFamily: T.fontMono }}>{c.numero || '—'}</div>
                    </div>
                    <div style={{ fontSize: 11, color: T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.titular || c.clienteNombre || c.proveedorNombre || '—'}
                    </div>
                    <span style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 13, color: '#1a9b9c', textAlign: 'right' }}>
                      $ {fmtN(c.monto)}
                    </span>
                  </div>
                ))}
                <div style={{ padding: '8px 14px', background: '#e8f4f0', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end' }}>
                  <span style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 13, color: '#1a9b9c' }}>
                    Total: $ {fmtN(totalCheques)}
                  </span>
                </div>
              </>
            )
          )}

        </div>

        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, textAlign: 'right' }}>
          <Btn sm onClick={onClose}>Cerrar</Btn>
        </div>
      </div>
    </div>
  );
}

function NuevaCajaModal({ onClose }) {
  const isMobile = useIsMobile();
  const { addCaja } = useMovimientos();
  const { usuarios } = useUsuarios();
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState('efectivo');
  const [moneda, setMoneda] = useState('ARS');
  const [propietario, setPropietario] = useState('');
  const [usuarioId, setUsuarioId] = useState('');
  const [saldoInicial, setSaldoInicial] = useState('');

  const esEfectivo = tipo === 'efectivo';
  const canSave = nombre.trim() && (!esEfectivo || usuarioId);

  const confirmar = () => {
    if (!canSave) return;
    const usuarioSel = esEfectivo ? usuarios.find(u => u.email === usuarioId) : null;
    addCaja({
      nombre: nombre.trim(),
      tipo, moneda,
      propietario: esEfectivo ? (usuarioSel?.nombre || '') : propietario.trim(),
      usuarioId: esEfectivo ? usuarioId : '',
      color: T.ink2,
      saldo: parseFloat(saldoInicial) || 0,
    });
    onClose();
  };

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: isMobile ? '100%' : 380 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 17, fontFamily: T.font }}>Nueva caja</div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={labelSt}>Nombre</label>
            <input style={inputSt} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Caja Martínez" autoFocus />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={labelSt}>Tipo</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={tipo} onChange={e => { setTipo(e.target.value); setUsuarioId(''); setPropietario(''); }}>
                {Object.entries(TIPO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label style={labelSt}>Moneda</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={moneda} onChange={e => setMoneda(e.target.value)}>
                <option>ARS</option>
                <option>USD</option>
              </select>
            </div>
          </div>
          {esEfectivo ? (
            <div>
              <label style={labelSt}>Usuario responsable <span style={{ color: '#dc2626' }}>*</span></label>
              <select style={{ ...inputSt, cursor: 'pointer', borderColor: !usuarioId ? '#dc2626' : undefined }}
                value={usuarioId} onChange={e => setUsuarioId(e.target.value)}>
                <option value="">— Seleccioná un usuario —</option>
                {usuarios.map(u => <option key={u.email} value={u.email}>{u.nombre}</option>)}
              </select>
              {!usuarioId && <div style={{ fontSize: 10, color: '#dc2626', marginTop: 3 }}>Las cajas de efectivo deben tener un usuario asignado</div>}
            </div>
          ) : (
            <div>
              <label style={labelSt}>Propietario / asignado a</label>
              <input style={inputSt} value={propietario} onChange={e => setPropietario(e.target.value)} placeholder="Opcional" />
            </div>
          )}
          <div>
            <label style={labelSt}>Saldo inicial</label>
            <input style={{ ...inputSt, fontFamily: T.fontMono, fontWeight: 700 }}
              type="number" min="0" placeholder="0" value={saldoInicial} onChange={e => setSaldoInicial(e.target.value)} />
          </div>
        </div>
        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill onClick={confirmar} style={{ opacity: canSave ? 1 : 0.5 }}>Crear caja</Btn>
        </div>
      </div>
    </div>
  );
}

function CajaCard({ caja, onTraspaso, onRemove, onClick, saldoCheques = 0, canRemove = true }) {
  const isMobile = useIsMobile();
  const isARS = caja.moneda === 'ARS';
  const saldo = caja.saldo || 0;
  const efectivo = saldo - saldoCheques;
  const tieneChecks = isARS && saldoCheques > 0;
  const isLow = caja.tipo === 'obra' && saldo < 30000;

  return (
    <Box style={{ padding: '12px 14px', borderLeft: `3px solid ${caja.color || T.ink2}`, cursor: 'pointer' }} onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{caja.nombre}</div>
          <div style={{ fontSize: 11, color: T.ink2 }}>
            {TIPO_LABEL[caja.tipo] || caja.tipo}{caja.propietario ? ` · ${caja.propietario}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {isLow && <Chip warn style={{ fontSize: 9 }}>⚠ bajo</Chip>}
          {canRemove && (
            <span style={{ color: T.ink3, cursor: 'pointer', fontSize: 16, opacity: 0.4, lineHeight: 1 }}
              onClick={e => { e.stopPropagation(); onRemove(); }}>×</span>
          )}
        </div>
      </div>

      {tieneChecks ? (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1px 1fr', alignItems: 'stretch', marginBottom: 10 }}>
          <div style={{ paddingRight: isMobile ? 0 : 12, minWidth: 0, marginBottom: isMobile ? 8 : 0 }}>
            <div style={{ fontSize: 9, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>Efectivo</div>
            <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 16, color: efectivo < 0 ? NEG : T.ink, lineHeight: 1 }}>
              {fmtMonto(efectivo, '$')}
            </div>
          </div>
          {!isMobile && <div style={{ background: T.faint2 }} />}
          <div style={{ paddingLeft: isMobile ? 0 : 12, minWidth: 0 }}>
            <div style={{ fontSize: 9, color: '#1a9b9c', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>Cheques</div>
            <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 16, color: '#1a9b9c', lineHeight: 1 }}>
              $ {fmtN(saldoCheques)}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 10 }}>
          <div className="k-stat-sm" style={{ color: saldo < 0 ? NEG : T.ink }}>
            {fmtMonto(saldo, isARS ? '$' : 'U$S')}
          </div>
          {!isARS && <div style={{ fontSize: 10, color: T.ink3, fontFamily: T.fontMono, marginTop: 2 }}>{caja.moneda}</div>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 4 }}>
        <Btn sm onClick={e => { e.stopPropagation(); onTraspaso(); }}>↔ Traspasar</Btn>
        <span style={{ fontSize: 10, color: T.ink3, alignSelf: 'center', marginLeft: 2 }}>Ver movimientos →</span>
      </div>
    </Box>
  );
}

export default function Cajas() {
  const isMobile = useIsMobile();
  const { cajas, removeCaja } = useMovimientos();
  const { dolarVenta } = useDolar();
  const { currentUser } = useUsuarios();
  const isAdmin = currentUser?.rol === 'Admin';
  const { cheques } = useCheques();

  const chequesPorCaja = useMemo(() => {
    const map = {};
    cheques.forEach(c => {
      if (c.estado === 'cartera' && c.cajaId && c.moneda === 'ARS') {
        map[c.cajaId] = (map[c.cajaId] || 0) + (c.monto || 0);
      }
    });
    return map;
  }, [cheques]);
  const [traspaso, setTraspaso] = useState(false);
  const [nuevaCaja, setNuevaCaja] = useState(false);
  const [cajaSel, setCajaSel] = useState(null);
  const location = useLocation();

  useEffect(() => {
    const openId = location.state?.openCajaId;
    if (!openId) return;
    const caja = cajas.find(c => c.id === openId);
    if (caja) setCajaSel(caja);
    // Clear state so back-navigation doesn't re-open
    window.history.replaceState({}, '');
  }, [location.state, cajas]);

  // Ve su caja (de la que es responsable) + las asignadas a mano. Admin ve todas.
  const puedoVer = (c) => puedeVerCaja(c, currentUser);

  const cajasActivas    = cajas.filter(c => c.activa && puedoVer(c));
  const cajasARS        = cajasActivas.filter(c => c.moneda === 'ARS' && c.tipo !== 'rendicion');
  const cajasUSD        = cajasActivas.filter(c => c.moneda === 'USD');
  const cajasRendicion  = cajasActivas.filter(c => c.tipo === 'rendicion');

  const totalARS       = cajasActivas.filter(c => c.moneda === 'ARS').reduce((s, c) => s + (c.saldo || 0), 0);
  const totalUSD       = cajasActivas.filter(c => c.moneda === 'USD').reduce((s, c) => s + (c.saldo || 0), 0);
  const totalUSDenARS  = totalUSD * dolarVenta;
  const equivTotalUSD  = (totalARS + totalUSDenARS) / dolarVenta;

  const handleRemove = (caja) => {
    if (confirm(`¿Eliminar la caja "${caja.nombre}"? Esta acción no revertirá los movimientos.`)) {
      removeCaja(caja.id);
    }
  };

  return (
    <PageLayout breadcrumb={['Cajas']} active="Cajas">
      <PageHero
        label="GESTIÓN DE CAJAS"
        title="Cajas"
        subtitle={`${cajasActivas.length} cajas activas · TC BNA $ ${fmtN(dolarVenta)}`}
        actions={
          <>
            <Btn sm onClick={() => setTraspaso(true)}>↔ Traspaso rápido</Btn>
            {isAdmin && <Btn sm fill onClick={() => setNuevaCaja(true)}>+ Nueva caja</Btn>}
          </>
        }
        kpis={isAdmin ? [
          { label: 'Total ARS',         value: fmtMonto(totalARS, '$'),                color: totalARS < 0 ? NEG : T.ink },
          { label: 'Total USD',         value: fmtMonto(totalUSD, 'U$S'),              color: totalUSD < 0 ? NEG : T.ink },
          { label: 'Equiv. total USD',  value: fmtMonto(equivTotalUSD, 'U$S'),         color: equivTotalUSD < 0 ? NEG : T.accent },
          { label: 'Equiv. total ARS',  value: fmtMonto(totalARS + totalUSDenARS, '$'), color: (totalARS + totalUSDenARS) < 0 ? NEG : T.accent },
        ] : []}
      />

      {/* Tablas formales por seccion */}
      {[
        { titulo: 'ARS',                 cajas: cajasARS,       isARS: true,  unidad: 'cajas' },
        { titulo: 'USD',                 cajas: cajasUSD,       isARS: false, unidad: 'cajas' },
        { titulo: 'Rendición de fondos', cajas: cajasRendicion, isARS: true,  unidad: 'usuarios' },
      ].filter(s => s.cajas.length > 0).map(seccion => (
        <div key={seccion.titulo} style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: T.ink2, fontFamily: T.fontMono, letterSpacing: 1.5, fontWeight: 700, textTransform: 'uppercase' }}>{seccion.titulo}</div>
            <span style={{ fontSize: 11, color: T.ink3 }}>{seccion.cajas.length} {seccion.unidad}</span>
          </div>

          <Box style={{ padding: 0, overflow: 'hidden' }}>
            {/* En mobile, scroll-x para no aplastar las columnas (preserva la
                alineación de saldos/cheques/acciones). Desktop intacto. */}
            <div style={isMobile ? { overflowX: 'auto', WebkitOverflowScrolling: 'touch' } : undefined}>
            <div style={{ minWidth: isMobile ? (seccion.isARS ? 640 : 540) : undefined }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: seccion.isARS ? '2fr 1fr 1.4fr 1fr 1fr 110px' : '2fr 1fr 1.4fr 1fr 110px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}`, padding: '8px 12px', fontSize: 10, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              <span>Caja</span>
              <span>Tipo</span>
              <span>Propietario</span>
              {seccion.isARS && <span style={{ textAlign: 'right' }}>Cheques</span>}
              <span style={{ textAlign: 'right' }}>Saldo</span>
              <span style={{ textAlign: 'right' }}>Acciones</span>
            </div>

            {/* Filas */}
            {seccion.cajas.map((c, i) => {
              const saldo = c.saldo || 0;
              const saldoCheques = chequesPorCaja[c.id] || 0;
              const efectivo = saldo - saldoCheques;
              const isLow = c.tipo === 'obra' && saldo < 30000;
              return (
                <div key={c.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: seccion.isARS ? '2fr 1fr 1.4fr 1fr 1fr 110px' : '2fr 1fr 1.4fr 1fr 110px',
                    padding: '9px 12px',
                    borderBottom: i < seccion.cajas.length - 1 ? `1px solid ${T.faint2}` : 'none',
                    fontSize: 12,
                    alignItems: 'center',
                    cursor: 'pointer',
                    transition: 'background 0.12s',
                    borderLeft: `3px solid ${c.color || T.ink2}`,
                  }}
                  onClick={() => setCajaSel(c)}
                  onMouseEnter={e => e.currentTarget.style.background = T.faint}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ fontWeight: 700, color: T.ink, display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', minWidth: 0 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nombre}</span>
                    {isLow && <Chip warn style={{ fontSize: 9, flexShrink: 0 }}>⚠ bajo</Chip>}
                  </span>
                  <span style={{ fontSize: 11, color: T.ink2, textTransform: 'capitalize' }}>{TIPO_LABEL[c.tipo] || c.tipo}</span>
                  <span style={{ fontSize: 11, color: T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 6, minWidth: 0 }}>{c.propietario || '—'}</span>
                  {seccion.isARS && (
                    <span style={{ textAlign: 'right', fontFamily: T.fontMono, fontWeight: 600, color: saldoCheques > 0 ? T.accent : T.ink3 }}>
                      {saldoCheques > 0 ? `$ ${fmtN(saldoCheques)}` : '—'}
                    </span>
                  )}
                  <span style={{ textAlign: 'right', fontFamily: T.fontMono, fontWeight: 800, fontSize: 13, color: saldo < 0 ? T.warn : T.ink }}>
                    {seccion.isARS ? '$' : 'U$S'} {fmtN(saldo)}
                  </span>
                  <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                    <Btn sm onClick={() => setTraspaso(true)}>↔</Btn>
                    {isAdmin && (
                      <span style={{ color: T.warn, cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1 }}
                        onClick={() => handleRemove(c)}>×</span>
                    )}
                  </span>
                </div>
              );
            })}
            </div>
            </div>
          </Box>

          {seccion.titulo === 'Rendición de fondos' && (
            <div style={{ marginTop: 8, fontSize: 11, color: T.ink2, padding: '6px 10px', background: T.faint, borderRadius: 4, maxWidth: 520 }}>
              Rendición = caja asignada a un usuario con fondos adelantados. Saldo negativo indica que la empresa le debe al usuario.
            </div>
          )}
        </div>
      ))}

      {cajasActivas.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: T.ink3 }}>Sin cajas registradas. Creá la primera.</div>
      )}

      {traspaso && <TraspasoModal onClose={() => setTraspaso(false)} />}
      {nuevaCaja && <NuevaCajaModal onClose={() => setNuevaCaja(false)} />}
      {cajaSel && <CajaMovimientosModal caja={cajaSel} onClose={() => setCajaSel(null)} />}
    </PageLayout>
  );
}
