import { useState } from 'react';
import { Btn, Divider } from '../../components/ui';
import { T } from '../../theme';
import { useMovimientos } from '../../store/MovimientosContext';
import { useObras } from '../../store/ObrasContext';
import { useConfiguracion } from '../../store/ConfiguracionContext';

const inputSt = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };
const fmtN = (n) => Math.round(n).toLocaleString('es-AR');

const DEFAULT_MEDIOS = ['Transferencia', 'Cheque', 'E-cheq', 'Efectivo', 'Tarjeta'];

export default function RegistrarPagoModal({ proveedor = '', proveedorId = null, onClose }) {
  const { cajas, addMovimiento } = useMovimientos();
  const { obras } = useObras();
  const { config } = useConfiguracion();
  const mediosDePago = config?.mediosDePago?.length ? config.mediosDePago : DEFAULT_MEDIOS;

  const obrasActivas = obras.filter(o => o.estado === 'activa' || o.estado === 'en-presupuesto');
  const cajasARS = cajas.filter(c => c.moneda === 'ARS' && c.activa);

  const today = new Date().toISOString().split('T')[0];
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(today);
  const [imputar, setImputar] = useState('obra');
  const [obraId, setObraId] = useState(obrasActivas[0]?.id || '');
  const [cajaId, setCajaId] = useState(cajasARS[0]?.id || '');
  const [medio, setMedio] = useState('Transferencia');
  const [referencia, setReferencia] = useState('');
  const [fondoReparo, setFondoReparo] = useState(false);
  const [concepto, setConcepto] = useState('');

  const obraNombre = obras.find(o => o.id === obraId)?.nombre || '';
  const cajaNombre = cajas.find(c => c.id === cajaId)?.nombre || '';
  const montoNum = Math.round(parseFloat(monto.replace(/[^0-9.]/g, '')) || 0);

  const confirmar = () => {
    if (!montoNum || montoNum <= 0) return;

    const concFinal = concepto.trim() || `Pago a ${proveedor}${obraNombre ? ` · ${obraNombre}` : ''}`;

    // Libro único: el pago al proveedor queda SOLO como movimiento de gasto.
    // La cuenta corriente del proveedor (lo pagado) se DERIVA de los movimientos
    // (por proveedorId o nombre), así que no escribimos un asiento 'haber' en
    // ccEntries (sería duplicar el pago). Los 'debe' (deuda) sí viven en ccEntries.
    addMovimiento({
      fecha,
      tipo: 'gasto',
      descripcion: concFinal,
      monto: montoNum,
      obraId: imputar === 'obra' ? obraId : null,
      obraNombre: imputar === 'obra' ? obraNombre : 'General',
      cajaId,
      cajaDestinoId: null,
      proveedor,
      proveedorId: proveedorId || null,
      categoria: 'subcontrato',
      medioPago: medio,
      referencia,
      fondoReparo,
    });

    onClose();
  };

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 440 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: T.font, fontWeight: 800, fontSize: 17 }}>Registrar pago</div>
            <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>{proveedor || 'Proveedor'}</div>
          </div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={labelSt}>Fecha</label>
            <input type="date" style={inputSt} value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>

          <div>
            <label style={labelSt}>Monto $</label>
            <input style={{ ...inputSt, fontFamily: T.fontMono, fontWeight: 700, fontSize: 14 }}
              type="number" min="0" placeholder="0"
              value={monto} onChange={e => setMonto(e.target.value)} />
          </div>

          <Divider />

          <div>
            <label style={labelSt}>Imputar a</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
              {[
                { key: 'obra', label: 'Obra específica', sub: obraNombre || 'Seleccioná una obra abajo' },
                { key: 'general', label: 'Sin imputar (cuenta general)', sub: '' },
              ].map(opt => (
                <label key={opt.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer', padding: '7px 10px', borderRadius: 4, border: `1.5px solid ${imputar === opt.key ? T.accent : T.faint2}`, background: imputar === opt.key ? T.accentSoft : 'transparent' }}>
                  <input type="radio" name="imputar" checked={imputar === opt.key} onChange={() => setImputar(opt.key)} style={{ accentColor: T.accent, marginTop: 2 }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{opt.label}</div>
                    {opt.sub && <div style={{ fontSize: 10, color: T.ink2 }}>{opt.sub}</div>}
                  </div>
                </label>
              ))}
            </div>
          </div>

          {imputar === 'obra' && (
            <div>
              <label style={labelSt}>Obra</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={obraId} onChange={e => setObraId(e.target.value)}>
                {obrasActivas.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                {obrasActivas.length === 0 && <option value="">Sin obras activas</option>}
              </select>
            </div>
          )}

          <div>
            <label style={labelSt}>Caja / cuenta origen</label>
            <select style={{ ...inputSt, cursor: 'pointer' }} value={cajaId} onChange={e => setCajaId(e.target.value)}>
              {cajasARS.map(c => (
                <option key={c.id} value={c.id}>{c.nombre} · $ {fmtN(c.saldo)}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelSt}>Medio de pago</label>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {mediosDePago.map(m => (
                <span key={m} onClick={() => setMedio(m)}
                  style={{ fontSize: 11, padding: '4px 10px', borderRadius: 12, border: `1.5px solid ${medio === m ? T.accent : T.faint2}`, background: medio === m ? T.accentSoft : 'transparent', cursor: 'pointer', fontWeight: medio === m ? 700 : 400 }}>
                  {m}
                </span>
              ))}
            </div>
          </div>

          <div>
            <label style={labelSt}>N° referencia / comprobante</label>
            <input style={inputSt} value={referencia} onChange={e => setReferencia(e.target.value)} placeholder="Ej: TRF-20260502-00412" />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', padding: '7px 10px', background: T.faint, borderRadius: 4 }}>
            <input type="checkbox" checked={fondoReparo} onChange={e => setFondoReparo(e.target.checked)} style={{ accentColor: T.accent }} />
            <div>
              <div style={{ fontWeight: 700 }}>Aplicar retención fondo de reparo (5%)</div>
              <div style={{ fontSize: 10, color: T.ink2 }}>Retenido hasta recepción definitiva</div>
            </div>
          </label>

          <div>
            <label style={labelSt}>Concepto / nota</label>
            <input style={inputSt} value={concepto} onChange={e => setConcepto(e.target.value)} placeholder={`Pago a ${proveedor}${obraNombre ? ` · ${obraNombre}` : ''}`} />
          </div>
        </div>

        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          {montoNum > 0 && (
            <span style={{ fontSize: 12, color: T.ink2 }}>
              Deducir <b style={{ fontFamily: T.fontMono }}>$ {fmtN(montoNum)}</b> de {cajaNombre}
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Btn sm onClick={onClose}>Cancelar</Btn>
            <Btn sm fill onClick={confirmar} style={{ opacity: montoNum > 0 ? 1 : 0.5 }}>Registrar pago</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
