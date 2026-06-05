import { useState, useMemo } from 'react';
import { Btn, Divider } from '../../components/ui';
import { T } from '../../theme';
import { useMovimientos } from '../../store/MovimientosContext';
import { useObras } from '../../store/ObrasContext';
import { useConfiguracion } from '../../store/ConfiguracionContext';
import { useProveedores } from '../../store/ProveedoresContext';
import { facturasPendientesDeProveedor, saldoFacturaPendiente } from '../../lib/facturasPendientes';

const inputSt = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };
const fmtN = (n) => Math.round(n).toLocaleString('es-AR');
const fmtFecha = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; };

const DEFAULT_MEDIOS = ['Transferencia', 'Cheque', 'E-cheq', 'Efectivo', 'Tarjeta'];

// `facturaPendiente` (opcional): si viene, el modal salda esa factura puntual
// (preselecciona proveedor + sugiere monto = saldo). Si NO viene pero hay un
// proveedor seleccionado, se ofrece vincular el pago a una de sus facturas
// pendientes (o dejarlo "sin vincular", comportamiento histórico).
export default function RegistrarPagoModal({ proveedor = '', proveedorId = null, facturaPendiente = null, onClose }) {
  const { cajas, addMovimiento } = useMovimientos();
  const { obras } = useObras();
  const { config } = useConfiguracion();
  const { proveedores, facturasPendientes, registrarPagoFactura } = useProveedores();
  const mediosDePago = config?.mediosDePago?.length ? config.mediosDePago : DEFAULT_MEDIOS;

  const obrasActivas = obras.filter(o => o.estado === 'activa' || o.estado === 'en-presupuesto');
  const cajasARS = cajas.filter(c => c.moneda === 'ARS' && c.activa);

  // Proveedor efectivo: el de la factura a saldar (si vino) tiene prioridad.
  const provNombre = facturaPendiente?.proveedor || proveedor;
  const provId     = facturaPendiente?.proveedorId || proveedorId || null;
  // Proveedor resuelto (para listar sus facturas abiertas). Por id, sino por nombre.
  const provObj = useMemo(() => {
    if (provId) return proveedores.find(p => p.id === provId) || (provNombre ? { id: provId, nombre: provNombre } : null);
    if (provNombre) return proveedores.find(p => p.nombre === provNombre) || { id: null, nombre: provNombre };
    return null;
  }, [proveedores, provId, provNombre]);

  // Facturas pendientes (abiertas) del proveedor para el selector de vínculo.
  const facturasDelProv = useMemo(
    () => provObj ? facturasPendientesDeProveedor(facturasPendientes, provObj) : [],
    [facturasPendientes, provObj]
  );

  const today = new Date().toISOString().split('T')[0];
  // Factura vinculada: si vino por prop, fija; sino el usuario la elige ('' = sin vincular).
  const [facturaVincId, setFacturaVincId] = useState(facturaPendiente?.id || '');
  const facturaVinc = facturaPendiente || facturasDelProv.find(f => f.id === facturaVincId) || null;
  const saldoVinc = facturaVinc ? saldoFacturaPendiente(facturaVinc) : 0;

  const [monto, setMonto] = useState(facturaPendiente ? String(saldoFacturaPendiente(facturaPendiente)) : '');
  const [fecha, setFecha] = useState(today);
  // Si la factura está imputada a una obra, arrancamos imputando a esa obra (sino
  // 'general'); si no hay factura, el default histórico es 'obra'.
  const [imputar, setImputar] = useState(facturaPendiente ? (facturaPendiente.obraId ? 'obra' : 'general') : 'obra');
  const [obraId, setObraId] = useState(facturaPendiente?.obraId || obrasActivas[0]?.id || '');
  const [cajaId, setCajaId] = useState(cajasARS[0]?.id || '');
  const [medio, setMedio] = useState('Transferencia');
  const [referencia, setReferencia] = useState(facturaPendiente?.numero || '');
  const [fondoReparo] = useState(false); // retención fondo de reparo: aún no implementada (ver checkbox deshabilitado)
  const [concepto, setConcepto] = useState('');

  const obraNombre = obras.find(o => o.id === obraId)?.nombre || '';
  const cajaNombre = cajas.find(c => c.id === cajaId)?.nombre || '';
  const montoNum = Math.round(parseFloat(monto.replace(/[^0-9.]/g, '')) || 0);
  // Pago parcial: el monto cubre menos que el saldo de la factura vinculada.
  const esParcial = facturaVinc && montoNum > 0 && montoNum < saldoVinc;

  // Al elegir una factura del selector, sugerimos su saldo como monto (si el
  // usuario no tocó el campo o estaba en otra factura). Mantiene UX simple.
  const onPickFactura = (id) => {
    setFacturaVincId(id);
    const f = facturasDelProv.find(x => x.id === id);
    if (f) {
      setMonto(String(saldoFacturaPendiente(f)));
      if (f.obraId) { setImputar('obra'); setObraId(f.obraId); }
      if (f.numero && !referencia) setReferencia(f.numero);
    }
  };

  const confirmar = () => {
    if (!montoNum || montoNum <= 0) return;

    const concFinal = concepto.trim()
      || (facturaVinc ? `Pago factura ${facturaVinc.numero || ''} · ${provNombre}`.trim().replace(/ · $/, '')
                      : `Pago a ${provNombre}${obraNombre ? ` · ${obraNombre}` : ''}`);

    // Libro único: el pago al proveedor queda SOLO como movimiento de gasto.
    // La cuenta corriente del proveedor (lo pagado) se DERIVA de los movimientos
    // (por proveedorId o nombre), así que no escribimos un asiento 'haber' en
    // ccEntries (sería duplicar el pago). Los 'debe' (deuda) sí viven en ccEntries.
    // Si hay factura vinculada, el movimiento NO lleva comprobanteRecibido (el
    // dato fiscal ya vive en la factura pendiente → no se duplica el IVA) y se
    // marca con facturaPendienteId para trazar el pago.
    const movId = addMovimiento({
      fecha,
      tipo: 'gasto',
      descripcion: concFinal,
      monto: montoNum,
      obraId: imputar === 'obra' ? obraId : null,
      obraNombre: imputar === 'obra' ? obraNombre : 'General',
      cajaId,
      cajaDestinoId: null,
      proveedor: provNombre,
      proveedorId: provId,
      facturaPendienteId: facturaVinc ? facturaVinc.id : undefined,
      categoria: 'subcontrato',
      medioPago: medio,
      referencia,
      fondoReparo,
    });

    // Registra el pago contra la factura pendiente (recalcula estado/saldo).
    if (facturaVinc) {
      registrarPagoFactura(facturaVinc.id, { movimientoId: movId, monto: montoNum, fecha, cajaId });
    }

    onClose();
  };

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 440 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: T.font, fontWeight: 800, fontSize: 17 }}>{facturaPendiente ? 'Saldar factura' : 'Registrar pago'}</div>
            <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>
              {provNombre || 'Proveedor'}
              {facturaPendiente && facturaPendiente.numero ? ` · Factura ${facturaPendiente.numero}` : ''}
            </div>
          </div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Vincular a factura pendiente. Si vino por prop, queda fija (solo se
              muestra el resumen). Sino, selector con las facturas abiertas del
              proveedor (o "sin vincular" = pago suelto, comportamiento histórico). */}
          {facturaPendiente ? (
            <div style={{ background: T.accentSoft, border: `1px solid ${T.accent}55`, borderRadius: 4, padding: '8px 10px', fontSize: 11 }}>
              <div style={{ fontWeight: 700, color: T.accent, marginBottom: 2 }}>
                Saldando factura {facturaPendiente.numero || ''} {facturaPendiente.tipoLetra ? `(${facturaPendiente.tipoLetra})` : ''}
              </div>
              <div style={{ color: T.ink2, fontFamily: T.fontMono }}>
                Total $ {fmtN(facturaPendiente.monto || 0)} · Saldo $ {fmtN(saldoVinc)}
              </div>
            </div>
          ) : facturasDelProv.length > 0 && (
            <div>
              <label style={labelSt}>Vincular a factura pendiente</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={facturaVincId} onChange={e => onPickFactura(e.target.value)}>
                <option value="">— Sin vincular (pago suelto) —</option>
                {facturasDelProv.map(f => (
                  <option key={f.id} value={f.id}>
                    {fmtFecha(f.fecha)} · {f.numero || 's/n'} · saldo $ {fmtN(saldoFacturaPendiente(f))}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label style={labelSt}>Fecha</label>
            <input type="date" style={inputSt} value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>

          <div>
            <label style={labelSt}>Monto $</label>
            <input style={{ ...inputSt, fontFamily: T.fontMono, fontWeight: 700, fontSize: 14 }}
              type="number" min="0" placeholder="0"
              value={monto} onChange={e => setMonto(e.target.value)} />
            {facturaVinc && montoNum > 0 && (
              <div style={{ fontSize: 10.5, marginTop: 4, color: esParcial ? '#b45309' : T.ok }}>
                {esParcial
                  ? `Pago parcial: quedan $ ${fmtN(saldoVinc - montoNum)} de saldo en la factura.`
                  : montoNum >= saldoVinc ? 'Cubre el saldo completo de la factura.' : ''}
              </div>
            )}
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

          {/* La retención del fondo de reparo todavía NO está implementada: el pago
              se registra completo. Se deshabilita para no hacer creer que retiene el
              5% (antes guardaba fondoReparo:true pero descontaba el 100%). */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'not-allowed', padding: '7px 10px', background: T.faint, borderRadius: 4, opacity: 0.55 }}>
            <input type="checkbox" checked={false} disabled style={{ accentColor: T.accent }} />
            <div>
              <div style={{ fontWeight: 700 }}>Aplicar retención fondo de reparo (5%) <span style={{ fontWeight: 400, color: T.ink3 }}>· próximamente</span></div>
              <div style={{ fontSize: 10, color: T.ink2 }}>Aún no retiene: el pago se registra completo</div>
            </div>
          </label>

          <div>
            <label style={labelSt}>Concepto / nota</label>
            <input style={inputSt} value={concepto} onChange={e => setConcepto(e.target.value)} placeholder={`Pago a ${provNombre}${obraNombre ? ` · ${obraNombre}` : ''}`} />
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
