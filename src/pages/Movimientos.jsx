import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useIsMobile } from '../hooks/useMediaQuery';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn } from '../components/ui';
import PageHero from '../components/ui/PageHero';
import { T } from '../theme';
import { useMovimientos } from '../store/MovimientosContext';
import { useObras } from '../store/ObrasContext';
import { useProveedores } from '../store/ProveedoresContext';
import { useClientes } from '../store/ClientesContext';
import { useDolar } from '../store/DolarContext';
import { montoEnARS } from '../lib/caja';
import { useUsuarios } from '../store/UsuariosContext';
import { useSolicitudes } from '../store/SolicitudesContext';
import { useCatalog } from '../store/CatalogContext';
import { useConfiguracion } from '../store/ConfiguracionContext';
import { useCheques } from '../store/ChequesContext';
import { uploadFoto } from '../lib/upload';
import { cobradoObraUSD, repartirCobroEnCuotas, cuotaMontoUSD, ccObra } from './obra/helpers';
import { parseMoneyAR, JURISDICCIONES_IIBB } from '../lib/afip';
import { cajasDelUsuario } from '../lib/permisosCaja';

const DEFAULT_MEDIOS = ['Transferencia', 'Efectivo', 'Cheque', 'E-cheq', 'Débito', 'Tarjeta'];

// ── Modal para solicitar eliminación (no-admin) ───────────────────────────────
function SolicitarEliminacionModal({ movimiento, solicitante, onConfirm, onClose }) {
  const [motivo, setMotivo] = useState('');
  const isMobile = useIsMobile();
  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: isMobile ? 'min(90vw, 360px)' : 420 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: '#c0392b', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '6px 6px 0 0' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Solicitar eliminación de movimiento</div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.8 }} onClick={onClose}>✕</span>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: '#fef3f2', border: '1.5px solid #fca5a5', borderRadius: 4, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#c0392b', marginBottom: 4 }}>Movimiento a eliminar</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{movimiento.descripcion}</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3, fontFamily: 'monospace' }}>
              {movimiento.tipo} · ${Math.round(movimiento.monto).toLocaleString('es-AR')} · {movimiento.fecha}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Motivo de la solicitud <span style={{ color: '#c0392b' }}>*</span>
            </div>
            <textarea
              autoFocus
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              placeholder="Explicá por qué querés eliminar este movimiento…"
              style={{ width: '100%', minHeight: 80, padding: '8px 10px', border: '1.2px solid #d1d5db', borderRadius: 4, fontFamily: 'inherit', fontSize: 12, resize: 'vertical', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>
            Un administrador recibirá la solicitud y podrá aprobarla o rechazarla.
          </div>
        </div>
        <div style={{ padding: '10px 18px', borderTop: '1.5px solid #f3f4f6', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '6px 14px', border: '1.5px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>Cancelar</button>
          <button
            onClick={() => { if (motivo.trim()) { onConfirm(motivo.trim()); onClose(); } }}
            disabled={!motivo.trim()}
            style={{ padding: '6px 14px', border: 'none', borderRadius: 4, background: motivo.trim() ? '#c0392b' : '#fca5a5', color: '#fff', cursor: motivo.trim() ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 700, fontFamily: 'inherit' }}>
            Enviar solicitud
          </button>
        </div>
      </div>
    </div>
  );
}
const MEDIOS_NO_USD = new Set(['Cheque', 'E-cheq', 'Débito']);

const cuotaMontoFn = (c, moneda, tc) => (c._usd || moneda !== 'USD') ? (c.monto||0) : Math.round((c.monto||0)/tc);

const inputSt = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none' };
const fmtN   = (n) => Math.round(Math.abs(n)).toLocaleString('es-AR');
const fmtFecha = (iso) => { if (!iso) return ''; const [, m, d] = iso.split('-'); return `${d}/${m}`; };

const MESES_N = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const mesLabel = (m) => { const [y, mo] = m.split('-'); return `${MESES_N[+mo - 1]} ${y}`; };
const navMes   = (m, d) => { const [y, mo] = m.split('-').map(Number); const nd = new Date(y, mo - 1 + d, 1); return `${nd.getFullYear()}-${String(nd.getMonth()+1).padStart(2,'0')}`; };
const todayStr = () => new Date().toISOString().split('T')[0];
const currMes  = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; };

// ── Fila de traspaso ─────────────────────────────────────────────────────────
function TraspasoRow({ m, cajas, onRemove, isAdmin, pendingSolIds, onSolicitar }) {
  const [hover, setHover] = useState(false);
  const [showSolModal, setShowSolModal] = useState(false);
  const origen  = cajas.find(c => c.id === m.cajaId);
  const destino = cajas.find(c => c.id === m.cajaDestinoId);
  const isCross = origen && destino && origen.moneda !== destino.moneda;
  const isPendingSol = pendingSolIds?.has(m.id);
  return (
    <>
    <div
      style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: `1px solid ${T.faint2}`, fontSize: 12, background: isPendingSol ? '#fff7ed' : hover ? T.faint : 'transparent', transition: 'background .1s', gap: 8 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink3, width: 32, flexShrink: 0 }}>{fmtFecha(m.fecha)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.descripcion}</div>
        <div style={{ fontSize: 10, color: T.ink3, display: 'flex', gap: 6, marginTop: 1, alignItems: 'center' }}>
          <span style={{ background: T.faint2, borderRadius: 2, padding: '0 4px' }}>{origen?.nombre || '—'}</span>
          <span>→</span>
          <span style={{ background: T.faint2, borderRadius: 2, padding: '0 4px' }}>{destino?.nombre || '—'}</span>
          {isCross && m.tcAplicado && <span style={{ color: T.warn }}>· TC {fmtN(m.tcAplicado)}</span>}
          {isPendingSol && <span style={{ background: '#fef3c7', color: '#d97706', borderRadius: 2, padding: '0 4px', fontWeight: 700 }}>⏳ solicitud pendiente</span>}
        </div>
      </div>
      <span style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 13, color: T.ink2, flexShrink: 0 }}>
        ↔ {origen?.moneda === 'USD' ? 'U$S' : '$'} {fmtN(m.monto)}
      </span>
      <span style={{ width: 16, flexShrink: 0 }}>
        {hover && !isPendingSol && (
          isAdmin
            ? <span style={{ color: T.ink3, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
                onClick={() => { if (confirm('¿Eliminar este traspaso?')) onRemove(m.id); }}>×</span>
            : <span style={{ color: T.warn, cursor: 'pointer', fontSize: 11, fontWeight: 700, lineHeight: 1 }}
                title="Solicitar eliminación"
                onClick={() => setShowSolModal(true)}>✕</span>
        )}
      </span>
    </div>
    {showSolModal && (
      <SolicitarEliminacionModal
        movimiento={m}
        onConfirm={(motivo) => onSolicitar(m, motivo)}
        onClose={() => setShowSolModal(false)}
      />
    )}
    </>
  );
}

