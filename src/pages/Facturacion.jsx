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
import { useMovimientos } from '../store/MovimientosContext';
import { useProveedores } from '../store/ProveedoresContext';
import { abrirHTML } from '../lib/html';
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
const mesActual = () => new Date().toISOString().slice(0, 7); // YYYY-MM

const ESTADO_CHIP = {
  borrador: { bg: '#f5f0e0', color: '#92400e', label: 'Borrador' },
  emitido:  { bg: '#e8f4f0', color: '#166534', label: 'Emitido' },
  anulado:  { bg: '#fee2e2', color: '#b91c1c', label: 'Anulado' },
};

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const labelMes = (yyyymm) => {
  if (!yyyymm || yyyymm.length < 7) return yyyymm || '';
  const [y, m] = yyyymm.split('-');
  return `${MESES[Number(m) - 1] || m} ${y}`;
};

// Descarga un CSV a partir de filas (con headers ya incluidos).
function downloadCSV(filename, rows) {
  const esc = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map(r => r.map(esc).join(';')).join('\n');
  // BOM para que Excel abra UTF-8 con acentos.
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

// ── Modal: nueva factura (Ventas — emisión) ───────────────────────────────────
function NuevaFacturaModal({ empresa, clientes, obras, comprobantes, onSave, onClose }) {
  const [form, setForm] = useState({
    clienteId: '',
    tipoId: 'FB',
    obraId: '',
    concepto: '',
    neto: '',
    alicuota: 21,
    fecha: todayISO(),
    comprobanteAsociadoId: '',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const cliente = clientes.find(c => c.id === form.clienteId) || null;

  // Solo se ofrecen los tipos de la LETRA que le corresponde al cliente.
  const letraPermitida = cliente ? (cliente.condicionIVA === 'RI' ? 'A' : 'B') : null;
  const tiposDisponibles = letraPermitida
    ? TIPOS_COMPROBANTE.filter(t => t.letra === letraPermitida)
    : TIPOS_COMPROBANTE;

  // Nota de Crédito/Débito: necesita el "comprobante asociado" (RG 5824/2026).
  // Ofrecemos las facturas emitidas a ESTE cliente y de la MISMA LETRA.
  const tipoActual = getTipoComprobante(form.tipoId);
  const esNota = !!tipoActual && /^(NC|ND)/.test(tipoActual.id);
  const asociadosPosibles = (esNota && cliente)
    ? (comprobantes || [])
        .filter(c => c.clienteId === cliente.id && c.estado !== 'anulado' && (getTipoComprobante(c.tipoId)?.letra === letraPermitida) && /^F/.test(c.tipoId))
        .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
    : [];

  useEffect(() => {
    if (!cliente) return;
    const t = getTipoComprobante(form.tipoId);
    if (!t || t.letra !== letraPermitida) {
      set('tipoId', tipoFacturaSugerido(cliente.condicionIVA || 'CF'));
    }
  }, [form.clienteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const netoNum = parseFloat(String(form.neto).replace(',', '.')) || 0;
  const calc = calcDesdeNeto(netoNum, form.alicuota);

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
    // Referencia al comprobante original (solo NC/ND): cumple RG 5824/2026.
    comprobanteAsociadoId: esNota ? (form.comprobanteAsociadoId || null) : null,
  }), [form, cliente, calc.iva, calc.total, netoNum, empresa, obras, esNota]);

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
          <div style={{ background: T.faint, borderRadius: 4, padding: '8px 12px', fontSize: 11, color: T.ink2 }}>
            <b style={{ color: T.ink }}>Emisor:</b> {empresa.razonSocial} · CUIT {formatCUIT(empresa.cuit)} · Pto. venta {empresa.puntoVenta} · Responsable Inscripto
          </div>

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

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelSt}>Tipo de comprobante *</label>
              <select
                style={{ ...inputSt, cursor: cliente ? 'pointer' : 'not-allowed', opacity: cliente ? 1 : 0.5 }}
                disabled={!cliente}
                value={form.tipoId}
                onChange={e => set('tipoId', e.target.value)}
              >
                {tiposDisponibles.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select>
              {cliente && (
                <div style={{ fontSize: 10, color: T.ink3, marginTop: 3 }}>
                  Solo letra <b>{letraPermitida}</b> — el cliente es {getCondicionIVA(cliente.condicionIVA)?.nombre || 'Consumidor Final'}.
                </div>
              )}
              {!cliente && <div style={{ fontSize: 10, color: T.ink3, marginTop: 3 }}>Elegí primero el cliente.</div>}
            </div>
            <div style={{ width: 150 }}>
              <label style={labelSt}>Fecha *</label>
              <input type="date" style={inputSt} value={form.fecha} onChange={e => set('fecha', e.target.value)} />
            </div>
          </div>

          {esNota && (
            <div>
              <label style={labelSt}>Comprobante asociado * <span style={{ fontWeight: 400, color: T.ink3, textTransform: 'none', letterSpacing: 0 }}>— factura original que ajusta</span></label>
              <select style={{ ...inputSt, cursor: asociadosPosibles.length ? 'pointer' : 'not-allowed', opacity: asociadosPosibles.length ? 1 : 0.5 }}
                disabled={!asociadosPosibles.length}
                value={form.comprobanteAsociadoId}
                onChange={e => set('comprobanteAsociadoId', e.target.value)}>
                <option value="">— Elegí la factura original —</option>
                {asociadosPosibles.map(c => {
                  const t = getTipoComprobante(c.tipoId);
                  return <option key={c.id} value={c.id}>{t?.nombre} {c.numero || 'borrador'} · {fmtFecha(c.fecha)} · {fmtMoney(c.total)}</option>;
                })}
              </select>
              {!asociadosPosibles.length && (
                <div style={{ fontSize: 10, color: '#92400e', marginTop: 3 }}>
                  No hay facturas previas de este cliente de la misma letra. AFIP exige el comprobante asociado en notas de crédito/débito (RG 5824/2026).
                </div>
              )}
            </div>
          )}

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

          <div>
            <label style={labelSt}>Concepto / detalle</label>
            <input style={inputSt} value={form.concepto} onChange={e => set('concepto', e.target.value)} placeholder="Ej: Trabajos de obra — abril 2026" />
          </div>

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
              {form.alicuota === 10.5 && (
                <div style={{ fontSize: 10, color: '#92400e', marginTop: 3 }}>
                  ⓘ 10,5% solo para obras destinadas a vivienda (Ley 23905).
                </div>
              )}
            </div>
          </div>

          <div style={{ background: '#e8f4f0', borderRadius: 5, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Neto gravado</span><b style={{ fontFamily: T.fontMono }}>{fmtMoney(calc.neto)}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: T.ink2 }}><span>IVA {form.alicuota}%</span><b style={{ fontFamily: T.fontMono }}>{fmtMoney(calc.iva)}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${T.faint2}`, paddingTop: 4, fontSize: 14 }}>
              <b style={{ color: T.ink }}>TOTAL {letra ? `(${letra})` : ''}</b>
              <b style={{ fontFamily: T.fontMono, color: T.ok }}>{fmtMoney(calc.total)}</b>
            </div>
          </div>

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

// ── KPI grande ─────────────────────────────────────────────────────────────────
function PosicionCard({ debito, credito, posicion, mes, readOnly }) {
  const aPagar  = posicion > 0;
  const aFavor  = posicion < 0;
  const color   = aPagar ? '#b91c1c' : aFavor ? '#166534' : T.ink2;
  const label   = aPagar ? 'A pagar' : aFavor ? 'A favor' : 'Sin movimiento neto';
  const monto   = Math.abs(posicion);
  return (
    <Box style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 9.5, color: T.accent, fontFamily: T.fontMono, letterSpacing: 1.5, fontWeight: 700, textTransform: 'uppercase' }}>
            ◆ Posición de IVA · {labelMes(mes)}
          </div>
          <div style={{ fontSize: 11, color: T.ink2, marginTop: 2 }}>
            Débito (Ventas) − Crédito (Compras){readOnly ? ' · vista del contador' : ''}
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: 12, alignItems: 'stretch' }}>
        <div style={{ background: '#fff7e0', borderRadius: 6, padding: '14px 16px', border: `1px solid #fde68a` }}>
          <div style={{ fontSize: 10, color: '#92400e', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Débito (Ventas)</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#92400e', fontFamily: T.fontMono, marginTop: 4 }}>{fmtMoney(debito)}</div>
        </div>
        <div style={{ background: '#e8f4f0', borderRadius: 6, padding: '14px 16px', border: `1px solid #bbf7d0` }}>
          <div style={{ fontSize: 10, color: '#166534', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Crédito (Compras)</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#166534', fontFamily: T.fontMono, marginTop: 4 }}>{fmtMoney(credito)}</div>
        </div>
        <div style={{ background: aPagar ? '#fee2e2' : aFavor ? '#dcfce7' : T.faint, borderRadius: 6, padding: '14px 16px', border: `1px solid ${aPagar ? '#fecaca' : aFavor ? '#bbf7d0' : T.faint2}` }}>
          <div style={{ fontSize: 10, color, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>{label}</div>
          <div style={{ fontSize: 28, fontWeight: 800, color, fontFamily: T.fontMono, marginTop: 4 }}>{fmtMoney(monto)}</div>
          <div style={{ fontSize: 10, color: T.ink3, marginTop: 4 }}>
            {aPagar ? 'Resta IVA débito sobre crédito.' : aFavor ? 'Tenés saldo a favor: aplicará al próximo período.' : 'Compras y ventas se compensaron.'}
          </div>
        </div>
      </div>
    </Box>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function Facturacion() {
  const { currentUser } = useUsuarios();
  const navigate = useNavigate();
  const isAdmin    = currentUser?.rol === 'Admin';
  const isContador = currentUser?.rol === 'Contador';
  const puede      = isAdmin || isContador;
  useEffect(() => { if (currentUser && !puede) navigate('/', { replace: true }); }, [currentUser, puede, navigate]);

  const { comprobantes, addComprobante, removeComprobante } = useComprobantes();
  const { clientes } = useClientes();
  const { obras } = useObras();
  const { config } = useConfiguracion();
  const { movimientos } = useMovimientos();
  const { proveedores } = useProveedores();
  const empresa = config?.empresa || {};

  const [tab, setTab] = useState('resumen'); // 'resumen' | 'ventas' | 'compras'
  const [mes, setMes] = useState(mesActual());
  const [modal, setModal] = useState(false);
  const [zipping, setZipping] = useState(false);

  // ── Datos por mes ────────────────────────────────────────────────────────────
  const ventasMes = useMemo(() => comprobantes
    .filter(c => c.estado !== 'anulado' && (c.fecha || '').slice(0, 7) === mes)
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')),
    [comprobantes, mes]);

  const comprasMes = useMemo(() => (movimientos || [])
    .filter(m => m.comprobanteRecibido && (m.fecha || '').slice(0, 7) === mes)
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')),
    [movimientos, mes]);

  // ── IVA Débito (ventas, restando notas de crédito) ───────────────────────────
  const debito = useMemo(() => ventasMes.reduce((s, c) => {
    const signo = getTipoComprobante(c.tipoId)?.signo ?? 1;
    return s + signo * (c.iva || 0);
  }, 0), [ventasMes]);

  // ── IVA Crédito (compras) ────────────────────────────────────────────────────
  const credito = useMemo(() => comprasMes.reduce((s, m) => s + (m.comprobanteRecibido?.iva || 0), 0), [comprasMes]);

  const posicion = Math.round((debito - credito) * 100) / 100;

  // ── Comparativa con el mes anterior + saldo a favor arrastrado ───────────────
  // Helper: posición IVA de un mes (YYYY-MM) cualquiera, mismo cálculo.
  const compFor = (mesKey) => {
    const v = comprobantes.filter(c => c.estado !== 'anulado' && (c.fecha || '').slice(0, 7) === mesKey);
    const c = (movimientos || []).filter(m => m.comprobanteRecibido && (m.fecha || '').slice(0, 7) === mesKey);
    const deb = v.reduce((s, x) => s + (getTipoComprobante(x.tipoId)?.signo ?? 1) * (x.iva || 0), 0);
    const cre = c.reduce((s, m) => s + (m.comprobanteRecibido?.iva || 0), 0);
    return { debito: deb, credito: cre, posicion: Math.round((deb - cre) * 100) / 100 };
  };
  // Mes anterior (YYYY-MM): restamos 1 mes al mes seleccionado.
  const mesAnterior = useMemo(() => {
    if (!mes || mes.length < 7) return null;
    const [y, m] = mes.split('-').map(Number);
    const d = new Date(y, m - 2, 1); // m-1 (cero-base) - 1
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, [mes]);
  const datosMesAnt = useMemo(() => mesAnterior ? compFor(mesAnterior) : null, [mesAnterior, comprobantes, movimientos]); // eslint-disable-line react-hooks/exhaustive-deps

  // Saldo a favor acumulado al inicio del mes seleccionado: caminamos cada mes
  // anterior en orden. Si un mes dio "a favor" → suma al saldo. Si dio "a pagar"
  // → consume del saldo (bounded ≥ 0). Es cómo funciona AFIP: el saldo a favor
  // de un período se traslada al siguiente DDJJ.
  const saldoAFavorPrevio = useMemo(() => {
    const set = new Set();
    comprobantes.forEach(c => { const k = (c.fecha || '').slice(0, 7); if (k && k < mes) set.add(k); });
    (movimientos || []).forEach(m => { if (m.comprobanteRecibido) { const k = (m.fecha || '').slice(0, 7); if (k && k < mes) set.add(k); } });
    let saldo = 0;
    [...set].sort().forEach(mk => {
      const { posicion: p } = compFor(mk);
      if (p > 0) saldo = Math.max(0, saldo - p);
      else if (p < 0) saldo += -p;
    });
    return Math.round(saldo * 100) / 100;
  }, [comprobantes, movimientos, mes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Posición efectiva del mes seleccionado: consume del saldo a favor previo.
  const efectivaAPagar = posicion > 0 ? Math.max(0, posicion - saldoAFavorPrevio) : 0;
  const saldoAFavorNuevo = posicion <= 0
    ? saldoAFavorPrevio + (-posicion)
    : Math.max(0, saldoAFavorPrevio - posicion);

  // ── CRUD ─────────────────────────────────────────────────────────────────────
  const guardar = (c) => { addComprobante(c); setModal(false); };

  // ── Helpers de export ────────────────────────────────────────────────────────
  const cuitCliente = (c) => c.receptorCuit || '';
  const cuitProveedor = (m) => m.comprobanteRecibido?.cuit || (proveedores.find(p => p.nombre === m.proveedor)?.cuit) || '';

  const exportCSVVentas = () => {
    const head = ['Fecha','Tipo','Letra','Pto.Venta','Numero','Receptor','CUIT','Cond.IVA','Neto','Alicuota','IVA','Total','Concepto'];
    const rows = ventasMes.map(c => {
      const t = getTipoComprobante(c.tipoId);
      return [
        fmtFecha(c.fecha), t?.nombre || c.tipoId, t?.letra || '',
        c.puntoVenta || '', c.numero || 'borrador',
        c.receptorNombre || '', cuitCliente(c),
        getCondicionIVA(c.receptorCondicion)?.nombre || '',
        (c.neto || 0).toFixed(2), `${c.alicuota || 0}%`, (c.iva || 0).toFixed(2), (c.total || 0).toFixed(2),
        c.concepto || '',
      ];
    });
    downloadCSV(`libro-iva-ventas-${mes}.csv`, [head, ...rows]);
  };

  // ZIP con todos los comprobantes adjuntos de las compras del mes — útil para
  // que el contador tenga el respaldo en pdf/foto sin tener que abrir el sistema.
  const sanitize = (s) => (s || '').replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ _-]/g, '').slice(0, 40).trim();
  const downloadZipComprobantes = async () => {
    const conAdjunto = comprasMes.filter(m => m.comprobanteUrl);
    if (!conAdjunto.length) { alert('No hay comprobantes adjuntos para este mes.'); return; }
    setZipping(true);
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      await Promise.all(conAdjunto.map(async m => {
        try {
          const res = await fetch(m.comprobanteUrl);
          if (!res.ok) return;
          const blob = await res.blob();
          const ext = m.comprobanteUrl.endsWith('.pdf') ? 'pdf' : 'jpg';
          const num = m.comprobanteRecibido?.numero || m.referencia || '';
          const name = `${m.fecha}_${sanitize(m.proveedor)}_${sanitize(num)}_${Math.round(m.monto || 0)}.${ext}`;
          zip.file(name, blob);
        } catch { /* omitir si falla */ }
      }));
      const content = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(content);
      a.download = `comprobantes-compras-${mes}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setZipping(false);
    }
  };

  const exportCSVCompras = () => {
    const head = ['Fecha','Tipo','Numero','Proveedor','CUIT','Neto','Alicuota','IVA','Total','Concepto','Obra'];
    const rows = comprasMes.map(m => {
      const cr = m.comprobanteRecibido || {};
      return [
        fmtFecha(m.fecha), `Factura ${cr.tipo || ''}`, cr.numero || m.referencia || '',
        m.proveedor || '', cuitProveedor(m),
        (cr.neto || 0).toFixed(2), `${cr.alicuota ?? 0}%`, (cr.iva || 0).toFixed(2), (cr.total || m.monto || 0).toFixed(2),
        m.descripcion || '', m.obraNombre || '',
      ];
    });
    downloadCSV(`libro-iva-compras-${mes}.csv`, [head, ...rows]);
  };

  const imprimirResumen = () => {
    const fila = (l, r) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${l}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;font-weight:700">${r}</td></tr>`;
    const tablaV = ventasMes.map(c => {
      const t = getTipoComprobante(c.tipoId);
      return `<tr><td>${fmtFecha(c.fecha)}</td><td>${t?.letra || '?'}</td><td>${c.receptorNombre || '-'}</td><td style="text-align:right;font-family:monospace">${fmtMoney(c.neto)}</td><td style="text-align:right;font-family:monospace">${fmtMoney(c.iva)}</td><td style="text-align:right;font-family:monospace">${fmtMoney(c.total)}</td></tr>`;
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:#888;padding:14px">— sin ventas en el mes —</td></tr>';
    const tablaC = comprasMes.map(m => {
      const cr = m.comprobanteRecibido || {};
      return `<tr><td>${fmtFecha(m.fecha)}</td><td>${cr.tipo || '?'}</td><td>${m.proveedor || '-'}</td><td style="text-align:right;font-family:monospace">${fmtMoney(cr.neto)}</td><td style="text-align:right;font-family:monospace">${fmtMoney(cr.iva)}</td><td style="text-align:right;font-family:monospace">${fmtMoney(cr.total || m.monto)}</td></tr>`;
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:#888;padding:14px">— sin compras en el mes —</td></tr>';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Resumen IVA ${labelMes(mes)}</title>
      <style>body{font-family:system-ui,sans-serif;color:#1a1a1e;padding:24px;max-width:900px;margin:0 auto}
      h1{font-size:22px;margin:0 0 4px} h2{font-size:14px;margin:18px 0 8px;letter-spacing:.5px;text-transform:uppercase;color:#666;border-bottom:2px solid #1a1a1e;padding-bottom:4px}
      table{width:100%;border-collapse:collapse;font-size:12px} th,td{padding:6px 10px;border-bottom:1px solid #eee;text-align:left}
      th{background:#1a1a1e;color:#fff;font-size:10px;letter-spacing:1px}
      .sumario{display:flex;gap:12px;margin:10px 0 6px} .box{flex:1;border:1px solid #ddd;border-radius:6px;padding:12px;text-align:center}
      .box .l{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#666} .box .v{font-size:20px;font-weight:800;font-family:monospace;margin-top:4px}
      .pos{background:${posicion>0?'#fee2e2':posicion<0?'#dcfce7':'#f5f5f5'};border-color:${posicion>0?'#fecaca':posicion<0?'#bbf7d0':'#ddd'}}
      .meta{color:#666;font-size:11px;margin-bottom:14px}</style></head><body>
      <h1>Resumen IVA · ${labelMes(mes)}</h1>
      <div class="meta">${empresa.razonSocial || ''} · CUIT ${formatCUIT(empresa.cuit || '')} · Responsable Inscripto</div>
      <div class="sumario">
        <div class="box"><div class="l">Débito (Ventas)</div><div class="v">${fmtMoney(debito)}</div></div>
        <div class="box"><div class="l">Crédito (Compras)</div><div class="v">${fmtMoney(credito)}</div></div>
        <div class="box pos"><div class="l">${posicion>0?'A pagar':posicion<0?'A favor':'Neto'}</div><div class="v">${fmtMoney(Math.abs(posicion))}</div></div>
      </div>
      <h2>Ventas · Libro IVA Débito</h2>
      <table><thead><tr><th>Fecha</th><th>Letra</th><th>Cliente</th><th style="text-align:right">Neto</th><th style="text-align:right">IVA</th><th style="text-align:right">Total</th></tr></thead><tbody>${tablaV}</tbody></table>
      <h2>Compras · Libro IVA Crédito</h2>
      <table><thead><tr><th>Fecha</th><th>Tipo</th><th>Proveedor</th><th style="text-align:right">Neto</th><th style="text-align:right">IVA</th><th style="text-align:right">Total</th></tr></thead><tbody>${tablaC}</tbody></table>
      <p style="margin-top:24px;font-size:10px;color:#888;text-align:center">Generado por Kamak · Borrador para revisión del contador. Los comprobantes definitivos se emiten ante AFIP/ARCA.</p>
      </body></html>`;
    abrirHTML(html);
  };

  if (!puede) return null;

  const tabSt = (active) => ({
    padding: '10px 18px', cursor: 'pointer', fontFamily: T.font, fontSize: 13, fontWeight: 700,
    borderBottom: active ? `3px solid ${T.accent}` : `3px solid transparent`,
    color: active ? T.ink : T.ink2, transition: 'all .12s',
  });

  return (
    <PageLayout breadcrumb={['Facturación']} active="Facturación">
      <PageHero
        label="FACTURACIÓN · ARCA / AFIP"
        title="Facturación"
        subtitle={`${comprobantes.length} comprobante${comprobantes.length === 1 ? '' : 's'} emitido${comprobantes.length === 1 ? '' : 's'} · ${comprasMes.length} factura${comprasMes.length === 1 ? '' : 's'} de compra en ${labelMes(mes)}`}
        actions={isAdmin ? <Btn fill onClick={() => setModal(true)}>+ Nueva factura</Btn> : null}
      />

      <Box style={{ padding: '10px 14px', marginBottom: 12, background: '#fff7e0', border: `1.5px solid ${T.warn}`, display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
        <span style={{ fontSize: 16 }}>⚠️</span>
        <div style={{ color: T.ink2 }}>
          Los comprobantes se guardan como <b>borrador</b> con todos los datos fiscales calculados.
          La <b>emisión real ante AFIP</b> (número oficial + CAE) se conecta en una etapa posterior — por ahora <b>no</b> se envía nada a AFIP.
        </div>
      </Box>

      {/* Tabs */}
      <Box style={{ padding: 0, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex' }}>
          <div style={tabSt(tab === 'resumen')} onClick={() => setTab('resumen')}>📊 Resumen</div>
          <div style={tabSt(tab === 'ventas')}  onClick={() => setTab('ventas')}>📤 Ventas</div>
          <div style={tabSt(tab === 'compras')} onClick={() => setTab('compras')}>📥 Compras</div>
        </div>
        <div style={{ padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 11, color: T.ink2, fontWeight: 700 }}>MES</label>
          <input type="month" value={mes} onChange={e => setMes(e.target.value)}
            style={{ ...inputSt, width: 150, padding: '4px 8px', fontSize: 12 }} />
          <Btn sm onClick={() => setMes(mesActual())}>Hoy</Btn>
        </div>
      </Box>

      {/* ── TAB RESUMEN ─────────────────────────────────────────────────────── */}
      {tab === 'resumen' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <PosicionCard debito={debito} credito={credito} posicion={posicion} mes={mes} readOnly={isContador} />

          {/* Comparativa + saldo a favor arrastrado */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Box style={{ padding: 14 }}>
              <div style={{ fontSize: 10, color: T.ink2, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Mes anterior · {labelMes(mesAnterior)}</div>
              {datosMesAnt && (datosMesAnt.debito || datosMesAnt.credito) ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: T.ink2 }}><span>Débito</span><b style={{ fontFamily: T.fontMono }}>{fmtMoney(datosMesAnt.debito)}</b></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: T.ink2 }}><span>Crédito</span><b style={{ fontFamily: T.fontMono }}>{fmtMoney(datosMesAnt.credito)}</b></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${T.faint2}`, paddingTop: 3, marginTop: 3, fontSize: 13 }}>
                    <b>{datosMesAnt.posicion > 0 ? 'A pagar' : datosMesAnt.posicion < 0 ? 'A favor' : 'Neto'}</b>
                    <b style={{ fontFamily: T.fontMono, color: datosMesAnt.posicion > 0 ? '#b91c1c' : datosMesAnt.posicion < 0 ? '#166534' : T.ink2 }}>{fmtMoney(Math.abs(datosMesAnt.posicion))}</b>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>Sin movimientos fiscales el mes anterior.</div>
              )}
            </Box>

            <Box style={{ padding: 14 }}>
              <div style={{ fontSize: 10, color: T.ink2, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Saldo a favor arrastrado</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: saldoAFavorPrevio > 0 ? '#166534' : T.ink3, fontFamily: T.fontMono, marginTop: 4 }}>{fmtMoney(saldoAFavorPrevio)}</div>
              <div style={{ fontSize: 11, color: T.ink2, marginTop: 6, lineHeight: 1.4 }}>
                {posicion > 0 && saldoAFavorPrevio > 0 ? (
                  <>El mes da <b>a pagar {fmtMoney(posicion)}</b>, pero usás <b>{fmtMoney(Math.min(posicion, saldoAFavorPrevio))}</b> del saldo a favor.<br />
                  <b style={{ color: efectivaAPagar > 0 ? '#b91c1c' : '#166534' }}>
                    {efectivaAPagar > 0 ? `Pagás efectivo: ${fmtMoney(efectivaAPagar)}` : 'Te queda saldo a favor: ' + fmtMoney(saldoAFavorNuevo)}
                  </b></>
                ) : posicion < 0 ? (
                  <>Este mes suma <b style={{ color: '#166534' }}>{fmtMoney(-posicion)}</b> al saldo. Nuevo saldo: <b>{fmtMoney(saldoAFavorNuevo)}</b>.</>
                ) : saldoAFavorPrevio > 0 ? (
                  <>Sin movimiento neto este mes. El saldo a favor sigue intacto.</>
                ) : (
                  <>Sin saldo arrastrado.</>
                )}
              </div>
            </Box>
          </div>

          <Box style={{ padding: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Btn sm onClick={imprimirResumen}>🖨 Imprimir / PDF del resumen</Btn>
            <Btn sm onClick={exportCSVVentas} style={{ opacity: ventasMes.length ? 1 : 0.5, pointerEvents: ventasMes.length ? 'auto' : 'none' }}>⬇ CSV Libro IVA Ventas</Btn>
            <Btn sm onClick={exportCSVCompras} style={{ opacity: comprasMes.length ? 1 : 0.5, pointerEvents: comprasMes.length ? 'auto' : 'none' }}>⬇ CSV Libro IVA Compras</Btn>
            <Btn sm onClick={downloadZipComprobantes} style={{ opacity: comprasMes.some(m => m.comprobanteUrl) && !zipping ? 1 : 0.5, pointerEvents: comprasMes.some(m => m.comprobanteUrl) && !zipping ? 'auto' : 'none' }}>
              {zipping ? '⏳ Armando ZIP…' : '🗂 ZIP comprobantes del mes'}
            </Btn>
          </Box>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Box style={{ padding: 14 }}>
              <div style={{ fontSize: 11, color: T.ink2, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Ventas del mes</div>
              <div style={{ fontSize: 14, fontFamily: T.fontMono, marginTop: 4 }}><b>{ventasMes.length}</b> comprobante{ventasMes.length === 1 ? '' : 's'} · {fmtMoney(ventasMes.reduce((s, c) => s + (getTipoComprobante(c.tipoId)?.signo ?? 1) * (c.total || 0), 0))}</div>
            </Box>
            <Box style={{ padding: 14 }}>
              <div style={{ fontSize: 11, color: T.ink2, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Compras del mes</div>
              <div style={{ fontSize: 14, fontFamily: T.fontMono, marginTop: 4 }}><b>{comprasMes.length}</b> factura{comprasMes.length === 1 ? '' : 's'} · {fmtMoney(comprasMes.reduce((s, m) => s + (m.comprobanteRecibido?.total || m.monto || 0), 0))}</div>
            </Box>
          </div>
        </div>
      )}

      {/* ── TAB VENTAS ──────────────────────────────────────────────────────── */}
      {tab === 'ventas' && (
        <Box style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '8px 14px', background: T.faint, borderBottom: `1px solid ${T.faint2}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: T.ink2 }}>
            <span>{ventasMes.length} comprobante{ventasMes.length === 1 ? '' : 's'} emitido{ventasMes.length === 1 ? '' : 's'} en {labelMes(mes)}</span>
            <Btn sm onClick={exportCSVVentas} style={{ opacity: ventasMes.length ? 1 : 0.5, pointerEvents: ventasMes.length ? 'auto' : 'none' }}>⬇ CSV</Btn>
          </div>
          {ventasMes.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: T.ink3, fontSize: 13 }}>
              No hay comprobantes emitidos en este mes.{isAdmin && ' Tocá + Nueva factura.'}
            </div>
          ) : (
            <>
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
              {ventasMes.map((c, i) => {
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
                      {isAdmin && c.estado === 'borrador' && (
                        <span title="Eliminar borrador" style={{ cursor: 'pointer', color: T.ink3, fontSize: 13 }}
                          onClick={() => { if (window.confirm('¿Eliminar este borrador?')) removeComprobante(c.id); }}>✕</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </Box>
      )}

      {/* ── TAB COMPRAS ─────────────────────────────────────────────────────── */}
      {tab === 'compras' && (
        <Box style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '8px 14px', background: T.faint, borderBottom: `1px solid ${T.faint2}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: T.ink2 }}>
            <span>{comprasMes.length} factura{comprasMes.length === 1 ? '' : 's'} de compra en {labelMes(mes)}</span>
            <Btn sm onClick={exportCSVCompras} style={{ opacity: comprasMes.length ? 1 : 0.5, pointerEvents: comprasMes.length ? 'auto' : 'none' }}>⬇ CSV</Btn>
          </div>
          {comprasMes.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: T.ink3, fontSize: 13 }}>
              No hay facturas de compra en este mes. El bot las carga al recibir la foto/PDF.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 14px', background: T.dark, color: '#fff', fontSize: 9.5, fontFamily: T.fontMono, letterSpacing: 1.2, fontWeight: 700 }}>
                <div style={{ width: 60, flexShrink: 0 }}>TIPO</div>
                <div style={{ flex: 1 }}>PROVEEDOR</div>
                <div style={{ width: 90, textAlign: 'right' }}>FECHA</div>
                <div style={{ width: 120, textAlign: 'right' }}>NETO</div>
                <div style={{ width: 110, textAlign: 'right' }}>IVA</div>
                <div style={{ width: 130, textAlign: 'right' }}>TOTAL</div>
                <div style={{ width: 80, textAlign: 'center' }}>COMP.</div>
              </div>
              {comprasMes.map((m, i) => {
                const cr = m.comprobanteRecibido || {};
                return (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: i > 0 ? `1px solid ${T.faint2}` : 'none', fontSize: 12.5 }}>
                    <div style={{ width: 60, flexShrink: 0 }}>
                      <span style={{ background: cr.tipo === 'A' ? '#1e3a8a' : cr.tipo === 'C' ? '#7c2d12' : '#0e7490', color: '#fff', borderRadius: 3, padding: '2px 8px', fontWeight: 800, fontSize: 12 }}>{cr.tipo || '?'}</span>
                      {cr.numero && <div style={{ fontSize: 9, color: T.ink3, marginTop: 2 }}>N° {cr.numero}</div>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.proveedor || '—'}</div>
                      {m.descripcion && <div style={{ fontSize: 11, color: T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.descripcion}</div>}
                    </div>
                    <div style={{ width: 90, textAlign: 'right', fontFamily: T.fontMono, fontSize: 11, color: T.ink2 }}>{fmtFecha(m.fecha)}</div>
                    <div style={{ width: 120, textAlign: 'right', fontFamily: T.fontMono }}>{fmtMoney(cr.neto)}</div>
                    <div style={{ width: 110, textAlign: 'right', fontFamily: T.fontMono, color: T.ink2 }}>{fmtMoney(cr.iva)} <span style={{ fontSize: 9 }}>({cr.alicuota}%)</span></div>
                    <div style={{ width: 130, textAlign: 'right', fontFamily: T.fontMono, fontWeight: 700 }}>{fmtMoney(cr.total || m.monto)}</div>
                    <div style={{ width: 80, textAlign: 'center' }}>
                      {m.comprobanteUrl ? (
                        <a href={m.comprobanteUrl} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: T.accent, fontWeight: 700, textDecoration: 'underline' }}>Ver</a>
                      ) : <span style={{ fontSize: 10, color: T.ink3 }}>—</span>}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </Box>
      )}

      {modal && (
        <NuevaFacturaModal
          empresa={empresa}
          clientes={clientes}
          obras={obras}
          comprobantes={comprobantes}
          onSave={guardar}
          onClose={() => setModal(false)}
        />
      )}
    </PageLayout>
  );
}
