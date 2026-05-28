import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn, Bar, Chip } from '../components/ui';
import PageHero from '../components/ui/PageHero';
import { T } from '../theme';
import { useObras } from '../store/ObrasContext';
import { useProveedores } from '../store/ProveedoresContext';
import { useUsuarios } from '../store/UsuariosContext';
import { useMovimientos } from '../store/MovimientosContext';
import { useDolar } from '../store/DolarContext';
import { cobradoObraUSD, repartirCobroEnCuotas, cuotaEstadoDesdeCobrado } from './obra/helpers';

const CY = new Date().getFullYear();
const fmtM = (n) => {
  if (n >= 1e6) return `$ ${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$ ${Math.round(n / 1e3)}k`;
  return `$ ${Math.round(n).toLocaleString('es-AR')}`;
};

const margenColor = (m) => m < 0 ? '#dc2626' : m < 15 ? T.warn : T.ok;

const ESTADOS_LABEL = { activa: 'Activa', 'en-presupuesto': 'En presupuesto', pausada: 'Pausada', finalizada: 'Finalizada', archivada: 'Archivada' };

function exportJSON(data, filename) {
  const a = document.createElement('a');
  a.href = 'data:text/json,' + encodeURIComponent(JSON.stringify(data, null, 2));
  a.download = filename;
  a.click();
}

const fmtFechaCorta = (iso) => { if (!iso) return '—'; const [, m, d] = iso.split('-'); return `${d}/${m}`; };

