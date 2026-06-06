import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn, Chip, Label } from '../components/ui';
import { T } from '../theme';
import { useProveedores, debeEntriesProveedor, pagosProveedorDesdeMovs, calcSaldoProveedorMov } from '../store/ProveedoresContext';
import { useMovimientos } from '../store/MovimientosContext';
import { useUsuarios } from '../store/UsuariosContext';
import { useIsMobile } from '../hooks/useMediaQuery';
import RegistrarPagoModal from './modales/RegistrarPagoModal';
import { facturasPendientesDeProveedor, saldoFacturaPendiente, estadoFacturaPendiente, totalPendiente } from '../lib/facturasPendientes';

const fmtN = (n) => Math.abs(Math.round(n)).toLocaleString('es-AR');
const fmtFecha = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
};

const TIPO_LABEL = { contrato: 'Contrato', pago: 'Pago', cert: 'Certif.', factura: 'Factura', facturaPend: 'Orden pago', adicional: 'Adicional', echeq: 'ECHEQ', fondo: 'Fondo rep.' };
const TIPO_COLOR = { contrato: T.ink, pago: T.ok, cert: T.ok, factura: T.warn, facturaPend: T.accent, adicional: T.warn, echeq: T.ink2, fondo: T.accent };

function Avatar({ nombre, size = 50 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: T.ink2, color: T.paper, fontFamily: `'Montserrat',sans-serif`, fontSize: size * 0.55, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, flexShrink: 0 }}>
      {(nombre || '?')[0].toUpperCase()}
    </div>
  );
}

