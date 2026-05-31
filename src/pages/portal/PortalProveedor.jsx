import { useState } from 'react';
import { Box, Btn, Chip, Stat, Label } from '../../components/ui';
import { T } from '../../theme';

const MOVS = [
  { fecha: '02/05', desc: 'Pago mat. eléctrica · Bara · TRF-412', debe: '', haber: '245.000', saldo: '0' },
  { fecha: '28/04', desc: 'Factura B 0001-00312 · mat eléctrica Bara', debe: '245.000', haber: '', saldo: '245.000' },
  { fecha: '20/04', desc: 'Pago mat. albañilería · Tigre · TRF-389', debe: '', haber: '180.000', saldo: '0' },
  { fecha: '15/04', desc: 'Factura B 0001-00298 · mat albañilería Tigre', debe: '180.000', haber: '', saldo: '180.000' },
];

const PENDIENTES = [
  { n: 'B 0001-00331', obra: 'Baradero', fecha: '10/05/26', monto: '$ 312.000', dias: 5 },
  { n: 'B 0001-00338', obra: 'Pilar', fecha: '14/05/26', monto: '$ 87.500', dias: 1 },
];

export default function PortalProveedor() {
  const [tab, setTab] = useState(0);
  const tabs = ['Cuenta corriente', 'Facturas', 'Órdenes de compra', 'Mis datos'];

  return (
    <div style={{ fontFamily: T.font, background: T.paper, minHeight: '100vh' }}>
      <div style={{ background: '#fff7ed', color: '#b45309', padding: '8px 16px', fontSize: 12, fontWeight: 600, textAlign: 'center' }}>
        🚧 En construcción — maqueta de demostración. No muestra datos reales del proveedor.
      </div>
      {/* Header */}
      <div style={{ background: T.dark, padding: '16px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="/assets/kamak-logo-light.png" alt="Kamak" style={{ height: 32, opacity: 0.9 }} />
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 18 }}>|</div>
          <div style={{ color: T.paper }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Portal proveedor</div>
            <div style={{ fontSize: 11, opacity: 0.6 }}>Don Luis SRL · CUIT 30-71589456-2</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 16, background: T.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: 14 }}>D</div>
          <div style={{ color: T.paper, fontSize: 13 }}>Don Luis SRL</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background: 'white', borderBottom: `1.5px solid ${T.faint2}`, padding: '0 32px', display: 'flex', gap: 4 }}>
        {tabs.map((t, i) => (
          <span key={i} onClick={() => setTab(i)} style={{ padding: '12px 16px', fontSize: 13, fontWeight: tab === i ? 700 : 400, color: tab === i ? T.accent : T.ink2, borderBottom: `2px solid ${tab === i ? T.accent : 'transparent'}`, cursor: 'pointer' }}>{t}</span>
        ))}
      </div>

      <div style={{ padding: '24px 32px', maxWidth: 1000, margin: '0 auto' }}>
        {tab === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Saldos por obra */}
            <div style={{ display: 'flex', gap: 12 }}>
              {[
                { obra: 'Baradero', saldo: '$ 0', color: T.ok },
                { obra: 'Pilar', saldo: '$ 87.500', color: T.warn },
                { obra: 'Sin imputar', saldo: '$ 0', color: T.ink3 },
              ].map((s, i) => (
                <Box key={i} style={{ flex: 1, padding: 14 }}>
                  <div style={{ fontSize: 11, color: T.ink2, marginBottom: 4 }}>{s.obra}</div>
                  <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 22, color: s.color }}>{s.saldo}</div>
                  <div style={{ fontSize: 10, color: s.color === T.ok ? T.ok : T.warn, marginTop: 4 }}>{s.saldo === '$ 0' ? '✓ Al día' : '⚠ Pendiente'}</div>
                </Box>
              ))}
            </div>

            {/* CC table */}
            <Box style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'space-between' }}>
                <div className="k-h" style={{ fontSize: 16 }}>Movimientos</div>
                <span style={{ fontSize: 12, color: T.ink2 }}>Filtrar por obra ▾</span>
              </div>
              <div style={{ fontSize: 12 }}>
                <div style={{ display: 'flex', background: T.faint, padding: '6px 14px', fontWeight: 700, fontSize: 11, color: T.ink2, gap: 8 }}>
                  <span style={{ flex: 0.7 }}>Fecha</span>
                  <span style={{ flex: 4 }}>Descripción</span>
                  <span style={{ flex: 1.2, textAlign: 'right' }}>Debe</span>
                  <span style={{ flex: 1.2, textAlign: 'right' }}>Haber</span>
                  <span style={{ flex: 1.2, textAlign: 'right' }}>Saldo</span>
                </div>
                {MOVS.map((m, i) => (
                  <div key={i} style={{ display: 'flex', padding: '8px 14px', borderBottom: `1px solid ${T.faint2}`, alignItems: 'center', gap: 8 }}>
                    <span style={{ flex: 0.7, fontFamily: T.fontMono, color: T.ink2 }}>{m.fecha}</span>
                    <span style={{ flex: 4 }}>{m.desc}</span>
                    <span style={{ flex: 1.2, textAlign: 'right', fontFamily: T.fontMono, color: T.accent }}>{m.debe ? `$ ${m.debe}` : ''}</span>
                    <span style={{ flex: 1.2, textAlign: 'right', fontFamily: T.fontMono, color: T.ok }}>{m.haber ? `$ ${m.haber}` : ''}</span>
                    <span style={{ flex: 1.2, textAlign: 'right', fontFamily: T.fontMono, fontWeight: 700 }}>{m.saldo !== '0' ? `$ ${m.saldo}` : <span style={{ color: T.ok }}>$ 0</span>}</span>
                  </div>
                ))}
              </div>
            </Box>
          </div>
        )}

        {tab === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Pendientes */}
            {PENDIENTES.length > 0 && (
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10, color: T.warn }}>Pendientes de pago</div>
                {PENDIENTES.map((p, i) => (
                  <div key={i} style={{ background: '#fff7e6', border: `1.5px solid ${T.warn}`, borderRadius: 8, padding: '12px 16px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>Factura {p.n}</div>
                      <div style={{ fontSize: 11, color: T.ink2 }}>Obra {p.obra} · emitida {p.fecha}</div>
                    </div>
                    <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 16 }}>{p.monto}</div>
                    <Chip warn style={{ fontSize: 10 }}>{p.dias}d pendiente</Chip>
                  </div>
                ))}
              </div>
            )}

            {/* Upload */}
            <Box style={{ padding: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Enviar nueva factura</div>
              <div style={{ border: `2px dashed ${T.faint2}`, borderRadius: 8, padding: '24px', textAlign: 'center', cursor: 'pointer', color: T.ink2 }}>
                <div style={{ fontSize: 32, marginBottom: 6 }}>📎</div>
                <div style={{ fontSize: 13 }}>Arrastrá el archivo o hacé click</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>PDF, XML · Factura electrónica AFIP</div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <div style={{ flex: 1 }}>
                  <Label style={{ fontSize: 10 }}>Obra</Label>
                  <select style={{ width: '100%', padding: '6px 10px', borderRadius: 4, border: `1.5px solid ${T.faint2}`, fontSize: 12, fontFamily: T.font, marginTop: 4 }}>
                    <option>Baradero</option><option>Pilar</option><option>Tigre</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <Label style={{ fontSize: 10 }}>Rubro</Label>
                  <select style={{ width: '100%', padding: '6px 10px', borderRadius: 4, border: `1.5px solid ${T.faint2}`, fontSize: 12, fontFamily: T.font, marginTop: 4 }}>
                    <option>Materiales</option><option>Mano de obra</option>
                  </select>
                </div>
              </div>
              <Btn sm accent style={{ marginTop: 12 }}>Enviar factura</Btn>
            </Box>

            {/* Historial */}
            <Box style={{ padding: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Historial</div>
              {[
                { n: 'B 0001-00312', obra: 'Baradero', fecha: '28/04/26', monto: '$ 245.000', estado: 'pagado' },
                { n: 'B 0001-00298', obra: 'Tigre', fecha: '15/04/26', monto: '$ 180.000', estado: 'pagado' },
                { n: 'B 0001-00271', obra: 'Baradero', fecha: '01/04/26', monto: '$ 380.000', estado: 'pagado' },
              ].map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${T.faint2}`, gap: 10 }}>
                  <span style={{ fontSize: 20 }}>🧾</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>Factura {f.n}</div>
                    <div style={{ fontSize: 10, color: T.ink2 }}>Obra {f.obra} · {f.fecha}</div>
                  </div>
                  <span style={{ fontFamily: T.fontMono, fontSize: 13, fontWeight: 700 }}>{f.monto}</span>
                  <Chip ok style={{ fontSize: 10 }}>✓ {f.estado}</Chip>
                  <Btn sm>↓</Btn>
                </div>
              ))}
            </Box>
          </div>
        )}

        {tab === 2 && (
          <Box style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Órdenes de compra activas</div>
            {[
              { n: 'OC-2026-089', obra: 'Baradero', desc: 'Materiales eléctricos lote 3', monto: '$ 420.000', estado: 'aprobada' },
              { n: 'OC-2026-094', obra: 'Pilar', desc: 'Materiales plomería', monto: '$ 195.000', estado: 'en revisión' },
            ].map((o, i) => (
              <div key={i} style={{ border: `1.5px solid ${T.faint2}`, borderRadius: 8, padding: '12px 16px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{o.n}</div>
                  <div style={{ fontSize: 11, color: T.ink2 }}>{o.desc} · {o.obra}</div>
                </div>
                <span style={{ fontFamily: T.fontMono, fontWeight: 700 }}>{o.monto}</span>
                <Chip ok={o.estado === 'aprobada'} warn={o.estado === 'en revisión'} style={{ fontSize: 10 }}>{o.estado}</Chip>
                <Btn sm>Ver detalle</Btn>
              </div>
            ))}
          </Box>
        )}

        {tab === 3 && (
          <Box style={{ padding: 16, maxWidth: 500 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Mis datos</div>
            {[
              ['Razón social', 'Don Luis SRL'],
              ['CUIT', '30-71589456-2'],
              ['Email facturación', 'admin@donluissrl.com'],
              ['Teléfono', '+54 9 11 4523 8900'],
              ['Dirección', 'Av. Independencia 1450, CABA'],
              ['CBU', '0720599520000000123456'],
              ['Alias CBU', 'DONLUIS.COMERCIO'],
            ].map(([l, v], i) => (
              <div key={i} style={{ display: 'flex', padding: '8px 0', borderBottom: `1px solid ${T.faint2}`, gap: 10 }}>
                <span style={{ flex: 1.2, fontSize: 12, color: T.ink2 }}>{l}</span>
                <span style={{ flex: 2, fontSize: 12, fontWeight: 600 }}>{v}</span>
              </div>
            ))}
            <Btn sm style={{ marginTop: 14 }}>Solicitar actualización</Btn>
          </Box>
        )}
      </div>
    </div>
  );
}
