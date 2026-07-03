import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import PageHero from '../components/ui/PageHero';
import { Box, Btn } from '../components/ui';
import { T } from '../theme';
import { useProveedores } from '../store/ProveedoresContext';
import { useMovimientos } from '../store/MovimientosContext';
import { useDolar } from '../store/DolarContext';
import { useUsuarios } from '../store/UsuariosContext';
import { useIsMobile } from '../hooks/useMediaQuery';
import { saldoFacturaPendiente, estadoFacturaPendiente, totalPendiente } from '../lib/facturasPendientes';
import { creditoDisponibleProveedor } from '../lib/proveedorCC';
import RegistrarPagoModal from './modales/RegistrarPagoModal';
import FacturaPendienteModal from './modales/FacturaPendienteModal';
import AplicarCreditoModal from './modales/AplicarCreditoModal';

// Cuentas por pagar: facturas de proveedor cargadas (devengadas para Libro IVA)
// que todavía no se pagaron del todo. El pago se registra desde acá vía
// RegistrarPagoModal (crea el movimiento de caja + linkea con registrarPagoFactura).

const fmtN = (n) => Math.round(Math.abs(n || 0)).toLocaleString('es-AR');
const fmtFecha = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

const ESTADO_CHIP = {
  pendiente:  { label: 'Pendiente',  bg: '#fff3e0', color: '#d4923a' },
  parcial:    { label: 'Parcial',    bg: '#e0f0ff', color: '#0066cc' },
  pagada:     { label: 'Pagada',     bg: '#e8f4e8', color: '#3d7a4a' },
  anulada:    { label: 'Anulada',    bg: T.faint2,  color: T.ink3 },
  // Solo fiscal: cuenta para el Libro IVA pero no es deuda ni movió caja.
  registrada: { label: 'Registrada', bg: '#eef0ff', color: '#4f5bd5' },
};

function EstadoChip({ estado, mobile }) {
  const c = ESTADO_CHIP[estado] || ESTADO_CHIP.pendiente;
  return (
    <span style={{
      fontSize: mobile ? 9 : 10,
      padding: '2px 7px',
      borderRadius: 3,
      background: c.bg,
      color: c.color,
      fontWeight: 700,
      whiteSpace: mobile ? 'normal' : 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      display: 'inline-block',
      maxWidth: '100%',
    }}>
      {c.label}
    </span>
  );
}

