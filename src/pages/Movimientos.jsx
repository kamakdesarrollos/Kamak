import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn } from '../components/ui';
import { T } from '../theme';
import { useMovimientos } from '../store/MovimientosContext';
import { useObras } from '../store/ObrasContext';
import { useProveedores } from '../store/ProveedoresContext';
import { useClientes } from '../store/ClientesContext';
import { useDolar } from '../store/DolarContext';
import { useUsuarios } from '../store/UsuariosContext';
import { useCatalog } from '../store/CatalogContext';
import { useConfiguracion } from '../store/ConfiguracionContext';
import { useCheques } from '../store/ChequesContext';

const DEFAULT_MEDIOS = ['Transferencia', 'Efectivo', 'Cheque', 'E-cheq', 'Débito', 'Tarjeta'];

const inputSt = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none' };
const fmtN   = (n) => Math.round(Math.abs(n)).toLocaleString('es-AR');
const fmtFecha = (iso) => { if (!iso) return ''; const [, m, d] = iso.split('-'); return `${d}/${m}`; };

const MESES_N = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const mesLabel = (m) => { const [y, mo] = m.split('-'); return `${MESES_N[+mo - 1]} ${y}`; };
const navMes   = (m, d) => { const [y, mo] = m.split('-').map(Number); const nd = new Date(y, mo - 1 + d, 1); return `${nd.getFullYear()}-${String(nd.getMonth()+1).padStart(2,'0')}`; };
const todayStr = () => new Date().toISOString().split('T')[0];
const currMes  = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; };

// ── Fila de traspaso ─────────────────────────────────────────────────────────
function TraspasoRow({ m, cajas, onRemove }) {
  const [hover, setHover] = useState(false);
  const origen  = cajas.find(c => c.id === m.cajaId);
  const destino = cajas.find(c => c.id === m.cajaDestinoId);
  const isCross = origen && destino && origen.moneda !== destino.moneda;
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: `1px solid ${T.faint2}`, fontSize: 12, background: hover ? T.faint : 'transparent', transition: 'background .1s', gap: 8 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink3, width: 32, flexShrink: 0 }}>{fmtFecha(m.fecha)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.descripcion}</div>
        <div style={{ fontSize: 10, color: T.ink3, display: 'flex', gap: 6, marginTop: 1, alignItems: 'center' }}>
          <span style={{ background: T.faint2, borderRadius: 2, padding: '0 4px' }}>{origen?.nombre || '—'}</span>
          <span>→</span>
          <span style={{ background: T.faint2, borderRadius: 2, padding: '0 4px' }}>{destino?.nombre || '—'}</span>
          {isCross && m.tcAplicado && <span style={{ color: T.warn }}>· TC {fmtN(m.tcAplicado)}</span>}
        </div>
      </div>
      <span style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 13, color: T.ink2, flexShrink: 0 }}>
        ↔ {origen?.moneda === 'USD' ? 'U$S' : '$'} {fmtN(m.monto)}
      </span>
      <span style={{ width: 16, flexShrink: 0 }}>
        {hover && (
          <span style={{ color: T.ink3, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
            onClick={() => { if (confirm('¿Eliminar este traspaso?')) onRemove(m.id); }}>×</span>
        )}
      </span>
    </div>
  );
}

