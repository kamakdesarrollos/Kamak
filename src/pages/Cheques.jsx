import { useState, useMemo } from 'react';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn } from '../components/ui';
import { T } from '../theme';
import { useCheques } from '../store/ChequesContext';
import { useMovimientos } from '../store/MovimientosContext';
import { useObras } from '../store/ObrasContext';
import { useProveedores } from '../store/ProveedoresContext';
import { useClientes } from '../store/ClientesContext';

const inputSt = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };
const fmtN   = (n) => Math.round(Math.abs(n || 0)).toLocaleString('es-AR');
const todayStr = () => new Date().toISOString().split('T')[0];
const fmtFecha = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

const BANCOS = ['Banco Nación', 'Banco Galicia', 'Banco Provincia', 'Santander', 'BBVA', 'Macro', 'Supervielle', 'Credicoop', 'Comafi', 'Itaú', 'HSBC', 'Otro'];

const TIPO_OPTS = [
  { value: 'tercero',      label: 'Cheque de Tercero',   desc: 'Cheque físico recibido de un cliente' },
  { value: 'echeq_tercero', label: 'ECheq Tercero',       desc: 'Cheque electrónico recibido de un cliente' },
  { value: 'propio',       label: 'Cheque Propio',        desc: 'Cheque físico emitido por la empresa' },
  { value: 'echeq_propio', label: 'ECheq Propio',         desc: 'Cheque electrónico emitido por la empresa' },
];

const TIPO_BADGE = {
  tercero:       { label: 'Cheq 3°',   bg: '#e8f4f0', color: '#1a9b9c' },
  echeq_tercero: { label: 'ECheq 3°',  bg: '#e0f0ff', color: '#0066cc' },
  propio:        { label: 'Propio',    bg: '#fff3e0', color: '#d97706' },
  echeq_propio:  { label: 'ECheq P.',  bg: '#f3e8ff', color: '#7c3aed' },
};

const ESTADO_BADGE = {
  cartera:    { label: 'En cartera',  bg: '#e8f4f0', color: '#1a9b9c' },
  depositado: { label: 'Depositado',  bg: '#e8f4e8', color: '#2d7a2d' },
  endosado:   { label: 'Endosado',    bg: '#fff3e0', color: '#d97706' },
  rechazado:  { label: 'Rechazado',   bg: '#fde8e8', color: '#dc2626' },
  anulado:    { label: 'Anulado',     bg: T.faint2,  color: T.ink3 },
};

function diasHasta(fecha) {
  if (!fecha) return null;
  const hoy = new Date(todayStr());
  const vto = new Date(fecha);
  return Math.round((vto - hoy) / 86400000);
}