// ── Formulario de traspaso inline ─────────────────────────────────────────────
function TraspasoForm({ cajas, dolarVenta, onSave, onCancel }) {
  const cajasActivas = cajas.filter(c => c.activa);
  const todayVal = new Date().toISOString().split('T')[0];
  const [origenId,  setOrigenId]  = useState(cajasActivas[0]?.id || '');
  const [destinoId, setDestinoId] = useState(cajasActivas[1]?.id || '');
  const [monto,     setMonto]     = useState('');
  const [fecha,     setFecha]     = useState(todayVal);
  const [concepto,  setConcepto]  = useState('');
  const [tc,        setTc]        = useState(String(Math.round(dolarVenta || 1070)));

  const origen  = cajas.find(c => c.id === origenId);
  const destino = cajas.find(c => c.id === destinoId);
  const montoNum = Math.round(parseFloat(monto.replace(/[^0-9.]/g, '')) || 0);
  const isCross  = origen && destino && origen.moneda !== destino.moneda;
  const tcNum    = parseFloat(tc) || dolarVenta || 1070;
  const montoDestino = isCross && montoNum
    ? (origen.moneda === 'ARS' ? montoNum / tcNum : montoNum * tcNum)
    : null;
  const saldoPost = origen ? (origen.saldo || 0) - montoNum : 0;
  const canSave = montoNum > 0 && origenId && destinoId && origenId !== destinoId;

  const save = () => {
    if (!canSave) return;
    onSave({
      cajaOrigenId:  origenId,
      cajaDestinoId: destinoId,
      monto:         montoNum,
      // CRÍTICO: en traspasos cross-moneda hay que mandar el monto convertido,
      // sino el context acredita el mismo número en la otra moneda (~1000x).
      montoDestino:  isCross && montoDestino ? Math.round(montoDestino) : null,
      fecha,
      concepto:      concepto.trim() || `Traspaso: ${origen?.nombre} → ${destino?.nombre}`,
      tcAplicado:    isCross ? tcNum : null,
    });
  };

  return (
    <div style={{ padding: '12px 14px', background: 'rgba(100,100,200,.05)', borderBottom: `1px solid ${T.faint2}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 160 }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Caja origen</span>
          <select style={{ ...inputSt, cursor: 'pointer' }} value={origenId} onChange={e => setOrigenId(e.target.value)}>
            {cajasActivas.map(c => <option key={c.id} value={c.id}>{c.nombre} · {c.moneda === 'USD' ? 'U$S' : '$'} {fmtN(c.saldo)}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 7, fontSize: 18, color: T.ink3 }}>→</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 160 }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Caja destino</span>
          <select style={{ ...inputSt, cursor: 'pointer' }} value={destinoId} onChange={e => setDestinoId(e.target.value)}>
            {cajasActivas.filter(c => c.id !== origenId).map(c => <option key={c.id} value={c.id}>{c.nombre} · {c.moneda === 'USD' ? 'U$S' : '$'} {fmtN(c.saldo)}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 130 }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Monto ({origen?.moneda || '—'})</span>
          <input style={{ ...inputSt, fontFamily: T.fontMono, fontWeight: 700 }} type="number" min="0" placeholder="0" value={monto} onChange={e => setMonto(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel(); }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Fecha</span>
          <input type="date" style={inputSt} value={fecha} onChange={e => setFecha(e.target.value)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 2, minWidth: 180 }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Concepto</span>
          <input style={inputSt} value={concepto} onChange={e => setConcepto(e.target.value)} placeholder={`Traspaso: ${origen?.nombre || '—'} → ${destino?.nombre || '—'}`} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel(); }} />
        </div>
      </div>
      {isCross && (
        <div style={{ background: '#f6efd9', border: `1.5px solid ${T.warn}`, borderRadius: 4, padding: '8px 12px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.warn }}>Traspaso entre monedas ({origen?.moneda} → {destino?.moneda})</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: T.ink2 }}>TC aplicado</span>
            <input style={{ ...inputSt, width: 90, fontFamily: T.fontMono, fontWeight: 700 }} type="number" min="1" value={tc} onChange={e => setTc(e.target.value)} />
          </div>
          {montoDestino != null && (
            <span style={{ fontFamily: T.fontMono, fontWeight: 800, color: T.accent }}>
              = {destino?.moneda === 'USD' ? 'U$S' : '$'} {fmtN(montoDestino)}
            </span>
          )}
        </div>
      )}
      {montoNum > 0 && origen && (
        <div style={{ fontSize: 11, color: saldoPost < 0 ? T.accent : T.ink3 }}>
          Saldo post-traspaso en {origen.nombre}: {origen.moneda === 'USD' ? 'U$S' : '$'} {fmtN(saldoPost)}
          {saldoPost < 0 && <span style={{ marginLeft: 6, fontWeight: 700, color: T.accent }}>⚠ saldo insuficiente</span>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Btn sm onClick={onCancel}>Cancelar</Btn>
        <Btn sm fill onClick={save} style={{ opacity: canSave ? 1 : 0.5 }}>↔ Confirmar traspaso</Btn>
      </div>
    </div>
  );
}

// ── Panel de traspasos ────────────────────────────────────────────────────────
function TraspasoPanel({ traspasos, cajas, dolarVenta, onSave, onRemove, mes, isAdmin, pendingSolIds, onSolicitar }) {
  const [open, setOpen] = useState(false);
  const sinCajas = cajas.filter(c => c.activa).length < 2;
  const total = traspasos.reduce((s, m) => s + m.monto, 0);
  return (
    <Box style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
      <div style={{ padding: '9px 14px', background: 'rgba(100,100,200,.07)', borderBottom: `2px solid ${T.ink2}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 800, color: T.ink, fontSize: 14 }}>↔ Traspasos entre cajas</span>
          <span style={{ fontSize: 11, color: T.ink3 }}>{traspasos.length} registros</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {traspasos.length > 0 && <span style={{ fontFamily: T.fontMono, fontWeight: 800, color: T.ink2, fontSize: 14 }}>$ {fmtN(total)}</span>}
          <button
            onClick={() => !sinCajas && setOpen(o => !o)}
            title={sinCajas ? 'Necesitás al menos 2 cajas activas para hacer un traspaso' : ''}
            style={{ padding: '4px 12px', borderRadius: 4, border: `1.5px solid ${sinCajas ? T.faint2 : T.ink2}`, background: open ? T.ink2 : 'transparent', color: open ? '#fff' : (sinCajas ? T.ink3 : T.ink), fontFamily: T.font, fontSize: 11, fontWeight: 700, cursor: sinCajas ? 'not-allowed' : 'pointer', opacity: sinCajas ? 0.5 : 1 }}>
            {open ? '✕ Cerrar' : '+ Traspaso'}
          </button>
        </div>
      </div>
      {open && !sinCajas && (
        <TraspasoForm
          cajas={cajas}
          dolarVenta={dolarVenta}
          onSave={(data) => { onSave(data); setOpen(false); }}
          onCancel={() => setOpen(false)}
        />
      )}
      {traspasos.length === 0 && !open ? (
        <div style={{ padding: '24px 20px', textAlign: 'center', color: T.ink3, fontSize: 12 }}>Sin traspasos en {mesLabel(mes)}</div>
      ) : (
        traspasos.map(m => <TraspasoRow key={m.id} m={m} cajas={cajas} onRemove={onRemove} isAdmin={isAdmin} pendingSolIds={pendingSolIds} onSolicitar={onSolicitar} />)
      )}
    </Box>
  );
}

// ── Fila de movimiento ────────────────────────────────────────────────────────
function MovRow({ m, cajas, onRemove, isAdmin, pendingSolIds, onSolicitar }) {
  const [hover, setHover] = useState(false);
  const [showSolModal, setShowSolModal] = useState(false);
  const navigate = useNavigate();
  const { proveedores: provsList } = useProveedores();
  const caja = cajas.find(c => c.id === m.cajaId);
  const esNC = m.tipo === 'nota_credito_compra'; // nota de crédito de proveedor
  // Para el signo/color de la fila: una NC es un crédito a favor (como un ingreso).
  const isIngreso = m.tipo === 'ingreso' || esNC;
  const cajaIsUSD = caja?.moneda === 'USD';
  const simbolo = cajaIsUSD ? 'USD' : '$';
  const isPendingSol = pendingSolIds?.has(m.id);

  return (
    <>
    <div
      style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: `1px solid ${T.faint2}`, fontSize: 12, background: isPendingSol ? '#fff7ed' : hover ? T.faint : 'transparent', transition: 'background .1s', gap: 8 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink3, width: 32, flexShrink: 0 }}>{fmtFecha(m.fecha)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.descripcion}</div>
        <div style={{ fontSize: 10, color: T.ink3, display: 'flex', gap: 5, marginTop: 1, flexWrap: 'wrap' }}>
          {/* Links de obra/rubro/proveedor: en gastos usan T.warn (naranja)
              para mantener coherencia con el color del gasto. En ingresos
              quedan en T.accent (teal) coherente con el verde del ingreso. */}
          {m.obraNombre && m.obraNombre !== 'General' && (
            <span
              style={{ background: T.faint2, borderRadius: 2, padding: '0 4px', cursor: m.obraId ? 'pointer' : 'default', color: m.obraId ? (isIngreso ? T.accent : T.warn) : undefined }}
              onClick={e => { if (m.obraId) { e.stopPropagation(); navigate(`/obras/${m.obraId}/presupuesto`); } }}>
              {m.obraNombre}
            </span>
          )}
          {m.rubroNombre && (
            <span style={{ background: isIngreso ? '#e8f4f0' : '#fbeede', color: isIngreso ? T.accent : T.warn, borderRadius: 2, padding: '0 4px', fontWeight: 600 }}>{m.rubroNombre}</span>
          )}
          {caja && <span>{caja.nombre}</span>}
          {m.proveedor && (() => {
            const prov = m.proveedorId ? provsList.find(p => p.id === m.proveedorId) : provsList.find(p => p.nombre === m.proveedor);
            return prov
              ? <span style={{ color: isIngreso ? T.accent : T.warn, cursor: 'pointer', textDecoration: 'underline' }} onClick={e => { e.stopPropagation(); navigate(`/proveedores/${prov.id}`); }}>· {m.proveedor}</span>
              : <span>· {m.proveedor}</span>;
          })()}
          {m.medioPago && m.medioPago !== 'Transferencia' && <span>· {m.medioPago}</span>}
          {m.tipoCambio && m.montoDolar && !cajaIsUSD && (
            <span style={{ fontFamily: T.fontMono, color: T.ok }}>
              · ref USD {fmtN(m.montoDolar)}
            </span>
          )}
          {m.tipoCambio && m.montoARS && cajaIsUSD && (
            <span style={{ fontFamily: T.fontMono, color: T.ink3 }}>
              · = ${fmtN(m.montoARS)} ARS
            </span>
          )}
          {isPendingSol && (
            <span style={{ background: '#fef3c7', color: '#d97706', borderRadius: 2, padding: '0 4px', fontWeight: 700 }}>⏳ solicitud pendiente</span>
          )}
          {esNC && (
            <span style={{ background: '#fff7ed', color: '#b45309', borderRadius: 2, padding: '0 4px', fontWeight: 700 }}
              title="Nota de crédito de proveedor: reduce el IVA crédito del mes.">
              NC{m.afectaCaja ? '' : ' · solo fiscal'}
            </span>
          )}
          {(m.creadoPor || m.creadoPorWA) && (
            <span style={{ color: T.ink3 }}>
              {m.creadoPorWA ? '· bot' : `· ${m.creadoPor}`}
            </span>
          )}
        </div>
      </div>
      <span style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 13, color: isIngreso ? T.ok : T.warn, flexShrink: 0 }}>
        {isIngreso ? '+' : '−'}{simbolo} {fmtN(m.monto)}
      </span>
      {m.comprobanteUrl && (
        <a href={m.comprobanteUrl} target="_blank" rel="noreferrer"
          style={{ fontSize: 13, lineHeight: 1, flexShrink: 0, textDecoration: 'none', opacity: 0.7 }}
          title="Ver comprobante" onClick={e => e.stopPropagation()}>
          {m.comprobanteUrl.endsWith('.pdf') ? '📄' : '🖼'}
        </a>
      )}
      <span style={{ width: 16, flexShrink: 0 }}>
        {hover && !isPendingSol && (
          isAdmin
            ? <span style={{ color: T.ink3, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
                onClick={() => { if (confirm('¿Eliminar este movimiento?')) onRemove(m.id); }}>×</span>
            : <span style={{ color: T.warn, cursor: 'pointer', fontSize: 11, fontWeight: 700, lineHeight: 1 }}
                title="Solicitar eliminación"
                onClick={() => setShowSolModal(true)}>✕</span>
        )}
      </span>
    </div>
    {showSolModal && (
      <SolicitarEliminacionModal
        movimiento={m}
        onConfirm={(motivo) => onSolicitar(m, motivo)}
        onClose={() => setShowSolModal(false)}
      />
    )}
    </>
  );
}