// ── Formulario de traspaso inline ─────────────────────────────────────────────
function TraspasoForm({ cajas, dolarVenta, onSave, onCancel }) {
  const cajasActivas = cajas.filter(c => c.activa);
  const todayVal = new Date().toISOString().split('T')[0];
  const [origenId,  setOrigenId]  = useState(cajasActivas[0]?.id || '');
  const [destinoId, setDestinoId] = useState(cajasActivas[1]?.id || '');
  const [monto,     setMonto]     = useState('');
  const [fecha,     setFecha]     = useState(todayVal);
  const [concepto,  setConcepto]  = useState('');
  const [tc,        setTc]        = useState(String(Math.round(dolarVenta || 1070)));

  const origen  = cajas.find(c => c.id === origenId);
  const destino = cajas.find(c => c.id === destinoId);
  const montoNum = Math.round(parseFloat(monto.replace(/[^0-9.]/g, '')) || 0);
  const isCross  = origen && destino && origen.moneda !== destino.moneda;
  const tcNum    = parseFloat(tc) || dolarVenta || 1070;
  const montoDestino = isCross && montoNum
    ? (origen.moneda === 'ARS' ? montoNum / tcNum : montoNum * tcNum)
    : null;
  const saldoPost = origen ? (origen.saldo || 0) - montoNum : 0;
  const canSave = montoNum > 0 && origenId && destinoId && origenId !== destinoId;

  const save = () => {
    if (!canSave) return;
    onSave({
      cajaOrigenId:  origenId,
      cajaDestinoId: destinoId,
      monto:         montoNum,
      fecha,
      concepto:      concepto.trim() || `Traspaso: ${origen?.nombre} → ${destino?.nombre}`,
      tcAplicado:    isCross ? tcNum : null,
    });
  };

  return (
    <div style={{ padding: '12px 14px', background: 'rgba(100,100,200,.05)', borderBottom: `1px solid ${T.faint2}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 160 }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Caja origen</span>
          <select style={{ ...inputSt, cursor: 'pointer' }} value={origenId} onChange={e => setOrigenId(e.target.value)}>
            {cajasActivas.map(c => <option key={c.id} value={c.id}>{c.nombre} · {c.moneda === 'USD' ? 'U$S' : '$'} {fmtN(c.saldo)}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 7, fontSize: 18, color: T.ink3 }}>→</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 160 }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Caja destino</span>
          <select style={{ ...inputSt, cursor: 'pointer' }} value={destinoId} onChange={e => setDestinoId(e.target.value)}>
            {cajasActivas.filter(c => c.id !== origenId).map(c => <option key={c.id} value={c.id}>{c.nombre} · {c.moneda === 'USD' ? 'U$S' : '$'} {fmtN(c.saldo)}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 130 }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Monto ({origen?.moneda || '—'})</span>
          <input style={{ ...inputSt, fontFamily: T.fontMono, fontWeight: 700 }} type="number" min="0" placeholder="0" value={monto} onChange={e => setMonto(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel(); }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Fecha</span>
          <input type="date" style={inputSt} value={fecha} onChange={e => setFecha(e.target.value)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 2, minWidth: 180 }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Concepto</span>
          <input style={inputSt} value={concepto} onChange={e => setConcepto(e.target.value)} placeholder={`Traspaso: ${origen?.nombre || '—'} → ${destino?.nombre || '—'}`} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel(); }} />
        </div>
      </div>
      {isCross && (
        <div style={{ background: '#f6efd9', border: `1.5px solid ${T.warn}`, borderRadius: 4, padding: '8px 12px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.warn }}>Traspaso entre monedas ({origen?.moneda} → {destino?.moneda})</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: T.ink2 }}>TC aplicado</span>
            <input style={{ ...inputSt, width: 90, fontFamily: T.fontMono, fontWeight: 700 }} type="number" min="1" value={tc} onChange={e => setTc(e.target.value)} />
          </div>
          {montoDestino != null && (
            <span style={{ fontFamily: T.fontMono, fontWeight: 800, color: T.accent }}>
              = {destino?.moneda === 'USD' ? 'U$S' : '$'} {fmtN(montoDestino)}
            </span>
          )}
        </div>
      )}
      {montoNum > 0 && origen && (
        <div style={{ fontSize: 11, color: saldoPost < 0 ? T.accent : T.ink3 }}>
          Saldo post-traspaso en {origen.nombre}: {origen.moneda === 'USD' ? 'U$S' : '$'} {fmtN(saldoPost)}
          {saldoPost < 0 && <span style={{ marginLeft: 6, fontWeight: 700, color: T.accent }}>⚠ saldo insuficiente</span>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Btn sm onClick={onCancel}>Cancelar</Btn>
        <Btn sm fill onClick={save} style={{ opacity: canSave ? 1 : 0.5 }}>↔ Confirmar traspaso</Btn>
      </div>
    </div>
  );
}

// ── Panel de traspasos ────────────────────────────────────────────────────────
function TraspasoPanel({ traspasos, cajas, dolarVenta, onSave, onRemove, mes }) {
  const [open, setOpen] = useState(false);
  const sinCajas = cajas.filter(c => c.activa).length < 2;
  const total = traspasos.reduce((s, m) => s + m.monto, 0);
  return (
    <Box style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
      <div style={{ padding: '9px 14px', background: 'rgba(100,100,200,.07)', borderBottom: `2px solid ${T.ink2}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 800, color: T.ink, fontSize: 14 }}>↔ Traspasos entre cajas</span>
          <span style={{ fontSize: 11, color: T.ink3 }}>{traspasos.length} registros</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {traspasos.length > 0 && <span style={{ fontFamily: T.fontMono, fontWeight: 800, color: T.ink2, fontSize: 14 }}>$ {fmtN(total)}</span>}
          <button
            onClick={() => !sinCajas && setOpen(o => !o)}
            title={sinCajas ? 'Necesitás al menos 2 cajas activas para hacer un traspaso' : ''}
            style={{ padding: '4px 12px', borderRadius: 4, border: `1.5px solid ${sinCajas ? T.faint2 : T.ink2}`, background: open ? T.ink2 : 'transparent', color: open ? '#fff' : (sinCajas ? T.ink3 : T.ink), fontFamily: T.font, fontSize: 11, fontWeight: 700, cursor: sinCajas ? 'not-allowed' : 'pointer', opacity: sinCajas ? 0.5 : 1 }}>
            {open ? '✕ Cerrar' : '+ Traspaso'}
          </button>
        </div>
      </div>
      {open && !sinCajas && (
        <TraspasoForm
          cajas={cajas}
          dolarVenta={dolarVenta}
          onSave={(data) => { onSave(data); setOpen(false); }}
          onCancel={() => setOpen(false)}
        />
      )}
      {traspasos.length === 0 && !open ? (
        <div style={{ padding: '24px 20px', textAlign: 'center', color: T.ink3, fontSize: 12 }}>Sin traspasos en {mesLabel(mes)}</div>
      ) : (
        traspasos.map(m => <TraspasoRow key={m.id} m={m} cajas={cajas} onRemove={onRemove} />)
      )}
    </Box>
  );
}

