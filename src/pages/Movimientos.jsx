import { useState, useMemo, useEffect } from 'react';
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

const inputSt = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none' };
const fmtN   = (n) => Math.round(Math.abs(n)).toLocaleString('es-AR');
const fmtFecha = (iso) => { if (!iso) return ''; const [, m, d] = iso.split('-'); return `${d}/${m}`; };

const MESES_N = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const mesLabel = (m) => { const [y, mo] = m.split('-'); return `${MESES_N[+mo - 1]} ${y}`; };
const navMes   = (m, d) => { const [y, mo] = m.split('-').map(Number); const nd = new Date(y, mo - 1 + d, 1); return `${nd.getFullYear()}-${String(nd.getMonth()+1).padStart(2,'0')}`; };
const todayStr = () => new Date().toISOString().split('T')[0];
const currMes  = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; };

// ── Fila de movimiento ────────────────────────────────────────────────────────
function MovRow({ m, cajas, onRemove }) {
  const [hover, setHover] = useState(false);
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
            <span style={{ background: T.faint2, borderRadius: 2, padding: '0 4px' }}>{m.obraNombre}</span>
          )}
          {m.rubroNombre && (
            <span style={{ background: '#e8f4f0', color: '#1a9b9c', borderRadius: 2, padding: '0 4px', fontWeight: 600 }}>{m.rubroNombre}</span>
          )}
          {caja && <span>{caja.nombre}</span>}
          {m.proveedor && <span>· {m.proveedor}</span>}
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
function QuickAddForm({ tipo, obras, cajas, proveedores, clientes, dolarVenta, onSave, onCancel }) {
  const isGasto  = tipo === 'gasto';
  const color    = isGasto ? T.warn : T.ok;
  const { catalog } = useCatalog();

  const [desc,          setDesc]          = useState('');
  const [monto,         setMonto]         = useState('');
  const [fecha,         setFecha]         = useState(todayStr);
  const [obraId,        setObraId]        = useState('');
  const [medio,         setMedio]         = useState('Transferencia');
  const [contraparteId, setContraparteId] = useState('');
  const [rubroNombre,   setRubroNombre]   = useState('');

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

  const canSave = montoFinal > 0 && desc.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    const obra = obras.find(o => o.id === obraId);
    const effectiveCajaId = cajasMoneda.find(c => c.id === cajaId) ? cajaId : cajasMoneda[0]?.id || cajaId;

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

    onSave({
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
      referencia:    '',
      fondoReparo:   false,
      ...extra,
    });
    setDesc(''); setMonto(''); setRubroNombre(''); setContraparteId('');
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
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {isGasto ? 'Proveedor' : 'Cliente'}
          </span>
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

        <select style={{ ...inputSt, flex: 1, cursor: 'pointer' }} value={obraId} onChange={e => setObraId(e.target.value)}>
          <option value="">Sin obra</option>
          {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        </select>

        {/* Caja filtrada por moneda seleccionada */}
        <select style={{ ...inputSt, flex: 1, cursor: 'pointer' }}
          value={cajasMoneda.find(c => c.id === cajaId) ? cajaId : cajasMoneda[0]?.id || ''}
          onChange={e => setCajaId(e.target.value)}>
          {cajasMoneda.length === 0
            ? <option value="">Sin cajas {monedaActual}</option>
            : cajasMoneda.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)
          }
        </select>

        <select style={{ ...inputSt, width: 120, cursor: 'pointer' }} value={medio} onChange={e => setMedio(e.target.value)}>
          {['Transferencia','Efectivo','Cheque','E-cheq','Débito','Tarjeta'].map(v => <option key={v}>{v}</option>)}
        </select>

        <Btn sm onClick={onCancel}>✕</Btn>
        <button onClick={save}
          style={{ padding: '6px 16px', borderRadius: 4, border: 'none', fontFamily: T.font, fontWeight: 700, fontSize: 12, cursor: canSave ? 'pointer' : 'not-allowed', background: canSave ? color : T.faint2, color: canSave ? '#fff' : T.ink3, transition: 'background .15s', flexShrink: 0 }}>
          ↵ Guardar
        </button>
      </div>

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

  return (
    <Box style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '9px 14px', background: isIngreso ? 'rgba(61,122,74,.1)' : 'rgba(212,146,58,.1)', borderBottom: `2px solid ${color}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 800, color, fontSize: 14 }}>{arrow} {label}</span>
          <span style={{ fontSize: 11, color: T.ink3 }}>{movs.length} registros</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: T.fontMono, fontWeight: 800, color, fontSize: 15 }}>$ {fmtN(total)}</span>
          <button onClick={() => setOpen(o => !o)}
            style={{ padding: '4px 12px', borderRadius: 4, border: `1.5px solid ${color}`, background: open ? color : 'transparent', color: open ? '#fff' : color, fontFamily: T.font, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            {open ? '✕ Cerrar' : `+ ${isIngreso ? 'Ingreso' : 'Gasto'}`}
          </button>
        </div>
      </div>

      {open && (
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
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setOpen(true)}
                style={{ padding: '5px 14px', borderRadius: 4, border: `1px solid ${color}`, background: 'transparent', color, fontFamily: T.font, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                + Registrar {isIngreso ? 'ingreso' : 'gasto'}
              </button>
            </div>
          </div>
        )}
        {movs.map(m => <MovRow key={m.id} m={m} cajas={cajas} onRemove={onRemove} />)}
      </div>
    </Box>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function Movimientos() {
  const { movimientos, cajas: allCajas, addMovimiento, removeMovimiento } = useMovimientos();
  const { obras }          = useObras();
  const { proveedores }    = useProveedores();
  const { clientes }       = useClientes();
  const { dolarVenta }     = useDolar();
  const { currentUser }    = useUsuarios();

  const cv = currentUser?.cajasVisibles ?? '*';
  const cajas = cv === '*' ? allCajas : allCajas.filter(c => Array.isArray(cv) && cv.includes(c.id));

  const [mes,        setMes]        = useState(currMes);
  const [filtroObra, setFiltroObra] = useState('');

  const obrasOpciones = useMemo(() =>
    obras.filter(o => ['activa', 'en-presupuesto', 'pausada'].includes(o.estado)),
    [obras]);

  const filtered = useMemo(() =>
    movimientos
      .filter(m => m.fecha.startsWith(mes) && (!filtroObra || m.obraId === filtroObra))
      .sort((a, b) => b.fecha.localeCompare(a.fecha)),
    [movimientos, mes, filtroObra]);

  const ingresos = useMemo(() => filtered.filter(m => m.tipo === 'ingreso'), [filtered]);
  const gastos   = useMemo(() => filtered.filter(m => m.tipo === 'gasto'),   [filtered]);

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
          { label: 'Total movimientos', value: String(filtered.length), color: T.ink, sub: `en ${mesLabel(mes)}` },
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
    </PageLayout>
  );
}