export default function ProveedorCC() {
  const { currentUser } = useUsuarios();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const isAdmin = currentUser?.rol === 'Admin';
  // Guard: solo Admin (cuenta corriente expone deudas y pagos del proveedor).
  useEffect(() => {
    if (currentUser && !isAdmin) navigate('/', { replace: true });
  }, [currentUser, isAdmin, navigate]);

  const { id } = useParams();
  const { proveedores, getObrasProveedor, removeCC, ccEntries: ccRaw, facturasPendientes } = useProveedores();
  const { movimientos } = useMovimientos();
  const [pagoOpen, setPagoOpen] = useState(false);
  const [pagarFactura, setPagarFactura] = useState(null); // factura pendiente a saldar
  const [selectedObraId, setSelectedObraId] = useState(null);
  const [tab, setTab] = useState('cc');

  const proveedor = proveedores.find(p => p.id === id);

  // Facturas pendientes (cuentas por pagar) de este proveedor — TODAS (también las
  // ya saldadas, para historial) y solo las abiertas (para el saldo y los DEBE).
  const facturasProv      = useMemo(() => proveedor ? facturasPendientesDeProveedor(facturasPendientes, proveedor, { soloAbiertas: false }) : [], [facturasPendientes, proveedor]);
  const facturasAbiertas  = useMemo(() => facturasProv.filter(f => estadoFacturaPendiente(f) === 'pendiente' || estadoFacturaPendiente(f) === 'parcial'), [facturasProv]);
  const totalPendienteProv = useMemo(() => totalPendiente(facturasProv), [facturasProv]);

  const obras = useMemo(() => getObrasProveedor(id), [getObrasProveedor, id]);

  // CC DERIVADA (libro único): asientos DEBE de ccEntries (lo que debemos:
  // certificaciones, facturas, contratos) + DEBE de las facturas PENDIENTES de
  // pago (su monto total) + PAGOS de los movimientos (gastos a este proveedor).
  // Los pagos de una factura pendiente YA son movimientos → entran como haber
  // por la vía de pagosProveedorDesdeMovs; NO se duplican acá (la factura aporta
  // su monto bruto como debe, no su saldo). Los 'haber' de ccEntries quedan
  // vestigiales (los pagos ahora son movimientos).
  const buildEntries = (obraId) => {
    const debe = debeEntriesProveedor(id, ccRaw, obraId);
    // Cada factura pendiente abierta = un asiento DEBE por su monto bruto. Solo
    // las abiertas: una factura ya saldada no debe nada (su pago la canceló).
    const debeFacturas = facturasAbiertas
      .filter(f => !obraId || f.obraId === obraId)
      .map(f => ({
        id: `fp-${f.id}`, proveedorId: id, obraId: f.obraId || null, obraNombre: f.obraNombre || 'General',
        fecha: f.fecha, concepto: `Orden de pago ${f.numero || ''} ${f.tipoLetra ? `(${f.tipoLetra})` : ''}`.replace(/\s+/g, ' ').trim(),
        tipo: 'facturaPend', debe: Number(f.monto) || 0, haber: 0, _facturaId: f.id,
      }));
    const pagos = pagosProveedorDesdeMovs(proveedor, movimientos, obraId).map(m => ({
      id: m.id, proveedorId: id, obraId: m.obraId, obraNombre: m.obraNombre,
      fecha: m.fecha, concepto: m.descripcion || `Pago${m.medioPago ? ' · ' + m.medioPago : ''}`,
      tipo: 'pago', debe: 0, haber: m.monto || 0, _esMov: true,
    }));
    return [...debe, ...debeFacturas, ...pagos].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  };

  // Deuda BRUTA que aportan las facturas pendientes abiertas a una obra (null =
  // todas). Es la suma de su MONTO total (no del saldo): los pagos ya restan vía
  // movimientos (haber) en calcSaldoProveedorMov, así que sumar el saldo
  // descontaría el pago dos veces. El neto sale correcto: debe(monto) − pago(mov).
  const deudaFacturasObra = (obraId) => facturasAbiertas
    .filter(f => !obraId || f.obraId === obraId)
    .reduce((s, f) => s + (Number(f.monto) || 0), 0);

  const allEntries  = useMemo(() => buildEntries(null), [ccRaw, movimientos, id, proveedor, facturasAbiertas]); // eslint-disable-line react-hooks/exhaustive-deps
  // Saldo consolidado = (debe ccEntries − pagos movimientos) + monto de facturas
  // pendientes abiertas. Sus pagos ya están en los movimientos (haber).
  const saldoTotal  = useMemo(() => calcSaldoProveedorMov(proveedor, ccRaw, movimientos) + deudaFacturasObra(null), [proveedor, ccRaw, movimientos, facturasAbiertas]); // eslint-disable-line react-hooks/exhaustive-deps
  const saldoObra   = (obraId) => calcSaldoProveedorMov(proveedor, ccRaw, movimientos, obraId) + deudaFacturasObra(obraId);

  const selObraId = selectedObraId || obras[0]?.id || null;
  const ccEntries = useMemo(() => buildEntries(selObraId), [ccRaw, movimientos, id, selObraId, proveedor]); // eslint-disable-line react-hooks/exhaustive-deps

  const saldoSel = useMemo(() => {
    let acc = 0;
    return ccEntries.map(e => {
      acc += (e.debe || 0) - (e.haber || 0);
      return { ...e, saldoAcum: acc };
    });
  }, [ccEntries]);

  const totalDebe = allEntries.reduce((s, e) => s + (e.debe || 0), 0);
  const totalHaber = allEntries.reduce((s, e) => s + (e.haber || 0), 0);

  if (!proveedor) {
    return (
      <PageLayout breadcrumb={['Proveedores', '—']} active="Proveedores">
        <div style={{ padding: 40, textAlign: 'center', color: T.ink3 }}>Proveedor no encontrado.</div>
      </PageLayout>
    );
  }

  return (
    <PageLayout breadcrumb={[{ label: 'Proveedores', to: '/proveedores' }, proveedor.nombre]} active="Proveedores">
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'flex-start', justifyContent: 'space-between', gap: isMobile ? 10 : 0, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar nombre={proveedor.nombre} />
          <div>
            <div className="k-h" style={{ fontSize: 24 }}>{proveedor.nombre}</div>
            <div style={{ fontSize: 12, color: T.ink2, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {proveedor.cuit && <span>CUIT {proveedor.cuit}</span>}
              {proveedor.tipo && <span>· {proveedor.tipo}</span>}
              {proveedor.condicion && <span>· {proveedor.condicion}</span>}
              {proveedor.telefono && (
                <a href={`https://wa.me/${(proveedor.telefono).replace(/\s/g,'').replace('+','')}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ color: '#25d366', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>
                  📱 {proveedor.telefono}
                </a>
              )}
              {proveedor.email && (
                <a href={`mailto:${proveedor.email}`}
                  style={{ color: T.accent, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>
                  ✉ {proveedor.email}
                </a>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn sm onClick={() => navigate('/proveedores')}>← Volver</Btn>
          <Btn sm fill onClick={() => setPagoOpen(true)}>+ Registrar pago</Btn>
        </div>
      </div>

      {/* Summary bar — en mobile, grid 2 col envolvente (la fila de 5 paneles no entra). */}
      <div style={{ display: isMobile ? 'grid' : 'flex', gridTemplateColumns: isMobile ? '1fr 1fr' : undefined, gap: 0, background: saldoTotal > 0 ? '#fae6e0' : T.faint, borderRadius: 4, marginBottom: 12, overflow: 'hidden', border: `1px solid ${saldoTotal > 0 ? '#f0c5b8' : T.faint2}` }}>
        {[
          { label: 'Saldo consolidado', value: saldoTotal > 0 ? `$ ${fmtN(saldoTotal)}` : 'Al día', accent: saldoTotal > 0 },
          { label: `Debe (${obras.length} CC)`, value: `$ ${fmtN(totalDebe)}` },
          { label: 'Haber', value: `$ ${fmtN(totalHaber)}`, ok: true },
          { label: 'Por pagar', value: totalPendienteProv > 0 ? `$ ${fmtN(totalPendienteProv)}` : '—', accent: totalPendienteProv > 0 },
          { label: 'Obras activas', value: String(obras.length) },
        ].map((s, i) => (
          <div key={s.label} style={{ flex: isMobile ? undefined : 1, padding: '10px 14px', borderLeft: isMobile ? 'none' : (i ? `1px solid ${saldoTotal > 0 ? '#f0c5b8' : T.faint2}` : 'none'), borderTop: isMobile && i >= 2 ? `1px solid ${saldoTotal > 0 ? '#f0c5b8' : T.faint2}` : 'none', borderRight: isMobile && i % 2 === 0 ? `1px solid ${saldoTotal > 0 ? '#f0c5b8' : T.faint2}` : 'none' }}>
            <div style={{ fontSize: 9, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>{s.label}</div>
            <div style={{ fontWeight: 800, fontFamily: T.fontMono, fontSize: 16, color: s.accent ? T.accent : s.ok ? T.ok : T.ink }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="k-tabs" style={{ marginBottom: 12 }}>
        <span className={`k-tab${tab === 'cc' ? ' k-tab-on' : ''}`} onClick={() => setTab('cc')}>
          Cuentas corrientes · {obras.length}
        </span>
        <span className={`k-tab${tab === 'facturas' ? ' k-tab-on' : ''}`} onClick={() => setTab('facturas')}>
          Órdenes de pago{facturasAbiertas.length > 0 ? ` · ${facturasAbiertas.length}` : ''}
        </span>
        <span className={`k-tab${tab === 'datos' ? ' k-tab-on' : ''}`} onClick={() => setTab('datos')}>
          Datos del proveedor
        </span>
      </div>

      {tab === 'cc' && (
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 10, overflow: isMobile ? 'visible' : 'hidden', height: isMobile ? 'auto' : 'calc(100vh - 300px)' }}>
          {/* Left: CC by obra */}
          <div style={{ width: isMobile ? '100%' : 240, flexShrink: 0, overflow: isMobile ? 'visible' : 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Label style={{ marginBottom: 2 }}>Cuentas por obra</Label>
            {obras.length === 0 && (
              <div style={{ fontSize: 12, color: T.ink3, padding: '8px 0' }}>Sin obras registradas.</div>
            )}
            {obras.map(o => {
              const saldo = saldoObra(o.id);
              const entries = buildEntries(o.id);
              const debe = entries.reduce((s, e) => s + (e.debe || 0), 0);
              const haber = entries.reduce((s, e) => s + (e.haber || 0), 0);
              const isActive = selObraId === o.id;
              return (
                <Box key={o.id}
                  style={{ padding: 9, borderLeft: `3px solid ${saldo > 0 ? T.accent : T.ok}`, background: isActive ? (saldo > 0 ? '#fae6e0' : '#eaf4eb') : T.paper, cursor: 'pointer' }}
                  onClick={() => setSelectedObraId(o.id)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{o.nombre}</span>
                    <span style={{ fontFamily: T.fontMono, fontWeight: 700, fontSize: 12, color: saldo > 0 ? T.accent : T.ok }}>
                      {saldo > 0 ? `$ ${fmtN(saldo)}` : 'Saldado'}
                    </span>
                  </div>
                  {entries.length > 0 && (
                    <div style={{ fontSize: 10, color: T.ink2, marginTop: 3 }}>
                      Debe {`$ ${fmtN(debe)}`} · Haber {`$ ${fmtN(haber)}`}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 }}>
                    <div style={{ fontSize: 10, color: T.ink3 }}>{entries.length} movimiento{entries.length !== 1 ? 's' : ''}</div>
                    <span style={{ fontSize: 10, color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={e => { e.stopPropagation(); navigate(`/obras/${o.id}/presupuesto`); }}>
                      Ver obra →
                    </span>
                  </div>
                </Box>
              );
            })}
          </div>

          {/* Right: CC entries. En mobile, la tabla numérica (Debe/Haber/Saldo)
              scrollea en X dentro de su propio contenedor para preservar la
              alineación de columnas; afuera la página crece con normalidad. */}
          <Box style={{ flex: 1, padding: 0, overflow: isMobile ? 'visible' : 'hidden', display: 'flex', flexDirection: 'column' }}>
            {!selObraId ? (
              <div style={{ padding: 24, textAlign: 'center', color: T.ink3, fontSize: 12 }}>Sin obras con CC. Registrá un pago para crear una.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowX: isMobile ? 'auto' : 'visible', WebkitOverflowScrolling: 'touch' }}>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: isMobile ? 560 : 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}` }}>
                  <div className="k-h" style={{ fontSize: 16 }}>CC · {obras.find(o => o.id === selObraId)?.nombre || selObraId}</div>
                  <Chip style={{ fontSize: 10 }}>Saldo {saldoObra(selObraId) > 0 ? `$ ${fmtN(saldoObra(selObraId))}` : 'al día'}</Chip>
                  <span style={{ fontSize: 11, color: T.ink2, marginLeft: 'auto' }}>{ccEntries.length} movimiento{ccEntries.length !== 1 ? 's' : ''}</span>
                </div>

                {/* Table header */}
                <div style={{ display: 'flex', padding: '6px 12px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}`, fontSize: 10, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  <span style={{ flex: 0.8 }}>Fecha</span>
                  <span style={{ flex: 2.5 }}>Concepto</span>
                  <span style={{ flex: 0.8, textAlign: 'center' }}>Tipo</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>Debe</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>Haber</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>Saldo</span>
                  <span style={{ flex: 0.4 }}></span>
                </div>

                <div style={{ flex: 1, overflow: isMobile ? 'visible' : 'auto' }}>
                  {saldoSel.length === 0 && (
                    <div style={{ padding: 24, textAlign: 'center', color: T.ink3, fontSize: 12 }}>Sin movimientos en esta obra.</div>
                  )}
                  {saldoSel.map((e, i) => (
                    <div key={e.id} style={{ display: 'flex', padding: '8px 12px', borderBottom: `1px solid ${T.faint2}`, alignItems: 'center', fontSize: 12, background: i % 2 === 1 ? T.faint : 'transparent' }}>
                      <span style={{ flex: 0.8, fontFamily: T.fontMono, color: T.ink2, fontSize: 11 }}>{fmtFecha(e.fecha)}</span>
                      <span style={{ flex: 2.5 }}>{e.concepto}</span>
                      <span style={{ flex: 0.8, textAlign: 'center' }}>
                        <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 8, background: T.faint, color: TIPO_COLOR[e.tipo] || T.ink2, fontWeight: 700 }}>
                          {TIPO_LABEL[e.tipo] || e.tipo}
                        </span>
                      </span>
                      <span style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono, color: e.debe > 0 ? T.accent : T.ink3, fontWeight: e.debe > 0 ? 700 : 400 }}>
                        {e.debe > 0 ? `$ ${fmtN(e.debe)}` : '—'}
                      </span>
                      <span style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono, color: e.haber > 0 ? T.ok : T.ink3, fontWeight: e.haber > 0 ? 700 : 400 }}>
                        {e.haber > 0 ? `$ ${fmtN(e.haber)}` : '—'}
                      </span>
                      <span style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono, fontWeight: 800, color: e.saldoAcum > 0 ? T.accent : T.ok }}>
                        $ {fmtN(e.saldoAcum)}
                      </span>
                      <span style={{ flex: 0.4, textAlign: 'right' }}>
                        {e.tipo === 'facturaPend' ? (
                          <span style={{ color: T.accent, cursor: 'pointer', fontSize: 10, fontWeight: 700, padding: '0 4px' }}
                            onClick={() => { const f = facturasAbiertas.find(x => x.id === e._facturaId); if (f) setPagarFactura(f); }}>
                            Pagar
                          </span>
                        ) : e._esMov ? (
                          <span />
                        ) : (
                          <span style={{ color: T.accent, cursor: 'pointer', fontSize: 13, padding: '0 4px' }}
                            onClick={() => { if (confirm('¿Eliminar este movimiento?')) removeCC(e.id); }}>×</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Footer saldo */}
                {saldoSel.length > 0 && (
                  <div style={{ display: 'flex', padding: '7px 12px', background: T.faint, borderTop: `1.5px solid ${T.faint2}`, fontSize: 12, fontWeight: 800 }}>
                    <span style={{ flex: 4.1 }}>Saldo actual</span>
                    <span style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono, color: T.accent }}>$ {fmtN(totalDebe)}</span>
                    <span style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono, color: T.ok }}>$ {fmtN(totalHaber)}</span>
                    <span style={{ flex: 1.4, textAlign: 'right', fontFamily: T.fontMono, color: saldoObra(selObraId) > 0 ? T.accent : T.ok }}>
                      {saldoObra(selObraId) > 0 ? `$ ${fmtN(saldoObra(selObraId))}` : 'Al día'}
                    </span>
                  </div>
                )}
              </div>
              </div>
            )}
          </Box>
        </div>
      )}

      {tab === 'facturas' && (
        <Box style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}` }}>
            <div className="k-h" style={{ fontSize: 16 }}>Cuentas por pagar</div>
            <Chip style={{ fontSize: 10 }}>{facturasAbiertas.length} abierta{facturasAbiertas.length !== 1 ? 's' : ''}</Chip>
            {totalPendienteProv > 0 && (
              <span style={{ fontSize: 12, color: T.accent, fontWeight: 700, fontFamily: T.fontMono, marginLeft: 'auto' }}>
                Total pendiente $ {fmtN(totalPendienteProv)}
              </span>
            )}
          </div>

          {/* Tabla numérica de órdenes de pago: en mobile scrollea en X con
              min-width para preservar la alineación de Total/Saldo. */}
          <div style={{ overflowX: isMobile ? 'auto' : 'visible', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ minWidth: isMobile ? 620 : 'auto' }}>
          <div style={{ display: 'flex', padding: '6px 12px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}`, fontSize: 10, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <span style={{ flex: 0.8 }}>Fecha</span>
            <span style={{ flex: 1.2 }}>N° / Tipo</span>
            <span style={{ flex: 1.6 }}>Concepto / Obra</span>
            <span style={{ flex: 1, textAlign: 'right' }}>Total</span>
            <span style={{ flex: 1, textAlign: 'right' }}>Saldo</span>
            <span style={{ flex: 0.8, textAlign: 'center' }}>Estado</span>
            <span style={{ flex: 0.7, textAlign: 'right' }}></span>
          </div>

          {facturasProv.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: T.ink3, fontSize: 12 }}>Sin facturas pendientes para este proveedor.</div>
          )}
          {[...facturasProv].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).map((f, i) => {
            const saldo = saldoFacturaPendiente(f);
            const estado = estadoFacturaPendiente(f);
            const estCfg = {
              pendiente: { label: 'Pendiente', color: T.accent }, parcial: { label: 'Parcial', color: T.warn },
              pagada: { label: 'Pagada', color: T.ok }, anulada: { label: 'Anulada', color: T.ink3 },
            }[estado] || { label: estado, color: T.ink2 };
            const abierta = estado === 'pendiente' || estado === 'parcial';
            return (
              <div key={f.id} style={{ display: 'flex', padding: '8px 12px', borderBottom: `1px solid ${T.faint2}`, alignItems: 'center', fontSize: 12, background: i % 2 === 1 ? T.faint : 'transparent' }}>
                <span style={{ flex: 0.8, fontFamily: T.fontMono, color: T.ink2, fontSize: 11 }}>{fmtFecha(f.fecha)}</span>
                <span style={{ flex: 1.2 }}>
                  <span style={{ fontWeight: 700 }}>{f.numero || 's/n'}</span>
                  {f.tipoLetra && <span style={{ fontSize: 10, color: T.ink2, marginLeft: 4 }}>({f.tipoLetra})</span>}
                </span>
                <span style={{ flex: 1.6, color: T.ink2 }}>
                  {f.concepto || '—'}{f.obraNombre && f.obraNombre !== 'General' ? ` · ${f.obraNombre}` : ''}
                </span>
                <span style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono }}>$ {fmtN(f.monto || 0)}</span>
                <span style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono, fontWeight: 800, color: saldo > 0 ? T.accent : T.ok }}>
                  {saldo > 0 ? `$ ${fmtN(saldo)}` : '—'}
                </span>
                <span style={{ flex: 0.8, textAlign: 'center' }}>
                  <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 8, background: T.faint, color: estCfg.color, fontWeight: 700 }}>{estCfg.label}</span>
                </span>
                <span style={{ flex: 0.7, textAlign: 'right' }}>
                  {abierta && isAdmin && (
                    <span style={{ color: T.accent, cursor: 'pointer', fontSize: 10, fontWeight: 700, padding: '0 4px' }}
                      onClick={() => setPagarFactura(f)}>Pagar</span>
                  )}
                </span>
              </div>
            );
          })}
          </div>
          </div>
        </Box>
      )}

      {tab === 'datos' && (
        <Box style={{ padding: 16, maxWidth: 480 }}>
          <Label style={{ marginBottom: 10 }}>Datos del proveedor</Label>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10, fontSize: 12 }}>
            {[
              ['Nombre / Razón social', proveedor.nombre],
              ['Tipo de trabajo', proveedor.tipo || '—'],
              ['CUIT', proveedor.cuit || '—'],
              ['Condición AFIP', proveedor.condicion || '—'],
            ].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 2 }}>{k}</div>
                <div style={{ fontWeight: 600 }}>{v}</div>
              </div>
            ))}
            <div>
              <div style={{ fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 2 }}>Teléfono</div>
              {proveedor.telefono
                ? <a href={`https://wa.me/${(proveedor.telefono).replace(/\s/g,'').replace('+','')}`} target="_blank" rel="noopener noreferrer" style={{ color: '#25d366', fontWeight: 600, textDecoration: 'none' }}>📱 {proveedor.telefono}</a>
                : <span style={{ fontWeight: 600 }}>—</span>}
            </div>
            <div>
              <div style={{ fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 2 }}>Email</div>
              {proveedor.email
                ? <a href={`mailto:${proveedor.email}`} style={{ color: T.accent, fontWeight: 600, textDecoration: 'none' }}>✉ {proveedor.email}</a>
                : <span style={{ fontWeight: 600 }}>—</span>}
            </div>
          </div>
          {proveedor.notas && (
            <div style={{ marginTop: 12, fontSize: 12, color: T.ink2, borderTop: `1px solid ${T.faint2}`, paddingTop: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Notas</div>
              {proveedor.notas}
            </div>
          )}
        </Box>
      )}

      {pagoOpen && (
        <RegistrarPagoModal
          proveedor={proveedor.nombre}
          proveedorId={id}
          onClose={() => setPagoOpen(false)} />
      )}
      {pagarFactura && (
        <RegistrarPagoModal
          proveedor={proveedor.nombre}
          proveedorId={id}
          facturaPendiente={pagarFactura}
          onClose={() => setPagarFactura(null)} />
      )}
    </PageLayout>
  );
}