function VtoBadge({ fecha }) {
  const d = diasHasta(fecha);
  if (d === null) return <span style={{ color: T.ink3, fontSize: 11 }}>—</span>;
  let bg, color, label;
  if (d < 0)      { bg = '#fde8e8'; color = '#dc2626'; label = `Vencido ${Math.abs(d)}d`; }
  else if (d === 0) { bg = '#fff3e0'; color = '#d97706'; label = 'Hoy'; }
  else if (d <= 7)  { bg = '#fffbeb'; color = '#b45309'; label = `+${d}d`; }
  else if (d <= 30) { bg = '#ecfdf5'; color = '#059669'; label = `+${d}d`; }
  else              { bg = T.faint;   color = T.ink3;    label = `+${d}d`; }
  return (
    <span style={{ fontSize: 10, padding: '2px 5px', borderRadius: 3, background: bg, color, fontWeight: 700, fontFamily: T.fontMono, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

function Badge({ tipo, estado }) {
  const b = tipo ? TIPO_BADGE[tipo] : ESTADO_BADGE[estado];
  if (!b) return null;
  return <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: b.bg, color: b.color, fontWeight: 700, whiteSpace: 'nowrap' }}>{b.label}</span>;
}

// ── Resumen por vencimiento ────────────────────────────────────────────────────
function ResumenBand({ cheques }) {
  const grupos = useMemo(() => {
    const cartera = cheques.filter(c => c.estado === 'cartera' && (c.tipo === 'tercero' || c.tipo === 'echeq_tercero'));
    const calc = (fn) => {
      const items = cartera.filter(fn);
      return { count: items.length, monto: items.reduce((s, c) => s + (c.monto || 0), 0) };
    };
    return [
      { label: 'Vencidos',   ...calc(c => diasHasta(c.fechaVencimiento) < 0),             color: '#dc2626', bg: '#fde8e8' },
      { label: 'Hoy',        ...calc(c => diasHasta(c.fechaVencimiento) === 0),            color: '#d97706', bg: '#fff3e0' },
      { label: '1-7 días',   ...calc(c => { const d = diasHasta(c.fechaVencimiento); return d >= 1 && d <= 7; }),  color: '#b45309', bg: '#fffbeb' },
      { label: '8-30 días',  ...calc(c => { const d = diasHasta(c.fechaVencimiento); return d >= 8 && d <= 30; }), color: '#059669', bg: '#ecfdf5' },
      { label: '+30 días',   ...calc(c => (diasHasta(c.fechaVencimiento) || 0) > 30),      color: T.ink2,   bg: T.faint },
    ];
  }, [cheques]);

  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      {grupos.map(g => (
        <div key={g.label} style={{ flex: 1, minWidth: 120, padding: '10px 14px', borderRadius: 6, background: g.bg, border: `1px solid ${g.color}22` }}>
          <div style={{ fontSize: 10, color: g.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>{g.label}</div>
          <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 15, color: g.color }}>{g.count > 0 ? `$ ${fmtN(g.monto)}` : '—'}</div>
          {g.count > 0 && <div style={{ fontSize: 10, color: T.ink3, marginTop: 2 }}>{g.count} cheque{g.count !== 1 ? 's' : ''}</div>}
        </div>
      ))}
    </div>
  );
}

// ── Tabla de cheques ──────────────────────────────────────────────────────────
function ChequesTable({ cheques, onAccion }) {
  if (cheques.length === 0) return (
    <div style={{ padding: '32px 0', textAlign: 'center', color: T.ink3, fontSize: 13 }}>No hay cheques en esta vista</div>
  );
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: T.faint }}>
            {['Vencimiento', 'Tipo', 'Banco / N°', 'Emisor / Destinatario', 'Obra', 'Monto', 'Estado', ''].map(h => (
              <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: `1.5px solid ${T.faint2}`, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cheques.map(c => (
            <ChequeFila key={c.id} cheque={c} onAccion={onAccion} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChequeFila({ cheque: c, onAccion }) {
  const [hover, setHover] = useState(false);
  const esTercero = c.tipo === 'tercero' || c.tipo === 'echeq_tercero';
  return (
    <tr
      style={{ background: hover ? T.faint : 'transparent', transition: 'background .1s', cursor: 'default' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <td style={{ padding: '8px 10px', borderBottom: `1px solid ${T.faint2}` }}>
        <div style={{ fontSize: 11, fontFamily: T.fontMono, color: T.ink2 }}>{fmtFecha(c.fechaVencimiento)}</div>
        {c.estado === 'cartera' && <VtoBadge fecha={c.fechaVencimiento} />}
      </td>
      <td style={{ padding: '8px 10px', borderBottom: `1px solid ${T.faint2}` }}>
        <Badge tipo={c.tipo} />
      </td>
      <td style={{ padding: '8px 10px', borderBottom: `1px solid ${T.faint2}` }}>
        <div style={{ fontWeight: 600 }}>{c.banco || '—'}</div>
        <div style={{ fontSize: 10, color: T.ink3, fontFamily: T.fontMono }}>{c.numero || '—'}</div>
      </td>
      <td style={{ padding: '8px 10px', borderBottom: `1px solid ${T.faint2}`, maxWidth: 180 }}>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {esTercero ? (c.titular || c.clienteNombre || '—') : (c.proveedorNombre || '—')}
        </div>
        {c.estado === 'endosado' && c.endosadoA && (
          <div style={{ fontSize: 10, color: '#d97706' }}>→ {c.endosadoA}</div>
        )}
        {c.estado === 'depositado' && c.cajaDestinoNombre && (
          <div style={{ fontSize: 10, color: '#2d7a2d' }}>Dep. {c.cajaDestinoNombre}</div>
        )}
      </td>
      <td style={{ padding: '8px 10px', borderBottom: `1px solid ${T.faint2}` }}>
        <span style={{ fontSize: 11, color: T.ink3 }}>{c.obraNombre || '—'}</span>
      </td>
      <td style={{ padding: '8px 10px', borderBottom: `1px solid ${T.faint2}`, textAlign: 'right', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: T.fontMono, fontWeight: 700 }}>$ {fmtN(c.monto)}</span>
        {c.moneda === 'USD' && <span style={{ fontSize: 10, color: T.ink3, marginLeft: 4 }}>USD</span>}
      </td>
      <td style={{ padding: '8px 10px', borderBottom: `1px solid ${T.faint2}` }}>
        <Badge estado={c.estado} />
      </td>
      <td style={{ padding: '8px 10px', borderBottom: `1px solid ${T.faint2}` }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {c.estado === 'cartera' && esTercero && (
            <>
              <Btn sm onClick={() => onAccion('depositar', c)} style={{ fontSize: 10 }}>Depositar</Btn>
              <Btn sm onClick={() => onAccion('endosar', c)} style={{ fontSize: 10 }}>Endosar</Btn>
            </>
          )}
          {c.estado === 'cartera' && !esTercero && (
            <Btn sm onClick={() => onAccion('acreditar', c)} style={{ fontSize: 10 }}>Acreditado</Btn>
          )}
          {c.estado === 'cartera' && (
            <Btn sm onClick={() => onAccion('rechazar', c)} style={{ fontSize: 10, color: '#dc2626', borderColor: '#dc2626' }}>Rechazar</Btn>
          )}
          {(c.estado === 'rechazado' || c.estado === 'endosado') && (
            <Btn sm onClick={() => onAccion('reactivar', c)} style={{ fontSize: 10 }}>Reactivar</Btn>
          )}
          <Btn sm onClick={() => onAccion('editar', c)} style={{ fontSize: 10 }}>Editar</Btn>
          <Btn sm onClick={() => onAccion('eliminar', c)} style={{ fontSize: 10, color: T.ink3 }}>✕</Btn>
        </div>
      </td>
    </tr>
  );
}

// ── Modal: registrar / editar cheque ─────────────────────────────────────────
function ChequeModal({ cheque, onSave, onClose, obras, cajas }) {
  const esEdicion = !!cheque?.id;
  const [tipo, setTipo]               = useState(cheque?.tipo || 'tercero');
  const [numero, setNumero]           = useState(cheque?.numero || '');
  const [banco, setBanco]             = useState(cheque?.banco || '');
  const [titular, setTitular]         = useState(cheque?.titular || '');
  const [monto, setMonto]             = useState(cheque?.monto ? String(cheque.monto) : '');
  const [moneda, setMoneda]           = useState(cheque?.moneda || 'ARS');
  const [fechaIngreso, setFechaIngreso] = useState(cheque?.fechaIngreso || todayStr());
  const [fechaVencimiento, setFechaVencimiento] = useState(cheque?.fechaVencimiento || '');
  const [obraId, setObraId]           = useState(cheque?.obraId || '');
  const [clienteNombre, setClienteNombre] = useState(cheque?.clienteNombre || '');
  const [proveedorNombre, setProveedorNombre] = useState(cheque?.proveedorNombre || '');
  const [observacion, setObservacion] = useState(cheque?.observacion || '');

  const esTercero = tipo === 'tercero' || tipo === 'echeq_tercero';
  const montoNum = parseFloat(monto.replace(',', '.')) || 0;
  const canSave = montoNum > 0 && fechaVencimiento;

  const guardar = () => {
    if (!canSave) return;
    onSave({
      tipo, numero, banco, titular, monto: montoNum, moneda,
      fechaIngreso, fechaVencimiento,
      obraId: obraId || null,
      obraNombre: obras.find(o => o.id === obraId)?.nombre || '',
      clienteNombre: esTercero ? clienteNombre : '',
      proveedorNombre: !esTercero ? proveedorNombre : '',
      observacion,
    });
  };

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 520 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 16, fontFamily: T.font }}>{esEdicion ? 'Editar cheque' : 'Registrar cheque'}</div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Tipo */}
          {!esEdicion && (
            <div>
              <label style={labelSt}>Tipo</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {TIPO_OPTS.map(opt => (
                  <label key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '7px 10px', borderRadius: 4, border: `1.5px solid ${tipo === opt.value ? T.accent : T.faint2}`, background: tipo === opt.value ? '#f0f9f9' : 'transparent' }}>
                    <input type="radio" checked={tipo === opt.value} onChange={() => setTipo(opt.value)} style={{ accentColor: T.accent, marginTop: 2 }} />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{opt.label}</div>
                      <div style={{ fontSize: 10, color: T.ink2 }}>{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>N° de cheque</label>
              <input style={inputSt} value={numero} onChange={e => setNumero(e.target.value)} placeholder="12345678" />
            </div>
            <div>
              <label style={labelSt}>Banco</label>
              <input list="bancos-list" style={inputSt} value={banco} onChange={e => setBanco(e.target.value)} placeholder="Banco Galicia" />
              <datalist id="bancos-list">{BANCOS.map(b => <option key={b} value={b} />)}</datalist>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>{esTercero ? 'Titular (emisor)' : 'Destinatario (proveedor)'}</label>
              <input style={inputSt}
                value={esTercero ? titular : proveedorNombre}
                onChange={e => esTercero ? setTitular(e.target.value) : setProveedorNombre(e.target.value)}
                placeholder={esTercero ? 'Quien emitió el cheque' : 'A quién se emite'} />
            </div>
            {esTercero && (
              <div>
                <label style={labelSt}>Cliente</label>
                <input style={inputSt} value={clienteNombre} onChange={e => setClienteNombre(e.target.value)} placeholder="Nombre del cliente" />
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 10 }}>
            <div>
              <label style={labelSt}>Monto</label>
              <input style={{ ...inputSt, fontFamily: T.fontMono, fontWeight: 700 }} type="number" min="0" value={monto} onChange={e => setMonto(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label style={labelSt}>Moneda</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={moneda} onChange={e => setMoneda(e.target.value)}>
                <option value="ARS">ARS</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>{esTercero ? 'Fecha de recepción' : 'Fecha de emisión'}</label>
              <input type="date" style={inputSt} value={fechaIngreso} onChange={e => setFechaIngreso(e.target.value)} />
            </div>
            <div>
              <label style={labelSt}>Fecha de vencimiento *</label>
              <input type="date" style={inputSt} value={fechaVencimiento} onChange={e => setFechaVencimiento(e.target.value)} />
            </div>
          </div>

          <div>
            <label style={labelSt}>Obra (opcional)</label>
            <select style={{ ...inputSt, cursor: 'pointer' }} value={obraId} onChange={e => setObraId(e.target.value)}>
              <option value="">— Sin obra —</option>
              {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          </div>

          <div>
            <label style={labelSt}>Observación</label>
            <input style={inputSt} value={observacion} onChange={e => setObservacion(e.target.value)} placeholder="Notas adicionales…" />
          </div>
        </div>

        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill onClick={guardar} style={{ opacity: canSave ? 1 : 0.5 }}>
            {esEdicion ? 'Guardar cambios' : 'Registrar cheque'}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── Modal: depositar ──────────────────────────────────────────────────────────
function DepositarModal({ cheque, cajas, onConfirm, onClose }) {
  const cajasBancarias = cajas.filter(c => c.activa && (c.tipo === 'banco' || c.tipo === 'billetera'));
  const [fecha, setFecha]   = useState(todayStr());
  const [cajaId, setCajaId] = useState(cajasBancarias[0]?.id || '');

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 380 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: '#2d7a2d', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 16, fontFamily: T.font }}>Depositar cheque</div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: T.faint, borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{cheque.banco} #{cheque.numero}</div>
            <div style={{ fontSize: 12, color: T.ink2 }}>{cheque.titular} · <b style={{ fontFamily: T.fontMono }}>$ {fmtN(cheque.monto)}</b></div>
          </div>
          <div>
            <label style={labelSt}>Fecha de depósito</label>
            <input type="date" style={inputSt} value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
          <div>
            <label style={labelSt}>Depositar en</label>
            <select style={{ ...inputSt, cursor: 'pointer' }} value={cajaId} onChange={e => setCajaId(e.target.value)}>
              {cajasBancarias.map(c => <option key={c.id} value={c.id}>{c.nombre} · $ {fmtN(c.saldo)}</option>)}
              {cajasBancarias.length === 0 && <option value="">Sin cuentas bancarias</option>}
            </select>
          </div>
          <div style={{ fontSize: 11, color: '#2d7a2d', background: '#e8f4e8', padding: '8px 10px', borderRadius: 4 }}>
            Se registra el depósito del cheque. El ingreso ya fue acreditado al recibirlo.
          </div>
        </div>
        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill onClick={() => onConfirm({ cajaId, fecha })} style={{ background: '#2d7a2d', opacity: cajaId ? 1 : 0.5 }}>Confirmar depósito</Btn>
        </div>
      </div>
    </div>
  );
}

// ── Modal: endosar ────────────────────────────────────────────────────────────
function EndosarModal({ cheque, onConfirm, onClose }) {
  const [endosadoA, setEndosadoA] = useState('');
  const [fecha, setFecha]         = useState(todayStr());
  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 360 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: '#d97706', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 16, fontFamily: T.font }}>Endosar cheque</div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: T.faint, borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{cheque.banco} #{cheque.numero}</div>
            <div style={{ fontSize: 12, color: T.ink2 }}>$ {fmtN(cheque.monto)}</div>
          </div>
          <div>
            <label style={labelSt}>Endosado a</label>
            <input style={inputSt} value={endosadoA} onChange={e => setEndosadoA(e.target.value)} placeholder="Nombre del proveedor o destinatario" autoFocus />
          </div>
          <div>
            <label style={labelSt}>Fecha de endoso</label>
            <input type="date" style={inputSt} value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
        </div>
        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill onClick={() => onConfirm({ endosadoA, fecha })} style={{ background: '#d97706', opacity: endosadoA.trim() ? 1 : 0.5 }}>Confirmar endoso</Btn>
        </div>
      </div>
    </div>
  );
}

// ── Modal: rechazar ───────────────────────────────────────────────────────────
function RechazarModal({ cheque, onConfirm, onClose }) {
  const [motivo, setMotivo] = useState('');
  const [fecha, setFecha]   = useState(todayStr());
  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 360 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: '#dc2626', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 16, fontFamily: T.font }}>Rechazar cheque</div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: T.faint, borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{cheque.banco} #{cheque.numero}</div>
            <div style={{ fontSize: 12, color: T.ink2 }}>$ {fmtN(cheque.monto)}</div>
          </div>
          <div>
            <label style={labelSt}>Motivo de rechazo</label>
            <input style={inputSt} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Sin fondos, firma incorrecta…" autoFocus />
          </div>
          <div>
            <label style={labelSt}>Fecha de rechazo</label>
            <input type="date" style={inputSt} value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
        </div>
        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill onClick={() => onConfirm({ motivo, fecha })} style={{ background: '#dc2626' }}>Confirmar rechazo</Btn>
        </div>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function Cheques() {
  const { cheques, addCheque, updateCheque, removeCheque, depositarCheque, endosarCheque, rechazarCheque, anularCheque, reactivarCheque } = useCheques();
  const { cajas } = useMovimientos();
  const { obras } = useObras();
  const obrasActivas = obras.filter(o => o.estado === 'activa' || o.estado === 'en-presupuesto');

  const [tab, setTab]     = useState('cartera');
  const [modal, setModal] = useState(null); // null | 'nuevo' | { action, cheque }
  const [buscar, setBuscar] = useState('');

  const closeModal = () => setModal(null);

  // ── Filtrado por tab ──────────────────────────────────────────────────────
  const cartera   = useMemo(() => cheques.filter(c => c.estado === 'cartera' && (c.tipo === 'tercero' || c.tipo === 'echeq_tercero')), [cheques]);
  const emitidos  = useMemo(() => cheques.filter(c => c.tipo === 'propio' || c.tipo === 'echeq_propio'), [cheques]);
  const historial = useMemo(() => {
    if (!buscar.trim()) return cheques;
    const q = buscar.toLowerCase();
    return cheques.filter(c =>
      (c.numero || '').toLowerCase().includes(q) ||
      (c.titular || '').toLowerCase().includes(q) ||
      (c.banco || '').toLowerCase().includes(q) ||
      (c.clienteNombre || '').toLowerCase().includes(q) ||
      (c.proveedorNombre || '').toLowerCase().includes(q) ||
      (c.obraNombre || '').toLowerCase().includes(q)
    );
  }, [cheques, buscar]);

  const visibles = tab === 'cartera' ? cartera : tab === 'emitidos' ? emitidos : historial;

  // ── Acciones ──────────────────────────────────────────────────────────────
  const onAccion = (action, cheque) => {
    if (action === 'eliminar') {
      if (window.confirm(`¿Eliminar cheque #${cheque.numero || cheque.id}?`)) removeCheque(cheque.id);
      return;
    }
    if (action === 'reactivar') { reactivarCheque(cheque.id); return; }
    if (action === 'anular')    { anularCheque(cheque.id); return; }
    setModal({ action, cheque });
  };

  const handleNuevo = (data) => {
    addCheque(data);
    closeModal();
  };

  const handleEditar = (data) => {
    updateCheque(modal.cheque.id, data);
    closeModal();
  };

  const handleDepositar = ({ cajaId, fecha }) => {
    const c = modal.cheque;
    const caja = cajas.find(x => x.id === cajaId);
    depositarCheque(c.id, { cajaDestinoId: cajaId, cajaDestinoNombre: caja?.nombre || '', fechaDeposito: fecha, movimientoId: c.movimientoId || null });
    closeModal();
  };

  const handleAcreditar = ({ cajaId, fecha }) => {
    const c = modal.cheque;
    const caja = cajas.find(x => x.id === cajaId);
    depositarCheque(c.id, { cajaDestinoId: cajaId, cajaDestinoNombre: caja?.nombre || '', fechaDeposito: fecha, movimientoId: c.movimientoId || null });
    closeModal();
  };

  const handleEndosar = ({ endosadoA, fecha }) => {
    endosarCheque(modal.cheque.id, { endosadoA, fechaEndoso: fecha });
    closeModal();
  };

  const handleRechazar = ({ motivo, fecha }) => {
    rechazarCheque(modal.cheque.id, { fechaRechazo: fecha, motivoRechazo: motivo });
    closeModal();
  };

  // ── Totales ───────────────────────────────────────────────────────────────
  const totalCartera  = cartera.reduce((s, c) => s + (c.monto || 0), 0);
  const totalEmitidos = emitidos.filter(c => c.estado === 'cartera').reduce((s, c) => s + (c.monto || 0), 0);

  const TABS = [
    { key: 'cartera',   label: `Cartera de terceros`,  sub: `$ ${fmtN(totalCartera)}` },
    { key: 'emitidos',  label: `Propios emitidos`,     sub: `$ ${fmtN(totalEmitidos)}` },
    { key: 'historial', label: 'Historial',             sub: `${cheques.length} total` },
  ];

  return (
    <PageLayout breadcrumb={['Cheques']} active="Cheques">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <div>
          <div className="k-h" style={{ fontSize: 28 }}>Cheques</div>
          <div style={{ fontSize: 12, color: T.ink2 }}>Cartera de cheques · terceros y propios</div>
        </div>
        <Btn fill onClick={() => setModal('nuevo')} style={{ gap: 6 }}>+ Registrar cheque</Btn>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 14, borderBottom: `2px solid ${T.faint2}` }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '8px 18px', border: 'none', background: 'transparent', fontFamily: T.font, cursor: 'pointer', borderBottom: tab === t.key ? `2px solid ${T.accent}` : '2px solid transparent', marginBottom: -2, color: tab === t.key ? T.accent : T.ink2, fontWeight: tab === t.key ? 700 : 400, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
            <span style={{ fontSize: 13 }}>{t.label}</span>
            <span style={{ fontSize: 10, fontFamily: T.fontMono, opacity: 0.8 }}>{t.sub}</span>
          </button>
        ))}
      </div>

      {/* Resumen vencimientos (solo cartera) */}
      {tab === 'cartera' && <ResumenBand cheques={cheques} />}

      {/* Búsqueda (historial) */}
      {tab === 'historial' && (
        <div style={{ marginBottom: 10 }}>
          <input style={{ ...inputSt, maxWidth: 320 }} value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar por banco, número, titular, obra…" />
        </div>
      )}

      {/* Tabla */}
      <Box style={{ padding: 0, overflow: 'hidden' }}>
        <ChequesTable cheques={visibles} onAccion={onAccion} />
      </Box>

      {/* Modales */}
      {modal === 'nuevo' && (
        <ChequeModal obras={obrasActivas} cajas={cajas} onSave={handleNuevo} onClose={closeModal} />
      )}
      {modal?.action === 'editar' && (
        <ChequeModal cheque={modal.cheque} obras={obrasActivas} cajas={cajas} onSave={handleEditar} onClose={closeModal} />
      )}
      {modal?.action === 'depositar' && (
        <DepositarModal cheque={modal.cheque} cajas={cajas} onConfirm={handleDepositar} onClose={closeModal} />
      )}
      {modal?.action === 'acreditar' && (
        <DepositarModal cheque={modal.cheque} cajas={cajas} onConfirm={handleAcreditar} onClose={closeModal} />
      )}
      {modal?.action === 'endosar' && (
        <EndosarModal cheque={modal.cheque} onConfirm={handleEndosar} onClose={closeModal} />
      )}
      {modal?.action === 'rechazar' && (
        <RechazarModal cheque={modal.cheque} onConfirm={handleRechazar} onClose={closeModal} />
      )}
    </PageLayout>
  );
}