export default function CuentasPorPagar() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { currentUser } = useUsuarios();
  // Admin y Administración gestionan TODAS las órdenes (ven todas, pagan, ven el
  // CBU/alias para transferir). Jefe de obra y Logística pueden CARGAR órdenes y
  // ven SOLO las que subieron ellos — no ven datos bancarios ni pagan.
  const esAdmin  = currentUser?.rol === 'Admin' || currentUser?.rol === 'Administración';
  const puedeVer = esAdmin || currentUser?.rol === 'Jefe de obra' || currentUser?.rol === 'Logística y compras';
  const miId = currentUser?.id, miEmail = currentUser?.email;
  const esPropia = (f) => (!!miId && f.createdBy === miId) || (!!miEmail && f.createdBy === miEmail);
  useEffect(() => {
    if (currentUser && !puedeVer) navigate('/', { replace: true });
  }, [currentUser, puedeVer, navigate]);

  const { proveedores, facturasPendientes, updateFacturaPendiente } = useProveedores();
  const { movimientos, cajas } = useMovimientos();
  const { dolarVenta } = useDolar();

  const [filtroProv, setFiltroProv]   = useState('todos');
  const [filtroEstado, setFiltroEstado] = useState('abiertas');
  const [modalAlta, setModalAlta]     = useState(false);
  const [pagoFactura, setPagoFactura] = useState(null); // factura a saldar
  const [creditoFactura, setCreditoFactura] = useState(null); // {factura, credito}

  // Crédito a favor por proveedor (anticipos − aplicaciones): habilita "Aplicar
  // crédito" en sus facturas abiertas — el pedido se descuenta sin pagar.
  const creditoDe = (prov) => prov
    ? creditoDisponibleProveedor(prov, facturasPendientes, movimientos, { cajas, tc: dolarVenta })
    : 0;

  // Visibilidad por dueño: admin/administración ven todas; el resto solo las que
  // subió cada uno (createdBy). Todo lo demás (KPIs, filtros) opera sobre esto.
  const visibles = useMemo(
    () => esAdmin ? facturasPendientes : facturasPendientes.filter(esPropia),
    [facturasPendientes, esAdmin, miId, miEmail]
  );

  // KPI: total adeudado (saldos de órdenes abiertas) + cantidad abiertas.
  const totalAdeudado = useMemo(() => totalPendiente(visibles), [visibles]);
  const cantAbiertas = useMemo(
    () => visibles.filter(f => { const e = estadoFacturaPendiente(f); return e === 'pendiente' || e === 'parcial'; }).length,
    [visibles]
  );

  // Filtrado.
  const filtradas = useMemo(() => {
    return visibles.filter(f => {
      if (filtroProv !== 'todos') {
        const matchProv = f.proveedorId === filtroProv;
        if (!matchProv) return false;
      }
      const est = estadoFacturaPendiente(f);
      if (filtroEstado === 'abiertas') return est === 'pendiente' || est === 'parcial';
      if (filtroEstado !== 'todas') return est === filtroEstado;
      return true;
    });
  }, [visibles, filtroProv, filtroEstado]);

  // Agrupar por proveedor (nombre, con fallback al campo proveedor de la factura).
  const grupos = useMemo(() => {
    const map = new Map();
    filtradas.forEach(f => {
      const key = f.proveedorId || f.proveedor || 'sin-proveedor';
      const prov = proveedores.find(p => p.id === f.proveedorId) || null;
      const nombre = prov?.nombre || f.proveedor || 'Sin proveedor';
      if (!map.has(key)) map.set(key, { key, nombre, prov, facturas: [] });
      map.get(key).facturas.push(f);
    });
    const arr = [...map.values()];
    arr.forEach(g => {
      g.subtotal = g.facturas.reduce((s, f) => {
        const e = estadoFacturaPendiente(f);
        return (e === 'pendiente' || e === 'parcial') ? s + saldoFacturaPendiente(f) : s;
      }, 0);
      g.facturas.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    });
    return arr.sort((a, b) => b.subtotal - a.subtotal || a.nombre.localeCompare(b.nombre));
  }, [filtradas, proveedores]);

  const anular = (f) => {
    if (window.confirm(`¿Anular la orden de pago ${f.numero || ''} de ${f.proveedor || ''}?\n\nDejará de contar como deuda.`)) {
      updateFacturaPendiente(f.id, { estado: 'anulada' });
    }
  };

  const proveedoresOrden = [...proveedores].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

  if (currentUser && !puedeVer) return null;

  return (
    <PageLayout breadcrumb={['Órdenes de pago']} active="Órdenes de pago">
      <PageHero
        label="ÓRDENES DE PAGO"
        title="Órdenes de pago"
        subtitle={esAdmin ? 'Facturas de proveedor pendientes de pago' : 'Las órdenes de pago que cargaste'}
        actions={<Btn fill onClick={() => setModalAlta(true)} style={{ gap: 6 }}>+ Nueva orden de pago</Btn>}
        kpis={[
          { label: 'Total adeudado', value: `$ ${fmtN(totalAdeudado)}`, color: totalAdeudado > 0 ? T.warn : T.ok },
          { label: 'Facturas abiertas', value: cantAbiertas, color: T.ink },
        ]}
      />

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={isMobile ? { flex: '1 1 100%' } : undefined}>
          <div style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Proveedor</div>
          <select value={filtroProv} onChange={e => setFiltroProv(e.target.value)}
            style={{ padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, cursor: 'pointer', minWidth: 180, width: isMobile ? '100%' : undefined }}>
            <option value="todos">Todos los proveedores</option>
            {proveedoresOrden.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        <div style={isMobile ? { flex: '1 1 100%' } : undefined}>
          <div style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Estado</div>
          <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
            style={{ padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, cursor: 'pointer', width: isMobile ? '100%' : undefined }}>
            <option value="abiertas">Abiertas (pendiente + parcial)</option>
            <option value="pendiente">Pendiente</option>
            <option value="parcial">Parcial</option>
            <option value="pagada">Pagada</option>
            <option value="registrada">Registrada (solo fiscal, sin deuda)</option>
            <option value="anulada">Anulada</option>
            <option value="todas">Todas</option>
          </select>
        </div>
      </div>

      {/* Listado agrupado por proveedor */}
      {grupos.length === 0 ? (
        <Box style={{ padding: 32, textAlign: 'center', color: T.ink3, fontSize: 13 }}>
          No hay órdenes de pago en esta vista
        </Box>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {grupos.map(g => (
            <Box key={g.key} style={{ padding: 0, overflow: 'hidden' }}>
              {/* Header del proveedor */}
              <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}`, gap: 8 }}>
                <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                  <span style={{ fontWeight: 800, fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.nombre}</span>
                  {/* Datos bancarios para transferir — SOLO Admin/Administración. */}
                  {esAdmin && (g.prov?.cbu || g.prov?.alias) && (
                    <div style={{
                      fontSize: isMobile ? 9 : 10,
                      color: T.ink2,
                      fontFamily: T.fontMono,
                      marginTop: 3,
                      display: isMobile ? 'block' : 'flex',
                      gap: isMobile ? undefined : 12,
                      flexWrap: 'wrap',
                    }}>
                      {g.prov?.alias && <span title="Alias para transferir" style={isMobile ? { display: 'block', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : undefined}>🏦 {g.prov.alias}</span>}
                      {g.prov?.cbu && <span title="CBU para transferir" style={isMobile ? { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : undefined}>CBU {g.prov.cbu}</span>}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 11, color: T.ink2, flexShrink: 0, whiteSpace: 'nowrap', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  <span>Pendiente <b style={{ fontFamily: T.fontMono, color: g.subtotal > 0 ? T.warn : T.ok }}>$ {fmtN(g.subtotal)}</b></span>
                  {esAdmin && creditoDe(g.prov) > 1 && (
                    <span style={{ fontSize: 10, color: T.ok }}>A favor <b style={{ fontFamily: T.fontMono }}>$ {fmtN(creditoDe(g.prov))}</b></span>
                  )}
                </span>
              </div>

              {/* En mobile, scroll-x para no aplastar las 8 columnas (preserva
                  alineación de montos/estados). En desktop, igual que siempre. */}
              <div style={isMobile ? { overflowX: 'auto', WebkitOverflowScrolling: 'touch' } : undefined}>
              <div style={{ minWidth: isMobile ? 720 : undefined }}>
              {/* Encabezado de columnas */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.9fr 2fr 1.3fr 1fr 1fr 0.9fr 1.4fr', padding: '7px 14px', borderBottom: `1px solid ${T.faint2}`, fontSize: 10, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                <span>N°</span>
                <span>Fecha</span>
                <span>Concepto</span>
                <span>Obra</span>
                <span style={{ textAlign: 'right' }}>Monto</span>
                <span style={{ textAlign: 'right' }}>Saldo</span>
                <span style={{ textAlign: 'center' }}>Estado</span>
                <span style={{ textAlign: 'right' }}>Acciones</span>
              </div>

              {/* Filas */}
              {g.facturas.map(f => {
                const est = estadoFacturaPendiente(f);
                const saldo = saldoFacturaPendiente(f);
                const abierta = est === 'pendiente' || est === 'parcial';
                const pagosConComp = (f.pagos || []).filter(p => p.comprobanteUrl);
                return (
                  <div key={f.id}>
                  <div
                    style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.9fr 2fr 1.3fr 1fr 1fr 0.9fr 1.4fr', padding: '9px 14px', borderBottom: pagosConComp.length ? 'none' : `1px solid ${T.faint2}`, alignItems: 'center', fontSize: 12 }}>
                    <span style={{ fontFamily: T.fontMono, fontSize: 11 }}>
                      {f.tipoLetra && <span style={{ fontWeight: 700, marginRight: 4 }}>{f.tipoLetra}</span>}
                      {f.numero || '—'}
                    </span>
                    <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink2 }}>
                      {fmtFecha(f.fecha)}
                      {f.fechaVencimiento && <span style={{ display: 'block', color: T.warn, fontSize: 10 }}>vence {fmtFecha(f.fechaVencimiento)}</span>}
                    </span>
                    <span style={{ color: T.ink2, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.concepto || ''}>
                      {f.concepto || '—'}
                    </span>
                    <span style={{ fontSize: 11 }}>
                      {f.obraNombre
                        ? (f.obraId
                            ? <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate(`/obras/${f.obraId}/presupuesto`)}>{f.obraNombre}</span>
                            : <span>{f.obraNombre}</span>)
                        : <span style={{ color: T.ink3 }}>—</span>}
                    </span>
                    <span style={{ textAlign: 'right', fontFamily: T.fontMono, fontWeight: 700 }}>$ {fmtN(f.monto)}</span>
                    <span style={{ textAlign: 'right', fontFamily: T.fontMono, fontWeight: 800, color: saldo > 0 && abierta ? T.warn : T.ink3 }}>
                      {abierta ? `$ ${fmtN(saldo)}` : '—'}
                    </span>
                    <span style={{ textAlign: 'center' }}><EstadoChip estado={est} mobile={isMobile} /></span>
                    <span style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', alignItems: 'center' }}>
                      {f.comprobanteUrl && (
                        <Btn sm onClick={() => window.open(f.comprobanteUrl, '_blank', 'noopener')} style={{ fontSize: 10 }}>Ver</Btn>
                      )}
                      {abierta && esAdmin && creditoDe(g.prov) > 1 && (
                        <Btn sm onClick={() => setCreditoFactura({ factura: f, credito: creditoDe(g.prov) })}
                          title={`Aplicar crédito a favor ($ ${fmtN(creditoDe(g.prov))}) — no mueve caja`}
                          style={{ fontSize: 10, color: '#4f5bd5', borderColor: '#4f5bd5' }}>Aplicar crédito</Btn>
                      )}
                      {abierta && esAdmin && (
                        <Btn sm accent onClick={() => setPagoFactura(f)} style={{ fontSize: 10 }}>Registrar pago</Btn>
                      )}
                      {est !== 'anulada' && est !== 'pagada' && (esAdmin || esPropia(f)) && (
                        <span style={{ color: T.warn, cursor: 'pointer', fontSize: 15, padding: '0 2px', lineHeight: 1 }}
                          title="Anular orden de pago"
                          onClick={() => anular(f)}>×</span>
                      )}
                    </span>
                  </div>
                  {pagosConComp.length > 0 && (
                    <div style={{ padding: '3px 14px 8px 28px', borderBottom: `1px solid ${T.faint2}`, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                      {pagosConComp.map((p, i) => (
                        <a key={i} href={p.comprobanteUrl} target="_blank" rel="noreferrer"
                          style={{ fontSize: 10, color: T.accent, textDecoration: 'none' }}>
                          📎 Comprobante de pago · {fmtFecha(p.fecha)} · $ {fmtN(p.monto)}
                        </a>
                      ))}
                    </div>
                  )}
                  </div>
                );
              })}
              </div>
              </div>
            </Box>
          ))}
        </div>
      )}

      {/* Modales */}
      {modalAlta && <FacturaPendienteModal onClose={() => setModalAlta(false)} />}
      {pagoFactura && (
        <RegistrarPagoModal
          facturaPendiente={pagoFactura}
          proveedor={pagoFactura.proveedor || proveedores.find(p => p.id === pagoFactura.proveedorId)?.nombre || ''}
          proveedorId={pagoFactura.proveedorId || null}
          onClose={() => setPagoFactura(null)} />
      )}
      {creditoFactura && (
        <AplicarCreditoModal
          factura={creditoFactura.factura}
          credito={creditoFactura.credito}
          onClose={() => setCreditoFactura(null)} />
      )}
    </PageLayout>
  );
}
