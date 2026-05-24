import { useState } from 'react';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn } from '../components/ui';
import { T } from '../theme';
import { useWhatsappPending } from '../store/WhatsappPendingContext';
import { useMovimientos } from '../store/MovimientosContext';
import { useObras } from '../store/ObrasContext';
import { useProveedores } from '../store/ProveedoresContext';

const inputSt  = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt  = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };
const fmtN     = (n) => n != null ? Math.round(n).toLocaleString('es-AR') : '—';
const fmtFecha = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

// ── Modal revisión de FACTURA ─────────────────────────────────────────────────
function FacturaModal({ item, onConfirm, onClose }) {
  const { cajas, addMovimiento } = useMovimientos();
  const { obras }                = useObras();
  const { proveedores }          = useProveedores();

  const cajasARS   = cajas.filter(c => c.activa && c.moneda === 'ARS');
  const obrasActivas = obras.filter(o => o.estado === 'activa' || o.estado === 'en-presupuesto');

  const [proveedor,  setProveedor]  = useState(item.proveedor  || '');
  const [monto,      setMonto]      = useState(item.montoTotal != null ? String(item.montoTotal) : item.monto != null ? String(item.monto) : '');
  const [fecha,      setFecha]      = useState(item.fecha      || new Date().toISOString().split('T')[0]);
  const [concepto,   setConcepto]   = useState(item.concepto   || '');
  const [obraId,     setObraId]     = useState('');
  const [cajaId,     setCajaId]     = useState(cajasARS[0]?.id || '');

  const montoNum = Math.round(parseFloat(monto.replace(/[^0-9.]/g, '')) || 0);
  const canSave  = montoNum > 0 && proveedor.trim() && cajaId;

  const guardar = () => {
    if (!canSave) return;
    const obra    = obrasActivas.find(o => o.id === obraId);
    const cajaNom = cajas.find(c => c.id === cajaId)?.nombre || '';
    addMovimiento({
      tipo:           'gasto',
      descripcion:    concepto.trim() || `Factura ${item.tipoFactura || ''} ${item.numeroFactura || ''} · ${proveedor}`.trim(),
      monto:          montoNum,
      fecha,
      obraId:         obraId || null,
      obraNombre:     obra?.nombre || 'General',
      cajaId,
      cajaDestinoId:  null,
      proveedor:      proveedor.trim(),
      categoria:      'factura-proveedor',
      medioPago:      'Transferencia',
      referencia:     item.numeroFactura || '',
      comprobante:    'blanco',
      comprobanteUrl: item.mediaUrl || null,
      fondoReparo:    false,
    });
    onConfirm();
  };

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 500 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: '#25803a', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, fontFamily: T.font }}>Confirmar factura</div>
            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>Revisá los datos antes de guardar el gasto</div>
          </div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>

        <div style={{ padding: '10px 18px', background: T.faint, borderBottom: `1px solid ${T.faint2}`, fontSize: 11, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {item.tipoFactura && <span><b>Factura {item.tipoFactura}</b> {item.numeroFactura}</span>}
          {item.cuit        && <span>CUIT: {item.cuit}</span>}
          {item.fecha       && <span>Emitida: {fmtFecha(item.fecha)}</span>}
          {item.monto != null && item.montoTotal != null && item.monto !== item.montoTotal && (
            <span style={{ color: T.ink3 }}>Neto: $ {fmtN(item.monto)} · IVA incluido: $ {fmtN(item.montoTotal)}</span>
          )}
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={labelSt}>Proveedor *</label>
            <input list="prov-list" style={inputSt} value={proveedor} onChange={e => setProveedor(e.target.value)} autoFocus />
            <datalist id="prov-list">
              {proveedores.map(p => <option key={p.id} value={p.nombre} />)}
            </datalist>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>Monto total $ *</label>
              <input style={{ ...inputSt, fontFamily: T.fontMono, fontWeight: 700 }}
                type="number" min="0" value={monto} onChange={e => setMonto(e.target.value)} />
            </div>
            <div>
              <label style={labelSt}>Fecha</label>
              <input type="date" style={inputSt} value={fecha} onChange={e => setFecha(e.target.value)} />
            </div>
          </div>

          <div>
            <label style={labelSt}>Concepto</label>
            <input style={inputSt} value={concepto} onChange={e => setConcepto(e.target.value)}
              placeholder={`Factura ${item.tipoFactura || ''} · ${proveedor || 'proveedor'}`} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>Obra (opcional)</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={obraId} onChange={e => setObraId(e.target.value)}>
                <option value="">— General —</option>
                {obrasActivas.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelSt}>Caja de egreso *</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={cajaId} onChange={e => setCajaId(e.target.value)}>
                {cajasARS.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill onClick={guardar}
            style={{ background: canSave ? '#25803a' : T.faint2, color: canSave ? '#fff' : T.ink3, opacity: 1 }}>
            Guardar como gasto
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── Tarjeta de FACTURA pendiente ──────────────────────────────────────────────
function FacturaPendiente({ item, onReview, onReject }) {
  return (
    <Box style={{ padding: '12px 16px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      {item.mediaUrl && item.mediaType !== 'pdf' ? (
        <a href={item.mediaUrl} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
          <img src={item.mediaUrl} alt="factura" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, border: `1.5px solid ${T.faint2}`, display: 'block' }} />
        </a>
      ) : (
        <a href={item.mediaUrl || undefined} target="_blank" rel="noreferrer"
          style={{ width: 60, height: 60, borderRadius: 6, background: '#e8f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0, textDecoration: 'none' }}>
          {item.mediaUrl ? '📄' : (item.mediaType === 'image' ? '🖼' : '📄')}
        </a>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{item.proveedor || 'Proveedor no detectado'}</div>
            {item.cuit && <div style={{ fontSize: 10, color: T.ink3 }}>CUIT {item.cuit}</div>}
          </div>
          {item.montoTotal != null && (
            <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 15, color: T.warn, flexShrink: 0 }}>
              $ {fmtN(item.montoTotal)}
            </div>
          )}
        </div>

        <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: T.ink2 }}>
          {item.tipoFactura   && <span style={{ background: T.faint2, borderRadius: 3, padding: '1px 6px', fontWeight: 700 }}>Factura {item.tipoFactura}</span>}
          {item.numeroFactura && <span>{item.numeroFactura}</span>}
          {item.fecha         && <span>{fmtFecha(item.fecha)}</span>}
          {item.concepto      && <span style={{ color: T.ink3 }}>{item.concepto}</span>}
        </div>

        <div style={{ marginTop: 4, fontSize: 10, color: T.ink3 }}>
          Recibido de +{item.from} · {new Date(item.receivedAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
        <Btn sm fill onClick={onReview} style={{ background: '#25803a', fontSize: 11 }}>Confirmar</Btn>
        <Btn sm onClick={onReject} style={{ fontSize: 11, color: T.ink3 }}>Descartar</Btn>
      </div>
    </Box>
  );
}

// ── Tarjeta de MOVIMIENTO pendiente ───────────────────────────────────────────
function MovimientoPendiente({ item, onApprove, onReject }) {
  const m = item.movimiento || {};
  const esGasto = m.tipo === 'gasto';
  return (
    <Box style={{ padding: '12px 16px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <div style={{ width: 36, height: 36, borderRadius: 6, background: esGasto ? '#fff0e8' : '#e8f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
        {esGasto ? '💸' : '💰'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{m.descripcion || '—'}</div>
            <div style={{ fontSize: 11, color: T.ink2, marginTop: 2 }}>
              {item.creadoPor} · {m.obraNombre || 'General'}
            </div>
          </div>
          <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 15, color: esGasto ? T.warn : T.ok, flexShrink: 0 }}>
            {esGasto ? '−' : '+'}$ {fmtN(m.monto)}
          </div>
        </div>

        <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: T.ink2 }}>
          <span style={{ background: esGasto ? '#fff0e8' : '#e8f4f0', borderRadius: 3, padding: '1px 6px', fontWeight: 700, color: esGasto ? T.warn : T.ok, textTransform: 'capitalize' }}>
            {m.tipo}
          </span>
          {m.categoria && <span>{m.categoria}</span>}
          {m.proveedor && <span>{m.proveedor}</span>}
          {m.fecha     && <span>{fmtFecha(m.fecha)}</span>}
          <span style={{ padding: '1px 6px', borderRadius: 3, background: m.comprobante === 'blanco' ? '#e8f4f0' : '#f5f0e0', color: m.comprobante === 'blanco' ? T.ok : T.ink3, fontWeight: 600 }}>
            {m.comprobante === 'blanco' ? '✓ Con factura' : 'Sin factura'}
          </span>
        </div>

        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: T.ink3 }}>
          <span>Enviado desde WhatsApp · {new Date(item.receivedAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
          {m.comprobanteUrl && (
            <a href={m.comprobanteUrl} target="_blank" rel="noreferrer"
              style={{ color: '#25803a', fontWeight: 700, textDecoration: 'none', background: '#e8f4f0', borderRadius: 3, padding: '1px 6px' }}>
              {m.comprobanteUrl.endsWith('.pdf') ? '📄 Ver PDF' : '🖼 Ver foto'}
            </a>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
        <Btn sm fill onClick={onApprove} style={{ background: '#25803a', fontSize: 11 }}>Aprobar</Btn>
        <Btn sm onClick={onReject} style={{ fontSize: 11, color: T.ink3 }}>Rechazar</Btn>
      </div>
    </Box>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function WhatsappBuzon() {
  const { pending, reload, rejectItem, confirmItem } = useWhatsappPending();
  const { addMovimiento } = useMovimientos();
  const [review, setReview] = useState(null);

  const facturas    = pending.filter(p => p.tipoPendiente !== 'movimiento');
  const movimientos = pending.filter(p => p.tipoPendiente === 'movimiento');

  const handleRejectFactura = (id) => {
    if (window.confirm('¿Descartás esta factura? No se guardará como gasto.')) rejectItem(id);
  };

  const handleApproveMovimiento = (item) => {
    const m = item.movimiento;
    if (!m) return;
    addMovimiento({
      tipo:           m.tipo,
      descripcion:    m.descripcion,
      monto:          m.monto,
      fecha:          m.fecha,
      obraId:         m.obraId || null,
      obraNombre:     m.obraNombre || 'General',
      cajaId:         m.cajaId,
      cajaDestinoId:  null,
      proveedor:      m.proveedor || '',
      categoria:      m.categoria || 'general',
      medioPago:      m.medioPago || 'Transferencia',
      comprobante:    m.comprobante || 'negro',
      comprobanteUrl: m.comprobanteUrl || null,
      fondoReparo:    false,
    });
    confirmItem(item.id);
  };

  const handleRejectMovimiento = (id) => {
    if (window.confirm('¿Rechazás este movimiento? No se guardará.')) rejectItem(id);
  };

  const totalPendientes = pending.length;

  return (
    <PageLayout breadcrumb={['WhatsApp']} active="WhatsApp">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <div>
          <div className="k-h" style={{ fontSize: 28 }}>Buzón WhatsApp</div>
          <div style={{ fontSize: 12, color: T.ink2 }}>
            {totalPendientes > 0
              ? `${totalPendientes} elemento${totalPendientes > 1 ? 's' : ''} pendiente${totalPendientes > 1 ? 's' : ''} de aprobación`
              : 'Sin elementos pendientes'}
          </div>
        </div>
        <Btn sm onClick={reload}>↺ Actualizar</Btn>
      </div>

      {totalPendientes === 0 ? (
        <Box style={{ padding: '48px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
          <div style={{ fontWeight: 700, color: T.ink, marginBottom: 4 }}>Sin elementos pendientes</div>
          <div style={{ fontSize: 12, color: T.ink3 }}>
            Los gastos, ingresos y facturas enviados por WhatsApp aparecerán acá para aprobación.
          </div>
        </Box>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {movimientos.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: T.ink2, marginBottom: 8 }}>
                Movimientos registrados por el equipo ({movimientos.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {movimientos.map(item => (
                  <MovimientoPendiente
                    key={item.id}
                    item={item}
                    onApprove={() => handleApproveMovimiento(item)}
                    onReject={() => handleRejectMovimiento(item.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {facturas.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: T.ink2, marginBottom: 8 }}>
                Facturas recibidas ({facturas.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {facturas.map(item => (
                  <FacturaPendiente
                    key={item.id}
                    item={item}
                    onReview={() => setReview(item)}
                    onReject={() => handleRejectFactura(item.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {review && (
        <FacturaModal
          item={review}
          onConfirm={() => { confirmItem(review.id); setReview(null); }}
          onClose={() => setReview(null)}
        />
      )}
    </PageLayout>
  );
}