// ── Formulario rápido inline ──────────────────────────────────────────────────
const BANCOS_QUICK = ['Banco Nación', 'Banco Galicia', 'Banco Provincia', 'Santander', 'BBVA', 'Macro', 'Supervielle', 'Credicoop', 'Comafi', 'Itaú', 'HSBC', 'Otro'];

const newAdicId = () => `adic-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;

function QuickAddForm({ tipo, obras, cajas, proveedores, clientes, dolarVenta, onSave, onCancel }) {
  const isGasto  = tipo === 'gasto';
  const color    = isGasto ? T.warn : T.ok;
  const isMobile = useIsMobile();
  const { catalog } = useCatalog();
  const { config } = useConfiguracion();
  const { addCheque } = useCheques();
  const { patchDetalle, getDetalle } = useObras();
  const { movimientos: allMovs } = useMovimientos();
  const { currentUser } = useUsuarios();
  const fotoRef = useRef(null);       // attach del panel de cuotas (existente)
  const camRef  = useRef(null);       // input cámara (mobile, capture)
  const archRef = useRef(null);       // input archivo (galería / PDF)
  const mediosDePago = config?.mediosDePago?.length ? config.mediosDePago : DEFAULT_MEDIOS;

  const [desc,          setDesc]          = useState('');
  const [monto,         setMonto]         = useState('');
  const [fecha,         setFecha]         = useState(todayStr);
  const [obraId,        setObraId]        = useState('');
  const [medio,         setMedio]         = useState('Transferencia');
  const [contraparteId, setContraparteId] = useState('');
  const [rubroNombre,   setRubroNombre]   = useState('');

  // Campos del cheque (visibles solo cuando medio = Cheque / E-cheq)
  const [cheqNumero,     setCheqNumero]     = useState('');
  const [cheqBanco,      setCheqBanco]      = useState('');
  const [cheqTitular,    setCheqTitular]    = useState('');
  const [cheqVencimiento,setCheqVencimiento]= useState('');
  const [esAdicional,    setEsAdicional]    = useState(false);
  const [categoriaFiscal,setCategoriaFiscal]= useState(''); // sueldo|cs-soc|sind|iibb|alquiler|servicios|seguro|otro (vacío = no fiscal)
  const [retencionIIBB,  setRetencionIIBB]  = useState(''); // Retención de IIBB que sufrió este cobro (descuenta del IIBB a pagar del mes)
  const [percepcionIIBB, setPercepcionIIBB] = useState(''); // Percepción de IIBB sufrida en este gasto (estación de servicio, etc.) — también descuenta del IIBB a pagar
  const [jurisdiccionIIBB, setJurisdiccionIIBB] = useState('PBA'); // Jurisdicción de la percepción IIBB — solo las de PBA descuentan del IIBB del mes
  const [percepcionIVA,  setPercepcionIVA]  = useState(''); // Percepción de IVA sufrida (RG 2408/3337, mayoristas) — pago a cuenta que descuenta del IVA a pagar del mes
  const [cuotaId,        setCuotaId]        = useState('');
  const [fotoFile,       setFotoFile]       = useState(null);
  const [fotoUploading,  setFotoUploading]  = useState(false);

  // Rubros para imputar el gasto: si hay obra seleccionada, los del PRESUPUESTO
  // de esa obra (para que el desvío presupuesto-vs-real matchee por rubro); sino,
  // el catálogo global. Imputar a rubro habilita el control de margen por rubro.
  const rubrosImputables = (() => {
    if (obraId) {
      const rr = (getDetalle(obraId)?.rubros || []).filter(r => r.tipo !== 'seccion' && r.nombre);
      if (rr.length) return rr;
    }
    return catalog.rubros || [];
  })();

  // Al cambiar de obra, limpiar el rubro elegido: los rubros son del presupuesto
  // de cada obra, uno de otra obra no aplica (evita imputar a un rubro fantasma).
  useEffect(() => { setRubroNombre(''); }, [obraId]);

  // Moneda: 'ARS', 'USD' (directo a caja USD), 'USD_ARS' (pesos recibidos con ref USD, solo ingresos)
  const [monedaIngreso, setMonedaIngreso] = useState('ARS');
  const [monedaGasto,   setMonedaGasto]   = useState('ARS');
  const [tipoCambio,    setTipoCambio]    = useState(() => String(Math.round(dolarVenta || 1070)));

  const isCheckPayment = medio === 'Cheque' || medio === 'E-cheq';
  const mediosDisponibles = isGasto && monedaGasto === 'USD'
    ? mediosDePago.filter(m => !MEDIOS_NO_USD.has(m))
    : mediosDePago;

  useEffect(() => {
    if (isGasto && monedaGasto === 'USD' && MEDIOS_NO_USD.has(medio)) setMedio('Transferencia');
  }, [monedaGasto]);

  useEffect(() => {
    if (isGasto || !obraId) { setCuotaId(''); return; }
    const det = getDetalle(obraId);
    const obraM = obras.find(o => o.id === obraId)?.moneda || 'ARS';
    const tc = dolarVenta || 1070;
    const cuotas = det?.cuotas || [];
    // Primera cuota no cubierta por los movimientos de ingreso (libro único).
    const reparto = repartirCobroEnCuotas(cuotas, cobradoObraUSD(allMovs, cajas, obraId, tc), obraM, tc);
    const first = cuotas.find(c => (reparto[c.id] || 0) < cuotaMontoUSD(c, obraM, tc));
    setCuotaId(first?.id || '');
  }, [obraId, isGasto]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isGasto || !obraId) return;
    const obra = obras.find(o => o.id === obraId);
    if (!obra?.cliente) return;
    const match = clientes.find(c => c.nombre === obra.cliente);
    if (match) setContraparteId(match.id);
  }, [obraId, isGasto]); // eslint-disable-line react-hooks/exhaustive-deps

  // La moneda activa determina qué cajas mostrar
  const monedaActual     = isGasto ? monedaGasto : (monedaIngreso === 'USD' ? 'USD' : 'ARS');
  const cajasMoneda      = cajas.filter(c => c.activa && c.moneda === monedaActual);
  const cajaIsUSD        = monedaActual === 'USD';

  const [cajaId, setCajaId] = useState(() => cajas.filter(c => c.activa && c.moneda === 'ARS')[0]?.id || '');

  // Auto-reset cajaId cuando cambia la moneda seleccionada
  useEffect(() => {
    const firstMatch = cajas.filter(c => c.activa && c.moneda === monedaActual)[0];
    if (firstMatch) setCajaId(firstMatch.id);
  }, [monedaActual]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsedMonto  = parseFloat(monto.replace(/[^0-9.]/g, '')) || 0;
  const parsedTC     = parseFloat(tipoCambio.replace(/[^0-9.]/g, '')) || dolarVenta || 1070;

  // USD_ARS: se reciben pesos, la ref USD es monto / TC
  const montoFinal = Math.round(parsedMonto);
  const refUSD     = (!isGasto && monedaIngreso === 'USD_ARS' && parsedTC > 0)
    ? Math.round(parsedMonto / parsedTC)
    : 0;

  const effectiveCajaId = cajasMoneda.find(c => c.id === cajaId) ? cajaId : cajasMoneda[0]?.id || '';
  const canSave = montoFinal > 0 && desc.trim().length > 0 && effectiveCajaId && (!isCheckPayment || cheqVencimiento) && !fotoUploading;

  // Cuotas disponibles para vincular (después de parsedTC)
  const obraSelObj = obras.find(o => o.id === obraId);
  const obraMoneda = obraSelObj?.moneda || 'ARS';
  const detalleCuotas = !isGasto && obraId ? (getDetalle(obraId)?.cuotas || []) : [];
  // Cobrado previo por cuota DERIVADO de los movimientos de ingreso (libro
  // único), en USD. Reemplaza el viejo cálculo desde cuota.pagos[].
  const repartoPrevioUSD = useMemo(
    () => repartirCobroEnCuotas(detalleCuotas, cobradoObraUSD(allMovs, cajas, obraId, parsedTC), obraMoneda, parsedTC),
    [detalleCuotas, allMovs, cajas, obraId, obraMoneda, parsedTC]
  );
  // Cobrado de una cuota en la moneda de la obra (el reparto viene en USD).
  const cobradoCuotaObra = (c) => {
    const usd = repartoPrevioUSD[c.id] || 0;
    return (obraMoneda === 'USD' || c._usd) ? usd : Math.round(usd * parsedTC);
  };
  const estadoCuotaDeriv = (c) => {
    const cobUSD = repartoPrevioUSD[c.id] || 0;
    const montoUSD = cuotaMontoUSD(c, obraMoneda, parsedTC);
    if (cobUSD <= 0) return 'pendiente';
    if (cobUSD >= montoUSD) return 'pagado';
    return 'parcial';
  };
  const cuotasPendientes = detalleCuotas.filter(c => estadoCuotaDeriv(c) !== 'pagado');

  const pagoMoneda = !isGasto && monedaIngreso === 'USD' ? 'USD' : 'ARS';
  const distribucionPrev = useMemo(() => {
    if (isGasto || !cuotaId || !obraId || montoFinal <= 0) return [];
    const result = [];
    let remaining = montoFinal;
    let idx = detalleCuotas.findIndex(c => c.id === cuotaId);
    if (idx < 0) return [];
    while (remaining > 0 && idx < detalleCuotas.length) {
      const c = detalleCuotas[idx];
      const montoC   = cuotaMontoFn(c, obraMoneda, parsedTC);
      const cobradoC = cobradoCuotaObra(c);
      const saldoC   = montoC - cobradoC;
      if (saldoC <= 0) { idx++; continue; }
      const remEnObra = obraMoneda === 'USD' && pagoMoneda === 'ARS'
        ? Math.round(remaining / parsedTC)
        : obraMoneda === 'ARS' && pagoMoneda === 'USD'
        ? Math.round(remaining * parsedTC)
        : remaining;
      const aplicar = Math.min(remEnObra, saldoC);
      const pagoMonto = obraMoneda === 'USD' && pagoMoneda === 'ARS'
        ? Math.round(aplicar * parsedTC)
        : obraMoneda === 'ARS' && pagoMoneda === 'USD'
        ? Math.round(aplicar / parsedTC)
        : aplicar;
      result.push({ cuota: c, aplicar, saldoPost: saldoC - aplicar });
      remaining -= pagoMonto;
      idx++;
    }
    return result;
  }, [cuotaId, montoFinal, detalleCuotas, obraMoneda, parsedTC, pagoMoneda, isGasto, repartoPrevioUSD]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!canSave) return;
    const obra = obras.find(o => o.id === obraId);

    let contraparteName = '';
    const extra = {};

    if (isGasto) {
      const prov = proveedores.find(p => p.id === contraparteId);
      contraparteName = prov?.nombre || '';
      extra.proveedorId = contraparteId || null;
      if (rubroNombre) {
        // Solo imputar si el rubro existe en la obra/catálogo actual. Si quedó un
        // rubroNombre viejo (p.ej. se cambió de obra), NO lo persistimos → el gasto
        // queda "sin rubro" en vez de imputarse a un rubro fantasma que después
        // desaparece del desvío presupuesto-vs-real.
        const r = rubrosImputables.find(x => x.nombre === rubroNombre);
        if (r) {
          extra.rubroNombre = rubroNombre;
          if (r.id) extra.rubroId = r.id; // id del rubro del presupuesto (robusto ante renombres)
        }
      }
    } else {
      const cli = clientes.find(c => c.id === contraparteId);
      contraparteName = cli?.nombre || '';
      extra.clienteId = contraparteId || null;
      if (monedaIngreso === 'USD_ARS' && refUSD > 0) {
        extra.tipoCambio = parsedTC;
        extra.montoDolar = refUSD;
      }
      if (cuotaId) extra.cuotaId = cuotaId;
    }

    // Subir comprobante si hay foto (helper central — bucket kamak-fotos).
    let fotoUrl = null;
    if (fotoFile) {
      setFotoUploading(true);
      try {
        fotoUrl = await uploadFoto(fotoFile, isGasto ? 'gastos' : 'ingresos');
      } catch (err) {
        console.error('[Movimientos] subir comprobante:', err);
      }
      setFotoUploading(false);
    }

    const movId = onSave({
      tipo,
      descripcion:   desc.trim(),
      monto:         montoFinal,
      fecha,
      obraId:        obraId || null,
      obraNombre:    obra?.nombre || 'General',
      cajaId:        effectiveCajaId,
      cajaDestinoId: null,
      proveedor:     contraparteName,
      categoria:     isGasto ? 'general' : 'cobro-cliente',
      categoriaFiscal: isGasto && categoriaFiscal ? categoriaFiscal : undefined,
      // Retención IIBB sufrida en un cobro — se descuenta del IIBB del mes en el Financiero.
      retencionIIBB:   (() => { const n = !isGasto ? Math.round(parseMoneyAR(retencionIIBB)) : 0; return n > 0 ? n : undefined; })(),
      // Percepción IIBB sufrida en un gasto (estaciones de servicio, etc.) — también descuenta.
      percepcionIIBB:  (() => { const n =  isGasto ? Math.round(parseMoneyAR(percepcionIIBB)) : 0; return n > 0 ? n : undefined; })(),
      // Jurisdicción de la percepción IIBB. Solo se guarda si NO es PBA (ausente = PBA).
      jurisdiccionIIBB: (() => { const n = isGasto ? Math.round(parseMoneyAR(percepcionIIBB)) : 0; return (n > 0 && jurisdiccionIIBB !== 'PBA') ? jurisdiccionIIBB : undefined; })(),
      // Percepción IVA sufrida en un gasto (mayoristas, RG 2408/3337) — pago a cuenta del IVA del mes.
      percepcionIVA:   (() => { const n =  isGasto ? Math.round(parseMoneyAR(percepcionIVA)) : 0; return n > 0 ? n : undefined; })(),
      medioPago:     medio,
      referencia:    cheqNumero || '',
      fondoReparo:   false,
      comprobanteUrl: fotoUrl,
      creadoPor:     currentUser?.nombre || currentUser?.email || 'Usuario',
      creadoPorWA:   false,
      ...extra,
    });

    if (esAdicional && obraId) {
      patchDetalle(obraId, d => ({
        ...d,
        adicionales: [...(d.adicionales || []), {
          id: newAdicId(),
          descripcion: desc.trim(),
          tarea: '', cantidad: null, unidad: '',
          costoUnit: null, costoTotal: montoFinal,
          valorVentaUnit: null, valorVentaTotal: null,
          montoProveedor: montoFinal, cantidadProveedor: null, costoUnitProveedor: null,
          aplicadoAContrato: false,
          monto: montoFinal, fecha, estado: 'pendiente',
          aplicaACliente: true, aplicaAProveedor: false,
        }],
      }));
    }

    // Libro único: NO escribimos cuota.pagos[]. El cobro queda registrado como
    // movimiento de ingreso (con cuotaId de referencia) y la cuenta corriente
    // del cliente se DERIVA de los movimientos (repartidos sobre las cuotas en
    // orden) tanto en la obra como en el portal.

    if (isCheckPayment && cheqVencimiento) {
      const tipoCheck = isGasto
        ? (medio === 'E-cheq' ? 'echeq_propio' : 'propio')
        : (medio === 'E-cheq' ? 'echeq_tercero' : 'tercero');
      addCheque({
        tipo:            tipoCheck,
        numero:          cheqNumero,
        banco:           cheqBanco,
        titular:         cheqTitular,
        monto:           montoFinal,
        moneda:          cajaIsUSD ? 'USD' : 'ARS',
        fechaIngreso:    fecha,
        fechaVencimiento: cheqVencimiento,
        obraId:          obraId || null,
        obraNombre:      obra?.nombre || '',
        clienteNombre:   !isGasto ? contraparteName : '',
        proveedorNombre: isGasto  ? contraparteName : '',
        cajaId:          effectiveCajaId,
        movimientoId:    movId || null,
        estado:          'cartera',
      });
    }

    setDesc(''); setMonto(''); setRubroNombre(''); setContraparteId(''); setEsAdicional(false); setCategoriaFiscal(''); setRetencionIIBB(''); setPercepcionIIBB(''); setPercepcionIVA(''); setJurisdiccionIIBB('PBA');
    setCheqNumero(''); setCheqBanco(''); setCheqTitular(''); setCheqVencimiento('');
    setCuotaId(''); setFotoFile(null);
    if (fotoRef.current) fotoRef.current.value = '';
    if (camRef.current)  camRef.current.value  = '';
    if (archRef.current) archRef.current.value = '';
  };

  const onKey = (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div style={{ padding: '12px 14px', background: isGasto ? 'rgba(212,146,58,.07)' : 'rgba(61,122,74,.07)', display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* fila 1: descripción + monto + fecha */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 8 }}>
        <input autoFocus style={{ ...inputSt, flex: 1 }}
          value={desc} onChange={e => setDesc(e.target.value)} onKeyDown={onKey}
          placeholder={isGasto ? 'Descripción del gasto…' : 'Descripción del ingreso…'} />

        {/* Monto según modo */}
        {!isGasto && monedaIngreso === 'USD_ARS' ? (
          // Recibo pesos, referencia en USD: ARS ÷ TC = USD ref
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
            <input style={{ ...inputSt, width: isMobile ? '100%' : 110, fontFamily: T.fontMono, fontWeight: 700 }}
              type="number" min="0" placeholder="$ Pesos"
              value={monto} onChange={e => setMonto(e.target.value)} onKeyDown={onKey} />
            <span style={{ fontSize: 11, color: T.ink3 }}>÷ TC</span>
            <input style={{ ...inputSt, width: 85, fontFamily: T.fontMono }}
              type="number" min="0" placeholder="TC"
              value={tipoCambio} onChange={e => setTipoCambio(e.target.value)} onKeyDown={onKey} />
            <span style={{ fontSize: 11, color: T.ink3 }}>=</span>
            <div style={{ ...inputSt, width: 90, fontFamily: T.fontMono, fontWeight: 700, color: T.ok, background: T.faint, display: 'flex', alignItems: 'center', cursor: 'default' }}>
              USD {refUSD > 0 ? fmtN(refUSD) : '0'}
            </div>
          </div>
        ) : (
          // Input directo (USD o ARS según moneda seleccionada)
          <input style={{ ...inputSt, width: isMobile ? '100%' : 130, fontFamily: T.fontMono, fontWeight: 700 }}
            type="number" min="0" placeholder={cajaIsUSD ? 'USD' : '$ Monto'}
            value={monto} onChange={e => setMonto(e.target.value)} onKeyDown={onKey} />
        )}

        <input type="date" style={{ ...inputSt, width: isMobile ? '100%' : 140 }}
          value={fecha} onChange={e => setFecha(e.target.value)} />
      </div>

      {/* fila 2: contraparte + moneda + obra + caja + medio */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>

        {/* Selector proveedor / cliente */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: isMobile ? '1 1 100%' : '1.4', gap: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {isGasto ? 'Proveedor' : 'Cliente'}
            </span>
            {isGasto && contraparteId && (
              <span style={{ fontSize: 10, color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
                onClick={() => navigate(`/proveedores/${contraparteId}`)}>Ver CC →</span>
            )}
          </div>
          <select style={{ ...inputSt, cursor: 'pointer', width: '100%' }}
            value={contraparteId} onChange={e => setContraparteId(e.target.value)}>
            <option value="">{isGasto ? '— Sin proveedor' : '— Sin cliente'}</option>
            {isGasto
              ? proveedores.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}{p.tipo ? ` · ${p.tipo}` : ''}
                  </option>
                ))
              : clientes.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}{c.empresa ? ` · ${c.empresa}` : ''}
                  </option>
                ))
            }
          </select>
        </div>

        {/* Selector de moneda — ingresos: ARS / USD / USD→Pesos; gastos: ARS / USD */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: isMobile ? '1 1 calc(50% - 4px)' : '0 0 auto' }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Moneda</span>
          {isGasto ? (
            <select style={{ ...inputSt, width: isMobile ? '100%' : 110, cursor: 'pointer' }}
              value={monedaGasto} onChange={e => setMonedaGasto(e.target.value)}>
              <option value="ARS">Pesos (ARS)</option>
              <option value="USD">Dólares (USD)</option>
            </select>
          ) : (
            <select style={{ ...inputSt, width: isMobile ? '100%' : 110, cursor: 'pointer' }}
              value={monedaIngreso} onChange={e => setMonedaIngreso(e.target.value)}>
              <option value="ARS">Pesos (ARS)</option>
              <option value="USD">Dólares (USD)</option>
              <option value="USD_ARS">Pesos + ref USD</option>
            </select>
          )}
        </div>

        {isGasto && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: isMobile ? '1 1 100%' : 1, gap: 2 }}>
            <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Rubro{obraId && rubrosImputables.length ? ' (del presupuesto)' : ''}
            </span>
            <select style={{ ...inputSt, cursor: 'pointer', width: '100%' }}
              value={rubroNombre} onChange={e => setRubroNombre(e.target.value)}>
              <option value="">— Sin rubro —</option>
              {rubrosImputables.map(r => <option key={r.id} value={r.nombre}>{r.nombre}</option>)}
            </select>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', flex: isMobile ? '1 1 calc(50% - 4px)' : 1, gap: 2 }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Obra</span>
          <select style={{ ...inputSt, cursor: 'pointer', width: '100%' }} value={obraId} onChange={e => setObraId(e.target.value)}>
            <option value="">— Sin obra —</option>
            {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', flex: isMobile ? '1 1 calc(50% - 4px)' : 1, gap: 2 }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Caja</span>
          <select style={{ ...inputSt, cursor: 'pointer', width: '100%' }}
            value={cajasMoneda.find(c => c.id === cajaId) ? cajaId : cajasMoneda[0]?.id || ''}
            onChange={e => setCajaId(e.target.value)}>
            {cajasMoneda.length === 0
              ? <option value="">Sin cajas {monedaActual}</option>
              : cajasMoneda.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)
            }
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: isMobile ? '1 1 calc(50% - 4px)' : '0 0 auto' }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Medio de pago</span>
          <select style={{ ...inputSt, width: isMobile ? '100%' : 120, cursor: 'pointer' }} value={medio} onChange={e => setMedio(e.target.value)}>
            {mediosDisponibles.map(v => <option key={v}>{v}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 8, flex: isMobile ? '1 1 100%' : '0 0 auto', justifyContent: isMobile ? 'flex-end' : 'flex-start', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Adjuntar comprobante — SIEMPRE disponible (cualquier gasto/ingreso).
              En mobile: cámara directa (capture) + archivo. En desktop: un solo
              botón selector. Reutiliza fotoFile/fotoUploading (sube en save()). */}
          {isMobile ? (
            <>
              <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                onChange={e => setFotoFile(e.target.files?.[0] || null)} />
              <input ref={archRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }}
                onChange={e => setFotoFile(e.target.files?.[0] || null)} />
              <Btn sm onClick={() => camRef.current?.click()}>📷 Cámara</Btn>
              <Btn sm onClick={() => archRef.current?.click()}>📎 Archivo</Btn>
            </>
          ) : (
            <>
              <input ref={archRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }}
                onChange={e => setFotoFile(e.target.files?.[0] || null)} />
              <Btn sm onClick={() => archRef.current?.click()}>📎 Comprobante</Btn>
            </>
          )}
          {fotoFile && (
            <span style={{ fontSize: 10, color: T.ink3, display: 'flex', alignItems: 'center', gap: 4, maxWidth: 140 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fotoFile.name}</span>
              <span style={{ cursor: 'pointer', color: T.warn, fontWeight: 700 }}
                onClick={() => { setFotoFile(null); if (camRef.current) camRef.current.value = ''; if (archRef.current) archRef.current.value = ''; }}>✕</span>
            </span>
          )}
          {fotoUploading && <span style={{ fontSize: 10, color: T.ink2 }}>Subiendo…</span>}
          <Btn sm onClick={onCancel}>✕</Btn>
          <button onClick={save}
            style={{ padding: '6px 16px', borderRadius: 4, border: 'none', fontFamily: T.font, fontWeight: 700, fontSize: 12, cursor: canSave ? 'pointer' : 'not-allowed', background: canSave ? color : T.faint2, color: canSave ? '#fff' : T.ink3, transition: 'background .15s', flexShrink: 0 }}>
            ↵ Guardar
          </button>
        </div>
      </div>

      {/* Fila 3: datos del cheque (solo cuando medio = Cheque / E-cheq) */}
      {isCheckPayment && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: '8px 10px', background: isGasto ? 'rgba(212,146,58,.06)' : 'rgba(61,122,74,.06)', borderRadius: 4, border: `1px dashed ${isGasto ? T.warn : T.ok}`, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0, alignSelf: 'center', flex: isMobile ? '1 1 100%' : '0 0 auto' }}>Datos cheque</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: isMobile ? '1 1 calc(50% - 4px)' : '0 0 100px' }}>
            <span style={{ fontSize: 10, color: T.ink3 }}>N° cheque</span>
            <input style={{ ...inputSt }} value={cheqNumero} onChange={e => setCheqNumero(e.target.value)} placeholder="12345678" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: isMobile ? '1 1 calc(50% - 4px)' : '0 0 140px' }}>
            <span style={{ fontSize: 10, color: T.ink3 }}>Banco</span>
            <input list="mov-bancos-list" style={{ ...inputSt }} value={cheqBanco} onChange={e => setCheqBanco(e.target.value)} placeholder="Banco Galicia" />
            <datalist id="mov-bancos-list">{BANCOS_QUICK.map(b => <option key={b} value={b} />)}</datalist>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: isMobile ? '1 1 100%' : 1 }}>
            <span style={{ fontSize: 10, color: T.ink3 }}>{isGasto ? 'Destinatario' : 'Titular (emisor)'}</span>
            <input style={{ ...inputSt }} value={cheqTitular} onChange={e => setCheqTitular(e.target.value)} placeholder={isGasto ? 'A quién se emite' : 'Quien lo firmó'} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: isMobile ? '1 1 100%' : '0 0 140px' }}>
            <span style={{ fontSize: 10, color: T.ink3 }}>Fecha de cobro *</span>
            <input type="date" style={{ ...inputSt, width: '100%' }} value={cheqVencimiento} onChange={e => setCheqVencimiento(e.target.value)} />
          </div>
        </div>
      )}

      {isGasto && obraId && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer', color: T.ink2, userSelect: 'none' }}>
          <input type="checkbox" checked={esAdicional} onChange={e => setEsAdicional(e.target.checked)} />
          Registrar también como <b style={{ color: T.accent }}>adicional pendiente</b> de {obras.find(o => o.id === obraId)?.nombre || 'la obra'}
        </label>
      )}

      {/* Categoría fiscal (opcional) — sirve para que el panel Financiero
          sume sueldos / cargas / etc. automáticamente al mes correspondiente. */}
      {isGasto && (
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: T.ink3, whiteSpace: isMobile ? 'normal' : 'nowrap' }}>Categoría fiscal (Financiero):</span>
          <select value={categoriaFiscal} onChange={e => setCategoriaFiscal(e.target.value)}
            style={{ ...inputSt, flex: 1, width: isMobile ? '100%' : undefined, fontSize: 11, padding: '4px 8px' }}>
            <option value="">— sin categoría fiscal —</option>
            <option value="sueldo">Sueldo</option>
            <option value="cs-soc">Cargas sociales</option>
            <option value="sind">Sindicato (UOCRA)</option>
            <option value="iibb">IIBB (pago / boleta)</option>
            <option value="alquiler">Alquiler</option>
            <option value="servicios">Servicios (luz/gas/internet)</option>
            <option value="seguro">Seguro</option>
            <option value="otro">Otro gasto fijo</option>
          </select>
        </div>
      )}

      {/* Retención IIBB sufrida (solo en cobros) — descuenta del IIBB a pagar
          del mes correspondiente en el Financiero. Si el cliente te retuvo
          IIBB en este pago, lo cargás acá y queda registrado. */}
      {!isGasto && (
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: T.ink3, whiteSpace: isMobile ? 'normal' : 'nowrap' }}>Retención IIBB sufrida $ (opcional):</span>
          <input type="text" inputMode="decimal" placeholder="0"
            value={retencionIIBB} onChange={e => setRetencionIIBB(e.target.value)}
            style={{ ...inputSt, flex: 1, width: isMobile ? '100%' : undefined, fontSize: 11, padding: '4px 8px', textAlign: 'right', fontFamily: T.fontMono }} />
        </div>
      )}

      {/* Percepción IIBB sufrida (solo en gastos) — típico de estaciones de
          servicio: te suman un % de IIBB al pagar. Es pago a cuenta del IIBB
          tuyo del mes → se descuenta igual que una retención. */}
      {isGasto && (
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: T.ink3, whiteSpace: isMobile ? 'normal' : 'nowrap' }}>Percepción IIBB sufrida $ (opcional):</span>
          <input type="text" inputMode="decimal" placeholder="0"
            value={percepcionIIBB} onChange={e => setPercepcionIIBB(e.target.value)}
            style={{ ...inputSt, flex: 1, width: isMobile ? '100%' : undefined, fontSize: 11, padding: '4px 8px', textAlign: 'right', fontFamily: T.fontMono }} />
        </div>
      )}
      {/* Jurisdicción de la percepción IIBB: solo las de PBA descuentan del IIBB
          del mes (las de otra provincia se liquidan aparte, Convenio Multilateral). */}
      {isGasto && Math.round(parseMoneyAR(percepcionIIBB)) > 0 && (
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: T.ink3, whiteSpace: isMobile ? 'normal' : 'nowrap' }}>Jurisdicción IIBB:</span>
          <select value={jurisdiccionIIBB} onChange={e => setJurisdiccionIIBB(e.target.value)}
            style={{ ...inputSt, flex: 1, width: isMobile ? '100%' : undefined, fontSize: 11, padding: '4px 8px' }}>
            {JURISDICCIONES_IIBB.map(j => <option key={j.id} value={j.id}>{j.nombre}</option>)}
          </select>
        </div>
      )}
      {/* Percepción IVA sufrida (RG 2408/3337): típica en mayoristas. Es un pago a
          cuenta del IVA del mes → se descuenta de la posición IVA en el Financiero. */}
      {isGasto && (
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: T.ink3, whiteSpace: isMobile ? 'normal' : 'nowrap' }}>Percepción IVA sufrida $ (opcional):</span>
          <input type="text" inputMode="decimal" placeholder="0"
            value={percepcionIVA} onChange={e => setPercepcionIVA(e.target.value)}
            style={{ ...inputSt, flex: 1, width: isMobile ? '100%' : undefined, fontSize: 11, padding: '4px 8px', textAlign: 'right', fontFamily: T.fontMono }} />
        </div>
      )}

      {/* Distribución automática de cuotas + comprobante */}
      {!isGasto && obraId && cuotasPendientes.length > 0 && (
        <div style={{ padding: '8px 10px', background: 'rgba(61,122,74,.06)', borderRadius: 4, border: `1px dashed ${T.ok}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: T.ok, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Distribución automática de cuotas
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input ref={fotoRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }}
                onChange={e => setFotoFile(e.target.files?.[0] || null)} />
              <Btn sm onClick={() => fotoRef.current?.click()}>
                {fotoFile ? `📎 ${fotoFile.name.slice(0, 14)}…` : '📎 Comprobante'}
              </Btn>
              {fotoFile && <span style={{ fontSize: 10, color: T.ink3, cursor: 'pointer' }} onClick={() => { setFotoFile(null); if (fotoRef.current) fotoRef.current.value = ''; }}>✕</span>}
              {fotoUploading && <span style={{ fontSize: 10, color: T.ink2 }}>Subiendo…</span>}
            </div>
          </div>
          {distribucionPrev.length === 0 ? (
            <div style={{ fontSize: 11, color: T.ink3 }}>
              {montoFinal > 0 ? 'Sin cuotas pendientes desde la primera.' : 'Ingresá el monto para ver cómo se distribuye.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {distribucionPrev.map(({ cuota, aplicar, saldoPost }) => {
                const fmtC = n => obraMoneda === 'USD' ? `U$S ${Math.round(n).toLocaleString('es-AR')}` : `$ ${Math.round(n).toLocaleString('es-AR')}`;
                const isPagado = saldoPost <= 0;
                return (
                  <div key={cuota.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                    <span style={{ background: isPagado ? T.ok : T.warn, color: '#fff', borderRadius: 3, padding: '1px 7px', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                      {isPagado ? '✓ Pago' : '~ Parcial'}
                    </span>
                    <span style={{ color: T.ink, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cuota.descripcion}</span>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: isPagado ? T.ok : T.warn }}>{fmtC(aplicar)}</span>
                    {!isPagado && <span style={{ fontSize: 10, color: T.ink3 }}>· resta {fmtC(saldoPost)}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize: 10, color: T.ink3 }}>Enter guarda · Esc cierra · el formulario queda abierto para cargar varios seguidos</div>
    </div>
  );
}

// ── Panel (ingresos o gastos) ─────────────────────────────────────────────────
function Panel({ tipo, movs, cajas, obras, proveedores, clientes, dolarVenta, total, mes, addMovimiento, onRemove, isAdmin, pendingSolIds, onSolicitar }) {
  const [open, setOpen] = useState(false);
  const isIngreso = tipo === 'ingreso';
  const color = isIngreso ? T.ok : T.warn;
  const label = isIngreso ? 'Ingresos' : 'Gastos';
  const arrow = isIngreso ? '↑' : '↓';
  const sinCajas = cajas.filter(c => c.activa).length === 0;

  return (
    <Box style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '9px 14px', background: isIngreso ? 'rgba(61,122,74,.1)' : 'rgba(212,146,58,.1)', borderBottom: `2px solid ${color}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 800, color, fontSize: 14 }}>{arrow} {label}</span>
          <span style={{ fontSize: 11, color: T.ink3 }}>{movs.length} registros</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: T.fontMono, fontWeight: 800, color, fontSize: 15 }}>$ {fmtN(total)}</span>
          <button
            onClick={() => !sinCajas && setOpen(o => !o)}
            title={sinCajas ? 'Creá al menos una caja en Cajas antes de registrar movimientos' : ''}
            style={{ padding: '4px 12px', borderRadius: 4, border: `1.5px solid ${sinCajas ? T.faint2 : color}`, background: open ? color : 'transparent', color: open ? '#fff' : (sinCajas ? T.ink3 : color), fontFamily: T.font, fontSize: 11, fontWeight: 700, cursor: sinCajas ? 'not-allowed' : 'pointer', opacity: sinCajas ? 0.5 : 1 }}>
            {open ? '✕ Cerrar' : `+ ${isIngreso ? 'Ingreso' : 'Gasto'}`}
          </button>
        </div>
      </div>

      {sinCajas && (
        <div style={{ padding: '10px 14px', fontSize: 12, color: T.ink3, background: T.faint, borderBottom: `1px solid ${T.faint2}` }}>
          Para registrar movimientos necesitás tener al menos una caja activa.{' '}
          <a href="/cajas" style={{ color: T.accent, fontWeight: 700 }}>Ir a Cajas →</a>
        </div>
      )}

      {open && !sinCajas && (
        <QuickAddForm
          tipo={tipo}
          obras={obras}
          cajas={cajas}
          proveedores={proveedores}
          clientes={clientes}
          dolarVenta={dolarVenta}
          onSave={(data) => addMovimiento(data)}
          onCancel={() => setOpen(false)}
        />
      )}

      <div style={{ overflow: 'auto', maxHeight: 460 }}>
        {movs.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: T.ink3, fontSize: 12 }}>
            Sin {label.toLowerCase()} en {mesLabel(mes)}
            {!sinCajas && (
              <div style={{ marginTop: 8 }}>
                <button onClick={() => setOpen(true)}
                  style={{ padding: '5px 14px', borderRadius: 4, border: `1px solid ${color}`, background: 'transparent', color, fontFamily: T.font, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  + Registrar {isIngreso ? 'ingreso' : 'gasto'}
                </button>
              </div>
            )}
          </div>
        )}
        {movs.map(m => <MovRow key={m.id} m={m} cajas={cajas} onRemove={onRemove} isAdmin={isAdmin} pendingSolIds={pendingSolIds} onSolicitar={onSolicitar} />)}
      </div>
    </Box>
  );
}

// ── Panel comprobantes del mes ────────────────────────────────────────────────
// Pensado para armarle el cierre al contador: lista de movimientos del mes que
// tienen comprobante adjunto (facturas/tickets), con su total, descarga del
// ZIP de imágenes y un CSV con el detalle (fecha, proveedor, concepto, monto,
// obra) para la planilla contable.
function ComprobantesPanel({ movimientos, mes }) {
  const [open,        setOpen]        = useState(false);
  const [downloading, setDownloading] = useState(false);
  const isMobile = useIsMobile();

  const conFoto = movimientos.filter(m => m.comprobanteUrl);
  if (!conFoto.length) return null;

  const totalConFoto = conFoto.reduce((s, m) => s + (m.tipo === 'ingreso' ? 1 : -1) * (m.monto || 0), 0);
  const totalGastos  = conFoto.filter(m => m.tipo === 'gasto').reduce((s, m) => s + (m.monto || 0), 0);

  const sanitize = s => (s || '').replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ _-]/g, '').slice(0, 40).trim();

  const downloadZip = async () => {
    setDownloading(true);
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      await Promise.all(conFoto.map(async m => {
        try {
          const res = await fetch(m.comprobanteUrl);
          if (!res.ok) return;
          const blob = await res.blob();
          const ext  = m.comprobanteUrl.endsWith('.pdf') ? 'pdf' : 'jpg';
          zip.file(`${m.fecha}_${sanitize(m.descripcion)}_${Math.round(m.monto)}.${ext}`, blob);
        } catch { /* omitir si falla */ }
      }));
      const content = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(content);
      a.download = `comprobantes_${mes}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setDownloading(false);
    }
  };

  // CSV para el contador. Separador ';' (Excel ARG lo abre directo).
  const downloadCSV = () => {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const cols = ['Fecha', 'Tipo', 'Proveedor/Cliente', 'Concepto', 'Monto', 'Obra', 'Caja', 'Comprobante'];
    const filas = conFoto
      .slice()
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
      .map(m => [
        m.fecha || '',
        m.tipo || '',
        m.proveedor || '',
        m.descripcion || '',
        Math.round(m.monto || 0),
        m.obraNombre || 'General',
        m.cajaNombre || m.cajaId || '',
        m.comprobanteUrl || '',
      ].map(esc).join(';'));
    const csv = '﻿' + [cols.join(';'), ...filas].join('\n'); // BOM para tildes en Excel
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `comprobantes_${mes}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Box style={{ marginTop: 14 }}>
      <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', flexWrap: 'wrap', gap: 8 }}
        onClick={() => setOpen(o => !o)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Comprobantes del mes</span>
          <span style={{ fontSize: 11, background: T.faint2, borderRadius: 10, padding: '1px 8px', color: T.ink2 }}>{conFoto.length}</span>
          <span style={{ fontSize: 11, color: T.warn, fontFamily: T.fontMono, fontWeight: 700 }}>gastos $ {fmtN(totalGastos)}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Btn sm onClick={e => { e.stopPropagation(); downloadCSV(); }}>↓ CSV contador</Btn>
          <Btn sm fill onClick={e => { e.stopPropagation(); downloadZip(); }} style={{ opacity: downloading ? 0.6 : 1, pointerEvents: downloading ? 'none' : 'auto' }}>
            {downloading ? 'Preparando...' : '↓ ZIP imágenes'}
          </Btn>
          <span style={{ color: T.ink3, fontSize: 11 }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${T.faint2}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(auto-fill, minmax(90px, 1fr))' : 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8, marginTop: 12 }}>
            {conFoto.map(m => (
              <a key={m.id} href={m.comprobanteUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: T.ink }}>
                <div style={{ border: `1.5px solid ${T.faint2}`, borderRadius: 6, overflow: 'hidden', background: T.paper }}>
                  {m.comprobanteUrl.endsWith('.pdf') ? (
                    <div style={{ height: 86, background: '#f5f0e8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>📄</div>
                  ) : (
                    <img src={m.comprobanteUrl} alt="" style={{ width: '100%', height: 86, objectFit: 'cover', display: 'block' }} />
                  )}
                  <div style={{ padding: '5px 7px' }}>
                    <div style={{ fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: T.ink }}>{m.descripcion}</div>
                    <div style={{ fontSize: 11, fontFamily: T.fontMono, fontWeight: 800, color: T.warn, marginTop: 1 }}>$ {fmtN(m.monto)}</div>
                    <div style={{ fontSize: 9, color: T.ink3, marginTop: 1 }}>{fmtFecha(m.fecha)} · {m.obraNombre || 'General'}</div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </Box>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function Movimientos() {
  const isMobile = useIsMobile();
  const { movimientos, cajas: allCajas, addMovimiento, removeMovimiento, traspasar } = useMovimientos();
  const { obras, getDetalle } = useObras();
  const { proveedores, quitarPagoDeFactura } = useProveedores();
  const { clientes }       = useClientes();
  const { dolarVenta }     = useDolar();
  const { currentUser }    = useUsuarios();
  const { solicitudes, addSolicitud } = useSolicitudes();
  const { cheques, removeCheque } = useCheques();
  const isAdmin = currentUser?.rol === 'Admin';
  // No-admin: ve SU caja (de la que es responsable) + las asignadas a mano (helper
  // unificado). Esto también limita el selector del modal de traspaso a sus cajas.
  const cajas = cajasDelUsuario(allCajas, currentUser);
  const pendingSolIds = useMemo(() =>
    new Set(solicitudes.filter(s => s.estado === 'pendiente').map(s => s.movimientoId)),
    [solicitudes]);
  const handleSolicitar = (movimiento, motivo) => {
    addSolicitud({
      tipo: 'eliminar_movimiento',
      movimientoId: movimiento.id,
      movimiento: { ...movimiento },
      solicitadoPor: { id: currentUser?.id, nombre: currentUser?.nombre, email: currentUser?.email },
      motivo,
    });
  };

  // Borrar un movimiento revierte también el cheque vinculado (si lo hay), para
  // que no quede un cheque colgado sin respaldo en caja, y el PAGO registrado en
  // la factura pendiente: la factura vuelve a deber ese monto (sin esto quedaba
  // 'pagada' con un movimientoId muerto — caso real en prod, pago de $405.336).
  const handleRemoveMov = (id) => {
    const chq = cheques.find(c => c.movimientoId === id);
    if (chq) removeCheque(chq.id);
    quitarPagoDeFactura(id);
    removeMovimiento(id);
  };

  const [searchParams] = useSearchParams();
  const [mes,        setMes]        = useState(currMes);
  const [filtroObra, setFiltroObra] = useState(() => searchParams.get('obra') || '');
  const [soloComprobante, setSoloComprobante] = useState(false);

  useEffect(() => {
    const o = searchParams.get('obra');
    if (o) setFiltroObra(o);
  }, [searchParams]);

  // tc para el saldo de obras finalizadas (mismo criterio que Obras/Dashboard).
  const tc = dolarVenta || 1070;
  const obrasOpciones = useMemo(() =>
    obras.filter(o => {
      // Estados "vivos": siempre disponibles (aunque estén saldados).
      if (['activa', 'en-presupuesto', 'pausada'].includes(o.estado)) return true;
      // Finalizada/archivada: solo si todavía tienen saldo por cobrar (>1 USD), para
      // poder registrar el cobro pendiente. Mismo helper canónico (ccObra) que Obras.
      // allCajas (NO `cajas`, que está filtrado por usuario) para no romper la
      // conversión a USD del cobrado de un no-admin.
      if (o.estado === 'finalizada' || o.estado === 'archivada') {
        return ccObra(o, getDetalle(o.id), movimientos, allCajas, tc).saldoUSD > 1;
      }
      return false;
    }),
    [obras, getDetalle, movimientos, allCajas, tc]);

  const cajaIdsMias = useMemo(() => cajas.map(c => c.id), [cajas]);
  const filtered = useMemo(() => {
    return movimientos
      .filter(m => {
        // Cobros de "cuenta corriente previa" (arrastre, sin caja): no son
        // movimientos de caja → no se listan acá ni cuentan en los totales.
        // Siguen alimentando la cuenta corriente de la obra (que lee el libro completo).
        if (m.ccPrevia) return false;
        if (!m.fecha.startsWith(mes)) return false;
        if (filtroObra && m.obraId !== filtroObra) return false;
        if (soloComprobante && !m.comprobanteUrl) return false;
        if (!isAdmin) {
          // No-admin: SOLO movimientos de SUS cajas (responsable + asignadas).
          // cajaIdsMias ya sale del helper unificado; si no tiene cajas → ninguna.
          if (!m.cajaId || !cajaIdsMias.includes(m.cajaId)) return false;
        }
        return true;
      })
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [movimientos, mes, filtroObra, soloComprobante, isAdmin, cajaIdsMias]);

  const ingresos   = useMemo(() => filtered.filter(m => m.tipo === 'ingreso'),  [filtered]);
  // Las notas de crédito de proveedor se listan junto a los gastos (son compra-
  // relacionadas), pero se muestran como crédito a favor y no suman al total de gastos.
  const gastos     = useMemo(() => filtered.filter(m => m.tipo === 'gasto' || m.tipo === 'nota_credito_compra'), [filtered]);
  const traspasos  = useMemo(() => filtered.filter(m => m.tipo === 'traspaso'), [filtered]);

  // MOV-02: consolidar en ARS (no sumar pesos + dólares como si fueran lo mismo).
  const totalIngresos = ingresos.reduce((s, m) => s + montoEnARS(m, cajas, dolarVenta || 1070), 0);
  const totalGastos   = gastos.reduce((s, m) => s + montoEnARS(m, cajas, dolarVenta || 1070), 0);
  const neto          = totalIngresos - totalGastos;

  const exportCSV = () => {
    // Escape CSV: envolver en "..." y duplicar comillas internas.
    // Prefijar con ' valores que arrancan con = @ + - (CSV injection en Excel).
    const csvCell = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=@+\-]/.test(s)) s = "'" + s;
      if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const rows = [['Fecha','Tipo','Descripcion','Monto','Obra','Caja','Medio']];
    filtered.forEach(m => {
      const c = cajas.find(c => c.id === m.cajaId);
      rows.push([m.fecha, m.tipo, m.descripcion, m.monto, m.obraNombre || '', c?.nombre || '', m.medioPago || '']);
    });
    const csv = rows.map(r => r.map(csvCell).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `movimientos_${mes}.csv`;
    a.click();
  };

  return (
    <PageLayout breadcrumb={['Movimientos']} active="Movimientos">
      <PageHero
        label="CAJA · INGRESOS Y EGRESOS"
        title="Movimientos"
        subtitle={mesLabel(mes)}
        actions={
          <>
            <select
              value={filtroObra}
              onChange={e => setFiltroObra(e.target.value)}
              style={{ padding: '5px 8px', border: `1.2px solid #3a3a3e`, borderRadius: 4, fontSize: 12, fontFamily: T.font, background: 'rgba(255,255,255,0.06)', color: '#fff', cursor: 'pointer', maxWidth: 180 }}
            >
              <option value="" style={{ color: T.ink }}>Todas las obras</option>
              {obras.map(o => <option key={o.id} value={o.id} style={{ color: T.ink }}>{o.nombre}</option>)}
            </select>
            <div style={{ display: 'flex', alignItems: 'center', border: `1px solid #3a3a3e`, borderRadius: 4, overflow: 'hidden' }}>
              <span onClick={() => setMes(m => navMes(m, -1))}
                style={{ padding: '5px 10px', cursor: 'pointer', fontSize: 14, color: '#fff', background: 'rgba(255,255,255,0.06)', userSelect: 'none', lineHeight: 1 }}>‹</span>
              <span style={{ padding: '5px 14px', fontFamily: T.fontMono, fontSize: 11, fontWeight: 700, minWidth: 110, textAlign: 'center', color: '#fff' }}>
                {mesLabel(mes)}
              </span>
              <span onClick={() => setMes(m => navMes(m, +1))}
                style={{ padding: '5px 10px', cursor: 'pointer', fontSize: 14, color: '#fff', background: 'rgba(255,255,255,0.06)', userSelect: 'none', lineHeight: 1 }}>›</span>
            </div>
            <span
              onClick={() => setSoloComprobante(v => !v)}
              title="Mostrar solo movimientos con comprobante adjunto"
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 4, border: `1px solid ${soloComprobante ? T.accent : '#3a3a3e'}`, background: soloComprobante ? T.accent : 'rgba(255,255,255,0.06)', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, userSelect: 'none' }}>
              📎 Con comprobante
            </span>
            <Btn sm onClick={exportCSV}>↗ CSV</Btn>
          </>
        }
        kpis={[
          { label: 'Ingresos del mes',  value: `$ ${fmtN(totalIngresos)}`,  sub: `${ingresos.length} registros`, color: T.ok },
          { label: 'Gastos del mes',    value: `$ ${fmtN(totalGastos)}`,    sub: `${gastos.length} registros`,    color: T.warn },
          { label: 'Neto',              value: `${neto >= 0 ? '+' : '−'}$ ${fmtN(neto)}`, sub: neto >= 0 ? 'superávit' : 'déficit', color: neto >= 0 ? T.ok : T.warn },
          { label: 'Total movimientos', value: String(ingresos.length + gastos.length),   sub: `${traspasos.length} traspasos`,    color: T.ink },
        ]}
      />

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
        <Panel
          tipo="ingreso"
          movs={ingresos}
          cajas={cajas}
          obras={obrasOpciones}
          proveedores={proveedores}
          clientes={clientes}
          dolarVenta={dolarVenta}
          total={totalIngresos}
          mes={mes}
          addMovimiento={addMovimiento}
          onRemove={handleRemoveMov}
          isAdmin={isAdmin}
          pendingSolIds={pendingSolIds}
          onSolicitar={handleSolicitar}
        />
        <Panel
          tipo="gasto"
          movs={gastos}
          cajas={cajas}
          obras={obrasOpciones}
          proveedores={proveedores}
          clientes={clientes}
          dolarVenta={dolarVenta}
          total={totalGastos}
          mes={mes}
          addMovimiento={addMovimiento}
          onRemove={handleRemoveMov}
          isAdmin={isAdmin}
          pendingSolIds={pendingSolIds}
          onSolicitar={handleSolicitar}
        />
      </div>

      <TraspasoPanel
        traspasos={traspasos}
        cajas={cajas}
        dolarVenta={dolarVenta}
        onSave={traspasar}
        onRemove={handleRemoveMov}
        mes={mes}
        isAdmin={isAdmin}
        pendingSolIds={pendingSolIds}
        onSolicitar={handleSolicitar}
      />

      <ComprobantesPanel movimientos={filtered} mes={mes} />

    </PageLayout>
  );
}