// ── Fila de movimiento ────────────────────────────────────────────────────────
function MovRow({ m, cajas, onRemove }) {
  const [hover, setHover] = useState(false);
  const navigate = useNavigate();
  const { proveedores: provsList } = useProveedores();
  const caja = cajas.find(c => c.id === m.cajaId);
  const isIngreso = m.tipo === 'ingreso';
  const cajaIsUSD = caja?.moneda === 'USD';
  const simbolo = cajaIsUSD ? 'USD' : '$';

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: `1px solid ${T.faint2}`, fontSize: 12, background: hover ? T.faint : 'transparent', transition: 'background .1s', gap: 8 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink3, width: 32, flexShrink: 0 }}>{fmtFecha(m.fecha)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.descripcion}</div>
        <div style={{ fontSize: 10, color: T.ink3, display: 'flex', gap: 5, marginTop: 1, flexWrap: 'wrap' }}>
          {m.obraNombre && m.obraNombre !== 'General' && (
            <span
              style={{ background: T.faint2, borderRadius: 2, padding: '0 4px', cursor: m.obraId ? 'pointer' : 'default', color: m.obraId ? T.accent : undefined }}
              onClick={e => { if (m.obraId) { e.stopPropagation(); navigate(`/obras/${m.obraId}/presupuesto`); } }}>
              {m.obraNombre}
            </span>
          )}
          {m.rubroNombre && (
            <span style={{ background: '#e8f4f0', color: '#1a9b9c', borderRadius: 2, padding: '0 4px', fontWeight: 600 }}>{m.rubroNombre}</span>
          )}
          {caja && <span>{caja.nombre}</span>}
          {m.proveedor && (() => {
            const prov = m.proveedorId ? provsList.find(p => p.id === m.proveedorId) : provsList.find(p => p.nombre === m.proveedor);
            return prov
              ? <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }} onClick={e => { e.stopPropagation(); navigate(`/proveedores/${prov.id}`); }}>· {m.proveedor}</span>
              : <span>· {m.proveedor}</span>;
          })()}
          {m.medioPago && m.medioPago !== 'Transferencia' && <span>· {m.medioPago}</span>}
          {m.tipoCambio && m.montoDolar && !cajaIsUSD && (
            <span style={{ fontFamily: T.fontMono, color: T.ok }}>
              · ref USD {fmtN(m.montoDolar)}
            </span>
          )}
          {m.tipoCambio && m.montoARS && cajaIsUSD && (
            <span style={{ fontFamily: T.fontMono, color: T.ink3 }}>
              · = ${fmtN(m.montoARS)} ARS
            </span>
          )}
        </div>
      </div>
      <span style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 13, color: isIngreso ? T.ok : T.warn, flexShrink: 0 }}>
        {isIngreso ? '+' : '−'}{simbolo} {fmtN(m.monto)}
      </span>
      {m.comprobanteUrl && (
        <a href={m.comprobanteUrl} target="_blank" rel="noreferrer"
          style={{ fontSize: 13, lineHeight: 1, flexShrink: 0, textDecoration: 'none', opacity: 0.7 }}
          title="Ver comprobante" onClick={e => e.stopPropagation()}>
          {m.comprobanteUrl.endsWith('.pdf') ? '📄' : '🖼'}
        </a>
      )}
      <span style={{ width: 16, flexShrink: 0 }}>
        {hover && (
          <span style={{ color: T.ink3, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
            onClick={() => { if (confirm('¿Eliminar este movimiento?')) onRemove(m.id); }}>×</span>
        )}
      </span>
    </div>
  );
}

// ── Formulario rápido inline ──────────────────────────────────────────────────
const BANCOS_QUICK = ['Banco Nación', 'Banco Galicia', 'Banco Provincia', 'Santander', 'BBVA', 'Macro', 'Supervielle', 'Credicoop', 'Comafi', 'Itaú', 'HSBC', 'Otro'];

