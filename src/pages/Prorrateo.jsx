import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn, Label } from '../components/ui';
import PageHero from '../components/ui/PageHero';
import { T } from '../theme';
import { useGastosFijos } from '../store/GastosFijosContext';
import { useObras } from '../store/ObrasContext';
import { useUsuarios } from '../store/UsuariosContext';
import { useMovimientos } from '../store/MovimientosContext';
import { useDolar } from '../store/DolarContext';
import { useIsMobile } from '../hooks/useMediaQuery';
import { esErrorRpcFaltante } from '../lib/pagoAtomico';
import { newId } from '../lib/id';
import { supabase } from '../lib/supabase';

const fmtN = (n) => Math.round(n).toLocaleString('es-AR');

const CRITERIOS = [
  { key: 'tiempo', label: 'Por tiempo de obra activa en el mes' },
  { key: 'peso',   label: 'Por peso económico (% del presupuesto)' },
  { key: 'mixto',  label: 'Mixto · 50% tiempo + 50% peso' },
  { key: 'manual', label: 'Manual (definí % por obra)' },
];

const MES_ACTUAL = new Date().toLocaleString('es-AR', { month: 'long', year: 'numeric' });

export default function Prorrateo() {
  const navigate = useNavigate();
  const { currentUser } = useUsuarios();
  const isMobile = useIsMobile();
  const isAllowed = !currentUser || currentUser.rol === 'Admin' || currentUser.rol === 'Administración';
  useEffect(() => {
    if (currentUser && !isAllowed) navigate('/', { replace: true });
  }, [currentUser, isAllowed, navigate]);

  const { items, setItems, totalMensual } = useGastosFijos();
  const { obras } = useObras();
  const { addMovimientoAsync, movimientos } = useMovimientos();
  const { dolarVenta } = useDolar();
  const [criterio, setCriterio]     = useState('mixto');
  const [manualPct, setManualPct]   = useState({});
  const [confirmado, setConfirmado] = useState(false);
  const [guardando, setGuardando]   = useState(false);
  const [errorMsg, setErrorMsg]     = useState('');

  // Idempotencia (fix crítico: doble click / dos admins duplicaban TODOS los
  // gastos del prorrateo): si ya hay movimientos 'prorrateo' este mes, el botón
  // se bloquea. La RPC confirmar_prorrateo repite este guard server-side.
  const mesISO = new Date().toISOString().slice(0, 7); // YYYY-MM
  const yaConfirmadoEsteMes = useMemo(
    () => movimientos.some(m => m.categoria === 'prorrateo' && (m.fecha || '').startsWith(mesISO)),
    [movimientos, mesISO]
  );

  // ── Gastos fijos editing ──
  const [editId,  setEditId]  = useState(null);
  const [editVal, setEditVal] = useState('');

  const startEdit = (id, val) => { setEditId(id); setEditVal(String(val)); };
  const saveEdit  = () => {
    if (!editId) return;
    setItems(prev => prev.map(i => i.id === editId ? { ...i, monto: Math.round(+editVal) || 0 } : i));
    setEditId(null);
  };
  const addItem = () => {
    const nombre = prompt('Nombre del gasto fijo:');
    if (!nombre?.trim()) return;
    setItems(prev => [...prev, { id: `gf-${Date.now()}`, nombre: nombre.trim(), monto: 0 }]);
  };
  const removeItem = (id) => {
    if (!confirm('¿Eliminar este gasto fijo?')) return;
    setItems(prev => prev.filter(i => i.id !== id));
  };

  // ── Distribución ──
  const obrasActivas = useMemo(() => obras.filter(o => o.estado === 'activa'), [obras]);
  const hoy    = new Date();
  const diasMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();

  const distribuciones = useMemo(() => {
    if (obrasActivas.length === 0) return [];
    // Peso económico en ARS: los presupuestos USD se convierten con el TC (fix:
    // antes se sumaban crudos ARS+USD y una obra USD grande pesaba casi nada).
    const presuARS = (o) => o.moneda === 'USD' ? (o.presupuesto || 0) * (dolarVenta || 1) : (o.presupuesto || 0);
    const totalPresu = obrasActivas.reduce((s, o) => s + presuARS(o), 0) || 1;
    return obrasActivas.map(o => {
      const pctTiempo  = 100 / obrasActivas.length;
      const pctPeso    = totalPresu > 0 ? presuARS(o) / totalPresu * 100 : 100 / obrasActivas.length;
      let pctAsignado;
      if      (criterio === 'tiempo') pctAsignado = pctTiempo;
      else if (criterio === 'peso')   pctAsignado = pctPeso;
      else if (criterio === 'mixto')  pctAsignado = (pctTiempo + pctPeso) / 2;
      else                            pctAsignado = parseFloat(manualPct[o.id] || 0);
      return { o, pctTiempo, pctPeso, pctAsignado };
    });
  }, [obrasActivas, criterio, manualPct, diasMes, dolarVenta]);

  const totalPct = distribuciones.reduce((s, d) => s + d.pctAsignado, 0);
  // El criterio manual exige que los % cierren en 100 (antes se podía confirmar
  // un 30% o un 500% del gasto fijo sin ninguna validación).
  const manualDescuadrado = criterio === 'manual' && Math.abs(totalPct - 100) >= 0.5;
  const puedeConfirmar = totalMensual > 0 && obrasActivas.length > 0 &&
    !yaConfirmadoEsteMes && !manualDescuadrado && !guardando;

  // Item 3.8: en vez de empujar a detalle.movimientos (fuente legacy/semilla)
  // ahora creamos movimientos reales via MovimientosContext, asi aparecen
  // en /movimientos, /cajas, Reportes, etc. (fuente unica).
  // Fix crítico de idempotencia: intenta la RPC confirmar_prorrateo (test-and-set
  // por mes en una transacción — dos admins o un doble click ya no duplican);
  // si la RPC no está desplegada, guard local yaConfirmadoEsteMes + escritura
  // por ítem como antes.
  const confirmar = async () => {
    if (!puedeConfirmar) return;
    setGuardando(true);
    setErrorMsg('');
    const hoy = new Date().toISOString().split('T')[0];
    const movs = distribuciones
      .map((d) => ({ d, monto: Math.round(totalMensual * d.pctAsignado / 100) }))
      .filter(({ monto }) => monto > 0)
      .map(({ d, monto }) => ({
        id:          newId('mov'),
        tipo:        'gasto',
        descripcion: `Prorrateo administrativo · ${MES_ACTUAL}`,
        monto,
        fecha:       hoy,
        categoria:   'prorrateo',
        obraId:      d.o.id,
        obraNombre:  d.o.nombre,
        cajaId:      null,
        cajaDestinoId: null,
        proveedor:   '',
        medioPago:   'Prorrateo',
        referencia:  '',
        fondoReparo: false,
        creadoPor:   currentUser?.nombre || 'Sistema',
        creadoPorWA: false,
      }));

    const { error } = await supabase.rpc('confirmar_prorrateo', { p_mes: mesISO, p_movs: movs }) || {};
    if (!error) {
      movs.forEach(m => addMovimientoAsync(m, { soloLocal: true }));
    } else if (esErrorRpcFaltante(error)) {
      movs.forEach(m => addMovimientoAsync(m));
    } else {
      setGuardando(false);
      setErrorMsg(error.message || 'No se pudo confirmar el prorrateo.');
      return;
    }
    setGuardando(false);
    setConfirmado(true);
    setTimeout(() => setConfirmado(false), 4000);
  };

  return (
    <PageLayout breadcrumb={['Gastos Fijos', MES_ACTUAL]} active="Gastos Fijos">
      <PageHero
        label={`GASTOS FIJOS · ${MES_ACTUAL}`}
        title="Prorrateo"
        subtitle="Gastos fijos mensuales repartidos entre las obras activas"
        actions={
          <>
            {confirmado && <span style={{ fontSize: 12, color: T.accent, fontWeight: 700 }}>✓ Confirmado</span>}
            {errorMsg && <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 700 }}>{errorMsg}</span>}
            {yaConfirmadoEsteMes && !confirmado && (
              <span style={{ fontSize: 11, color: T.ok, fontWeight: 700 }}>✓ El prorrateo de este mes ya está confirmado</span>
            )}
            {manualDescuadrado && (
              <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 700 }}>Los % manuales suman {totalPct.toFixed(1)}% — deben sumar 100%</span>
            )}
            <Btn sm fill onClick={confirmar} disabled={!puedeConfirmar} style={{ opacity: puedeConfirmar ? 1 : 0.5, cursor: puedeConfirmar ? 'pointer' : 'not-allowed' }}>
              {guardando ? 'Confirmando…' : 'Confirmar prorrateo'}
            </Btn>
          </>
        }
        kpis={[
          { label: 'Gastos fijos',     value: items.length,                                 sub: 'configurados',     color: T.ink },
          { label: 'Total mensual',    value: `$ ${fmtN(totalMensual)}`,                    sub: 'a repartir',        color: T.warn },
          { label: 'Obras activas',    value: obrasActivas.length,                          sub: 'destinatarias',    color: T.ok },
          { label: 'Promedio por obra', value: obrasActivas.length > 0 ? `$ ${fmtN(totalMensual / obrasActivas.length)}` : '—', sub: 'estimado', color: T.ink },
        ]}
      />

      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 10, overflow: isMobile ? 'visible' : 'hidden', height: isMobile ? 'auto' : 'calc(100vh - 240px)' }}>

        {/* ── Panel izquierdo ── */}
        <Box style={{ width: isMobile ? 'auto' : 290, flexShrink: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', padding: 0 }}>

          {/* Gastos fijos — editable */}
          <div style={{ padding: '10px 14px 0' }}>
            <Label style={{ marginBottom: 8 }}>Gastos fijos del mes</Label>

            {items.length === 0 && (
              <div style={{ fontSize: 12, color: T.ink3, padding: '6px 0 8px' }}>Sin gastos configurados.</div>
            )}

            {items.map(item => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderBottom: `1px solid ${T.faint2}` }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.nombre}</span>
                {editId === item.id ? (
                  <input
                    autoFocus type="number" min="0"
                    style={{ width: isMobile ? 'calc(100% - 120px)' : 100, maxWidth: 100, minWidth: 60, textAlign: 'right', fontFamily: T.fontMono, padding: '2px 6px', border: `1.5px solid ${T.accent}`, borderRadius: 3, fontSize: 12, outline: 'none', flexShrink: 0 }}
                    value={editVal}
                    onChange={e => setEditVal(e.target.value)}
                    onBlur={saveEdit}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditId(null); }}
                  />
                ) : (
                  <span
                    title="Clic para editar"
                    style={{ fontFamily: T.fontMono, fontSize: 12, color: item.monto === 0 ? T.ink3 : T.ink, cursor: 'text', padding: '2px 6px', border: `1px solid ${T.faint2}`, borderRadius: 3, minWidth: 88, textAlign: 'right', flexShrink: 0 }}
                    onClick={() => startEdit(item.id, item.monto)}>
                    $ {fmtN(item.monto)}
                  </span>
                )}
                <span style={{ color: T.accent, cursor: 'pointer', fontSize: 15, flexShrink: 0, lineHeight: 1 }} onClick={() => removeItem(item.id)}>×</span>
              </div>
            ))}

            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0 2px', fontWeight: 800, fontSize: 13 }}>
              <span>Total mensual</span>
              <span style={{ fontFamily: T.fontMono, color: totalMensual > 0 ? T.accent : T.ink3 }}>$ {fmtN(totalMensual)}</span>
            </div>
            <Btn sm onClick={addItem} style={{ marginTop: 6, marginBottom: 14, width: '100%' }}>+ Agregar gasto fijo</Btn>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: T.faint2, marginBottom: 14 }} />

          {/* Criterio de distribución */}
          <div style={{ padding: '0 14px' }}>
            <Label style={{ marginBottom: 8 }}>Criterio de distribución</Label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {CRITERIOS.map(cr => (
                <label key={cr.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: 12 }}>
                  <input type="radio" name="criterio" value={cr.key} checked={criterio === cr.key}
                    onChange={() => setCriterio(cr.key)} style={{ accentColor: T.accent, marginTop: 2, flexShrink: 0 }} />
                  <span style={{ fontWeight: criterio === cr.key ? 700 : 400 }}>{cr.label}</span>
                </label>
              ))}
            </div>

            <div style={{ marginTop: 14, fontSize: 10, color: T.ink2, padding: '8px 10px', background: T.faint, borderRadius: 4 }}>
              Al confirmar, se crean líneas de gasto en cada obra activa con categoría "Prorrateo administrativo".
            </div>
          </div>
        </Box>

        {/* ── Panel derecho: distribución ── */}
        <Box style={{ flex: 1, padding: 0, overflow: isMobile ? 'auto' : 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '8px 12px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}`, display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 4 : 8 }}>
            <div className="k-h" style={{ fontSize: 'clamp(13px, 3.5vw, 16px)' }}>Distribución por obra</div>
            <span style={{ marginLeft: isMobile ? 0 : 'auto', fontSize: 12, color: T.ink2 }}>
              Total a distribuir: <b style={{ fontFamily: T.fontMono }}>$ {fmtN(totalMensual)}</b>
            </span>
          </div>

          {/* Tabla: wrapped en overflow-x:auto en mobile para que header+filas scrolleen juntos */}
          <div style={{ flex: 1, overflow: isMobile ? 'visible' : 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, overflowX: isMobile ? 'auto' : 'visible', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
              {/* Contenedor interno con ancho mínimo para que el scroll funcione en mobile */}
              <div style={{ minWidth: isMobile ? 520 : 'auto' }}>

                <div style={{ display: 'flex', padding: '6px 12px', background: T.faint, borderBottom: `1px solid ${T.faint2}`, fontSize: 10, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  <span style={{ flex: 2, minWidth: 0 }}>Obra</span>
                  <span style={{ flex: 1, minWidth: 0, textAlign: 'right', fontFamily: T.fontMono }}>Presupuesto</span>
                  <span style={{ flex: 0.8, minWidth: 0, textAlign: 'right', fontFamily: T.fontMono }}>% Tiempo</span>
                  <span style={{ flex: 0.8, minWidth: 0, textAlign: 'right', fontFamily: T.fontMono }}>% Peso</span>
                  <span style={{ flex: 1, minWidth: 0, textAlign: 'right', fontFamily: T.fontMono }}>% Asignado</span>
                  <span style={{ flex: 1.2, minWidth: 0, textAlign: 'right', fontFamily: T.fontMono }}>Monto $</span>
                </div>

                {obrasActivas.length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', color: T.ink3, fontSize: 12 }}>Sin obras activas. El prorrateo requiere al menos una obra en estado "activa".</div>
                )}
                {distribuciones.map(({ o, pctTiempo, pctPeso, pctAsignado }, i) => {
                  const monto = totalMensual * pctAsignado / 100;
                  return (
                    <div key={o.id} style={{ display: 'flex', padding: '9px 12px', borderBottom: `1px solid ${T.faint2}`, alignItems: 'center', fontSize: 12, background: i % 2 === 1 ? T.faint : 'transparent' }}>
                      <span style={{ flex: 2, minWidth: 0, fontWeight: 700, color: T.accent, cursor: 'pointer', textDecoration: 'underline', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        onClick={() => navigate(`/obras/${o.id}/presupuesto`)}>{o.nombre}</span>
                      <span style={{ flex: 1, minWidth: 0, textAlign: 'right', fontFamily: T.fontMono, color: T.ink2 }}>
                        {o.moneda === 'USD' ? `U$S ${fmtN(o.presupuesto)}` : `$ ${fmtN(o.presupuesto)}`}
                      </span>
                      <span style={{ flex: 0.8, minWidth: 0, textAlign: 'right', fontFamily: T.fontMono, color: T.ink2 }}>{pctTiempo.toFixed(1)}%</span>
                      <span style={{ flex: 0.8, minWidth: 0, textAlign: 'right', fontFamily: T.fontMono, color: T.ink2 }}>{pctPeso.toFixed(1)}%</span>
                      <span style={{ flex: 1, minWidth: 0, textAlign: 'right', fontFamily: T.fontMono, fontWeight: 700 }}>
                        {criterio === 'manual' ? (
                          <input type="number" min="0" max="100"
                            value={manualPct[o.id] || ''}
                            onChange={e => setManualPct(prev => ({ ...prev, [o.id]: e.target.value }))}
                            style={{ width: 60, textAlign: 'right', padding: '2px 4px', borderRadius: 3, border: `1.5px solid ${T.faint2}`, fontFamily: T.fontMono, fontSize: 12, outline: 'none' }} />
                        ) : (
                          `${pctAsignado.toFixed(1)}%`
                        )}
                      </span>
                      <span style={{ flex: 1.2, minWidth: 0, textAlign: 'right', fontFamily: T.fontMono, fontWeight: 700, color: T.accent }}>
                        {totalMensual > 0 ? `$ ${fmtN(monto)}` : '—'}
                      </span>
                    </div>
                  );
                })}

                {distribuciones.length > 0 && (
                  <div style={{ display: 'flex', padding: '8px 12px', background: T.faint, borderTop: `1.5px solid ${T.faint2}`, fontSize: 12, fontWeight: 800 }}>
                    <span style={{ flex: 4.6, minWidth: 0 }}>Total</span>
                    <span style={{ flex: 1, minWidth: 0, textAlign: 'right', fontFamily: T.fontMono, color: Math.abs(totalPct - 100) < 0.5 ? T.ok : T.accent }}>
                      {totalPct.toFixed(1)}%
                    </span>
                    <span style={{ flex: 1.2, minWidth: 0, textAlign: 'right', fontFamily: T.fontMono, color: T.accent }}>
                      $ {fmtN(distribuciones.reduce((s, d) => s + Math.round(totalMensual * d.pctAsignado / 100), 0))}
                    </span>
                  </div>
                )}

              </div>
            </div>
          </div>
        </Box>
      </div>
    </PageLayout>
  );
}
