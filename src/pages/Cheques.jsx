import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import PageHero from '../components/ui/PageHero';
import { Box, Btn } from '../components/ui';
import { T } from '../theme';
import { useCheques } from '../store/ChequesContext';
import { useMovimientos } from '../store/MovimientosContext';
import { useObras } from '../store/ObrasContext';
import { useProveedores } from '../store/ProveedoresContext';
import { useClientes } from '../store/ClientesContext';
import { useUsuarios } from '../store/UsuariosContext';
import { idsCajasDelUsuario } from '../lib/permisosCaja';

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
  acreditado: { label: 'Acreditado',  bg: '#e8f4e8', color: '#2d7a2d' },
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
function ChequesTable({ cheques, onAccion, cajas, currentUserEmail }) {
  if (cheques.length === 0) return (
    <div style={{ padding: '32px 0', textAlign: 'center', color: T.ink3, fontSize: 13 }}>No hay cheques en esta vista</div>
  );
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: T.faint }}>
            {['Fecha de cobro', 'Tipo', 'Banco / N°', 'Emisor / Destinatario', 'Obra', 'Monto', 'Estado', ''].map(h => (
              <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: `1.5px solid ${T.faint2}`, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cheques.map(c => (
            <ChequeFila key={c.id} cheque={c} onAccion={onAccion} cajas={cajas} currentUserEmail={currentUserEmail} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChequeFila({ cheque: c, onAccion, cajas, currentUserEmail }) {
  const [hover, setHover] = useState(false);
  const navigate = useNavigate();
  const { proveedores } = useProveedores();
  const { clientes }    = useClientes();
  const esTercero = c.tipo === 'tercero' || c.tipo === 'echeq_tercero';
  const sinCaja = !c.cajaId;
  // Caja que tiene físicamente el cheque (para "en cartera de quién").
  const cajaActual = c.cajaId ? (cajas || []).find(x => x.id === c.cajaId) : null;
  // Posesión: solo quien tiene el cheque en SU caja puede depositarlo/endosarlo/
  // traspasarlo (aunque un admin lo vea). Si la caja no tiene dueño asignado
  // (ej. caja compartida/banco), no se restringe.
  const esPoseedor = !cajaActual?.usuarioId || cajaActual.usuarioId === currentUserEmail;
  const puedeOperar = !sinCaja && esPoseedor;
  // soloPosesion=true → requiere ser el poseedor; false → basta con tener caja
  // (ej. rechazar, que es registrar un hecho, no operar la tenencia).
  const btnAccion = (label, action, style = {}, soloPosesion = true) => {
    const habilitado = soloPosesion ? puedeOperar : !sinCaja;
    const title = sinCaja
      ? 'Este cheque no tiene caja asociada — editalo para asignarle una'
      : (soloPosesion && !esPoseedor)
        ? `Solo puede operarlo quien lo tiene en su caja${cajaActual ? ` (${cajaActual.nombre})` : ''}`
        : '';
    return (
      <Btn sm
        onClick={() => habilitado && onAccion(action, c)}
        title={title}
        style={{ fontSize: 10, opacity: habilitado ? 1 : 0.4, cursor: habilitado ? 'pointer' : 'not-allowed', ...style }}>
        {label}
      </Btn>
    );
  };
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
          {esTercero ? (() => {
            const nombre = c.titular || c.clienteNombre || '';
            const cli = nombre ? clientes.find(cl => cl.nombre === nombre || cl.nombre === c.clienteNombre) : null;
            return nombre
              ? <span style={{ color: cli ? T.accent : undefined, cursor: cli ? 'pointer' : 'default', textDecoration: cli ? 'underline' : 'none' }}
                  onClick={() => cli && navigate(`/clientes?q=${encodeURIComponent(nombre)}`)}>
                  {nombre}
                </span>
              : '—';
          })() : (() => {
            const nombre = c.proveedorNombre || '';
            const prov = nombre ? proveedores.find(p => p.nombre === nombre) : null;
            return nombre
              ? <span style={{ color: prov ? T.accent : undefined, cursor: prov ? 'pointer' : 'default', textDecoration: prov ? 'underline' : 'none' }}
                  onClick={() => prov && navigate(`/proveedores/${prov.id}`)}>
                  {nombre}
                </span>
              : '—';
          })()}
        </div>
        {c.estado === 'endosado' && c.endosadoA && (
          <div style={{ fontSize: 10, color: '#d97706' }}>→ {c.endosadoA}</div>
        )}
        {c.traspasoA && c.estado === 'cartera' && (
          <div style={{ fontSize: 10, color: '#6366f1' }}>↗ {c.traspasoA}</div>
        )}
        {c.estado === 'depositado' && c.cajaDestinoNombre && (
          <div style={{ fontSize: 10, color: '#2d7a2d' }}>Dep. {c.cajaDestinoNombre}</div>
        )}
      </td>
      <td style={{ padding: '8px 10px', borderBottom: `1px solid ${T.faint2}` }}>
        {c.obraId ? (
          <span style={{ fontSize: 11, color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => navigate(`/obras/${c.obraId}/presupuesto`)}>
            {c.obraNombre || '—'}
          </span>
        ) : <span style={{ fontSize: 11, color: T.ink3 }}>{c.obraNombre || '—'}</span>}
        {c.movimientoId && (
          <div style={{ fontSize: 10, color: T.accent, cursor: 'pointer', marginTop: 1 }}
            onClick={() => navigate(c.obraId ? `/obras/${c.obraId}/presupuesto?tab=5` : '/movimientos')}>
            Ver movimiento →
          </div>
        )}
      </td>
      <td style={{ padding: '8px 10px', borderBottom: `1px solid ${T.faint2}`, textAlign: 'right', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: T.fontMono, fontWeight: 700 }}>$ {fmtN(c.monto)}</span>
        {c.moneda === 'USD' && <span style={{ fontSize: 10, color: T.ink3, marginLeft: 4 }}>USD</span>}
      </td>
      <td style={{ padding: '8px 10px', borderBottom: `1px solid ${T.faint2}` }}>
        <Badge estado={c.estado} />
        {c.estado === 'cartera' && (
          <div style={{ fontSize: 10, color: cajaActual ? T.ink2 : '#dc2626', marginTop: 2 }}>
            {cajaActual ? `📍 En ${cajaActual.nombre}` : '⚠ sin caja'}
          </div>
        )}
      </td>
      <td style={{ padding: '8px 10px', borderBottom: `1px solid ${T.faint2}` }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {c.estado === 'cartera' && esTercero && (
            <>
              {btnAccion('Depositar', 'depositar')}
              {btnAccion('Endosar', 'endosar')}
              {btnAccion('Traspasar', 'traspasar', { color: sinCaja ? undefined : '#6366f1', borderColor: sinCaja ? undefined : '#6366f1' })}
            </>
          )}
          {c.estado === 'cartera' && !esTercero && (
            btnAccion('Acreditado', 'acreditar')
          )}
          {c.estado === 'cartera' && (
            btnAccion('Rechazar', 'rechazar', { color: sinCaja ? undefined : '#dc2626', borderColor: sinCaja ? undefined : '#dc2626' }, false)
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
  const cajasARS = cajas.filter(c => c.activa && c.moneda === 'ARS');
  const [tipo, setTipo]               = useState(cheque?.tipo || 'tercero');
  const [numero, setNumero]           = useState(cheque?.numero || '');
  const [banco, setBanco]             = useState(cheque?.banco || '');
  const [titular, setTitular]         = useState(cheque?.titular || '');
  const [monto, setMonto]             = useState(cheque?.monto ? String(cheque.monto) : '');
  const [moneda, setMoneda]           = useState(cheque?.moneda || 'ARS');
  const [cajaId, setCajaId]           = useState(cheque?.cajaId || cajasARS[0]?.id || '');
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
      cajaId: cajaId || null,
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

          <div>
            <label style={labelSt}>Caja *</label>
            <select style={{ ...inputSt, cursor: 'pointer' }} value={cajaId} onChange={e => setCajaId(e.target.value)}>
              <option value="">— Sin caja —</option>
              {cajasARS.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>{esTercero ? 'Fecha de recepción' : 'Fecha de emisión'}</label>
              <input type="date" style={inputSt} value={fechaIngreso} onChange={e => setFechaIngreso(e.target.value)} />
            </div>
            <div>
              <label style={labelSt}>Fecha de cobro *</label>
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
function EndosarModal({ cheque, cajas, obras, onConfirm, onClose }) {
  const cajaCheque = cajas.find(c => c.id === cheque.cajaId);
  const [endosadoA, setEndosadoA] = useState('');
  const [fecha,      setFecha]    = useState(todayStr());
  const [obraId,     setObraId]   = useState(cheque.obraId || '');
  const [concepto,   setConcepto] = useState('');

  // Si el cheque no tiene cajaId registrada, permitir seleccionarla
  const sinCaja = !cheque.cajaId;
  const cajasActivas = cajas.filter(c => c.activa);
  const [cajaIdFallback, setCajaIdFallback] = useState(cajasActivas[0]?.id || '');
  const cajaIdFinal = cheque.cajaId || cajaIdFallback;

  const canConfirm = endosadoA.trim() && cajaIdFinal;

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: '#d97706', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, fontFamily: T.font }}>Endosar cheque</div>
            <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>Se registrará un gasto por el monto del cheque</div>
          </div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: T.faint, borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{cheque.banco}{cheque.numero ? ` #${cheque.numero}` : ''}</div>
            <div style={{ fontSize: 12, color: T.ink2, fontFamily: T.fontMono, fontWeight: 700 }}>$ {fmtN(cheque.monto)}</div>
          </div>

          <div>
            <label style={labelSt}>Endosado a (proveedor / destinatario) *</label>
            <input style={inputSt} value={endosadoA} onChange={e => setEndosadoA(e.target.value)}
              placeholder="Nombre de quien recibe el cheque" autoFocus />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>Fecha de endoso</label>
              <input type="date" style={inputSt} value={fecha} onChange={e => setFecha(e.target.value)} />
            </div>
            <div>
              <label style={labelSt}>Caja de egreso</label>
              {sinCaja ? (
                <select style={{ ...inputSt, cursor: 'pointer' }} value={cajaIdFallback} onChange={e => setCajaIdFallback(e.target.value)}>
                  {cajasActivas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              ) : (
                <div style={{ ...inputSt, background: T.faint, color: T.ink2 }}>{cajaCheque?.nombre || '—'}</div>
              )}
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
            <label style={labelSt}>Concepto</label>
            <input style={inputSt} value={concepto} onChange={e => setConcepto(e.target.value)}
              placeholder={`Pago a ${endosadoA || 'proveedor'}`} />
          </div>
        </div>
        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill onClick={() => onConfirm({ endosadoA, fecha, cajaId: cajaIdFinal, obraId, concepto })}
            style={{ background: '#d97706', opacity: canConfirm ? 1 : 0.5 }}>
            Confirmar endoso
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── Modal: traspasar ──────────────────────────────────────────────────────────
function TraspasoModal({ cheque, cajas, onConfirm, onClose }) {
  const cajaCheque = cajas.find(c => c.id === cheque.cajaId);
  const sinCaja = !cheque.cajaId;
  const cajasDestino = cajas.filter(c => c.activa && c.id !== cheque.cajaId);
  const [cajaDestinoId, setCajaDestinoId] = useState(cajasDestino[0]?.id || '');
  const [fecha,          setFecha]         = useState(todayStr());
  const [nota,           setNota]          = useState('');

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 400 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: sinCaja ? T.ink2 : '#6366f1', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, fontFamily: T.font }}>Traspasar cheque</div>
            <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>El cheque queda en cartera, bajo custodia de otra persona</div>
          </div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: T.faint, borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{cheque.banco}{cheque.numero ? ` #${cheque.numero}` : ''}</div>
            <div style={{ display: 'flex', gap: 12, marginTop: 3, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: T.ink2, fontFamily: T.fontMono, fontWeight: 700 }}>$ {fmtN(cheque.monto)}</span>
              {cajaCheque
                ? <span style={{ fontSize: 11, color: T.ok, fontWeight: 600 }}>Caja: {cajaCheque.nombre}</span>
                : <span style={{ fontSize: 11, color: T.warn, fontWeight: 600 }}>⚠ Sin caja asociada</span>
              }
            </div>
          </div>

          {sinCaja ? (
            <div style={{ fontSize: 12, color: T.warn, background: '#fff8e1', border: `1px solid ${T.warn}`, borderRadius: 4, padding: '10px 12px' }}>
              Este cheque no tiene una caja asociada. Para mantener trazabilidad completa, editá el cheque y asocialo a una caja antes de traspasar.
            </div>
          ) : (
            <>
              <div>
                <label style={labelSt}>Traspasar a caja *</label>
                {cajasDestino.length === 0
                  ? <div style={{ ...inputSt, background: T.faint, color: T.ink3 }}>No hay otras cajas disponibles</div>
                  : <select style={{ ...inputSt, cursor: 'pointer' }} value={cajaDestinoId} onChange={e => setCajaDestinoId(e.target.value)} autoFocus>
                      {cajasDestino.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                }
              </div>
              <div>
                <label style={labelSt}>Fecha</label>
                <input type="date" style={inputSt} value={fecha} onChange={e => setFecha(e.target.value)} />
              </div>
              <div>
                <label style={labelSt}>Nota (opcional)</label>
                <input style={inputSt} value={nota} onChange={e => setNota(e.target.value)}
                  placeholder="Para qué / a quién va a pagar" />
              </div>
              <div style={{ fontSize: 11, color: '#6366f1', background: '#eef2ff', padding: '8px 10px', borderRadius: 4 }}>
                No genera movimiento. Cuando se concrete el pago, registralo como endoso.
              </div>
            </>
          )}
        </div>
        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn sm onClick={onClose}>{sinCaja ? 'Cerrar' : 'Cancelar'}</Btn>
          {!sinCaja && (
            <Btn sm fill
              onClick={() => {
                const caja = cajasDestino.find(c => c.id === cajaDestinoId);
                onConfirm({ traspasadoA: caja?.nombre || cajaDestinoId, cajaDestinoId, fecha, nota });
              }}
              style={{ background: '#6366f1', opacity: (cajaDestinoId && cajasDestino.length > 0) ? 1 : 0.5 }}>
              Confirmar traspaso
            </Btn>
          )}
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
  const { currentUser } = useUsuarios();
  const navigate = useNavigate();
  const isAdmin = currentUser?.rol === 'Admin';

  // Admin y Administración entran; Administración ve solo los cheques en su poder (filtro abajo).
  const puedeCheques = isAdmin || currentUser?.rol === 'Administración';
  useEffect(() => {
    if (currentUser && !puedeCheques) navigate('/', { replace: true });
  }, [currentUser, puedeCheques, navigate]);

  const { cheques: chequesAll, addCheque, updateCheque, removeCheque, depositarCheque, acreditarCheque, endosarCheque, rechazarCheque, anularCheque, reactivarCheque } = useCheques();
  const { cajas, addMovimiento, removeMovimiento, traspasar } = useMovimientos();
  // No-admin (ej. Administración): solo ve cheques "en su poder" = los de SUS cajas
  // (de las que es responsable + las asignadas a mano). Filtra TODA la base (lista,
  // totales y resumen por vencimiento), no solo la lista.
  const _idsCajasCheq = idsCajasDelUsuario(cajas, currentUser);
  const cheques = isAdmin ? chequesAll : chequesAll.filter(c => c.cajaId && _idsCajasCheq.includes(c.cajaId));
  const { obras } = useObras();
  const obrasActivas = obras.filter(o => o.estado === 'activa' || o.estado === 'en-presupuesto');

  const [tab, setTab]     = useState('cartera');
  const [modal, setModal] = useState(null); // null | 'nuevo' | { action, cheque }
  const [buscar, setBuscar] = useState('');
  const [filtroVencer7, setFiltroVencer7] = useState(false);

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

  // En 7 días — calculado acá temprano para poder filtrar `visibles` con él.
  const en7Dias = useMemo(() => cartera.filter(c => {
    const f = c.fechaVencimiento;
    if (!f) return false;
    const ms = new Date(f).getTime() - Date.now();
    const dias = Math.ceil(ms / (24 * 60 * 60 * 1000));
    return dias >= 0 && dias <= 7;
  }), [cartera]);
  const totalEn7 = useMemo(() => en7Dias.reduce((s, c) => s + (c.monto || 0), 0), [en7Dias]);

  let visibles = tab === 'cartera' ? cartera : tab === 'emitidos' ? emitidos : historial;
  if (filtroVencer7) {
    const idsEn7 = new Set(en7Dias.map(c => c.id));
    visibles = visibles.filter(c => idsEn7.has(c.id));
  }
  // El filtro "en su poder" para no-admin ya se aplicó en la base (const cheques),
  // así que cartera/emitidos/historial/resumen quedan filtrados de forma coherente.

  // ── Acciones ──────────────────────────────────────────────────────────────
  // Ajusta la caja cuando un cheque "sale" (anular/rechazar/endosar) o
  // "reingresa" (reactivar). La dirección depende del tipo de cheque:
  //  - tercero (recibido): entró como INGRESO → su salida es GASTO; reingreso = INGRESO.
  //  - propio (emitido):   salió como GASTO  → su "salida" (anular) DEVUELVE = INGRESO; reingreso = GASTO.
  // Solo aplica si el cheque estaba contado en una caja.
  const ajustarCajaCheque = (cheque, modo, motivo, fecha) => {
    if (!cheque.cajaId || !(cheque.monto > 0)) return;
    const esTercero = cheque.tipo === 'tercero' || cheque.tipo === 'echeq_tercero';
    const esEcheq = cheque.tipo === 'echeq_tercero' || cheque.tipo === 'echeq_propio';
    const tipo = modo === 'salida'
      ? (esTercero ? 'gasto' : 'ingreso')
      : (esTercero ? 'ingreso' : 'gasto');
    addMovimiento({
      tipo,
      descripcion: `${motivo}${cheque.numero ? ` #${cheque.numero}` : ''}`,
      monto: cheque.monto,
      fecha: fecha || todayStr(),
      cajaId: cheque.cajaId,
      cajaDestinoId: null,
      obraId: cheque.obraId || null,
      obraNombre: cheque.obraNombre || 'General',
      proveedor: cheque.clienteNombre || cheque.titular || cheque.proveedorNombre || '',
      categoria: 'cheque',
      medioPago: esEcheq ? 'E-cheq' : 'Cheque',
      referencia: cheque.numero || '',
      fondoReparo: false,
    });
  };

  const onAccion = (action, cheque) => {
    if (action === 'eliminar') {
      if (window.confirm(`¿Eliminar cheque #${cheque.numero || cheque.id}?`)) {
        // Borrar el cheque revierte también su movimiento (el ingreso que generó
        // al recibirlo), para no dejar plata contada sin respaldo.
        if (cheque.movimientoId) removeMovimiento(cheque.movimientoId);
        removeCheque(cheque.id);
      }
      return;
    }
    if (action === 'reactivar') {
      // Vuelve a cartera: si estaba contado, repone la plata en la caja.
      ajustarCajaCheque(cheque, 'reingreso', 'Cheque reactivado');
      reactivarCheque(cheque.id);
      return;
    }
    if (action === 'anular') {
      // Anula: revierte el efecto en la caja (tercero sale, propio se devuelve).
      ajustarCajaCheque(cheque, 'salida', 'Cheque anulado');
      anularCheque(cheque.id);
      return;
    }
    if (action === 'acreditar') {
      // Cheque PROPIO cobrado por el recipiente: NO genera movimiento (la caja ya
      // se descontó al emitirlo). Solo cambia el estado. Antes reusaba el flujo de
      // depósito → doble egreso de la caja de origen.
      if (window.confirm(`¿Marcar el cheque #${cheque.numero || cheque.id} como acreditado?\n\nNo genera movimiento de caja: la plata ya se descontó cuando se emitió el cheque.`)) {
        acreditarCheque(cheque.id, {});
      }
      return;
    }
    setModal({ action, cheque });
  };

  const handleNuevo = (data) => {
    // Modelo "al recibirlo": el cheque impacta la caja en el momento de
    // registrarlo (igual que el cobro/pago con cheque desde Movimientos).
    //  - tercero (recibido) → ingreso a la caja
    //  - propio (emitido)   → gasto desde la caja
    // Vinculamos el movimiento al cheque (movimientoId) para poder revertirlo
    // si se borra el movimiento o se anula el cheque.
    const esTercero = data.tipo === 'tercero' || data.tipo === 'echeq_tercero';
    const esEcheq = data.tipo === 'echeq_tercero' || data.tipo === 'echeq_propio';
    let movimientoId = null;
    if (data.cajaId && (data.monto || 0) > 0) {
      movimientoId = addMovimiento({
        tipo: esTercero ? 'ingreso' : 'gasto',
        descripcion: `${esTercero ? 'Cheque recibido' : 'Cheque emitido'}${data.numero ? ` #${data.numero}` : ''}${data.banco ? ` · ${data.banco}` : ''}`,
        monto: data.monto,
        fecha: data.fechaIngreso,
        obraId: data.obraId || null,
        obraNombre: data.obraNombre || 'General',
        cajaId: data.cajaId,
        cajaDestinoId: null,
        proveedor: esTercero ? (data.clienteNombre || data.titular || '') : (data.proveedorNombre || ''),
        categoria: 'cheque',
        medioPago: esEcheq ? 'E-cheq' : 'Cheque',
        referencia: data.numero || '',
        fondoReparo: false,
      });
    }
    addCheque({ ...data, movimientoId });
    closeModal();
  };

  const handleEditar = (data) => {
    updateCheque(modal.cheque.id, data);
    closeModal();
  };

  const handleDepositar = ({ cajaId, fecha }) => {
    const c = modal.cheque;
    const caja = cajas.find(x => x.id === cajaId);
    // Modelo "al recibirlo": el cheque ya entró a una caja al registrarlo.
    // Depositar = TRASPASO de esa caja al banco (baja de una, sube de otra),
    // NO un ingreso nuevo (sino duplicaríamos la plata).
    // Caso legacy: si el cheque no tenía caja de origen (nunca se contó),
    // entonces sí entra como ingreso al banco recién al depositarlo.
    if (c.cajaId && c.cajaId !== cajaId) {
      traspasar({
        cajaOrigenId: c.cajaId,
        cajaDestinoId: cajaId,
        monto: c.monto,
        fecha,
        concepto: `Depósito cheque${c.numero ? ` #${c.numero}` : ''}${caja ? ` en ${caja.nombre}` : ''}`,
      });
    } else if (!c.cajaId) {
      addMovimiento({
        tipo: 'ingreso',
        descripcion: `Depósito cheque${c.numero ? ` #${c.numero}` : ''}`,
        monto: c.monto,
        fecha,
        obraId: c.obraId || null,
        obraNombre: c.obraNombre || 'General',
        cajaId,
        cajaDestinoId: null,
        proveedor: c.clienteNombre || c.titular || '',
        categoria: 'cheque',
        medioPago: (c.tipo === 'echeq_tercero' || c.tipo === 'echeq_propio') ? 'E-cheq' : 'Cheque',
        referencia: c.numero || '',
        fondoReparo: false,
      });
    }
    depositarCheque(c.id, { cajaDestinoId: cajaId, cajaDestinoNombre: caja?.nombre || '', fechaDeposito: fecha, movimientoId: c.movimientoId || null });
    closeModal();
  };

  // handleAcreditar era identico a handleDepositar — unificado.

  const handleEndosar = ({ endosadoA, fecha, obraId, concepto }) => {
    const c = modal.cheque;
    const obra = obrasActivas.find(o => o.id === obraId);
    const esEcheq = c.tipo === 'echeq_tercero' || c.tipo === 'echeq_propio';
    const desc = concepto.trim() ||
      `Endoso ${esEcheq ? 'ECheq' : 'Cheque'}${c.numero ? ` #${c.numero}` : ''} a ${endosadoA}`;

    // Modelo "al recibirlo": si el cheque de tercero ya estaba contado en una
    // caja, endosarlo (dárselo a un tercero) hace que la plata SALGA de esa
    // caja (gasto). Si no tenía caja (cheque legacy nunca contado), registramos
    // un 'endoso' que no toca saldo (comportamiento viejo).
    const esTercero = c.tipo === 'tercero' || c.tipo === 'echeq_tercero';
    addMovimiento({
      tipo: (c.cajaId && esTercero) ? 'gasto' : 'endoso',
      descripcion: desc,
      monto: c.monto,
      fecha,
      cajaId: c.cajaId || null,
      obraId: obraId || null,
      obraNombre: obra?.nombre || 'General',
      proveedor: endosadoA,
      categoria: 'endoso',
      medioPago: esEcheq ? 'E-cheq' : 'Cheque',
      referencia: c.numero || '',
      fondoReparo: false,
    });

    endosarCheque(c.id, { endosadoA, fechaEndoso: fecha });
    closeModal();
  };

  const handleRechazar = ({ motivo, fecha }) => {
    const c = modal.cheque;
    // Si estaba contado en una caja, al rebotar se revierte (tercero sale).
    ajustarCajaCheque(c, 'salida', `Cheque rechazado${motivo ? ` · ${motivo}` : ''}`, fecha);
    rechazarCheque(c.id, { fechaRechazo: fecha, motivoRechazo: motivo });
    closeModal();
  };

  const handleTraspasar = ({ traspasadoA, cajaDestinoId, fecha, nota }) => {
    const c = modal.cheque;
    // Mover el cheque a otra caja = traspaso de plata entre cajas (baja de la
    // caja donde estaba, sube a la destino). Solo si el cheque ya estaba en una
    // caja (fue contado al recibirlo).
    if (c.cajaId && cajaDestinoId && c.cajaId !== cajaDestinoId) {
      const cajaDest = cajas.find(x => x.id === cajaDestinoId);
      traspasar({
        cajaOrigenId: c.cajaId,
        cajaDestinoId,
        monto: c.monto,
        fecha,
        concepto: nota || `Traspaso cheque${c.numero ? ` #${c.numero}` : ''}${cajaDest ? ` a ${cajaDest.nombre}` : ''}`,
      });
    }
    updateCheque(c.id, {
      cajaId: cajaDestinoId || c.cajaId,
      traspasoA: traspasadoA,
      fechaTraspaso: fecha,
      observacion: nota || c.observacion,
    });
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
      <PageHero
        label="CARTERA DE CHEQUES"
        title="Cheques"
        subtitle="Cartera de cheques · terceros y propios"
        actions={
          <Btn fill onClick={() => setModal('nuevo')} style={{ gap: 6 }}>+ Registrar cheque</Btn>
        }
        kpis={[
          {
            label: 'Cartera de terceros', value: cartera.length, sub: `$ ${fmtN(totalCartera)}`,
            color: tab === 'cartera' && !filtroVencer7 ? T.accent : T.ink,
            active: tab === 'cartera' && !filtroVencer7,
            onClick: () => { setTab('cartera'); setFiltroVencer7(false); },
          },
          {
            label: 'Propios emitidos', value: emitidos.filter(c => c.estado === 'cartera').length, sub: `$ ${fmtN(totalEmitidos)}`,
            color: tab === 'emitidos' && !filtroVencer7 ? T.accent : T.ink,
            active: tab === 'emitidos' && !filtroVencer7,
            onClick: () => { setTab('emitidos'); setFiltroVencer7(false); },
          },
          {
            label: 'Historial', value: cheques.length, sub: 'incl. cobrados/anulados',
            color: tab === 'historial' && !filtroVencer7 ? T.accent : T.ink,
            active: tab === 'historial' && !filtroVencer7,
            onClick: () => { setTab('historial'); setFiltroVencer7(false); },
          },
          {
            label: 'Vencen en 7 d', value: en7Dias.length, sub: `$ ${fmtN(totalEn7)}`,
            color: filtroVencer7 ? T.accent : (en7Dias.length > 0 ? T.warn : T.ink),
            active: filtroVencer7,
            onClick: () => { setTab('cartera'); setFiltroVencer7(prev => !prev); },
          },
        ]}
      />

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
        <ChequesTable cheques={visibles} onAccion={onAccion} cajas={cajas} currentUserEmail={currentUser?.email} />
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
      {modal?.action === 'endosar' && (
        <EndosarModal cheque={modal.cheque} cajas={cajas} obras={obrasActivas} onConfirm={handleEndosar} onClose={closeModal} />
      )}
      {modal?.action === 'traspasar' && (
        <TraspasoModal cheque={modal.cheque} cajas={cajas} onConfirm={handleTraspasar} onClose={closeModal} />
      )}
      {modal?.action === 'rechazar' && (
        <RechazarModal cheque={modal.cheque} onConfirm={handleRechazar} onClose={closeModal} />
      )}
    </PageLayout>
  );
}
