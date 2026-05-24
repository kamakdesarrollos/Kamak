import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Chip, Btn, Stat, Label, Bar, Stripes } from '../components/ui';
import { T } from '../theme';
import { useMovimientos } from '../store/MovimientosContext';
import { useObras } from '../store/ObrasContext';
import { useDolar } from '../store/DolarContext';
import { useAlertas } from '../store/AlertasContext';
import { useProveedores } from '../store/ProveedoresContext';

const fmtN = (n) => Math.round(Math.abs(n)).toLocaleString('es-AR');
const currMes = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; };
const MESES_N = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

const ALL_WIDGETS = [
  { id: 'posicion',    label: 'Posición Consolidada' },
  { id: 'alertas',     label: 'Alertas' },
  { id: 'cashflow',    label: 'Cash Flow' },
  { id: 'presupuesto', label: 'Presup. vs Gastado' },
  { id: 'kpis',        label: 'KPIs del Mes' },
  { id: 'top-prov',    label: 'Top Proveedores' },
  { id: 'cuotas-prox', label: 'Cuotas Próximas' },
  { id: 'adicionales', label: 'Adicionales Pendientes' },
];

const STORAGE_KEY = 'kamak_dashboard_widgets_v1';
const loadWidgets = () => {
  try { const s = localStorage.getItem(STORAGE_KEY); if (s) return JSON.parse(s); } catch {}
  return ALL_WIDGETS.map(w => w.id);
};

const fmtD = (iso) => !iso ? '—' : iso.split('-').reverse().join('/');

