import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn } from '../components/ui';
import PageHero from '../components/ui/PageHero';
import { T } from '../theme';
import { useComprobantes } from '../store/ComprobantesContext';
import { useClientes } from '../store/ClientesContext';
import { useObras } from '../store/ObrasContext';
import { useConfiguracion } from '../store/ConfiguracionContext';
import { useUsuarios } from '../store/UsuariosContext';
import {
  TIPOS_COMPROBANTE, CONDICIONES_IVA, ALICUOTAS_IVA,
  calcDesdeNeto, tipoFacturaSugerido, validarComprobante,
  formatCUIT, getTipoComprobante, getCondicionIVA, validarCUIT,
} from '../lib/afip';

const inputSt = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };

const fmtMoney = (n) => `$ ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtFecha = (iso) => !iso ? '—' : String(iso).slice(0, 10).split('-').reverse().join('/');
const todayISO = () => new Date().toISOString().slice(0, 10);

const ESTADO_CHIP = {
  borrador: { bg: '#f5f0e0', color: '#92400e', label: 'Borrador' },
  emitido:  { bg: '#e8f4f0', color: '#166534', label: 'Emitido' },
  anulado:  { bg: '#fee2e2', color: '#b91c1c', label: 'Anulado' },
};

// ── Modal: nueva factura ───────────────────────────────────────────────────────
function NuevaFacturaModal({ empresa, clientes, obras, onSave, onClose }) {
  const [form, setForm] = useState({
    clienteId: '',
    tipoId: 'FB',
    obraId: '',
    concepto: '',
    neto: '',
    alicuota: 21,
    fecha: todayISO(),
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const cliente = clientes.find(c => c.id === form.clienteId) || null;

  // Al elegir cliente: sugerir el tipo de comprobante según su condición IVA.
  useEffect(() => {
    if (cliente) set('tipoId', tipoFacturaSugerido(cliente.condicionIVA || 'CF'));
  }, [form.clienteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const netoNum = parseFloat(String(form.neto).replace(',', '.')) || 0;
  const calc = calcDesdeNeto(netoNum, form.alicuota);

  // Arma el comprobante (con datos de emisor de la config) para validar y guardar.
  const comprobante = useMemo(() => ({
    tipoId: form.tipoId,
    emisorRazonSocial: empresa.razonSocial,
    emisorCuit: empresa.cuit,
    emisorCondicion: empresa.condicionIVA,
    puntoVenta: empresa.puntoVenta,
    clienteId: form.clienteId || null,
    receptorNombre: cliente?.empresa || cliente?.nombre || '',
    receptorCuit: cliente?.cuit || '',
    receptorCondicion: cliente?.condicionIVA || 'CF',
    obraId: form.obraId || null,
    obraNombre: obras.find(o => o.id === form.obraId)?.nombre || '',
    concepto: form.concepto.trim(),
    neto: netoNum,
    alicuota: Number(form.alicuota),
    iva: calc.iva,
    total: calc.total,
    fecha: form.fecha,
  }), [form, cliente, calc.iva, calc.total, netoNum, empresa, obras]);

  const errores = validarComprobante(comprobante);
  const puedeGuardar = !!form.clienteId && errores.length === 0;
  const letra = getTipoComprobante(form.tipoId)?.letra;

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 560, maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: T.font, fontWeight: 800, fontSize: 17 }}>Nueva factura</div>
            <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>Queda en borrador · la emisión a AFIP se hace después</div>
          </div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Emisor (solo lectura) */}
          <div style={{ background: T.faint, borderRadius: 4, padding: '8px 12px', fontSize: 11, color: T.ink2 }}>
            <b style={{ color: T.ink }}>Emisor:</b> {empresa.razonSocial} · CUIT {formatCUIT(empresa.cuit)} · Pto. venta {empresa.puntoVenta} · Responsable Inscripto
          </div>

          {/* Cliente */}
          <div>
            <label style={labelSt}>Cliente *</label>
            <select style={{ ...inputSt, cursor: 'pointer' }} value={form.clienteId} onChange={e => set('clienteId', e.target.value)}>
              <option value="">— Elegí un cliente —</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.empresa || c.nombre}</option>)}
            </select>
            {cliente && (
              <div style={{ fontSize: 10.5, color: T.ink2, marginTop: 4 }}>
                {getCondicionIVA(cliente.condicionIVA)?.nombre || 'Consumidor Final'}
                {cliente.cuit ? ` · CUIT ${formatCUIT(cliente.cuit)}` : ' · sin CUIT'}
                {cliente.cuit && !validarCUIT(cliente.cuit) && <span style={{ color: '#b91c1c', fontWeight: 700 }}> · ⚠ CUIT inválido</span>}
              </div>
            )}
          </div>

          {/* Tipo + Fecha */}
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelSt}>Tipo de comprobante *</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={form.tipoId} onChange={e => set('tipoId', e.target.value)}>
                {TIPOS_COMPROBANTE.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select>
            </div>
            <div style={{ width: 150 }}>
              <label style={labelSt}>Fecha *</label>
              <input type="date" style={inputSt} value={form.fecha} onChange={e => set('fecha', e.target.value)} />
            </div>
          </div>

          {/* Obra (opcional, para concepto) */}
          <div>
            <label style={labelSt}>Obra (opcional)</label>
            <select style={{ ...inputSt, cursor: 'pointer' }} value={form.obraId}
              onChange={e => {
                const o = obras.find(x => x.id === e.target.value);
                set('obraId', e.target.value);
                if (o && !form.concepto.trim()) set('concepto', `Trabajos en obra ${o.nombre}`);
              }}>
              <option value="">— Sin obra —</option>
              {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          </div>

          {/* Concepto */}
          <div>
            <label style={labelSt}>Concepto / detalle</label>
            <input style={inputSt} value={form.concepto} onChange={e => set('concepto', e.target.value)} placeholder="Ej: Trabajos de obra — abril 2026" />
          </div>

          {/* Neto + Alícuota */}
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelSt}>Neto gravado $ *</label>
              <input style={{ ...inputSt, fontFamily: T.fontMono, fontWeight: 700, fontSize: 14 }} type="text" inputMode="decimal"
                value={form.neto} onChange={e => set('neto', e.target.value)} placeholder="0,00" />
            </div>
            <div style={{ width: 130 }}>
              <label style={labelSt}>IVA *</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={form.alicuota} onChange={e => set('alicuota', Number(e.target.value))}>
                {ALICUOTAS_IVA.map(a => <option key={a.pct} value={a.pct}>{a.pct}%</option>)}
              </select>
            </div>
          </div>

          {/* Totales calculados */}
          <div style={{ background: '#e8f4f0', borderRadius: 5, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Neto gravado</span><b style={{ fontFamily: T.fontMono }}>{fmtMoney(calc.neto)}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: T.ink2 }}><span>IVA {form.alicuota}%</span><b style={{ fontFamily: T.fontMono }}>{fmtMoney(calc.iva)}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${T.faint2}`, paddingTop: 4, fontSize: 14 }}>
              <b style={{ color: T.ink }}>TOTAL {letra ? `(${letra})` : ''}</b>
              <b style={{ fontFamily: T.fontMono, color: T.ok }}>{fmtMoney(calc.total)}</b>
            </div>
          </div>

          {/* Errores de validación */}
          {form.clienteId && errores.length > 0 && (
            <div style={{ background: '#fee2e2', border: `1.5px solid #b91c1c`, borderRadius: 4, padding: '8px 12px', fontSize: 11, color: '#7f1d1d' }}>
              <b>Revisá antes de guardar:</b>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {errores.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>

        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill onClick={() => onSave(comprobante)} style={{ opacity: puedeGuardar ? 1 : 0.45, pointerEvents: puedeGuardar ? 'auto' : 'none' }}>
            Guardar borrador
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── Página ─────────────────────────────────────────────────────────────────────
export default function Facturacion() {
  const { currentUser } = useUsuarios();
  const navigate = useNavigate();
  const isAdmin = currentUser?.rol === 'Admin';
  useEffect(() => { if (currentUser && !isAdmin) navigate('/', { replace: true }); }, [currentUser, isAdmin, navigate]);

  const { comprobantes, addComprobante, removeComprobante } = useComprobantes();
  const { clientes } = useClientes();
  const { obras } = useObras();
  const { config } = useConfiguracion();
  const empresa = config?.empresa || {};
  const [modal, setModal] = useState(false);

  const ordenados = useMemo(
    () => [...comprobantes].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.creadoAt || '').localeCompare(a.creadoAt || '')),
    [comprobantes]
  );
  const totalFacturado = useMemo(
    () => ordenados.filter(c => c.estado !== 'anulado').reduce((s, c) => s + (getTipoComprobante(c.tipoId)?.signo || 1) * (c.total || 0), 0),
    [ordenados]
  );

  const guardar = (comprobante) => { addComprobante(comprobante); setModal(false); };

  if (!isAdmin) return null;

  return (
    <PageLayout breadcrumb={['Facturación']} active="Facturación">
      <PageHero
        label="FACTURACIÓN · ARCA / AFIP"
        title="Facturación"
        subtitle={`${ordenados.length} comprobante${ordenados.length === 1 ? '' : 's'} · ${fmtMoney(totalFacturado)} facturado`}
        actions={<Btn fill onClick={() => setModal(true)}>+ Nueva factura</Btn>}
      />

      {/* Aviso: todavía no está conectado a AFIP */}
      <Box style={{ padding: '10px 14px', marginBottom: 12, background: '#fff7e0', border: `1.5px solid ${T.warn}`, display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
        <span style={{ fontSize: 16 }}>⚠️</span>
        <div style={{ color: T.ink2 }}>
          Los comprobantes se guardan como <b>borrador</b> con todos los datos fiscales calculados y validados.
          La <b>emisión real ante AFIP</b> (número oficial + CAE) se conecta en una etapa posterior — por ahora <b>no</b> se envía nada a AFIP.
        </div>
      </Box>

      {ordenados.length === 0 ? (
        <Box style={{ padding: '40px 20px', textAlign: 'center', color: T.ink3, fontSize: 13 }}>
          Todavía no hay comprobantes. Tocá <b>+ Nueva factura</b> para crear el primero.
        </Box>
      ) : (
        <Box style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 14px', background: T.dark, color: '#fff', fontSize: 9.5, fontFamily: T.fontMono, letterSpacing: 1.2, fontWeight: 700 }}>
            <div style={{ width: 70, flexShrink: 0 }}>TIPO</div>
            <div style={{ flex: 1 }}>CLIENTE</div>
            <div style={{ width: 90, textAlign: 'right' }}>FECHA</div>
            <div style={{ width: 120, textAlign: 'right' }}>NETO</div>
            <div style={{ width: 110, textAlign: 'right' }}>IVA</div>
            <div style={{ width: 130, textAlign: 'right' }}>TOTAL</div>
            <div style={{ width: 90, textAlign: 'center' }}>ESTADO</div>
            <div style={{ width: 24, flexShrink: 0 }} />
          </div>
          {ordenados.map((c, i) => {
            const tipo = getTipoComprobante(c.tipoId);
            const chip = ESTADO_CHIP[c.estado] || ESTADO_CHIP.borrador;
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: i > 0 ? `1px solid ${T.faint2}` : 'none', fontSize: 12.5 }}>
                <div style={{ width: 70, flexShrink: 0 }}>
                  <span style={{ background: tipo?.letra === 'A' ? '#1e3a8a' : '#0e7490', color: '#fff', borderRadius: 3, padding: '2px 8px', fontWeight: 800, fontSize: 12 }}>{tipo?.letra || '?'}</span>
                  <div style={{ fontSize: 9, color: T.ink3, marginTop: 2 }}>{c.numero || 's/n°'}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.receptorNombre || '—'}</div>
                  {c.concepto && <div style={{ fontSize: 11, color: T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.concepto}</div>}
                </div>
                <div style={{ width: 90, textAlign: 'right', fontFamily: T.fontMono, fontSize: 11, color: T.ink2 }}>{fmtFecha(c.fecha)}</div>
                <div style={{ width: 120, textAlign: 'right', fontFamily: T.fontMono }}>{fmtMoney(c.neto)}</div>
                <div style={{ width: 110, textAlign: 'right', fontFamily: T.fontMono, color: T.ink2 }}>{fmtMoney(c.iva)} <span style={{ fontSize: 9 }}>({c.alicuota}%)</span></div>
                <div style={{ width: 130, textAlign: 'right', fontFamily: T.fontMono, fontWeight: 700 }}>{fmtMoney(c.total)}</div>
                <div style={{ width: 90, textAlign: 'center' }}>
                  <span style={{ background: chip.bg, color: chip.color, borderRadius: 3, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>{chip.label}</span>
                </div>
                <div style={{ width: 24, flexShrink: 0, textAlign: 'center' }}>
                  {c.estado === 'borrador' && (
                    <span title="Eliminar borrador" style={{ cursor: 'pointer', color: T.ink3, fontSize: 13 }}
                      onClick={() => { if (window.confirm('¿Eliminar este borrador?')) removeComprobante(c.id); }}>✕</span>
                  )}
                </div>
              </div>
            );
          })}
        </Box>
      )}

      {modal && (
        <NuevaFacturaModal
          empresa={empresa}
          clientes={clientes}
          obras={obras}
          onSave={guardar}
          onClose={() => setModal(false)}
        />
      )}
    </PageLayout>
  );
}
