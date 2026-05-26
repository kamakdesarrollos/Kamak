import { useState } from 'react';
import { Btn } from '../../components/ui';
import { T } from '../../theme';
import { useMovimientos } from '../../store/MovimientosContext';
import { useObras } from '../../store/ObrasContext';
import { useProveedores } from '../../store/ProveedoresContext';

// Modal de revisión y aprobación de una factura recibida por WhatsApp.
// Extraido del antiguo WhatsappBuzon.jsx — la logica es la misma.
//
// El bot manda una propuesta (proveedor, monto, fecha, etc. detectados de
// la foto/PDF). El admin revisa, ajusta si hace falta, y confirma:
// se crea el movimiento gasto y se marca el item como confirmado.

const inputSt  = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt  = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };
const fmtN     = (n) => n != null ? Math.round(n).toLocaleString('es-AR') : '—';
const fmtFecha = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const newAdicId = () => `adic-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;

export default function AprobarFacturaModal({ item, onConfirm, onClose }) {
  const { cajas, addMovimiento } = useMovimientos();
  const { obras, patchDetalle }  = useObras();
  const { proveedores }          = useProveedores();

  const cajasARS   = cajas.filter(c => c.activa && c.moneda === 'ARS');
  const obrasActivas = obras.filter(o => o.estado === 'activa' || o.estado === 'en-presupuesto');

  const [proveedor,  setProveedor]  = useState(() => {
    if (item.proveedor) return item.proveedor;
    if (item.cuit) {
      const clean = (item.cuit || '').replace(/[-\s]/g, '');
      const match = proveedores.find(p => (p.cuit || '').replace(/[-\s]/g, '') === clean);
      if (match) return match.nombre;
    }
    return '';
  });
  const [monto,      setMonto]      = useState(item.montoTotal != null ? String(item.montoTotal) : item.monto != null ? String(item.monto) : '');
  const [fecha,      setFecha]      = useState(item.fecha      || new Date().toISOString().split('T')[0]);
  const [concepto,   setConcepto]   = useState(item.concepto   || '');
  const [obraId,      setObraId]     = useState('');
  const [cajaId,      setCajaId]     = useState(cajasARS[0]?.id || '');
  const [esAdicional, setEsAdicional] = useState(false);

  const montoNum = Math.round(parseFloat(String(monto).replace(/[^0-9.]/g, '')) || 0);
  const canSave  = montoNum > 0 && proveedor.trim() && cajaId;

  const guardar = () => {
    if (!canSave) return;
    const obra    = obrasActivas.find(o => o.id === obraId);
    const descripcion = concepto.trim() || `Factura ${item.tipoFactura || ''} ${item.numeroFactura || ''} · ${proveedor}`.trim();
    addMovimiento({
      tipo:           'gasto',
      descripcion,
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
    if (esAdicional && obraId) {
      patchDetalle(obraId, d => ({
        ...d,
        adicionales: [...(d.adicionales || []), {
          id: newAdicId(),
          descripcion,
          tarea: '', cantidad: null, unidad: '',
          costoUnit: null, costoTotal: montoNum,
          valorVentaUnit: null, valorVentaTotal: null,
          montoProveedor: montoNum, cantidadProveedor: null, costoUnitProveedor: null,
          aplicadoAContrato: false,
          monto: montoNum, fecha, estado: 'pendiente',
          aplicaACliente: true, aplicaAProveedor: false,
        }],
      }));
    }
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

          {obraId && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer', color: T.ink2, userSelect: 'none', marginTop: 2 }}>
              <input type="checkbox" checked={esAdicional} onChange={e => setEsAdicional(e.target.checked)} />
              Registrar también como <b style={{ color: T.accent }}>adicional pendiente</b> de {obrasActivas.find(o => o.id === obraId)?.nombre || 'la obra'}
            </label>
          )}
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
