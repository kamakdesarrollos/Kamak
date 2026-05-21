import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn, Chip, Label } from '../components/ui';
import { T } from '../theme';
import { useProveedores } from '../store/ProveedoresContext';
import RegistrarPagoModal from './modales/RegistrarPagoModal';

const fmtN = (n) => Math.abs(Math.round(n)).toLocaleString('es-AR');
const fmtFecha = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
};

const TIPO_LABEL = { contrato: 'Contrato', pago: 'Pago', cert: 'Certif.', factura: 'Factura', adicional: 'Adicional', echeq: 'ECHEQ', fondo: 'Fondo rep.' };
const TIPO_COLOR = { contrato: T.ink, pago: T.ok, cert: T.ok, factura: T.warn, adicional: T.warn, echeq: T.ink2, fondo: T.accent };

function Avatar({ nombre, size = 50 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: T.ink2, color: T.paper, fontFamily: `'Montserrat',sans-serif`, fontSize: size * 0.55, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, flexShrink: 0 }}>
      {(nombre || '?')[0].toUpperCase()}
    </div>
  );
}

export default function ProveedorCC() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { proveedores, getCC, getSaldo, getObrasProveedor, removeCC } = useProveedores();
  const [pagoOpen, setPagoOpen] = useState(false);
  const [selectedObraId, setSelectedObraId] = useState(null);
  const [tab, setTab] = useState('cc');

  const proveedor = proveedores.find(p => p.id === id);

  const obras = useMemo(() => getObrasProveedor(id), [getObrasProveedor, id]);
  const saldoTotal = getSaldo(id);

  const allEntries = useMemo(() => getCC(id), [getCC, id]);

  const selObraId = selectedObraId || obras[0]?.id || null;
  const ccEntries = useMemo(() => getCC(id, selObraId), [getCC, id, selObraId]);

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
    <PageLayout breadcrumb={['Proveedores', proveedor.nombre]} active="Proveedores">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar nombre={proveedor.nombre} />
          <div>
            <div className="k-h" style={{ fontSize: 24 }}>{proveedor.nombre}</div>
            <div style={{ fontSize: 12, color: T.ink2 }}>
              {proveedor.cuit && `CUIT ${proveedor.cuit} · `}
              {proveedor.tipo}
              {proveedor.condicion && ` · ${proveedor.condicion}`}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn sm onClick={() => navigate('/proveedores')}>← Volver</Btn>
          <Btn sm fill onClick={() => setPagoOpen(true)}>+ Registrar pago</Btn>
        </div>
      </div>

      {/* Summary bar */}
      <div style={{ display: 'flex', gap: 0, background: saldoTotal > 0 ? '#fae6e0' : T.faint, borderRadius: 4, marginBottom: 12, overflow: 'hidden', border: `1px solid ${saldoTotal > 0 ? '#f0c5b8' : T.faint2}` }}>
        {[
          { label: 'Saldo consolidado', value: saldoTotal > 0 ? `$ ${fmtN(saldoTotal)}` : 'Al día', accent: saldoTotal > 0 },
          { label: `Debe (${obras.length} CC)`, value: `$ ${fmtN(totalDebe)}` },
          { label: 'Haber', value: `$ ${fmtN(totalHaber)}`, ok: true },
          { label: 'Obras activas', value: String(obras.length) },
        ].map((s, i) => (
          <div key={s.label} style={{ flex: 1, padding: '10px 14px', borderLeft: i ? `1px solid ${saldoTotal > 0 ? '#f0c5b8' : T.faint2}` : 'none' }}>
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
        <span className={`k-tab${tab === 'datos' ? ' k-tab-on' : ''}`} onClick={() => setTab('datos')}>
          Datos del proveedor
        </span>
      </div>

      {tab === 'cc' && (
        <div style={{ display: 'flex', gap: 10, overflow: 'hidden', height: 'calc(100vh - 300px)' }}>
          {/* Left: CC by obra */}
          <div style={{ width: 240, flexShrink: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Label style={{ marginBottom: 2 }}>Cuentas por obra</Label>
            {obras.length === 0 && (
              <div style={{ fontSize: 12, color: T.ink3, padding: '8px 0' }}>Sin obras registradas.</div>
            )}
            {obras.map(o => {
              const saldo = getSaldo(id, o.id);
              const entries = getCC(id, o.id);
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
                  <div style={{ fontSize: 10, color: T.ink3, marginTop: 1 }}>{entries.length} movimiento{entries.length !== 1 ? 's' : ''}</div>
                </Box>
              );
            })}
          </div>

          {/* Right: CC entries */}
          <Box style={{ flex: 1, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {!selObraId ? (
              <div style={{ padding: 24, textAlign: 'center', color: T.ink3, fontSize: 12 }}>Sin obras con CC. Registrá un pago para crear una.</div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}` }}>
                  <div className="k-h" style={{ fontSize: 16 }}>CC · {obras.find(o => o.id === selObraId)?.nombre || selObraId}</div>
                  <Chip style={{ fontSize: 10 }}>Saldo {getSaldo(id, selObraId) > 0 ? `$ ${fmtN(getSaldo(id, selObraId))}` : 'al día'}</Chip>
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

                <div style={{ flex: 1, overflow: 'auto' }}>
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
                        <span style={{ color: T.accent, cursor: 'pointer', fontSize: 13, padding: '0 4px' }}
                          onClick={() => { if (confirm('¿Eliminar este movimiento?')) removeCC(e.id); }}>×</span>
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
                    <span style={{ flex: 1.4, textAlign: 'right', fontFamily: T.fontMono, color: getSaldo(id, selObraId) > 0 ? T.accent : T.ok }}>
                      {getSaldo(id, selObraId) > 0 ? `$ ${fmtN(getSaldo(id, selObraId))}` : 'Al día'}
                    </span>
                  </div>
                )}
              </>
            )}
          </Box>
        </div>
      )}

      {tab === 'datos' && (
        <Box style={{ padding: 16, maxWidth: 480 }}>
          <Label style={{ marginBottom: 10 }}>Datos del proveedor</Label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
            {[
              ['Nombre / Razón social', proveedor.nombre],
              ['Tipo de trabajo', proveedor.tipo],
              ['CUIT', proveedor.cuit || '—'],
              ['Condición AFIP', proveedor.condicion || '—'],
              ['Teléfono', proveedor.telefono || '—'],
              ['Email', proveedor.email || '—'],
            ].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 2 }}>{k}</div>
                <div style={{ fontWeight: 600 }}>{v}</div>
              </div>
            ))}
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
    </PageLayout>
  );
}