export default function Reportes() {
  const navigate = useNavigate();
  const { currentUser } = useUsuarios();
  const isAdmin = currentUser?.rol === 'Admin';
  // Guard: solo Admin (reportes muestran facturacion, margenes, totales sensibles).
  useEffect(() => {
    if (currentUser && !isAdmin) navigate('/', { replace: true });
  }, [currentUser, isAdmin, navigate]);

  const { obras, detalles } = useObras();
  const { proveedores } = useProveedores();
  const { movimientos, cajas } = useMovimientos();
  const { dolarVenta } = useDolar();
  const tc = dolarVenta || 1070;
  const [rubroObraId, setRubroObraId] = useState('');

  // ── KPIs ──
  const activas = obras.filter(o => o.estado === 'activa');

  // Item 3.8: leer movimientos reales del MovimientosContext (fuente unica)
  // en vez de los movs semilla en detalles[obraId].movimientos. Antes los
  // numeros de Reportes no coincidian con los de /movimientos.
  const allMovsYTD = useMemo(() =>
    movimientos.filter(m => (m.fecha || '').startsWith(String(CY))),
    [movimientos]);

  const facturacionYTD = allMovsYTD.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0);
  const costoYTD       = allMovsYTD.filter(m => m.tipo === 'gasto').reduce((s, m) => s + m.monto, 0);
  const margenProm = activas.length > 0
    ? activas.reduce((s, o) => s + (o.margen || 0), 0) / activas.length : 0;

  // ── Avance por rubro ──
  const obrasConDetalle = useMemo(() =>
    obras.filter(o => (detalles[o.id]?.rubros?.length || 0) > 0), [obras, detalles]);

  const selObraId = rubroObraId || obrasConDetalle[0]?.id || '';
  const selObra = obras.find(o => o.id === selObraId);

  const rubrosAvance = useMemo(() => {
    const det = detalles[selObraId];
    if (!det?.rubros) return [];
    return det.rubros.map(r => {
      const tareas = r.tareas || [];
      const avg = tareas.length > 0
        ? Math.round(tareas.reduce((s, t) => s + (t.avance || 0), 0) / tareas.length)
        : 0;
      return { nombre: r.nombre, avance: avg };
    });
  }, [detalles, selObraId]);

  // ── Margen por obra ──
  const obrasConMargen = obras.filter(o => ['activa', 'pausada', 'finalizada'].includes(o.estado));

  // ── Top proveedores ──
  const topProveedores = useMemo(() => {
    const map = {};
    allMovsYTD.filter(m => m.tipo === 'gasto' && m.proveedor).forEach(m => {
      map[m.proveedor] = (map[m.proveedor] || 0) + m.monto;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [allMovsYTD]);

  // ── Financiación cross-obra ──
  const adicionalesAprobados = useMemo(() => {
    const all = [];
    obras.forEach(o => {
      (detalles[o.id]?.adicionales || [])
        .filter(a => a.estado === 'aprobado')
        .forEach(a => all.push({ ...a, obraNombre: o.nombre, obraId: o.id }));
    });
    return all.sort((a, b) =>
      (b.valorVentaTotal || b.costoTotal || b.monto || 0) - (a.valorVentaTotal || a.costoTotal || a.monto || 0)
    );
  }, [obras, detalles]);

  const totalAdicionalesCliente = adicionalesAprobados
    .filter(a => a.aplicaACliente !== false)
    .reduce((s, a) => s + (a.valorVentaTotal || a.costoTotal || a.monto || 0), 0);

  const cuotasProximas = useMemo(() => {
    const hoy = new Date().toISOString().split('T')[0];
    const limite = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const all = [];
    obras.forEach(o => {
      const reparto = repartirCobroEnCuotas(detalles[o.id]?.cuotas || [], cobradoObraUSD(movimientos, cajas, o.id, tc), o.moneda || 'ARS', tc);
      (detalles[o.id]?.cuotas || [])
        .filter(c => cuotaEstadoDesdeCobrado(c, reparto[c.id], o.moneda || 'ARS', tc) !== 'pagado' && c.fecha >= hoy && c.fecha <= limite)
        .forEach(c => all.push({ ...c, obraNombre: o.nombre, obraId: o.id }));
    });
    return all.sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [obras, detalles, tc, movimientos, cajas]);

  const cuotasTotalesMonto = useMemo(() =>
    obras.reduce((s, o) => s + (detalles[o.id]?.cuotas || []).reduce((ss, c) => ss + (c.monto || 0), 0), 0),
    [obras, detalles]);

  const cuotasCobradas = useMemo(() =>
    obras.reduce((s, o) => {
      const reparto = repartirCobroEnCuotas(detalles[o.id]?.cuotas || [], cobradoObraUSD(movimientos, cajas, o.id, tc), o.moneda || 'ARS', tc);
      return s + (detalles[o.id]?.cuotas || []).filter(c => cuotaEstadoDesdeCobrado(c, reparto[c.id], o.moneda || 'ARS', tc) === 'pagado').reduce((ss, c) => ss + (c.monto || 0), 0);
    }, 0),
    [obras, detalles, tc, movimientos, cajas]);

  // ── Resumen por tipo de obra ──
  const tiposMap = useMemo(() => {
    const map = {};
    obras.filter(o => o.presupuesto > 0).forEach(o => {
      if (!map[o.tipo]) map[o.tipo] = { count: 0, total: 0 };
      map[o.tipo].count++;
      map[o.tipo].total += o.presupuesto;
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [obras]);

  return (
    <PageLayout breadcrumb={['Reportes']} active="Reportes">
      <PageHero
        label={`ANÁLISIS DE DATOS · ${CY}`}
        title="Reportes"
        subtitle="Indicadores de gestión y exportación de datos"
        actions={
          <Btn sm onClick={() => exportJSON({ obras, detalles }, `kamak_datos_${CY}.json`)}>
            ↗ Exportar todo (JSON)
          </Btn>
        }
        kpis={[
          { label: 'Obras activas',    value: activas.length,                                                          sub: `${obras.filter(o=>o.estado==='en-presupuesto').length} en presu.`, color: T.ok },
          { label: 'Cobrado YTD',      value: fmtM(facturacionYTD),                                                    color: T.accent },
          { label: 'Gastado YTD',      value: fmtM(costoYTD),                                                          color: T.warn },
          { label: 'Margen promedio',  value: `${margenProm.toFixed(1)}%`,                                              sub: 'obras activas',     color: margenProm < 0 ? T.warn : T.ok },
        ]}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Avance por rubro */}
        <Box style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Avance por rubro</div>
            {obrasConDetalle.length > 0 && (
              <select value={selObraId} onChange={e => setRubroObraId(e.target.value)}
                style={{ padding: '4px 8px', borderRadius: 4, border: `1.5px solid ${T.faint2}`, fontSize: 12, fontFamily: T.font, background: T.paper }}>
                {obrasConDetalle.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </select>
            )}
          </div>
          {rubrosAvance.length === 0 && (
            <div style={{ color: T.ink3, fontSize: 12, padding: '12px 0' }}>Sin datos de avance registrados</div>
          )}
          {rubrosAvance.map(r => (
            <div key={r.nombre} style={{ marginBottom: 9 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                <span>{r.nombre}</span>
                <span style={{ fontFamily: T.fontMono }}>{r.avance}%</span>
              </div>
              <Bar pct={r.avance} ok={r.avance === 100} accent={r.avance > 0 && r.avance < 100} warn={r.avance === 0} />
            </div>
          ))}
          {selObra && (
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${T.faint2}`, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: T.ink2 }}>Avance global</span>
              <span style={{ fontFamily: T.fontMono, fontWeight: 800, color: T.accent }}>{selObra.avance}%</span>
            </div>
          )}
        </Box>

        {/* Margen por obra */}
        <Box style={{ padding: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Margen por obra</div>
          {obrasConMargen.length === 0 && (
            <div style={{ color: T.ink3, fontSize: 12 }}>Sin obras con margen registrado</div>
          )}
          {obrasConMargen.map(o => (
            <div key={o.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 10 }}>
              <span style={{ width: 90, fontSize: 12, flexShrink: 0, color: T.accent, cursor: 'pointer', textDecoration: 'underline', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                onClick={() => navigate(`/obras/${o.id}/presupuesto`)}>{o.nombre}</span>
              <div style={{ flex: 1, height: 16, background: T.faint2, borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, Math.abs(o.margen) * 2.5))}%`, background: margenColor(o.margen), borderRadius: 8 }} />
              </div>
              <span style={{ fontFamily: T.fontMono, fontSize: 12, fontWeight: 700, color: margenColor(o.margen), width: 38, textAlign: 'right', flexShrink: 0 }}>
                {o.margen > 0 ? '+' : ''}{o.margen}%
              </span>
              <Chip style={{ fontSize: 9 }}>{ESTADOS_LABEL[o.estado] || o.estado}</Chip>
            </div>
          ))}
        </Box>

        {/* Top proveedores */}
        <Box style={{ padding: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Top proveedores</div>
          <div style={{ fontSize: 11, color: T.ink2, marginBottom: 12 }}>Gasto registrado {CY}</div>
          {topProveedores.length === 0 && (
            <div style={{ color: T.ink3, fontSize: 12 }}>Sin movimientos de gasto en {CY}</div>
          )}
          {topProveedores.map(([prov, monto], i) => {
            const provObj = proveedores.find(p => p.nombre === prov);
            return (
            <div key={prov} style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 10 }}>
              <span style={{ width: 20, fontFamily: T.fontMono, fontSize: 11, color: T.ink3, flexShrink: 0 }}>#{i+1}</span>
              {provObj
                ? <span style={{ flex: 2, fontSize: 12, color: T.accent, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate(`/proveedores/${provObj.id}`)}>{prov}</span>
                : <span style={{ flex: 2, fontSize: 12 }}>{prov}</span>
              }
              <div style={{ flex: 2, height: 14, background: T.faint2, borderRadius: 7, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(monto / (topProveedores[0]?.[1] || 1)) * 100}%`, background: T.accent, borderRadius: 7 }} />
              </div>
              <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink2, width: 70, textAlign: 'right', flexShrink: 0 }}>{fmtM(monto)}</span>
            </div>
          );})}
        </Box>

        {/* Descargables + por tipo */}
        <Box style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Por tipo */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Distribución por tipo</div>
            {tiposMap.map(([tipo, { count, total }]) => (
              <div key={tipo} style={{ display: 'flex', alignItems: 'center', marginBottom: 7, gap: 10 }}>
                <span style={{ flex: 2, fontSize: 12 }}>{tipo}</span>
                <span style={{ fontSize: 11, color: T.ink2, width: 18, textAlign: 'center' }}>{count}</span>
                <div style={{ flex: 3, height: 14, background: T.faint2, borderRadius: 7, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(total / (tiposMap[0]?.[1]?.total || 1)) * 100}%`, background: T.ink2, borderRadius: 7 }} />
                </div>
                <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink2, width: 70, textAlign: 'right', flexShrink: 0 }}>{fmtM(total)}</span>
              </div>
            ))}
          </div>

          <div style={{ borderTop: `1px solid ${T.faint2}`, paddingTop: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Exportar datos</div>
            {[
              {
                label: 'Todas las obras', fmt: 'JSON',
                fn: () => exportJSON(obras, `kamak_obras_${CY}.json`),
              },
              {
                label: 'Movimientos (todos)', fmt: 'JSON',
                fn: () => exportJSON(
                  Object.entries(detalles).flatMap(([obraId, d]) =>
                    (d.movimientos || []).map(m => ({ ...m, obraId }))),
                  `kamak_movimientos_${CY}.json`),
              },
              {
                label: 'Contratos MO', fmt: 'JSON',
                fn: () => exportJSON(
                  Object.entries(detalles).flatMap(([obraId, d]) =>
                    (d.contratos || []).map(c => ({ ...c, obraId }))),
                  `kamak_contratos_${CY}.json`),
              },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${T.faint2}`, gap: 10 }}>
                <span style={{ fontSize: 16 }}>📊</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{item.label}</div>
                  <div style={{ fontSize: 10, color: T.ink2 }}>{item.fmt}</div>
                </div>
                <Btn sm onClick={item.fn}>↓</Btn>
              </div>
            ))}
          </div>
        </Box>
      </div>

      {/* Financiación cross-obra */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>

        {/* Adicionales aprobados */}
        <Box style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Adicionales aprobados</div>
            <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 13, color: T.ok }}>
              {adicionalesAprobados.length} · {fmtM(totalAdicionalesCliente)}
            </div>
          </div>
          {adicionalesAprobados.length === 0 ? (
            <div style={{ color: T.ink3, fontSize: 12 }}>Sin adicionales aprobados</div>
          ) : adicionalesAprobados.slice(0, 8).map(a => (
            <div key={a.id}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${T.faint2}`, cursor: 'pointer' }}
              onClick={() => navigate(`/obras/${a.obraId}/presupuesto?tab=3`)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.descripcion}</div>
                <div style={{ fontSize: 10, color: T.ink3 }}>{a.obraNombre}</div>
              </div>
              <span style={{ fontFamily: T.fontMono, fontSize: 12, fontWeight: 800, color: T.ok, flexShrink: 0 }}>
                {fmtM(a.valorVentaTotal || a.costoTotal || a.monto || 0)}
              </span>
            </div>
          ))}
          {adicionalesAprobados.length > 8 && (
            <div style={{ fontSize: 10, color: T.ink3, marginTop: 6, textAlign: 'right' }}>
              +{adicionalesAprobados.length - 8} más
            </div>
          )}
        </Box>

        {/* Cuotas próximas */}
        <Box style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Cuotas (60 días)</div>
              <div style={{ fontSize: 11, color: T.ink2 }}>
                Cobrado: {fmtM(cuotasCobradas)} · Total plan: {fmtM(cuotasTotalesMonto)}
              </div>
            </div>
            <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 13, color: cuotasProximas.length > 0 ? T.warn : T.ok }}>
              {cuotasProximas.length} pendientes
            </div>
          </div>
          {cuotasProximas.length === 0 ? (
            <div style={{ color: T.ink3, fontSize: 12 }}>Sin cuotas en los próximos 60 días</div>
          ) : cuotasProximas.map(c => (
            <div key={c.id}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${T.faint2}`, cursor: 'pointer' }}
              onClick={() => navigate(`/obras/${c.obraId}/presupuesto?tab=10`)}>
              <div style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink3, width: 36, flexShrink: 0 }}>
                {fmtFechaCorta(c.fecha)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.descripcion || `Cuota ${c.numero || ''}`}
                </div>
                <div style={{ fontSize: 10, color: T.ink3 }}>{c.obraNombre}</div>
              </div>
              <span style={{ fontFamily: T.fontMono, fontSize: 12, fontWeight: 800, color: T.warn, flexShrink: 0 }}>
                {fmtM(c.monto || 0)}
              </span>
            </div>
          ))}
        </Box>

      </div>
    </PageLayout>
  );
}
