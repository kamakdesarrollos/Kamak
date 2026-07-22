import { useState } from 'react';
import { Btn } from '../../components/ui';
import { T } from '../../theme';
import { useProveedores } from '../../store/ProveedoresContext';
import { saldoFacturaPendiente } from '../../lib/facturasPendientes';
import { crearPagoCredito } from '../../lib/proveedorCC';
import { ejecutarAplicarCredito, rpcSupabase } from '../../lib/pagoAtomico';

const inputSt = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };
const fmtN = (n) => Math.round(Math.abs(n || 0)).toLocaleString('es-AR');

// Consume CRÉDITO A FAVOR del proveedor contra una factura/orden de pago.
// No mueve caja: agrega un pago {tipo:'credito'} a la factura (RPC transaccional
// aplicar_credito_factura, con fallback al patch por ítem). El caso del dueño:
// "me quedó saldo a favor y el próximo pedido lo retiro sin pagar".
export default function AplicarCreditoModal({ factura, credito, onClose }) {
  const { registrarPagoFacturaAsync } = useProveedores();
  const saldo = saldoFacturaPendiente(factura);
  const maxAplicable = Math.min(saldo, credito);
  const [monto, setMonto] = useState(String(maxAplicable));
  const [guardando, setGuardando] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const montoNum = Math.round(parseFloat(monto.replace(/[^0-9.]/g, '')) || 0);

  const confirmar = async () => {
    if (guardando) return;
    setErrorMsg('');
    let pago;
    try {
      pago = crearPagoCredito({ factura, credito, monto: montoNum, fecha: new Date().toISOString().split('T')[0] });
    } catch (e) {
      setErrorMsg(e.message);
      return;
    }
    setGuardando(true);
    const res = await ejecutarAplicarCredito(
      { facturaId: factura.id, pago },
      { rpc: rpcSupabase, registrarPagoFacturaAsync }
    );
    if (!res.ok) {
      setGuardando(false);
      setErrorMsg(res.error);
      return;
    }
    onClose();
  };

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 400 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: T.font, fontWeight: 800, fontSize: 17 }}>Aplicar crédito a favor</div>
            <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>
              {factura.proveedor || 'Proveedor'} · Factura {factura.numero || 's/n'}
            </div>
          </div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ background: '#eaf4eb', border: `1px solid ${T.ok}55`, borderRadius: 4, padding: '8px 10px', fontSize: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span>Crédito disponible</span>
              <b style={{ fontFamily: T.fontMono, color: T.ok }}>$ {fmtN(credito)}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Saldo de la factura</span>
              <b style={{ fontFamily: T.fontMono }}>$ {fmtN(saldo)}</b>
            </div>
          </div>

          <div>
            <label style={labelSt}>Monto a aplicar $</label>
            <input style={{ ...inputSt, fontFamily: T.fontMono, fontWeight: 700, fontSize: 14 }}
              type="number" min="0" max={maxAplicable}
              value={monto} onChange={e => setMonto(e.target.value)} />
            <div style={{ fontSize: 10.5, marginTop: 4, color: T.ink2 }}>
              No mueve plata de ninguna caja: descuenta del crédito a favor y baja el saldo de la factura.
            </div>
          </div>

          {errorMsg && (
            <div style={{ fontSize: 11, color: '#dc2626', background: '#fde8e8', border: '1px solid #dc262655', borderRadius: 4, padding: '7px 10px' }}>
              {errorMsg}
            </div>
          )}
        </div>

        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill onClick={confirmar} style={{ opacity: montoNum > 0 && !guardando ? 1 : 0.5 }}>
            {guardando ? 'Aplicando…' : 'Aplicar crédito'}
          </Btn>
        </div>
      </div>
    </div>
  );
}