export default function Dashboard() {
  const { movimientos, cajas } = useMovimientos();
  const { obras, getDetalle }  = useObras();
  const { dolarVenta }         = useDolar();
  const navigate               = useNavigate();
  const { alertas: alertasWA, noLeidas, marcarLeida, marcarTodasLeidas } = useAlertas();
  const { proveedores }        = useProveedores();

  const [editMode,       setEditMode]       = useState(false);
  const [enabledWidgets, setEnabledWidgets] = useState(loadWidgets);

  const toggleWidget = (id) => {
    setEnabledWidgets(prev => {
      const next = prev.includes(id) ? prev.filter(w => w !== id) : [...prev, id];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const on = (id) => enabledWidgets.includes(id);

  const mes = currMes();
  const [y, mo] = mes.split('-').map(Number);
  const tc = dolarVenta || 1070;
  const today = new Date();

  // ── Posición consolidada ──
  const totalARS    = useMemo(() => cajas.filter(c => c.activa && c.moneda === 'ARS').reduce((s, c) => s + (c.saldo || 0), 0), [cajas]);
  const totalUSD    = useMemo(() => cajas.filter(c => c.activa && c.moneda === 'USD').reduce((s, c) => s + (c.saldo || 0), 0), [cajas]);
  const posicionUSD = Math.round(totalARS / tc + totalUSD);
  const posicionARS = Math.round(totalARS + totalUSD * tc);

  // ── KPIs del mes ──
  const movsMes         = useMemo(() => movimientos.filter(m => m.fecha.startsWith(mes)), [movimientos, mes]);
  const ingresosMes     = useMemo(() => movsMes.filter(m => m.tipo === 'ingreso'), [movsMes]);
  const gastosMes       = useMemo(() => movsMes.filter(m => m.tipo === 'gasto'),   [movsMes]);
  const totalIngresosMes = ingresosMes.reduce((s, m) => s + m.monto, 0);
  const totalGastosMes   = gastosMes.reduce((s, m) => s + m.monto, 0);
  const netoMes          = totalIngresosMes - totalGastosMes;

  // ── Top proveedores este mes ──
  const topProvs = useMemo(() => {
    const map = {};
    gastosMes.forEach(m => { if (m.proveedor) map[m.proveedor] = (map[m.proveedor] || 0) + m.monto; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [gastosMes]);
  const maxProvMonto = topProvs.length > 0 ? topProvs[0][1] : 1;

  // ── Cash flow últimos 6 meses ──
  const cashFlowData = useMemo(() => {
    const result = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(y, mo - 1 - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const inp = movimientos.filter(m => m.tipo === 'ingreso' && m.fecha.startsWith(key)).reduce((s, m) => s + m.monto, 0);
      const out = movimientos.filter(m => m.tipo === 'gasto'   && m.fecha.startsWith(key)).reduce((s, m) => s + m.monto, 0);
      result.push({ label: MESES_N[d.getMonth()], inp, out });
    }
    return result;
  }, [movimientos, y, mo]);
  const maxCF = Math.max(...cashFlowData.flatMap(d => [d.inp, d.out]), 1);

  // ── Obras ──
  const obrasActivas = useMemo(() => obras.filter(o => o.estado === 'activa'), [obras]);

  // ── Cuotas próximas (todos las obras, próximos 45 días) ──
  const cuotasProximas = useMemo(() => {
    const now = new Date(); now.setHours(0,0,0,0);
    const limit = new Date(now); limit.setDate(limit.getDate() + 45);
    const items = [];
    obras.forEach(o => {
      const det = getDetalle(o.id);
      (det.cuotas || []).forEach(c => {
        if (c.estado === 'pagado') return;
        const fecha = c.fecha ? new Date(c.fecha + 'T00:00:00') : null;
        if (!fecha || fecha > limit) return;
        const diasRestantes = Math.ceil((fecha - now) / 86400000);
        items.push({ ...c, obraId: o.id, obraNombre: o.nombre, diasRestantes });
      });
    });
    return items.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')).slice(0, 8);
  }, [obras, getDetalle]);

  // ── Adicionales pendientes de aprobación ──
  const adicionalesPendientes = useMemo(() => {
    const items = [];
    obras.forEach(o => {
      const det = getDetalle(o.id);
      (det.adicionales || []).filter(a => a.estado === 'pendiente').forEach(a => {
        items.push({ ...a, obraId: o.id, obraNombre: o.nombre });
      });
    });
    return items.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 8);
  }, [obras, getDetalle]);

  // ── Alertas ──
  const alertas = useMemo(() => {
    const list = [];
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    cajas.filter(c => c.activa).forEach(c => {
      const minimo = c.moneda === 'USD' ? 100 : 50000;
      if ((c.saldo || 0) < minimo)
        list.push({ tipo: 'warn', texto: `Caja "${c.nombre}" tiene saldo bajo`, obraId: null });
    });
    obrasActivas.forEach(o => {
      if (o.presupuesto > 0 && o.gastado > o.presupuesto)
        list.push({ tipo: 'accent', texto: `${o.nombre}: gastos superan el presupuesto`, obraId: o.id });
      else if (o.presupuesto > 0 && o.gastado / o.presupuesto > 0.9)
        list.push({ tipo: 'warn', texto: `${o.nombre}: gastado > ${Math.round(o.gastado / o.presupuesto * 100)}% del presupuesto`, obraId: o.id });
    });
    // Cuotas vencidas
    obras.forEach(o => {
      const det = getDetalle(o.id);
      const vencidas = (det.cuotas || []).filter(c => {
        if (c.estado === 'pagado') return false;
        const f = c.fecha ? new Date(c.fecha + 'T00:00:00') : null;
        return f && f < hoy;
      });
      if (vencidas.length > 0)
        list.push({ tipo: 'accent', texto: `${o.nombre}: ${vencidas.length} cuota${vencidas.length > 1 ? 's' : ''} vencida${vencidas.length > 1 ? 's' : ''}`, obraId: o.id, tab: 10 });
    });
    // Adicionales pendientes más de 7 días
    obras.forEach(o => {
      const det = getDetalle(o.id);
      const viejos = (det.adicionales || []).filter(a => {
        if (a.estado !== 'pendiente') return false;
        if (!a.fecha) return false;
        const dias = Math.floor((hoy - new Date(a.fecha + 'T00:00:00')) / 86400000);
        return dias > 7;
      });
      if (viejos.length > 0)
        list.push({ tipo: 'warn', texto: `${o.nombre}: ${viejos.length} adicional${viejos.length > 1 ? 'es' : ''} pendiente${viejos.length > 1 ? 's' : ''} sin aprobar`, obraId: o.id, tab: 3 });
    });
    return list;
  }, [cajas, obrasActivas, obras, getDetalle]);

  const fechaStr = today.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <PageLayout breadcrumb={['Inicio', 'Dashboard']} active="Dashboard">

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
        <div>
          <div className="k-h" style={{ fontSize: 28 }}>Dashboard · Kamak</div>
          <div style={{ fontSize: 12, color: T.ink2, textTransform: 'capitalize' }}>{fechaStr}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {editMode && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '6px 10px', background: T.faint, borderRadius: 6, border: `1px solid ${T.faint2}`, maxWidth: 480 }}>
              {ALL_WIDGETS.map(w => (
                <span key={w.id} onClick={() => toggleWidget(w.id)}
                  style={{ padding: '3px 10px', borderRadius: 10, fontSize: 11, cursor: 'pointer', fontWeight: 600, userSelect: 'none', background: on(w.id) ? T.ink : T.faint2, color: on(w.id) ? T.paper : T.ink3, transition: 'all .15s' }}>
                  {on(w.id) ? '✓ ' : ''}{w.label}
                </span>
              ))}
            </div>
          )}
          <Btn sm onClick={() => setEditMode(e => !e)}>{editMode ? '✓ Listo' : '⊞ Personalizar'}</Btn>
        </div>
      </div>

      {/* Posición consolidada + Alertas */}
      {(on('posicion') || on('alertas')) && (
        <div style={{ display: 'grid', gridTemplateColumns: on('posicion') && on('alertas') ? '1.4fr 1fr' : '1fr', gap: 12, marginBottom: 12 }}>

          {on('posicion') && (
            <Box style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ background: T.dark, color: '#fff', padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', overflow: 'hidden' }}>
                <Stripes style={{ top: -40, right: -20 }} />
                <div style={{ position: 'relative' }}>
                  <div style={{ fontSize: 9, color: T.accent, fontFamily: `'JetBrains Mono', monospace`, letterSpacing: 1.8, fontWeight: 700 }}>POSICIÓN CONSOLIDADA</div>
                  <div className="k-h" style={{ fontSize: 28, marginTop: 2 }}>U$S {fmtN(posicionUSD)}</div>
                  <div style={{ fontSize: 11, color: '#9a9892' }}>equivalente · $ {fmtN(posicionARS)} ARS</div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 10, color: '#9a9892', fontFamily: `'JetBrains Mono', monospace`, letterSpacing: 1, position: 'relative' }}>
                  <div style={{ color: T.accent }}>TC OFICIAL</div>
                  <div style={{ color: '#fff', fontSize: 14, fontWeight: 700, marginTop: 2 }}>$ {fmtN(tc)}</div>
                  <div>{today.toLocaleDateString('es-AR')}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                {/* ARS */}
                <div style={{ borderRight: `1px solid ${T.faint2}` }}>
                  <div style={{ padding: '10px 14px', borderBottom: `1px solid ${T.faint2}`, background: T.faint }}>
                    <div style={{ fontSize: 8, color: T.ink3, fontFamily: `'JetBrains Mono', monospace`, letterSpacing: 1.5, fontWeight: 700 }}>ARS LÍQUIDO</div>
                    <div className="k-mono" style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>$ {fmtN(totalARS)}</div>
                  </div>
                  {cajas.filter(c => c.activa && c.moneda === 'ARS').map(c => (
                    <div key={c.id}
                      onClick={() => navigate('/cajas')}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 14px', borderBottom: `1px solid ${T.faint2}`, cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = T.faint}
                      onMouseLeave={e => e.currentTarget.style.background = ''}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: c.color || T.ink2, flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nombre}</span>
                      </div>
                      <span style={{ fontSize: 11, fontFamily: `'JetBrains Mono', monospace`, fontWeight: 700, flexShrink: 0, marginLeft: 8, color: (c.saldo || 0) < 0 ? T.accent : (c.saldo || 0) < 50000 ? T.warn : T.ink }}>
                        $ {fmtN(c.saldo || 0)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* USD */}
                <div>
                  <div style={{ padding: '10px 14px', borderBottom: `1px solid ${T.faint2}`, background: T.faint }}>
                    <div style={{ fontSize: 8, color: T.ink3, fontFamily: `'JetBrains Mono', monospace`, letterSpacing: 1.5, fontWeight: 700 }}>USD LÍQUIDO</div>
                    <div className="k-mono" style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>U$S {fmtN(totalUSD)}</div>
                  </div>
                  {cajas.filter(c => c.activa && c.moneda === 'USD').map(c => (
                    <div key={c.id}
                      onClick={() => navigate('/cajas')}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 14px', borderBottom: `1px solid ${T.faint2}`, cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = T.faint}
                      onMouseLeave={e => e.currentTarget.style.background = ''}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: c.color || T.ink2, flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nombre}</span>
                      </div>
                      <span style={{ fontSize: 11, fontFamily: `'JetBrains Mono', monospace`, fontWeight: 700, flexShrink: 0, marginLeft: 8, color: (c.saldo || 0) < 0 ? T.accent : (c.saldo || 0) < 100 ? T.warn : T.ink }}>
                        U$S {fmtN(c.saldo || 0)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Box>
          )}

          {on('alertas') && (
            <Box style={{ padding: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <Label style={{ marginBottom: 0 }}>
                  Alertas {(alertas.length + alertasWA.filter(a => !a.leida).length) > 0
                    ? `(${alertas.length + alertasWA.filter(a => !a.leida).length})`
                    : ''}
                </Label>
                {alertasWA.some(a => !a.leida) && (
                  <span style={{ fontSize: 10, color: T.ink3, cursor: 'pointer', textDecoration: 'underline' }} onClick={marcarTodasLeidas}>
                    Marcar todas leídas
                  </span>
                )}
              </div>

              {alertas.length === 0 && alertasWA.filter(a => !a.leida).length === 0 ? (
                <div style={{ marginTop: 10, fontSize: 12, color: T.ok }}>✓ Todo en orden</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12 }}>
                  {/* Alertas computadas (cajas, presupuesto, cuotas, adicionales) */}
                  {alertas.map((a, i) => (
                    <div key={`c-${i}`}
                      style={{ display: 'flex', gap: 6, alignItems: 'flex-start', cursor: a.obraId ? 'pointer' : 'default' }}
                      onClick={() => a.obraId && navigate(`/obras/${a.obraId}/presupuesto${a.tab != null ? `?tab=${a.tab}` : ''}`)}>
                      <Chip accent={a.tipo === 'accent'} warn={a.tipo === 'warn'}>{a.tipo === 'accent' ? '🚨' : '⚠'}</Chip>
                      <div style={{ flex: 1, color: a.obraId ? T.accent : undefined }}>{a.texto}</div>
                    </div>
                  ))}
                  {/* Alertas desde WhatsApp (no leídas) */}
                  {alertasWA.filter(a => !a.leida).map(a => (
                    <div key={a.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', background: T.faint, borderRadius: 4, padding: '5px 7px' }}>
                      <Chip accent>{a.tipo === 'exceso' ? '📊' : '⚠'}</Chip>
                      <div style={{ flex: 1 }}>
                        <div>{a.texto}</div>
                        <div style={{ fontSize: 10, color: T.ink3, marginTop: 2 }}>
                          {a.obra} · {a.creadoPor} · {a.fecha ? new Date(a.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                        </div>
                      </div>
                      <span style={{ fontSize: 10, color: T.ink3, cursor: 'pointer', flexShrink: 0, textDecoration: 'underline' }} onClick={() => marcarLeida(a.id)}>✓</span>
                    </div>
                  ))}
                </div>
              )}
            </Box>
          )}
        </div>
      )}

      {/* Cash flow + Presupuestado vs Gastado */}
      {(on('cashflow') || on('presupuesto')) && (
        <div style={{ display: 'grid', gridTemplateColumns: on('cashflow') && on('presupuesto') ? '1.4fr 1fr' : '1fr', gap: 12, marginBottom: 12 }}>

          {on('cashflow') && (
            <Box style={{ padding: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <Label>Ingresos vs Egresos · últimos 6 meses</Label>
                <div style={{ display: 'flex', gap: 10, fontSize: 11, color: T.ink2 }}>
                  <span><span style={{ display: 'inline-block', width: 9, height: 9, background: T.ok, marginRight: 4, verticalAlign: 'middle' }} />Ingresos</span>
                  <span><span style={{ display: 'inline-block', width: 9, height: 9, background: T.warn, marginRight: 4, verticalAlign: 'middle' }} />Gastos</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 100, padding: '0 2px' }}>
                {cashFlowData.map((d, i) => (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: '100%', justifyContent: 'flex-end' }}>
                    <div style={{ width: '100%', display: 'flex', gap: 2, alignItems: 'flex-end', flex: 1 }}>
                      <div style={{ flex: 1, background: T.ok, opacity: 0.75, height: `${Math.round((d.inp / maxCF) * 100)}%`, minHeight: d.inp > 0 ? 3 : 0, borderRadius: '2px 2px 0 0' }} />
                      <div style={{ flex: 1, background: T.warn, opacity: 0.75, height: `${Math.round((d.out / maxCF) * 100)}%`, minHeight: d.out > 0 ? 3 : 0, borderRadius: '2px 2px 0 0' }} />
                    </div>
                    <span style={{ fontSize: 9, color: T.ink3, fontFamily: `'JetBrains Mono', monospace` }}>{d.label}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12, color: T.ink2 }}>
                <span style={{ cursor: 'pointer' }} onClick={() => navigate('/movimientos')}>Ingresos <b style={{ color: T.ok }}>$ {fmtN(totalIngresosMes)}</b></span>
                <span style={{ cursor: 'pointer' }} onClick={() => navigate('/movimientos')}>Gastos <b style={{ color: T.warn }}>$ {fmtN(totalGastosMes)}</b></span>
                <span style={{ cursor: 'pointer' }} onClick={() => navigate('/movimientos')}>Neto <b style={{ color: netoMes >= 0 ? T.ok : T.warn }}>{netoMes >= 0 ? '+' : '−'}$ {fmtN(netoMes)}</b></span>
              </div>
            </Box>
          )}

          {on('presupuesto') && (
            <Box style={{ padding: 13 }}>
              <Label>Presupuestado vs Gastado · obras activas</Label>
              {obrasActivas.length === 0 ? (
                <div style={{ marginTop: 12, fontSize: 12, color: T.ink3 }}>Sin obras activas</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 8 }}>
                  {obrasActivas.slice(0, 6).map(o => {
                    const pct = o.presupuesto > 0 ? Math.round((o.gastado / o.presupuesto) * 100) : 0;
                    const color = pct > 100 ? T.accent : pct > 90 ? T.warn : T.ok;
                    return (
                      <div key={o.id} style={{ cursor: 'pointer' }}
                        onClick={() => navigate(`/obras/${o.id}/presupuesto`)}
                        onMouseEnter={e => e.currentTarget.style.opacity = '0.75'}
                        onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                          <span style={{ color: T.accent }}>{o.nombre}</span>
                          <span style={{ color, fontFamily: T.fontMono, fontSize: 11 }}>{pct}%</span>
                        </div>
                        <div style={{ position: 'relative', height: 7, background: T.faint, borderRadius: 2, marginTop: 2 }}>
                          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.min(100, pct)}%`, background: color, borderRadius: 2, opacity: 0.8 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Box>
          )}
        </div>
      )}

      {/* KPIs del mes */}
      {on('kpis') && (
        <Box style={{ padding: 0, marginBottom: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {[
              { label: `Ingresos · ${MESES_N[mo - 1]}`, value: `$ ${fmtN(totalIngresosMes)}`, sub: `${ingresosMes.length} cobros`, color: T.ok, to: '/movimientos' },
              { label: `Gastos · ${MESES_N[mo - 1]}`,   value: `$ ${fmtN(totalGastosMes)}`,   sub: `${gastosMes.length} registros`, color: T.warn, to: '/movimientos' },
              { label: `Neto · ${MESES_N[mo - 1]}`,     value: `${netoMes >= 0 ? '+' : '−'} $ ${fmtN(netoMes)}`, sub: netoMes >= 0 ? 'Superávit' : 'Déficit', color: netoMes >= 0 ? T.ok : T.accent, to: '/movimientos' },
              { label: 'Obras activas', value: String(obrasActivas.length), sub: `${obras.filter(o => o.estado === 'en-presupuesto').length} en presupuesto`, color: T.ink, to: '/obras' },
            ].map((k, i, arr) => (
              <div key={i}
                onClick={() => navigate(k.to)}
                style={{ padding: '14px 16px', borderRight: i < arr.length - 1 ? `1px solid ${T.faint2}` : 'none', minWidth: 0, cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = T.faint}
                onMouseLeave={e => e.currentTarget.style.background = ''}>
                <div style={{ fontSize: 10, color: T.ink3, marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.label}</div>
                <div style={{ fontFamily: `'JetBrains Mono', monospace`, fontSize: k.value.length > 10 ? 14 : 18, fontWeight: 800, color: k.color, lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.value}</div>
                <div style={{ fontSize: 10, color: T.ink3, marginTop: 6, whiteSpace: 'nowrap' }}>{k.sub}</div>
              </div>
            ))}
          </div>
        </Box>
      )}

      {/* Top Proveedores */}
      {on('top-prov') && (
        <Box style={{ padding: 13 }}>
          <Label>Top proveedores · este mes</Label>
          {topProvs.length === 0 ? (
            <div style={{ marginTop: 10, fontSize: 12, color: T.ink3 }}>Sin gastos con proveedor registrados este mes</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8, fontSize: 12 }}>
              {topProvs.map(([nombre, monto], i) => {
                const provObj = proveedores.find(p => p.nombre === nombre);
                return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {provObj
                    ? <span style={{ width: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.accent, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate(`/proveedores/${provObj.id}`)}>{nombre}</span>
                    : <span style={{ width: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombre}</span>
                  }
                  <div style={{ flex: 1 }}><Bar pct={Math.round((monto / maxProvMonto) * 100)} h={5} /></div>
                  <span style={{ width: 100, textAlign: 'right', fontFamily: `'JetBrains Mono', monospace`, fontSize: 11 }}>$ {fmtN(monto)}</span>
                </div>
              );})}
            </div>
          )}
        </Box>
      )}

      {/* Cuotas próximas + Adicionales pendientes */}
      {(on('cuotas-prox') || on('adicionales')) && (
        <div style={{ display: 'grid', gridTemplateColumns: on('cuotas-prox') && on('adicionales') ? '1fr 1fr' : '1fr', gap: 12, marginTop: 12 }}>

          {on('cuotas-prox') && (
            <Box style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', background: T.faint, borderBottom: `1px solid ${T.faint2}` }}>
                <Label style={{ marginBottom: 0 }}>Cuotas próximas · 45 días</Label>
              </div>
              {cuotasProximas.length === 0 ? (
                <div style={{ padding: '20px 14px', fontSize: 12, color: T.ok }}>✓ Sin cuotas vencidas ni próximas</div>
              ) : (
                cuotasProximas.map((c, i) => (
                  <div key={`${c.obraId}-${c.id}`}
                    onClick={() => navigate(`/obras/${c.obraId}/presupuesto?tab=10`)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: i < cuotasProximas.length - 1 ? `1px solid ${T.faint2}` : 'none', cursor: 'pointer', fontSize: 12 }}
                    onMouseEnter={e => e.currentTarget.style.background = T.faint}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ width: 36, height: 36, borderRadius: 6, background: c.diasRestantes < 0 ? T.accent : c.diasRestantes <= 7 ? T.warn + '33' : T.faint2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: c.diasRestantes < 0 ? 'white' : c.diasRestantes <= 7 ? T.warn : T.ink3, flexShrink: 0 }}>
                      {c.diasRestantes < 0 ? 'VEN' : `${c.diasRestantes}d`}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.descripcion}</div>
                      <div style={{ fontSize: 10, color: T.ink3 }}>{c.obraNombre} · {fmtD(c.fecha)}</div>
                    </div>
                    <div style={{ fontFamily: `'JetBrains Mono', monospace`, fontWeight: 700, fontSize: 12, flexShrink: 0, color: c.diasRestantes < 0 ? T.accent : T.ink }}>$ {fmtN(c.monto)}</div>
                  </div>
                ))
              )}
            </Box>
          )}

          {on('adicionales') && (
            <Box style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', background: T.faint, borderBottom: `1px solid ${T.faint2}` }}>
                <Label style={{ marginBottom: 0 }}>Adicionales pendientes{adicionalesPendientes.length > 0 ? ` (${adicionalesPendientes.length})` : ''}</Label>
              </div>
              {adicionalesPendientes.length === 0 ? (
                <div style={{ padding: '20px 14px', fontSize: 12, color: T.ok }}>✓ Sin adicionales pendientes</div>
              ) : (
                adicionalesPendientes.map((a, i) => (
                  <div key={`${a.obraId}-${a.id}`}
                    onClick={() => navigate(`/obras/${a.obraId}/presupuesto?tab=3`)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: i < adicionalesPendientes.length - 1 ? `1px solid ${T.faint2}` : 'none', cursor: 'pointer', fontSize: 12 }}
                    onMouseEnter={e => e.currentTarget.style.background = T.faint}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ fontSize: 20, flexShrink: 0 }}>➕</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.descripcion}</div>
                      <div style={{ fontSize: 10, color: T.ink3 }}>{a.obraNombre}{a.tarea ? ` · ${a.tarea}` : ''} · {fmtD(a.fecha)}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {a.valorVentaTotal != null && <div style={{ fontFamily: `'JetBrains Mono', monospace`, fontSize: 11, fontWeight: 700, color: T.accent }}>V: $ {fmtN(a.valorVentaTotal)}</div>}
                      {a.costoTotal != null && <div style={{ fontFamily: `'JetBrains Mono', monospace`, fontSize: 10, color: T.ink3 }}>C: $ {fmtN(a.costoTotal)}</div>}
                    </div>
                  </div>
                ))
              )}
            </Box>
          )}
        </div>
      )}

    </PageLayout>
  );
}
