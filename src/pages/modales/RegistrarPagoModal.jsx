import { useState, useMemo } from 'react';
import { Btn, Divider } from '../../components/ui';
import { T } from '../../theme';
import { useMovimientos } from '../../store/MovimientosContext';
import { useObras } from '../../store/ObrasContext';
import { useConfiguracion } from '../../store/ConfiguracionContext';
import { useProveedores } from '../../store/ProveedoresContext';
import { facturasPendientesDeProveedor, saldoFacturaPendiente } from '../../lib/facturasPendientes';
import { validarPagoFactura } from '../../lib/proveedorCC';
import { ejecutarPagoFactura, rpcSupabase } from '../../lib/pagoAtomico';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { uploadFoto } from '../../lib/upload';

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
  const isMobile = useIsMobile();
  const { cajas, addMovimientoAsync, removeMovimiento } = useMovimientos();
  const { obras } = useObras();
  const { config } = useConfiguracion();
  const { proveedores, facturasPendientes, registrarPagoFacturaAsync } = useProveedores();
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
  // Comprobante del PAGO (transferencia / echeq / recibo). Se sube a Storage y
  // queda en el movimiento (comprobanteUrl, visible en Movimientos) y en el pago
  // de la factura (para verlo desde Órdenes de pago). Distinto del comprobante
  // fiscal de la factura (comprobanteRecibido) → no afecta el Libro IVA.
  const [file, setFile] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  // Pago suelto (sin factura): ¿gasto directo (impuestos, sin deuda registrada)
  // o ANTICIPO a cuenta (queda como crédito a favor en la CC del proveedor)?
  const [tipoPagoSuelto, setTipoPagoSuelto] = useState('directo');
  // Sobrepago: registrar el excedente como anticipo (nunca se "traga" plata).
  const [excedenteComoAnticipo, setExcedenteComoAnticipo] = useState(true);

  const obraNombre = obras.find(o => o.id === obraId)?.nombre || '';
  const cajaNombre = cajas.find(c => c.id === cajaId)?.nombre || '';
  const montoNum = Math.round(parseFloat(monto.replace(/[^0-9.]/g, '')) || 0);
  // Pago parcial: el monto cubre menos que el saldo de la factura vinculada.
  const esParcial = facturaVinc && montoNum > 0 && montoNum < saldoVinc;
  // Guard de sobrepago (fix: antes el excedente desaparecía — el saldo clampea en 0).
  const validacion = facturaVinc && montoNum > 0 ? validarPagoFactura(facturaVinc, montoNum) : null;
  const excedente = validacion?.excedente || 0;
  // Comprobante OBLIGATORIO: no se registra el pago sin adjuntar el PDF/foto.
  const puedeConfirmar = montoNum > 0 && !!file && !subiendo && !guardando &&
    (!facturaVinc || validacion?.ok || (excedente > 0 && excedenteComoAnticipo));

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

  const confirmar = async () => {
    if (!puedeConfirmar) return;
    setGuardando(true);
    setErrorMsg('');

    // Comprobante OBLIGATORIO del pago. Si la subida falla, NO se registra el pago
    // (antes era best-effort: se guardaba sin doc). Sin comprobante no hay pago.
    if (!file) { setGuardando(false); setErrorMsg('Adjuntá el comprobante del pago para continuar.'); return; }
    let comprobanteUrl;
    setSubiendo(true);
    try {
      comprobanteUrl = await uploadFoto(file, 'pagos');
    } catch (err) {
      console.error('[RegistrarPago] subir comprobante:', err);
      setSubiendo(false);
      setGuardando(false);
      setErrorMsg('No se pudo subir el comprobante: ' + (err?.message || 'error') + '. El pago no se registró.');
      return;
    }
    setSubiendo(false);

    const concFinal = concepto.trim()
      || (facturaVinc ? `Pago factura ${facturaVinc.numero || ''} · ${provNombre}`.trim().replace(/ · $/, '')
                      : `${tipoPagoSuelto === 'anticipo' ? 'Anticipo a cuenta' : 'Pago'} · ${provNombre}${obraNombre ? ` · ${obraNombre}` : ''}`);

    // Libro único: el pago al proveedor queda SOLO como movimiento de gasto; la
    // CC del proveedor se DERIVA (facturas por saldo + anticipos − aplicaciones,
    // ver lib/proveedorCC). Si hay factura vinculada, el movimiento se marca con
    // facturaPendienteId y NO lleva comprobanteRecibido (el dato fiscal vive en
    // la factura → no se duplica el IVA).
    const baseMov = {
      fecha,
      tipo: 'gasto',
      obraId: imputar === 'obra' ? obraId : null,
      obraNombre: imputar === 'obra' ? obraNombre : 'General',
      cajaId,
      cajaDestinoId: null,
      proveedor: provNombre,
      proveedorId: provId,
      categoria: 'subcontrato',
      medioPago: medio,
      referencia,
      fondoReparo,
      comprobanteUrl,
    };

    const efectores = { rpc: rpcSupabase, addMovimientoAsync, registrarPagoFacturaAsync, removeMovimiento };

    // Sobrepago sobre factura vinculada: el pago cubre el saldo y el EXCEDENTE
    // queda como anticipo a cuenta (crédito a favor) — nunca se pierde plata.
    const montoFactura = facturaVinc ? Math.min(montoNum, saldoVinc) : montoNum;
    const montoExcedente = facturaVinc ? montoNum - montoFactura : 0;

    const res = await ejecutarPagoFactura({
      movData: {
        ...baseMov,
        descripcion: concFinal,
        monto: montoFactura,
        facturaPendienteId: facturaVinc ? facturaVinc.id : undefined,
        anticipo: !facturaVinc && tipoPagoSuelto === 'anticipo' ? true : undefined,
      },
      facturaId: facturaVinc ? facturaVinc.id : null,
      pago: facturaVinc ? { monto: montoFactura, fecha, cajaId, comprobanteUrl } : null,
    }, efectores);

    if (!res.ok) {
      setGuardando(false);
      setErrorMsg(res.error || 'No se pudo registrar el pago.');
      return;
    }

    if (montoExcedente > 0 && excedenteComoAnticipo) {
      const resAnticipo = await ejecutarPagoFactura({
        movData: {
          ...baseMov,
          descripcion: `Anticipo a cuenta (excedente de pago) · ${provNombre}`,
          monto: montoExcedente,
          anticipo: true,
        },
      }, efectores);
      if (!resAnticipo.ok) {
        // El pago principal ya quedó bien; el anticipo se puede recargar a mano.
        setGuardando(false);
        setErrorMsg(`El pago se registró, pero el anticipo del excedente ($ ${fmtN(montoExcedente)}) falló: ${resAnticipo.error} Cargalo de nuevo como pago suelto tipo anticipo.`);
        return;
      }
    }

    onClose();
  };

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: isMobile ? '100%' : 440 }} onClick={e => e.stopPropagation()}>
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
            {facturaVinc && montoNum > 0 && excedente === 0 && (
              <div style={{ fontSize: 10.5, marginTop: 4, color: esParcial ? '#b45309' : T.ok }}>
                {esParcial
                  ? `Pago parcial: quedan $ ${fmtN(saldoVinc - montoNum)} de saldo en la factura.`
                  : montoNum >= saldoVinc ? 'Cubre el saldo completo de la factura.' : ''}
              </div>
            )}
            {/* Sobrepago: antes el excedente se "tragaba" (el saldo clampea en 0).
                Ahora se registra como ANTICIPO a cuenta → crédito a favor en la CC. */}
            {facturaVinc && excedente > 0 && (
              <div style={{ fontSize: 10.5, marginTop: 6, padding: '8px 10px', background: '#fff3e0', border: '1px solid #d4923a55', borderRadius: 4 }}>
                <div style={{ color: '#b45309', fontWeight: 700, marginBottom: 4 }}>
                  El pago excede el saldo de la factura en $ {fmtN(excedente)}.
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                  <input type="checkbox" checked={excedenteComoAnticipo}
                    onChange={e => setExcedenteComoAnticipo(e.target.checked)} style={{ accentColor: T.accent }} />
                  <span>Registrar el excedente como <b>anticipo a cuenta</b> (queda a favor en la CC de {provNombre || 'el proveedor'})</span>
                </label>
                {!excedenteComoAnticipo && (
                  <div style={{ color: '#b45309', marginTop: 4 }}>Destildado no se puede confirmar: bajá el monto al saldo (${fmtN(saldoVinc)}) o dejá el excedente como anticipo.</div>
                )}
              </div>
            )}
          </div>

          {/* Pago suelto: ¿gasto directo o anticipo a cuenta? (solo con proveedor) */}
          {!facturaVinc && provNombre && (
            <div>
              <label style={labelSt}>Tipo de pago</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                {[
                  { key: 'directo', label: 'Gasto directo (sin deuda registrada)', sub: 'Impuestos, servicios, compras sin factura cargada. No toca la cuenta corriente.' },
                  { key: 'anticipo', label: 'Anticipo a cuenta (queda a favor)', sub: `Deja crédito a favor en la CC de ${provNombre}: el próximo pedido se descuenta de ahí.` },
                ].map(opt => (
                  <label key={opt.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer', padding: '7px 10px', borderRadius: 4, border: `1.5px solid ${tipoPagoSuelto === opt.key ? T.accent : T.faint2}`, background: tipoPagoSuelto === opt.key ? T.accentSoft : 'transparent' }}>
                    <input type="radio" name="tipoPagoSuelto" checked={tipoPagoSuelto === opt.key} onChange={() => setTipoPagoSuelto(opt.key)} style={{ accentColor: T.accent, marginTop: 2 }} />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{opt.label}</div>
                      <div style={{ fontSize: 10, color: T.ink2 }}>{opt.sub}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

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

          <div>
            <label style={labelSt}>Comprobante del pago (PDF / foto) *</label>
            <input type="file" accept="image/*,application/pdf" capture={isMobile ? 'environment' : undefined}
              style={{ ...inputSt, padding: '5px 8px' }}
              onChange={e => setFile(e.target.files?.[0] || null)} />
            {file
              ? <div style={{ fontSize: 10, color: T.ink3, marginTop: 3 }}>{file.name}</div>
              : <div style={{ fontSize: 10, color: T.warn, marginTop: 3, fontWeight: 700 }}>Obligatorio: adjuntá el comprobante para registrar el pago.</div>}
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

        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {errorMsg && (
            <div style={{ fontSize: 11, color: '#dc2626', background: '#fde8e8', border: '1px solid #dc262655', borderRadius: 4, padding: '7px 10px' }}>
              {errorMsg}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            {montoNum > 0 && (
              <span style={{ fontSize: 12, color: T.ink2 }}>
                Deducir <b style={{ fontFamily: T.fontMono }}>$ {fmtN(montoNum)}</b> de {cajaNombre}
              </span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <Btn sm onClick={onClose}>Cancelar</Btn>
              <Btn sm fill onClick={confirmar} style={{ opacity: puedeConfirmar ? 1 : 0.5 }}>
                {subiendo ? 'Subiendo…' : guardando ? 'Guardando…' : 'Registrar pago'}
              </Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
