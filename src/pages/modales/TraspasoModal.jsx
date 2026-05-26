import { useState, useMemo } from 'react';
import { Btn, Divider } from '../../components/ui';
import { T } from '../../theme';
import { useMovimientos } from '../../store/MovimientosContext';
import { useDolar } from '../../store/DolarContext';

const inputSt = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };
const fmtN = (n) => Math.round(Math.abs(n)).toLocaleString('es-AR');

export default function TraspasoModal({ onClose }) {
  const { cajas, traspasar } = useMovimientos();
  const { dolarVenta } = useDolar();

  const cajasActivas = cajas.filter(c => c.activa);
  const today = new Date().toISOString().split('T')[0];

  const [origenId, setOrigenId] = useState(cajasActivas[0]?.id || '');
  const [destinoId, setDestinoId] = useState(cajasActivas[1]?.id || '');
  const [monto, setMonto] = useState('');
  const [tcAplicado, setTcAplicado] = useState(String(Math.round(dolarVenta)));
  const [fecha, setFecha] = useState(today);
  const [concepto, setConcepto] = useState('');

  const origen = cajas.find(c => c.id === origenId);
  const destino = cajas.find(c => c.id === destinoId);
  const montoNum = Math.round(parseFloat(monto.replace(/[^0-9.]/g, '')) || 0);

  const isCross = origen && destino && origen.moneda !== destino.moneda;
  const tc = parseFloat(tcAplicado) || dolarVenta;

  const montoDestino = useMemo(() => {
    if (!isCross || !montoNum) return null;
    if (origen.moneda === 'ARS' && destino.moneda === 'USD') return montoNum / tc;
    if (origen.moneda === 'USD' && destino.moneda === 'ARS') return montoNum * tc;
    return montoNum;
  }, [isCross, montoNum, origen, destino, tc]);

  const saldoPostOrigen = origen ? (origen.saldo || 0) - montoNum : 0;

  const confirmar = () => {
    if (!montoNum || montoNum <= 0 || !origenId || !destinoId || origenId === destinoId) return;
    traspasar({
      cajaOrigenId: origenId,
      cajaDestinoId: destinoId,
      monto: montoNum,
      // Si las cajas son de distinta moneda, mandamos el monto convertido.
      montoDestino: isCross && montoDestino != null ? Math.round(montoDestino) : null,
      fecha,
      concepto: concepto.trim() || `Traspaso: ${origen?.nombre} → ${destino?.nombre}`,
      tcAplicado: isCross ? tc : null,
    });
    onClose();
  };

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: T.font, fontWeight: 800, fontSize: 17 }}>Traspaso entre cajas</div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelSt}>Caja origen</label>
            <select style={{ ...inputSt, cursor: 'pointer' }} value={origenId} onChange={e => setOrigenId(e.target.value)}>
              {cajasActivas.map(c => (
                <option key={c.id} value={c.id}>{c.nombre} · {c.moneda === 'USD' ? 'U$S' : '$'} {fmtN(c.saldo)}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={labelSt}>Monto</label>
              <input style={{ ...inputSt, fontFamily: T.fontMono, fontWeight: 700 }}
                type="number" min="0" placeholder="0"
                value={monto} onChange={e => setMonto(e.target.value)} />
            </div>
            <div style={{ paddingBottom: 6, fontSize: 18, color: T.accent }}>→</div>
            <div style={{ width: 70 }}>
              <label style={labelSt}>Moneda</label>
              <div style={{ ...inputSt, background: T.faint, color: T.ink2, fontWeight: 700 }}>{origen?.moneda || '—'}</div>
            </div>
          </div>

          <div>
            <label style={labelSt}>Caja destino</label>
            <select style={{ ...inputSt, cursor: 'pointer' }} value={destinoId} onChange={e => setDestinoId(e.target.value)}>
              {cajasActivas.filter(c => c.id !== origenId).map(c => (
                <option key={c.id} value={c.id}>{c.nombre} · {c.moneda === 'USD' ? 'U$S' : '$'} {fmtN(c.saldo)}</option>
              ))}
            </select>
          </div>

          {isCross && (
            <div style={{ background: '#f6efd9', border: `1.5px solid ${T.warn}`, borderRadius: 4, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.warn, marginBottom: 8 }}>Traspaso entre monedas ({origen?.moneda} → {destino?.moneda})</div>
              <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 9, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>TC BNA hoy</div>
                  <div style={{ fontWeight: 800, fontFamily: T.fontMono }}>$ {fmtN(dolarVenta)}</div>
                </div>
                {montoDestino != null && (
                  <div>
                    <div style={{ fontSize: 9, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Monto equiv. {destino?.moneda}</div>
                    <div style={{ fontWeight: 800, fontFamily: T.fontMono, color: T.accent }}>
                      {destino?.moneda === 'USD' ? 'U$S' : '$'} {fmtN(montoDestino)}
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label style={labelSt}>TC aplicado</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input style={{ ...inputSt, width: 90, fontFamily: T.fontMono, fontWeight: 700 }}
                    type="number" min="1" value={tcAplicado}
                    onChange={e => setTcAplicado(e.target.value)} />
                  <span style={{ fontSize: 11, color: T.ink2 }}>ARS/USD · Podés sobreescribirlo</span>
                </div>
              </div>
            </div>
          )}

          <Divider />

          <div>
            <label style={labelSt}>Fecha</label>
            <input type="date" style={inputSt} value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>

          <div>
            <label style={labelSt}>Concepto</label>
            <input style={inputSt} value={concepto} onChange={e => setConcepto(e.target.value)} placeholder="Ej: Fondos para compras semana 20" />
          </div>

          <div style={{ background: T.faint, borderRadius: 4, padding: '8px 12px', fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: T.ink2 }}>Saldo actual origen</span>
              <span style={{ fontFamily: T.fontMono, fontWeight: 700 }}>
                {origen?.moneda === 'USD' ? 'U$S' : '$'} {fmtN(origen?.saldo || 0)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: T.ink2 }}>Saldo actual destino</span>
              <span style={{ fontFamily: T.fontMono, fontWeight: 700 }}>
                {destino?.moneda === 'USD' ? 'U$S' : '$'} {fmtN(destino?.saldo || 0)}
              </span>
            </div>
            {montoNum > 0 && (
              <>
                <div style={{ height: 1, background: T.faint2, margin: '6px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: T.ink2 }}>Saldo origen post-traspaso</span>
                  <span style={{ fontFamily: T.fontMono, fontWeight: 700, color: saldoPostOrigen < 0 ? T.accent : T.ok }}>
                    {origen?.moneda === 'USD' ? 'U$S' : '$'} {fmtN(saldoPostOrigen)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill onClick={confirmar}
            style={{ opacity: (montoNum > 0 && origenId !== destinoId) ? 1 : 0.5 }}>
            Confirmar traspaso
          </Btn>
        </div>
      </div>
    </div>
  );
}