function QuickAddForm({ tipo, obras, cajas, proveedores, clientes, dolarVenta, onSave, onCancel }) {
  const isGasto  = tipo === 'gasto';
  const color    = isGasto ? T.warn : T.ok;
  const { catalog } = useCatalog();
  const { config } = useConfiguracion();
  const { addCheque } = useCheques();
  const mediosDePago = config?.mediosDePago?.length ? config.mediosDePago : DEFAULT_MEDIOS;

  const [desc,          setDesc]          = useState('');
  const [monto,         setMonto]         = useState('');
  const [fecha,         setFecha]         = useState(todayStr);
  const [obraId,        setObraId]        = useState('');
  const [medio,         setMedio]         = useState('Transferencia');
  const [contraparteId, setContraparteId] = useState('');
  const [rubroNombre,   setRubroNombre]   = useState('');

  // Campos del cheque (visibles solo cuando medio = Cheque / E-cheq)
  const [cheqNumero,     setCheqNumero]     = useState('');
  const [cheqBanco,      setCheqBanco]      = useState('');
  const [cheqTitular,    setCheqTitular]    = useState('');
  const [cheqVencimiento,setCheqVencimiento]= useState('');
  const isCheckPayment = medio === 'Cheque' || medio === 'E-cheq';

  // Moneda: 'ARS', 'USD' (directo a caja USD), 'USD_ARS' (pesos recibidos con ref USD, solo ingresos)
  const [monedaIngreso, setMonedaIngreso] = useState('ARS');
  const [monedaGasto,   setMonedaGasto]   = useState('ARS');
  const [tipoCambio,    setTipoCambio]    = useState(() => String(Math.round(dolarVenta || 1070)));

  // La moneda activa determina qué cajas mostrar
  const monedaActual     = isGasto ? monedaGasto : (monedaIngreso === 'USD' ? 'USD' : 'ARS');
  const cajasMoneda      = cajas.filter(c => c.activa && c.moneda === monedaActual);
  const cajaIsUSD        = monedaActual === 'USD';

  const [cajaId, setCajaId] = useState(() => cajas.filter(c => c.activa && c.moneda === 'ARS')[0]?.id || '');

  // Auto-reset cajaId cuando cambia la moneda seleccionada
  useEffect(() => {
    const firstMatch = cajas.filter(c => c.activa && c.moneda === monedaActual)[0];
    if (firstMatch) setCajaId(firstMatch.id);
  }, [monedaActual]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsedMonto  = parseFloat(monto.replace(/[^0-9.]/g, '')) || 0;
  const parsedTC     = parseFloat(tipoCambio.replace(/[^0-9.]/g, '')) || dolarVenta || 1070;

  // USD_ARS: se reciben pesos, la ref USD es monto / TC
  const montoFinal = Math.round(parsedMonto);
  const refUSD     = (!isGasto && monedaIngreso === 'USD_ARS' && parsedTC > 0)
    ? Math.round(parsedMonto / parsedTC)
    : 0;

  const effectiveCajaId = cajasMoneda.find(c => c.id === cajaId) ? cajaId : cajasMoneda[0]?.id || '';
  const canSave = montoFinal > 0 && desc.trim().length > 0 && effectiveCajaId && (!isCheckPayment || cheqVencimiento);

  const save = () => {
    if (!canSave) return;
    const obra = obras.find(o => o.id === obraId);

    let contraparteName = '';
    const extra = {};

    if (isGasto) {
      const prov = proveedores.find(p => p.id === contraparteId);
      contraparteName = prov?.nombre || '';
      extra.proveedorId = contraparteId || null;
      if (rubroNombre) extra.rubroNombre = rubroNombre;
    } else {
      const cli = clientes.find(c => c.id === contraparteId);
      contraparteName = cli?.nombre || '';
      extra.clienteId = contraparteId || null;
      if (monedaIngreso === 'USD_ARS' && refUSD > 0) {
        extra.tipoCambio = parsedTC;
        extra.montoDolar = refUSD;
      }
    }

    const movId = onSave({
      tipo,
      descripcion:   desc.trim(),
      monto:         montoFinal,
      fecha,
      obraId:        obraId || null,
      obraNombre:    obra?.nombre || 'General',
      cajaId:        effectiveCajaId,
      cajaDestinoId: null,
      proveedor:     contraparteName,
      categoria:     isGasto ? 'general' : 'cobro-cliente',
      medioPago:     medio,
      referencia:    cheqNumero || '',
      fondoReparo:   false,
      ...extra,
    });

    if (isCheckPayment && cheqVencimiento) {
      const tipoCheck = isGasto
        ? (medio === 'E-cheq' ? 'echeq_propio' : 'propio')
        : (medio === 'E-cheq' ? 'echeq_tercero' : 'tercero');
      addCheque({
        tipo:            tipoCheck,
        numero:          cheqNumero,
        banco:           cheqBanco,
        titular:         cheqTitular,
        monto:           montoFinal,
        moneda:          cajaIsUSD ? 'USD' : 'ARS',
        fechaIngreso:    fecha,
        fechaVencimiento: cheqVencimiento,
        obraId:          obraId || null,
        obraNombre:      obra?.nombre || '',
        clienteNombre:   !isGasto ? contraparteName : '',
        proveedorNombre: isGasto  ? contraparteName : '',
        cajaId:          effectiveCajaId,
        movimientoId:    movId || null,
        estado:          'cartera',
      });
    }

    setDesc(''); setMonto(''); setRubroNombre(''); setContraparteId('');
    setCheqNumero(''); setCheqBanco(''); setCheqTitular(''); setCheqVencimiento('');
  };

  const onKey = (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div style={{ padding: '12px 14px', background: isGasto ? 'rgba(212,146,58,.07)' : 'rgba(61,122,74,.07)', display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* fila 1: descripción + monto + fecha */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input autoFocus style={{ ...inputSt, flex: 1 }}
          value={desc} onChange={e => setDesc(e.target.value)} onKeyDown={onKey}
          placeholder={isGasto ? 'Descripción del gasto…' : 'Descripción del ingreso…'} />

        {/* Monto según modo */}
        {!isGasto && monedaIngreso === 'USD_ARS' ? (
          // Recibo pesos, referencia en USD: ARS ÷ TC = USD ref
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
            <input style={{ ...inputSt, width: 110, fontFamily: T.fontMono, fontWeight: 700 }}
              type="number" min="0" placeholder="$ Pesos"
              value={monto} onChange={e => setMonto(e.target.value)} onKeyDown={onKey} />
            <span style={{ fontSize: 11, color: T.ink3 }}>÷ TC</span>
            <input style={{ ...inputSt, width: 85, fontFamily: T.fontMono }}
              type="number" min="0" placeholder="TC"
              value={tipoCambio} onChange={e => setTipoCambio(e.target.value)} onKeyDown={onKey} />
            <span style={{ fontSize: 11, color: T.ink3 }}>=</span>
            <div style={{ ...inputSt, width: 90, fontFamily: T.fontMono, fontWeight: 700, color: T.ok, background: T.faint, display: 'flex', alignItems: 'center', cursor: 'default' }}>
              USD {refUSD > 0 ? fmtN(refUSD) : '0'}
            </div>
          </div>
        ) : (
          // Input directo (USD o ARS según moneda seleccionada)
          <input style={{ ...inputSt, width: 130, fontFamily: T.fontMono, fontWeight: 700 }}
            type="number" min="0" placeholder={cajaIsUSD ? 'USD' : '$ Monto'}
            value={monto} onChange={e => setMonto(e.target.value)} onKeyDown={onKey} />
        )}

        <input type="date" style={{ ...inputSt, width: 140 }}
          value={fecha} onChange={e => setFecha(e.target.value)} />
      </div>

      {/* fila 2: contraparte + moneda + obra + caja + medio */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>

        {/* Selector proveedor / cliente */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1.4, gap: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {isGasto ? 'Proveedor' : 'Cliente'}
            </span>
            {isGasto && contraparteId && (
              <span style={{ fontSize: 10, color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
                onClick={() => navigate(`/proveedores/${contraparteId}`)}>Ver CC →</span>
            )}
          </div>
          <select style={{ ...inputSt, cursor: 'pointer', width: '100%' }}
            value={contraparteId} onChange={e => setContraparteId(e.target.value)}>
            <option value="">{isGasto ? '— Sin proveedor' : '— Sin cliente'}</option>
            {isGasto
              ? proveedores.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}{p.tipo ? ` · ${p.tipo}` : ''}
                  </option>
                ))
              : clientes.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}{c.empresa ? ` · ${c.empresa}` : ''}
                  </option>
                ))
            }
          </select>
        </div>

        {/* Selector de moneda — ingresos: ARS / USD / USD→Pesos; gastos: ARS / USD */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Moneda</span>
          {isGasto ? (
            <select style={{ ...inputSt, width: 110, cursor: 'pointer' }}
              value={monedaGasto} onChange={e => setMonedaGasto(e.target.value)}>
              <option value="ARS">Pesos (ARS)</option>
              <option value="USD">Dólares (USD)</option>
            </select>
          ) : (
            <select style={{ ...inputSt, width: 110, cursor: 'pointer' }}
              value={monedaIngreso} onChange={e => setMonedaIngreso(e.target.value)}>
              <option value="ARS">Pesos (ARS)</option>
              <option value="USD">Dólares (USD)</option>
              <option value="USD_ARS">Pesos + ref USD</option>
            </select>
          )}
        </div>

        {isGasto && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 2 }}>
            <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Rubro</span>
            <select style={{ ...inputSt, cursor: 'pointer', width: '100%' }}
              value={rubroNombre} onChange={e => setRubroNombre(e.target.value)}>
              <option value="">— Sin rubro —</option>
              {(catalog.rubros || []).map(r => <option key={r.id} value={r.nombre}>{r.nombre}</option>)}
            </select>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 2 }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Obra</span>
          <select style={{ ...inputSt, cursor: 'pointer', width: '100%' }} value={obraId} onChange={e => setObraId(e.target.value)}>
            <option value="">— Sin obra —</option>
            {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 2 }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Caja</span>
          <select style={{ ...inputSt, cursor: 'pointer', width: '100%' }}
            value={cajasMoneda.find(c => c.id === cajaId) ? cajaId : cajasMoneda[0]?.id || ''}
            onChange={e => setCajaId(e.target.value)}>
            {cajasMoneda.length === 0
              ? <option value="">Sin cajas {monedaActual}</option>
              : cajasMoneda.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)
            }
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Medio de pago</span>
          <select style={{ ...inputSt, width: 120, cursor: 'pointer' }} value={medio} onChange={e => setMedio(e.target.value)}>
            {mediosDePago.map(v => <option key={v}>{v}</option>)}
          </select>
        </div>

        <Btn sm onClick={onCancel}>✕</Btn>
        <button onClick={save}
          style={{ padding: '6px 16px', borderRadius: 4, border: 'none', fontFamily: T.font, fontWeight: 700, fontSize: 12, cursor: canSave ? 'pointer' : 'not-allowed', background: canSave ? color : T.faint2, color: canSave ? '#fff' : T.ink3, transition: 'background .15s', flexShrink: 0 }}>
          ↵ Guardar
        </button>
      </div>

      {/* Fila 3: datos del cheque (solo cuando medio = Cheque / E-cheq) */}
      {isCheckPayment && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: '8px 10px', background: isGasto ? 'rgba(212,146,58,.06)' : 'rgba(61,122,74,.06)', borderRadius: 4, border: `1px dashed ${isGasto ? T.warn : T.ok}` }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0, alignSelf: 'center' }}>Datos cheque</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '0 0 100px' }}>
            <span style={{ fontSize: 10, color: T.ink3 }}>N° cheque</span>
            <input style={{ ...inputSt }} value={cheqNumero} onChange={e => setCheqNumero(e.target.value)} placeholder="12345678" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '0 0 140px' }}>
            <span style={{ fontSize: 10, color: T.ink3 }}>Banco</span>
            <input list="mov-bancos-list" style={{ ...inputSt }} value={cheqBanco} onChange={e => setCheqBanco(e.target.value)} placeholder="Banco Galicia" />
            <datalist id="mov-bancos-list">{BANCOS_QUICK.map(b => <option key={b} value={b} />)}</datalist>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
            <span style={{ fontSize: 10, color: T.ink3 }}>{isGasto ? 'Destinatario' : 'Titular (emisor)'}</span>
            <input style={{ ...inputSt }} value={cheqTitular} onChange={e => setCheqTitular(e.target.value)} placeholder={isGasto ? 'A quién se emite' : 'Quien lo firmó'} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '0 0 140px' }}>
            <span style={{ fontSize: 10, color: T.ink3 }}>Fecha de cobro *</span>
            <input type="date" style={{ ...inputSt }} value={cheqVencimiento} onChange={e => setCheqVencimiento(e.target.value)} />
          </div>
        </div>
      )}

      <div style={{ fontSize: 10, color: T.ink3 }}>Enter guarda · Esc cierra · el formulario queda abierto para cargar varios seguidos</div>
    </div>
  );
}

// ── Panel (ingresos o gastos) ─────────────────────────────────────────────────
function Panel({ tipo, movs, cajas, obras, proveedores, clientes, dolarVenta, total, mes, addMovimiento, onRemove }) {
  const [open, setOpen] = useState(false);
  const isIngreso = tipo === 'ingreso';
  const color = isIngreso ? T.ok : T.warn;
  const label = isIngreso ? 'Ingresos' : 'Gastos';
  const arrow = isIngreso ? '↑' : '↓';
  const sinCajas = cajas.filter(c => c.activa).length === 0;

  return (
    <Box style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '9px 14px', background: isIngreso ? 'rgba(61,122,74,.1)' : 'rgba(212,146,58,.1)', borderBottom: `2px solid ${color}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 800, color, fontSize: 14 }}>{arrow} {label}</span>
          <span style={{ fontSize: 11, color: T.ink3 }}>{movs.length} registros</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: T.fontMono, fontWeight: 800, color, fontSize: 15 }}>$ {fmtN(total)}</span>
          <button
            onClick={() => !sinCajas && setOpen(o => !o)}
            title={sinCajas ? 'Creá al menos una caja en Cajas antes de registrar movimientos' : ''}
            style={{ padding: '4px 12px', borderRadius: 4, border: `1.5px solid ${sinCajas ? T.faint2 : color}`, background: open ? color : 'transparent', color: open ? '#fff' : (sinCajas ? T.ink3 : color), fontFamily: T.font, fontSize: 11, fontWeight: 700, cursor: sinCajas ? 'not-allowed' : 'pointer', opacity: sinCajas ? 0.5 : 1 }}>
            {open ? '✕ Cerrar' : `+ ${isIngreso ? 'Ingreso' : 'Gasto'}`}
          </button>
        </div>
      </div>

      {sinCajas && (
        <div style={{ padding: '10px 14px', fontSize: 12, color: T.ink3, background: T.faint, borderBottom: `1px solid ${T.faint2}` }}>
          Para registrar movimientos necesitás tener al menos una caja activa.{' '}
          <a href="/cajas" style={{ color: T.accent, fontWeight: 700 }}>Ir a Cajas →</a>
        </div>
      )}

      {open && !sinCajas && (
        <QuickAddForm
          tipo={tipo}
          obras={obras}
          cajas={cajas}
          proveedores={proveedores}
          clientes={clientes}
          dolarVenta={dolarVenta}
          onSave={(data) => addMovimiento(data)}
          onCancel={() => setOpen(false)}
        />
      )}

      <div style={{ overflow: 'auto', maxHeight: 460 }}>
        {movs.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: T.ink3, fontSize: 12 }}>
            Sin {label.toLowerCase()} en {mesLabel(mes)}
            {!sinCajas && (
              <div style={{ marginTop: 8 }}>
                <button onClick={() => setOpen(true)}
                  style={{ padding: '5px 14px', borderRadius: 4, border: `1px solid ${color}`, background: 'transparent', color, fontFamily: T.font, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  + Registrar {isIngreso ? 'ingreso' : 'gasto'}
                </button>
              </div>
            )}
          </div>
        )}
        {movs.map(m => <MovRow key={m.id} m={m} cajas={cajas} onRemove={onRemove} />)}
      </div>
    </Box>
  );
}

// ── Panel comprobantes del mes ────────────────────────────────────────────────
function ComprobantesPanel({ movimientos, mes }) {
  const [open,        setOpen]        = useState(false);
  const [downloading, setDownloading] = useState(false);

  const conFoto = movimientos.filter(m => m.comprobanteUrl);
  if (!conFoto.length) return null;

  const sanitize = s => (s || '').replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ _-]/g, '').slice(0, 40).trim();

  const downloadZip = async () => {
    setDownloading(true);
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      await Promise.all(conFoto.map(async m => {
        try {
          const res = await fetch(m.comprobanteUrl);
          if (!res.ok) return;
          const blob = await res.blob();
          const ext  = m.comprobanteUrl.endsWith('.pdf') ? 'pdf' : 'jpg';
          zip.file(`${m.fecha}_${sanitize(m.descripcion)}_${Math.round(m.monto)}.${ext}`, blob);
        } catch { /* omitir si falla */ }
      }));
      const content = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(content);
      a.download = `comprobantes_${mes}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Box style={{ marginTop: 14 }}>
      <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Comprobantes del mes</span>
          <span style={{ fontSize: 11, background: T.faint2, borderRadius: 10, padding: '1px 8px', color: T.ink2 }}>{conFoto.length}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Btn sm fill onClick={e => { e.stopPropagation(); downloadZip(); }} style={{ opacity: downloading ? 0.6 : 1, pointerEvents: downloading ? 'none' : 'auto' }}>
            {downloading ? 'Preparando...' : '↓ Descargar ZIP'}
          </Btn>
          <span style={{ color: T.ink3, fontSize: 11 }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${T.faint2}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8, marginTop: 12 }}>
            {conFoto.map(m => (
              <a key={m.id} href={m.comprobanteUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: T.ink }}>
                <div style={{ border: `1.5px solid ${T.faint2}`, borderRadius: 6, overflow: 'hidden', background: T.paper }}>
                  {m.comprobanteUrl.endsWith('.pdf') ? (
                    <div style={{ height: 86, background: '#f5f0e8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>📄</div>
                  ) : (
                    <img src={m.comprobanteUrl} alt="" style={{ width: '100%', height: 86, objectFit: 'cover', display: 'block' }} />
                  )}
                  <div style={{ padding: '5px 7px' }}>
                    <div style={{ fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: T.ink }}>{m.descripcion}</div>
                    <div style={{ fontSize: 11, fontFamily: T.fontMono, fontWeight: 800, color: T.warn, marginTop: 1 }}>$ {fmtN(m.monto)}</div>
                    <div style={{ fontSize: 9, color: T.ink3, marginTop: 1 }}>{fmtFecha(m.fecha)} · {m.obraNombre || 'General'}</div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </Box>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function Movimientos() {
  const { movimientos, cajas: allCajas, addMovimiento, removeMovimiento, traspasar } = useMovimientos();
  const { obras }          = useObras();
  const { proveedores }    = useProveedores();
  const { clientes }       = useClientes();
  const { dolarVenta }     = useDolar();
  const { currentUser }    = useUsuarios();
  const cv = currentUser?.cajasVisibles ?? '*';
  const cajas = cv === '*' ? allCajas : allCajas.filter(c => Array.isArray(cv) && cv.includes(c.id));

  const [searchParams] = useSearchParams();
  const [mes,        setMes]        = useState(currMes);
  const [filtroObra, setFiltroObra] = useState(() => searchParams.get('obra') || '');

  useEffect(() => {
    const o = searchParams.get('obra');
    if (o) setFiltroObra(o);
  }, [searchParams]);

  const obrasOpciones = useMemo(() =>
    obras.filter(o => ['activa', 'en-presupuesto', 'pausada'].includes(o.estado)),
    [obras]);

  const filtered = useMemo(() =>
    movimientos
      .filter(m => m.fecha.startsWith(mes) && (!filtroObra || m.obraId === filtroObra))
      .sort((a, b) => b.fecha.localeCompare(a.fecha)),
    [movimientos, mes, filtroObra]);

  const ingresos   = useMemo(() => filtered.filter(m => m.tipo === 'ingreso'),  [filtered]);
  const gastos     = useMemo(() => filtered.filter(m => m.tipo === 'gasto'),    [filtered]);
  const traspasos  = useMemo(() => filtered.filter(m => m.tipo === 'traspaso'), [filtered]);

  const totalIngresos = ingresos.reduce((s, m) => s + m.monto, 0);
  const totalGastos   = gastos.reduce((s, m) => s + m.monto, 0);
  const neto          = totalIngresos - totalGastos;

  const exportCSV = () => {
    const rows = [['Fecha','Tipo','Descripción','Monto','Obra','Caja','Medio']];
    filtered.forEach(m => {
      const c = cajas.find(c => c.id === m.cajaId);
      rows.push([m.fecha, m.tipo, m.descripcion, m.monto, m.obraNombre || '', c?.nombre || '', m.medioPago || '']);
    });
    const csv = rows.map(r => r.join(';')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `movimientos_${mes}.csv`;
    a.click();
  };

  return (
    <PageLayout breadcrumb={['Movimientos']} active="Movimientos">

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="k-h" style={{ fontSize: 28 }}>Movimientos</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select style={{ ...inputSt, cursor: 'pointer' }} value={filtroObra} onChange={e => setFiltroObra(e.target.value)}>
            <option value="">Todas las obras</option>
            {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', border: `1.2px solid ${T.faint2}`, borderRadius: 4, overflow: 'hidden' }}>
            <span onClick={() => setMes(m => navMes(m, -1))}
              style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 16, color: T.ink2, background: T.faint, borderRight: `1px solid ${T.faint2}`, userSelect: 'none', lineHeight: 1 }}>‹</span>
            <span style={{ padding: '6px 18px', fontFamily: T.fontMono, fontSize: 12, fontWeight: 700, minWidth: 130, textAlign: 'center' }}>
              {mesLabel(mes)}
            </span>
            <span onClick={() => setMes(m => navMes(m, +1))}
              style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 16, color: T.ink2, background: T.faint, borderLeft: `1px solid ${T.faint2}`, userSelect: 'none', lineHeight: 1 }}>›</span>
          </div>
          <Btn sm onClick={exportCSV}>↗ CSV</Btn>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
        {[
          { label: 'Ingresos del mes',  value: `$ ${fmtN(totalIngresos)}`, color: T.ok,   sub: `${ingresos.length} registros` },
          { label: 'Gastos del mes',    value: `$ ${fmtN(totalGastos)}`,   color: T.warn, sub: `${gastos.length} registros` },
          { label: 'Neto',              value: `${neto >= 0 ? '+' : '−'}$ ${fmtN(neto)}`, color: neto >= 0 ? T.ok : T.warn, sub: neto >= 0 ? 'superávit' : 'déficit' },
          { label: 'Total movimientos', value: String(ingresos.length + gastos.length), color: T.ink, sub: `${traspasos.length} traspasos` },
        ].map(s => (
          <Box key={s.label} style={{ padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.label}</div>
            <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 18, color: s.color, marginTop: 2 }}>{s.value}</div>
            <div style={{ fontSize: 10, color: T.ink3, marginTop: 1 }}>{s.sub}</div>
          </Box>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Panel
          tipo="ingreso"
          movs={ingresos}
          cajas={cajas}
          obras={obrasOpciones}
          proveedores={proveedores}
          clientes={clientes}
          dolarVenta={dolarVenta}
          total={totalIngresos}
          mes={mes}
          addMovimiento={addMovimiento}
          onRemove={removeMovimiento}
        />
        <Panel
          tipo="gasto"
          movs={gastos}
          cajas={cajas}
          obras={obrasOpciones}
          proveedores={proveedores}
          clientes={clientes}
          dolarVenta={dolarVenta}
          total={totalGastos}
          mes={mes}
          addMovimiento={addMovimiento}
          onRemove={removeMovimiento}
        />
      </div>

      <TraspasoPanel
        traspasos={traspasos}
        cajas={cajas}
        dolarVenta={dolarVenta}
        onSave={traspasar}
        onRemove={removeMovimiento}
        mes={mes}
      />

      <ComprobantesPanel movimientos={filtered} mes={mes} />

    </PageLayout>
  );
}
