import { useState, useRef, useMemo, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import PageLayout from '../../components/layout/PageLayout';
import { Box, Btn, Chip, Stat, Label, Bar, Divider } from '../../components/ui';
import { T } from '../../theme';
import { useObras, EMPTY_DETALLE } from '../../store/ObrasContext';
import { usePlantillas } from '../../store/PlantillasContext';
import { resolverCostosTareaPlantilla } from '../Plantillas';
import { useMovimientos } from '../../store/MovimientosContext';
import { useProveedores } from '../../store/ProveedoresContext';
import { useClientes } from '../../store/ClientesContext';
import { useDolar } from '../../store/DolarContext';
import ExportModal from '../modales/ExportModal';
import ContratoMOModal from '../modales/ContratoMOModal';
import { useGastosFijos } from '../../store/GastosFijosContext';
import { useCatalog, calcTarea } from '../../store/CatalogContext';
import { useUsuarios, ROL_TABS_OCULTAS, ROL_TABS_OCULTAS_DEFAULT } from '../../store/UsuariosContext';
import { useTareas } from '../../store/TareasContext';
import { generarTareasObra } from '../../lib/generarTareasObra';
import { supabase } from '../../lib/supabase';
import { loadSharedData, saveSharedData } from '../../lib/dbHelpers';
import { onRemoteChange } from '../../lib/syncBus';
import { esc, abrirHTML } from '../../lib/html';
import { BASE_CSS } from '../../lib/printTheme';
import { cajasDelUsuario } from '../../lib/permisosCaja';
import {
  cuotaMontoFn, cuotaCobrado, cuotaEstadoCalc,
  cuotaMontoUSD, arsToUSD, calcTotalClienteUSD,
  tareaVentaUnit, calcRubro, calcObra, calcTareaContratada,
  cobradoObraUSD, repartirCobroEnCuotas, cuotaEstadoDesdeCobrado,
  ingresosObraUSD, detallePagosCuotas,
  gastadoPorRubro, desvioRubro,
} from './helpers';

// Rediseño "libro único": lo cobrado de cada cuota se DERIVA de los movimientos
// de ingreso de la obra (no del libro paralelo cuota.pagos[]). Estos helpers
// arman, para una obra, las versiones "derivadas" de cuotaCobrado/cuotaEstadoCalc
// repartiendo el total cobrado (de movimientos) sobre las cuotas en orden.
function buildCuotaDerivados(cuotas, movimientos, cajas, obraId, obraMoneda, tc) {
  const cobUSD = cobradoObraUSD(movimientos, cajas, obraId, tc);
  const reparto = repartirCobroEnCuotas(cuotas, cobUSD, obraMoneda, tc);
  const ingresos = ingresosObraUSD(movimientos, cajas, obraId, tc);
  const detalle = detallePagosCuotas(cuotas, ingresos, obraMoneda, tc);
  return {
    cuotaCobrado: (c) => reparto[c.id] || 0, // en USD
    cuotaEstadoCalc: (c) => cuotaEstadoDesdeCobrado(c, reparto[c.id], obraMoneda, tc),
    cuotaPagos: (c) => detalle[c.id]?.pagos || [], // detalle derivado de movimientos
    cuotaFechaPagada: (c) => detalle[c.id]?.fechaPagada || null,
    cobradoTotalUSD: cobUSD,
  };
}
import { FRow, FInput, FSelect, FormPanel, inputSt, labelSt } from './forms';
import TabDocumentos from './tabs/TabDocumentos';
import ClienteAccesoModal from '../modales/ClienteAccesoModal';

// ── Helpers ───────────────────────────────────────────────────────────────────
const newId = () => `id-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const fmtN = (n) => Math.round(n).toLocaleString('es-AR');
const fmtM = (n, moneda) => moneda === 'USD' ? `U$S ${fmtN(n)}` : `$ ${fmtN(n)}`;
const fmtQ = (n) => { if (!n) return '0'; const r = Math.round(n * 1000) / 1000; return r.toLocaleString('es-AR', { maximumFractionDigits: 3 }); };
const fmtD = (iso) => !iso ? '—' : iso.split('-').reverse().join('/');

// Estilos del editor inline en celdas del presupuesto (constantes, no varian
// por celda ni por render). Antes se creaban dentro del .map() por cada tarea.
const INLINE_CELL_ST  = { fontFamily: T.fontMono, fontSize: 12, color: T.ink2, cursor: 'text', textDecoration: 'underline dotted', textDecorationColor: T.faint2 };
const INLINE_INPUT_ST = { width: '100%', textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, border: `1.5px solid ${T.accent}`, borderRadius: 3, padding: '2px 5px', outline: 'none', background: 'white', boxShadow: `0 0 0 3px ${T.accentSoft}` };

// ─────────────────────────────────────────────────────────────────────────────
// TAB 0: RESUMEN
// ─────────────────────────────────────────────────────────────────────────────
function TabResumen({ obra, detalle, moneda, onChangeTab }) {
  const { currentUser } = useUsuarios();
  const isAdmin     = currentUser?.rol === 'Admin';
  // Fail-closed: si la clave de permiso no esta presente, se considera NO autorizado.
  const verCostos   = isAdmin || currentUser?.permisos?.verCostos   === true;
  const verMargenes = isAdmin || currentUser?.permisos?.verMargenes === true;
  // useMemo: calcObra recorre todos los rubros y tareas; sin memoizar se
  // ejecutaba 5 veces por render y en cada keystroke de inputs.
  const { costo, venta, margen, rubros: rr } = useMemo(() => calcObra(detalle.rubros), [detalle.rubros]);
  // Avance ponderado por venta de cada rubro; si no hay pricing, promedio simple
  const avanceGeneral = rr.length > 0
    ? venta > 0
      ? Math.round(rr.reduce((s, r) => s + r.avance * r.venta, 0) / venta)
      : Math.round(rr.reduce((s, r) => s + r.avance, 0) / rr.length)
    : 0;
  const { dolarVenta } = useDolar();
  const { movimientos: allMovs, cajas: allCajasResumen } = useMovimientos();
  const today = new Date();
  const fin = obra.fechaFinEstim ? new Date(obra.fechaFinEstim) : null;
  const diasRest = fin ? Math.ceil((fin - today) / 86400000) : null;

  // Cobrado real: ingresos registrados en Movimientos con esta obra
  const movsObra = useMemo(() => allMovs.filter(m => m.obraId === obra.id), [allMovs, obra.id]);
  const totalCobradoReal = useMemo(() => movsObra.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0), [movsObra]);
  const totalGastadoReal = useMemo(() => movsObra.filter(m => m.tipo === 'gasto').reduce((s, m) => s + m.monto, 0), [movsObra]);
  const faltaCobrar = Math.max(0, venta - totalCobradoReal);

  const currMesKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
  const gastosMes = movsObra.filter(m => m.tipo === 'gasto' && m.fecha.startsWith(currMesKey)).reduce((s, m) => s + m.monto, 0);

  const alertas = [];
  if (margen < 0) alertas.push({ tipo: 'danger', msg: `Margen negativo (${margen}%) — sobrecosto detectado` });
  if (diasRest !== null && diasRest < 30 && avanceGeneral < 80) alertas.push({ tipo: 'warn', msg: `Quedan ${diasRest} días pero el avance es solo ${avanceGeneral}%` });
  detalle.adicionales.filter(a => a.estado === 'pendiente').forEach(a => alertas.push({ tipo: 'info', msg: `Adicional pendiente de aprobación: "${a.descripcion}"` }));

  const tc = dolarVenta || 1070;
  // ── MODELO DE MONEDA ──────────────────────────────────────────────────
  // - Costos (calcObra.costo, gastado real): SIEMPRE en pesos. Las compras
  //   se hacen en pesos. fmtPesos para mostrar.
  // - Venta al cliente (totalCliente, cuotas, cobrado): SIEMPRE en USD.
  //   En Kamak nunca venden en pesos; la obra puede estar marcada como
  //   USD (valores cargados en USD) o ARS (valores cargados en ARS y se
  //   convierten al display). fmtUSD para mostrar.
  const obraMonedaResumen = obra.moneda || 'ARS';
  const fmtPesos = (n) => `$ ${fmtN(n)}`;
  const fmtUSD   = (n) => `U$S ${fmtN(n)}`;

  // Financiación
  const finPlan = detalle.financiacion || {};
  const adicionalCliente = (detalle.adicionales || [])
    .filter(a => a.estado === 'aprobado' && a.aplicaACliente !== false)
    .reduce((s, a) => s + (a.valorVentaTotal ?? a.costoTotal ?? a.monto ?? 0), 0);
  const interesFin = parseFloat(finPlan.interes) || 0;
  // venta y adicionales en ARS (vienen de costos en pesos). Total en ARS,
  // convertido a USD para display.
  const totalClienteARS = Math.round((venta + adicionalCliente) * (1 + interesFin / 100));
  const totalClienteUSD = calcTotalClienteUSD(detalle, venta, adicionalCliente, interesFin, tc);
  const adicionalClienteUSD = arsToUSD(adicionalCliente, tc);
  const cuotasPlan = detalle.cuotas || [];
  // Cobrado por cuota DERIVADO de los movimientos (libro único).
  const { cuotaEstadoCalc } = buildCuotaDerivados(cuotasPlan, allMovs, allCajasResumen, obra.id, obraMonedaResumen, tc);
  // Cuotas en USD (cada una segun su moneda nativa).
  const cuotasPagadasUSD = cuotasPlan
    .filter(c => cuotaEstadoCalc(c, obraMonedaResumen, tc) === 'pagado')
    .reduce((s, c) => s + cuotaMontoUSD(c, obraMonedaResumen, tc), 0);
  const totalCuotasUSD = cuotasPlan.reduce((s, c) => s + cuotaMontoUSD(c, obraMonedaResumen, tc), 0);
  // Diferencia entre el total acordado y la suma de cuotas (alerta para
  // armar el plan completo).
  const diferenciaPlanUSD = totalClienteUSD - totalCuotasUSD;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* KPIs — solo Estado de obra. La info de cuenta cliente (monto, cobrado,
          saldo, adicionales, gastado) vive ahora en la pestaña "Cuenta
          corriente", no se duplica más en Resumen. */}
      {(() => {
        const gastadoSobrec = totalGastadoReal > costo && costo > 0;
        return (
          <>
            {/* Bloque chico de gastado a proveedores — el unico dato financiero
                que mantenemos en Resumen porque es operativo (vs. plata cliente
                que es comercial y vive en su tab). */}
            {(verCostos && totalGastadoReal > 0) && (
              <div>
                <div style={{ fontSize: 9.5, color: T.accent, fontFamily: T.fontMono, letterSpacing: 1.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>
                  ◆ Costos a proveedores
                </div>
                <Box style={{ padding: '13px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 9.5, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 1.2, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Gastado</div>
                      <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 22, color: gastadoSobrec ? T.accent : T.ink, lineHeight: 1.1 }}>{fmtPesos(totalGastadoReal)}</div>
                    </div>
                    {costo > 0 && (
                      <div style={{ fontSize: 11, color: T.ink3 }}>
                        de <b style={{ color: T.ink2 }}>{fmtPesos(costo)}</b> presupuestado · <b>{Math.round((totalGastadoReal / costo) * 100)}%</b> consumido
                      </div>
                    )}
                  </div>
                </Box>
              </div>
            )}

            {/* EJECUCIÓN POR RUBRO — presupuesto vs gastado real, por rubro */}
            {verCostos && (() => {
              const gmap = gastadoPorRubro(movsObra);
              const hayImputado = Object.keys(gmap.porRubroId).length + Object.keys(gmap.porNombre).length > 0;
              if (!hayImputado) return null;
              const filas = rr
                .map(r => ({ nombre: r.nombre, ...desvioRubro(r, gmap) }))
                .filter(f => f.costo > 0 || f.gastado > 0);
              return (
                <div>
                  <div style={{ fontSize: 9.5, color: T.accent, fontFamily: T.fontMono, letterSpacing: 1.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>
                    ◆ Ejecución por rubro · presupuesto vs real
                  </div>
                  <Box style={{ padding: '4px 0' }}>
                    {filas.map((f, i) => {
                      const sobre = f.desvio > 0;
                      const pctBar = f.pct != null ? Math.min(100, f.pct) : (f.gastado > 0 ? 100 : 0);
                      return (
                        <div key={f.nombre} style={{ padding: '7px 14px', borderTop: i > 0 ? `1px solid ${T.faint2}` : 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 3 }}>
                            <span style={{ fontWeight: 600, fontSize: 12 }}>{f.nombre}</span>
                            <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink2 }}>
                              {fmtPesos(f.gastado)} / {fmtPesos(f.costo)}
                              {f.pct != null && <b style={{ marginLeft: 6, color: sobre ? T.accent : f.pct >= 85 ? T.warn : T.ok }}>{f.pct}%</b>}
                              {sobre && <b style={{ marginLeft: 6, color: T.accent }}>+{fmtPesos(f.desvio)}</b>}
                            </span>
                          </div>
                          <div style={{ height: 5, background: T.faint2, borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${pctBar}%`, height: '100%', background: sobre ? T.accent : f.pct >= 85 ? T.warn : T.ok }} />
                          </div>
                        </div>
                      );
                    })}
                    {gmap.sinRubro > 0 && (
                      <div style={{ padding: '7px 14px', borderTop: `1px solid ${T.faint2}`, fontSize: 11, color: T.ink3, display: 'flex', justifyContent: 'space-between' }}>
                        <span>Gastos sin rubro asignado</span>
                        <span style={{ fontFamily: T.fontMono }}>{fmtPesos(gmap.sinRubro)}</span>
                      </div>
                    )}
                  </Box>
                </div>
              );
            })()}

            {/* ESTADO */}
            <div>
              <div style={{ fontSize: 9.5, color: T.accent, fontFamily: T.fontMono, letterSpacing: 1.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>
                ◆ Estado de obra
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <Box style={{ padding: '11px 14px' }}>
                  <div style={{ fontSize: 9.5, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 1.2, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Avance general</div>
                  <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 19, color: avanceGeneral >= 85 ? T.warn : T.ok, lineHeight: 1.1 }}>{avanceGeneral}%</div>
                </Box>
                {verMargenes && (
                  <Box style={{ padding: '11px 14px' }}>
                    <div style={{ fontSize: 9.5, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 1.2, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Margen real</div>
                    <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 19, color: margen < 0 ? T.accent : margen < 20 ? T.warn : T.ok, lineHeight: 1.1 }}>{margen}%</div>
                  </Box>
                )}
                <Box style={{ padding: '11px 14px' }}>
                  <div style={{ fontSize: 9.5, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 1.2, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Días al vencimiento</div>
                  <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 19, color: diasRest !== null && diasRest < 30 ? T.warn : T.ink, lineHeight: 1.1 }}>{diasRest !== null ? diasRest : '—'}</div>
                </Box>
              </div>
            </div>
          </>
        );
      })()}

      {/* Avance por rubro */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontSize: 9.5, color: T.accent, fontFamily: T.fontMono, letterSpacing: 1.5, fontWeight: 700, textTransform: 'uppercase' }}>
            ◆ Avance por rubro
          </div>
          <span style={{ fontSize: 11, color: T.accent, cursor: 'pointer' }} onClick={() => onChangeTab?.(1)}>Ver presupuesto →</span>
        </div>
        <Box style={{ padding: 14, cursor: 'pointer' }} onClick={() => onChangeTab?.(1)}>
          {rr.length === 0 && <div style={{ color: T.ink3, fontSize: 12 }}>Sin rubros cargados</div>}
          <div style={{ display: 'grid', gridTemplateColumns: rr.length > 4 ? '1fr 1fr' : '1fr', gap: rr.length > 4 ? '6px 20px' : 0 }}>
            {rr.map(r => (
              <div key={r.id} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span style={{ fontWeight: 600 }}>{r.nombre}</span>
                  <span style={{ fontFamily: T.fontMono, color: r.avance === 100 ? T.ok : T.ink2 }}>{r.avance}%</span>
                </div>
                <Bar pct={r.avance} ok={r.avance === 100} warn={r.avance < 50 && r.avance > 0} />
              </div>
            ))}
          </div>
        </Box>
      </div>

      {/* Alertas */}
      {alertas.length > 0 && (
        <div>
          <div style={{ fontSize: 9.5, color: T.accent, fontFamily: T.fontMono, letterSpacing: 1.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>
            ◆ Alertas
          </div>
          <Box style={{ padding: 12 }}>
            {alertas.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 10px', borderRadius: 4, marginBottom: 5, background: a.tipo === 'danger' ? '#fae6e0' : a.tipo === 'warn' ? '#fff7e6' : T.accentSoft, borderLeft: `3px solid ${a.tipo === 'danger' ? T.accent : a.tipo === 'warn' ? T.warn : T.accent}` }}>
                <span>{a.tipo === 'danger' ? '⚠' : a.tipo === 'warn' ? '⏰' : 'ℹ'}</span>
                <span style={{ fontSize: 12 }}>{a.msg}</span>
              </div>
            ))}
          </Box>
        </div>
      )}

      {/* Notas de obra — cargadas desde la app o por WhatsApp ("dejá nota en X: ...") */}
      {(detalle.notasRapidas || []).length > 0 && (
        <div>
          <div style={{ fontSize: 9.5, color: T.accent, fontFamily: T.fontMono, letterSpacing: 1.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>
            ◆ Notas de obra
          </div>
          <Box style={{ padding: 0, overflow: 'hidden' }}>
            {(detalle.notasRapidas || []).map((n) => (
              <div key={n.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 14px', borderBottom: `1px solid ${T.faint2}`, borderLeft: `3px solid ${T.accent}` }}>
                <span style={{ fontSize: 14, lineHeight: 1.3 }}>{n.origen === 'whatsapp' ? '🟢' : '📝'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.35 }}>{n.texto}</div>
                  <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 2, fontFamily: T.fontMono }}>
                    {n.autor || '—'}{n.origen === 'whatsapp' ? ' · WhatsApp' : ''} · {fmtD((n.fecha || '').slice(0, 10))}
                  </div>
                </div>
              </div>
            ))}
          </Box>
        </div>
      )}

      {/* Últimos movimientos — solo admin (no-admin los ve filtrados por cajasVisibles en tab Movimientos) */}
      {isAdmin && detalle.movimientos.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ fontSize: 9.5, color: T.accent, fontFamily: T.fontMono, letterSpacing: 1.5, fontWeight: 700, textTransform: 'uppercase' }}>
              ◆ Últimos movimientos
            </div>
            <span style={{ fontSize: 11, color: T.accent, cursor: 'pointer' }} onClick={() => onChangeTab?.(5)}>Ver todos →</span>
          </div>
          <Box style={{ padding: 0, overflow: 'hidden' }}>
            {[...detalle.movimientos].reverse().slice(0, 5).map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', padding: '8px 14px', borderBottom: `1px solid ${T.faint2}`, fontSize: 12, borderLeft: `3px solid ${m.tipo === 'ingreso' ? T.ok : T.warn}` }}>
                <span style={{ flex: 0.7, fontFamily: T.fontMono, color: T.ink2 }}>{fmtD(m.fecha)}</span>
                <span style={{ flex: 3 }}>{m.descripcion}</span>
                <span style={{ fontFamily: T.fontMono, fontWeight: 700, color: m.tipo === 'ingreso' ? T.ok : T.warn }}>
                  {m.tipo === 'ingreso' ? '+' : '-'}{fmtM(m.monto, moneda)}
                </span>
              </div>
            ))}
          </Box>
        </div>
      )}
    </div>
  );
}

// ── Autocomplete para nombre de tarea ─────────────────────────────────────────
function TaskAutocomplete({ value, onChange, suggestions, onSelect }) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(-1);
  const wrapRef = useRef(null);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return suggestions.slice(0, 10);
    return suggestions.filter(s => (s.nombre || '').toLowerCase().includes(q)).slice(0, 10);
  }, [value, suggestions]);

  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (s) => {
    onSelect(s);
    setOpen(false);
    setFocused(-1);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        autoFocus
        style={inputSt}
        value={value}
        placeholder="Nombre de la tarea…"
        onChange={e => { onChange(e.target.value); setOpen(true); setFocused(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setFocused(f => Math.min(f + 1, filtered.length - 1)); }
          if (e.key === 'ArrowUp')   { e.preventDefault(); setFocused(f => Math.max(f - 1, 0)); }
          if (e.key === 'Enter' && focused >= 0 && filtered[focused]) select(filtered[focused]);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: T.paper, border: `1.5px solid ${T.accent}`, borderTop: 'none', borderRadius: '0 0 5px 5px', zIndex: 200, boxShadow: '0 6px 20px rgba(0,0,0,0.15)', maxHeight: 260, overflow: 'auto' }}>
          {filtered.map((s, i) => (
            <div key={i} onMouseDown={() => select(s)}
              style={{ padding: '6px 10px', cursor: 'pointer', background: i === focused ? T.accentSoft : 'transparent', borderBottom: `1px solid ${T.faint2}` }}>
              <div style={{ fontWeight: 700, fontSize: 12 }}>{s.nombre}</div>
              <div style={{ fontSize: 10, color: T.ink2, display: 'flex', gap: 8, marginTop: 1 }}>
                {s.costoMat > 0 && <span>mat $ {fmtN(s.costoMat)}</span>}
                {s.costoSub > 0 && <span>sub $ {fmtN(s.costoSub)}</span>}
                <span style={{ background: T.faint, padding: '1px 5px', borderRadius: 3 }}>{s.unidad}</span>
                <span style={{ marginLeft: 'auto', color: s.fuente === 'Catálogo' ? T.accent : T.ok, fontWeight: 600 }}>{s.fuente}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function buildVisibleTareas(tareas, collapsedSections) {
  let sec1 = null, sec2 = null;
  return tareas.map(t => {
    if (t.tipo === 'seccion') {
      if (t.nivel === 1) { sec1 = t; sec2 = null; return { ...t, _hidden: false }; }
      sec2 = t;
      return { ...t, _hidden: !!(sec1 && collapsedSections.has(sec1.id)) };
    }
    const hidden = (sec1 && collapsedSections.has(sec1.id)) || (sec2 && collapsedSections.has(sec2.id));
    return { ...t, _hidden: hidden };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1: PRESUPUESTO
// ─────────────────────────────────────────────────────────────────────────────
function TabPresupuesto({ obra, detalle, patch, moneda, frozen, onApprove, onReopen, onExport }) {
  const { currentUser } = useUsuarios();
  const navigate = useNavigate();
  const { proveedores: provListPresu } = useProveedores();
  // Fail-closed: defaults restrictivos. Admin tiene todos los permisos por su rol.
  const isAdmin    = currentUser?.rol === 'Admin';
  const verCostos   = isAdmin || currentUser?.permisos?.verCostos   === true;
  const verMargenes = isAdmin || currentUser?.permisos?.verMargenes === true;
  const puedeEditar = (isAdmin || currentUser?.permisos?.editarPresu === true) && !frozen;
  const puedeCargarAvance = isAdmin || currentUser?.permisos?.cargarAvance === true;
  const [selTask, setSelTask] = useState(null);
  const [selRubroId, setSelRubroId] = useState(null);
  const [editTask, setEditTask] = useState(null);
  const [addingTask, setAddingTask] = useState(null);
  const [addingRubro, setAddingRubro] = useState(false);
  const [newTask, setNewTask] = useState({ codigo: '', nombre: '', unidad: 'u', cantidad: 1, costoMat: 0, costoSub: 0 });
  const [newRubro, setNewRubro] = useState({ rubroId: '', margenMat: 20, margenMO: 35, proveedor: '' });
  const [selectedTareas, setSelectedTareas] = useState(new Set());
  const [showPlantillas, setShowPlantillas] = useState(false);
  const [inlineEdit, setInlineEdit] = useState(null);
  const [editSeccionId, setEditSeccionId] = useState(null);
  const [editSeccionNombre, setEditSeccionNombre] = useState('');
  const [collapsedSections, setCollapsedSections] = useState(new Set());
  const toggleSeccion = (id) => setCollapsedSections(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Estado abierto/cerrado de rubros: vive en state local (no en el detalle
  // persistido, que generaba race conditions con el broadcast realtime).
  // Valor inicial: todos los rubros que tienen abierto !== false en el detalle.
  const [rubrosAbiertos, setRubrosAbiertos] = useState(() => {
    const s = new Set();
    for (const r of (detalle.rubros || [])) if (r.abierto !== false) s.add(r.id);
    return s;
  });
  const isRubroAbierto = (id) => rubrosAbiertos.has(id);
  const toggleRubroAbierto = (id) => setRubrosAbiertos(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  // Ref de rubros YA VISTOS por el state local — sirve para distinguir
  // "rubro nuevo (recien agregado)" de "rubro existente que el user cerró".
  // Sin esto, el useEffect re-abria todo rubro que el user cerraba apenas
  // detalle.rubros cambiaba por cualquier motivo (BUG reportado: "los cierro
  // y se vuelven a abrir solos"), porque "no esta en prev" se interpretaba
  // erroneamente como "es nuevo".
  const seenRubrosRef = useRef(new Set((detalle.rubros || []).map(r => r.id)));
  useEffect(() => {
    const seen = seenRubrosRef.current;
    const nuevos = (detalle.rubros || []).filter(r => !seen.has(r.id));
    if (nuevos.length === 0) return;
    setRubrosAbiertos(prev => {
      const next = new Set(prev);
      for (const r of nuevos) if (r.abierto !== false) next.add(r.id);
      return next;
    });
    for (const r of nuevos) seen.add(r.id);
  }, [detalle.rubros]);
  const [colsUser, setColsUser] = useState({ costoUnit: false, costoTotal: true, margenL: false, ventaUnit: false, ventaTotal: true });
  // Force-off cost/margin columns based on permissions
  const cols = {
    costoUnit:  verCostos   ? colsUser.costoUnit  : false,
    costoTotal: verCostos   ? colsUser.costoTotal : false,
    margenL:    verMargenes ? colsUser.margenL    : false,
    // Venta es precio al cliente — solo admin.
    ventaUnit:  isAdmin ? colsUser.ventaUnit  : false,
    ventaTotal: isAdmin ? colsUser.ventaTotal : false,
  };
  const { plantillas, add: addPlantilla, incrementUso } = usePlantillas();
  const [showSavePlantilla, setShowSavePlantilla] = useState(false);
  const [savePlantillaForm, setSavePlantillaForm] = useState({ nombre: '', tipo: 'Comercial', descripcion: '' });
  const { obras: todasObras, detalles } = useObras();
  const { totalMensual: gfMensual } = useGastosFijos();
  const { catalog, catalogIndex, sismatCostMap } = useCatalog();
  const { dolarVenta } = useDolar();
  const tc = dolarVenta || 1070;
  const [viewUSD, setViewUSD] = useState(true);
  const fmtVenta = n => viewUSD ? `U$S ${fmtN(Math.round(n / tc))}` : `$ ${fmtN(n)}`;

  // Rubro element refs for sidebar scroll-to
  const rubroElemsRef = useRef({});

  // Drag state ─ rubros
  const dragRubroRef = useRef(null);
  const [dragOverRubroId, setDragOverRubroId] = useState(null);
  // Drag state ─ tasks
  const dragTaskRef = useRef(null);
  const [dragOverTaskId, setDragOverTaskId] = useState(null);

  // All task suggestions: catalog APUs + tasks from all obras
  const allSuggestions = useMemo(() => {
    const seen = new Set();
    const list = [];
    // From catalog APUs
    (catalog.tareas || []).forEach(t => {
      if (seen.has(t.nombre)) return;
      seen.add(t.nombre);
      const { mat, sub, mo } = calcTarea(t, catalogIndex);
      list.push({ nombre: t.nombre, unidad: t.unidad || 'u', costoMat: Math.round(mat), costoSub: Math.round(sub + mo), codigo: t.codigo || '', fuente: 'Catálogo' });
    });
    // From all obras
    Object.values(detalles).forEach(d => {
      (d.rubros || []).forEach(r => {
        (r.tareas || []).forEach(t => {
          if (seen.has(t.nombre)) return;
          seen.add(t.nombre);
          list.push({ nombre: t.nombre, unidad: t.unidad || 'u', costoMat: t.costoMat || 0, costoSub: t.costoSub || 0, codigo: t.codigo || '', fuente: 'Obra' });
        });
      });
    });
    return list;
  }, [catalog.tareas, detalles]);

  const { costo, venta, cMat, cSub, margen, rubros: rr } = calcObra(detalle.rubros);

  const obrasActivas = todasObras.filter(o => ['activa', 'en-presupuesto'].includes(o.estado));
  const durMeses = (() => {
    const ini = obra.fechaInicio ? new Date(obra.fechaInicio) : null;
    const fin = obra.fechaFinEstim || obra.fechaFin ? new Date(obra.fechaFinEstim || obra.fechaFin) : null;
    if (!ini || !fin) return 6;
    return Math.max(1, Math.ceil((fin - ini) / (1000 * 60 * 60 * 24 * 30)));
  })();
  const gastosFijosObra = obrasActivas.length > 0 ? Math.round(gfMensual * durMeses / obrasActivas.length) : 0;

  const allVisibleTaskIds = useMemo(() => {
    const ids = [];
    for (const r of detalle.rubros) {
      for (const t of buildVisibleTareas(r.tareas, collapsedSections)) {
        if (!t._hidden && t.tipo !== 'seccion') ids.push(t.id);
      }
    }
    return ids;
  }, [detalle.rubros, collapsedSections]);

  const saveInlineCost = () => {
    if (!inlineEdit) return;
    const { taskId, field, value } = inlineEdit;
    const isCostField = field === 'costoMat' || field === 'costoSub';
    const parsed = field === 'margenLinea'
      ? (value === '' ? null : +value)
      : (viewUSD && isCostField ? Math.round((+value || 0) * tc) : (+value || 0));
    patch(d => ({ ...d, rubros: d.rubros.map(r => ({ ...r, tareas: r.tareas.map(t => t.id === taskId ? { ...t, [field]: parsed } : t) })) }));
    if (selTask?.id === taskId) setSelTask(prev => ({ ...prev, [field]: parsed }));
    setInlineEdit(null);
  };

  const patchTaskReceta = (taskId, receta) => {
    const costoMat = receta.materiales.reduce((s, m) => s + (m.costoUnit || 0), 0);
    patch(d => ({ ...d, rubros: d.rubros.map(r => ({ ...r, tareas: r.tareas.map(t => t.id === taskId ? { ...t, receta, costoMat } : t) })) }));
    setSelTask(prev => prev && prev.id === taskId ? { ...prev, receta, costoMat } : prev);
  };

  const guardarComoPlantilla = () => {
    if (!savePlantillaForm.nombre.trim()) return;
    const rubros = (detalle.rubros || []).map(r => ({
      id: newId(), nombre: r.nombre, margenMat: r.margenMat, margenMO: r.margenMO,
      tareas: (r.tareas || []).map(t => t.tipo === 'seccion'
        ? { id: newId(), tipo: 'seccion', nombre: t.nombre, nivel: t.nivel || 1 }
        : { id: newId(), nombre: t.nombre, codigo: t.codigo || '', unidad: t.unidad || 'u',
            cantidad: t.cantidad || 1, costoMat: t.costoMat || 0, costoSub: t.costoSub || 0,
            receta: t.receta ? { materiales: (t.receta.materiales || []).map(m => ({ ...m, id: newId() })) } : { materiales: [] },
            ...(t.margenLinea != null ? { margenLinea: t.margenLinea } : {}) }
      ),
    }));
    addPlantilla({ nombre: savePlantillaForm.nombre.trim(), tipo: savePlantillaForm.tipo, descripcion: savePlantillaForm.descripcion, rubros });
    setShowSavePlantilla(false);
  };

  const importarPlantilla = (plt) => {
    const n = detalle.rubros.length;
    const nuevos = (plt.rubros || []).map((r, idx) => ({
      id: newId(), nombre: r.nombre, proveedor: '', margenMat: r.margenMat || 20, margenMO: r.margenMO || 35,
      orden: n + idx, abierto: true,
      tareas: (r.tareas || []).map(t => {
        if (t.tipo === 'seccion') return { id: newId(), tipo: 'seccion', nombre: t.nombre, nivel: t.nivel || 1 };
        // Resolver el costo igual que la página Plantillas (hardcoded → catálogo
        // APU por nombre → SISMAT). Antes copiaba t.costoMat||0, por eso las
        // plantillas prediseñadas (sin costo guardado) entraban en cero.
        const { costoMat, costoSub } = resolverCostosTareaPlantilla(t, catalogIndex, sismatCostMap);
        return { id: newId(), codigo: t.codigo || '', nombre: t.nombre, unidad: t.unidad || 'u', cantidad: t.cantidad || 1, costoMat, costoSub, receta: t.receta ? { materiales: (t.receta.materiales || []).map(m => ({ ...m, id: newId() })) } : { materiales: [] }, avance: 0 };
      }),
    }));
    patch(d => ({ ...d, rubros: [...d.rubros, ...nuevos] }));
    incrementUso(plt.id);
    setShowPlantillas(false);
  };

  const addSeccion = (rubroId, nivel) => {
    const nombre = window.prompt(nivel === 2 ? 'Nombre de la sub-sección:' : 'Nombre de la sección:');
    if (!nombre?.trim()) return;
    patch(d => ({ ...d, rubros: d.rubros.map(r => r.id === rubroId ? { ...r, tareas: [...r.tareas, { id: newId(), tipo: 'seccion', nombre: nombre.trim(), nivel }] } : r) }));
  };
  const patchSeccionNombre = (tareaId, nombre) => {
    patch(d => ({ ...d, rubros: d.rubros.map(r => ({ ...r, tareas: r.tareas.map(t => t.id === tareaId ? { ...t, nombre } : t) })) }));
  };

  // Toggle local: NO toca el detalle ni dispara save remoto. El abrir/cerrar de
  // un rubro es UI puro, no info compartida con otras sesiones.
  const toggleRubro = (id) => toggleRubroAbierto(id);
  const deleteTarea = (rubroId, tareaId) => patch(d => ({ ...d, rubros: d.rubros.map(r => r.id === rubroId ? { ...r, tareas: r.tareas.filter(t => t.id !== tareaId) } : r) }));
  const deleteRubro = (rubroId) => { if (window.confirm('¿Eliminar rubro y todas sus tareas?')) patch(d => ({ ...d, rubros: d.rubros.filter(r => r.id !== rubroId) })); };
  // Toggle "materiales a cargo del comprador": no se cobran/cuentan los materiales
  // del rubro (solo la mano de obra) y en el export figura la nota.
  const toggleMaterialesComprador = (rubroId) => patch(d => ({ ...d, rubros: d.rubros.map(r => r.id === rubroId ? { ...r, materialesACargoComprador: !r.materialesACargoComprador } : r) }));

  const saveTask = () => {
    if (!newTask.nombre.trim()) return;
    const t = { id: newId(), ...newTask, cantidad: +newTask.cantidad, costoMat: +newTask.costoMat, costoSub: +newTask.costoSub || 0, receta: { materiales: [] }, avance: 0 };
    patch(d => ({ ...d, rubros: d.rubros.map(r => r.id === addingTask ? { ...r, tareas: [...r.tareas, t] } : r) }));
    setAddingTask(null);
    setNewTask({ codigo: '', nombre: '', unidad: 'u', cantidad: 1, costoMat: 0, costoSub: 0 });
  };

  const saveRubro = () => {
    const catalogRubro = (catalog.rubros || []).find(r => r.id === newRubro.rubroId);
    if (!catalogRubro) return;
    const tareasIniciales = (catalog.tareas || [])
      .filter(t => selectedTareas.has(t.id))
      .map(t => {
        const { mat, sub, mo, gen } = calcTarea(t, catalogIndex);
        return { id: newId(), nombre: t.nombre, codigo: t.codigo || '', unidad: t.unidad || 'u', cantidad: 1, costoMat: Math.round(mat + gen), costoSub: Math.round(sub + mo), receta: { materiales: (t.materiales || []).map(m => ({ id: newId(), nombre: m.nombre, cantidad: m.cantidad || 0, unidad: m.unidad || '', precio: m.precio || 0, costoUnit: (m.cantidad || 0) * (m.precio || 0) })) }, avance: 0 };
      });
    patch(d => ({ ...d, rubros: [...d.rubros, { id: newId(), nombre: catalogRubro.nombre, proveedor: newRubro.proveedor, margenMat: +newRubro.margenMat, margenMO: +newRubro.margenMO, orden: d.rubros.length, abierto: true, tareas: tareasIniciales }] }));
    setAddingRubro(false);
    setNewRubro({ rubroId: '', margenMat: 20, margenMO: 35, proveedor: '' });
    setSelectedTareas(new Set());
  };

  const saveEditTask = () => {
    if (!editTask) return;
    patch(d => ({ ...d, rubros: d.rubros.map(r => ({ ...r, tareas: r.tareas.map(t => t.id === editTask.id ? editTask : t) })) }));
    setSelTask(editTask);
    setEditTask(null);
  };

  const updateEditField = (k, v) => setEditTask(et => ({ ...et, [k]: isNaN(v) || v === '' ? v : +v }));
  const selRubro = selRubroId ? rr.find(r => r.id === selRubroId) : null;

  // ── Drag handlers: rubros ────────────────────────────────────────────────
  const onRubroDragStart = (e, rubroId) => {
    dragRubroRef.current = rubroId;
    e.dataTransfer.effectAllowed = 'move';
  };
  const onRubroDragOver = (e, rubroId) => {
    e.preventDefault();
    if (dragRubroRef.current && dragRubroRef.current !== rubroId) setDragOverRubroId(rubroId);
  };
  const onRubroDrop = (e, rubroId) => {
    e.preventDefault();
    const src = dragRubroRef.current;
    if (!src || src === rubroId) { setDragOverRubroId(null); return; }
    patch(d => {
      const rubros = [...d.rubros];
      const fi = rubros.findIndex(r => r.id === src);
      const ti = rubros.findIndex(r => r.id === rubroId);
      if (fi === -1 || ti === -1) return d;
      const [moved] = rubros.splice(fi, 1);
      rubros.splice(ti, 0, moved);
      return { ...d, rubros };
    });
    dragRubroRef.current = null;
    setDragOverRubroId(null);
  };
  const onRubroDragEnd = () => { dragRubroRef.current = null; setDragOverRubroId(null); };

  // ── Drag handlers: tasks ─────────────────────────────────────────────────
  const onTaskDragStart = (e, rubroId, taskId) => {
    dragTaskRef.current = { rubroId, taskId };
    e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation();
  };
  const onTaskDragOver = (e, taskId) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragTaskRef.current && dragTaskRef.current.taskId !== taskId) setDragOverTaskId(taskId);
  };
  const onTaskDrop = (e, toRubroId, toTaskId) => {
    e.preventDefault();
    e.stopPropagation();
    const src = dragTaskRef.current;
    if (!src || src.taskId === toTaskId) { setDragOverTaskId(null); return; }
    patch(d => {
      const rubros = d.rubros.map(r => ({ ...r, tareas: [...r.tareas] }));
      const fromRubro = rubros.find(r => r.id === src.rubroId);
      const toRubro = rubros.find(r => r.id === toRubroId);
      if (!fromRubro || !toRubro) return d;
      const fi = fromRubro.tareas.findIndex(t => t.id === src.taskId);
      if (fi === -1) return d;
      const [moved] = fromRubro.tareas.splice(fi, 1);
      const ti = toRubro.tareas.findIndex(t => t.id === toTaskId);
      toRubro.tareas.splice(ti === -1 ? toRubro.tareas.length : ti, 0, moved);
      return { ...d, rubros };
    });
    dragTaskRef.current = null;
    setDragOverTaskId(null);
  };
  const onTaskDragEnd = () => { dragTaskRef.current = null; setDragOverTaskId(null); };

  const COLS_DEF = [
    { key: 'costoUnit', label: '$ Costo unit' },
    { key: 'costoTotal', label: '$ Costo total' },
    { key: 'margenL', label: 'Margen %' },
    { key: 'ventaUnit', label: '$ Venta unit' },
    { key: 'ventaTotal', label: '$ Venta total' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden', height: 'calc(100vh - 250px)', minHeight: 520 }}>

      {/* ── Barra compacta única ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexShrink: 0, flexWrap: 'wrap', padding: '6px 10px', background: T.faint, borderRadius: 6, border: `1px solid ${T.faint2}` }}>

        {/* Totales inline — Venta solo admin (es precio al cliente). */}
        {isAdmin && <span style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 13, color: T.accent }}>Venta: {fmtVenta(venta)}</span>}
        {verCostos && <><span style={{ color: T.faint2 }}>·</span><span style={{ fontFamily: T.fontMono, fontSize: 12, fontWeight: 700, color: '#a85648' }}>Costo: {fmtVenta(costo)}</span></>}
        {verMargenes && <><span style={{ color: T.faint2 }}>·</span><span style={{ fontFamily: T.fontMono, fontSize: 12, fontWeight: 700, color: venta - costo < 0 ? '#dc2626' : T.ok }}>Ganancia: {fmtVenta(venta - costo)}</span></>}

        <span style={{ width: 1, height: 16, background: T.faint2, flexShrink: 0, margin: '0 2px' }} />

        {/* Toggle moneda */}
        <span onClick={() => setViewUSD(v => !v)}
          style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, cursor: 'pointer', userSelect: 'none', fontWeight: 700, border: `1px solid ${T.accent}`, background: T.accentSoft, color: T.accent }}>
          {viewUSD ? 'U$S' : '$'}
        </span>

        {/* Column toggles */}
        {COLS_DEF.filter(c => {
          if ((c.key === 'costoUnit' || c.key === 'costoTotal') && !verCostos) return false;
          if (c.key === 'margenL' && !verMargenes) return false;
          if ((c.key === 'ventaUnit' || c.key === 'ventaTotal') && !isAdmin) return false;
          return true;
        }).map(c => (
          <span key={c.key} onClick={() => setColsUser(s => ({ ...s, [c.key]: !s[c.key] }))}
            style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, cursor: 'pointer', userSelect: 'none', transition: 'all 0.12s',
              background: cols[c.key] ? T.accent : T.paper, color: cols[c.key] ? 'white' : T.ink3,
              fontWeight: cols[c.key] ? 700 : 400, border: `1px solid ${cols[c.key] ? T.accent : T.faint2}` }}>
            {c.label}
          </span>
        ))}

        <div style={{ flex: 1 }} />

        {/* Acciones */}
        {frozen ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: T.ok, fontWeight: 700 }}>
              Aprobado{detalle.fechaAprobacion ? ` ${fmtD(detalle.fechaAprobacion)}` : ''}
            </span>
            {onReopen && <Btn sm onClick={onReopen}>↩ Editar</Btn>}
          </div>
        ) : (
          onApprove && <Btn sm fill onClick={onApprove} style={{ background: T.ok, borderColor: T.ok, color: '#fff' }}>✓ Aprobar</Btn>
        )}
        {onExport && <Btn sm onClick={onExport}>↗</Btn>}
        {puedeEditar && <Btn sm fill onClick={() => setAddingRubro(true)}>+ Rubro</Btn>}
        {puedeEditar && <Btn sm onClick={() => setShowPlantillas(true)}>📋</Btn>}
        {puedeEditar && <Btn sm onClick={() => { setSavePlantillaForm({ nombre: obra.nombre || '', tipo: 'Comercial', descripcion: '' }); setShowSavePlantilla(true); }}>💾</Btn>}
      </div>

    <div style={{ display: 'flex', gap: 10, flex: 1, overflow: 'hidden' }}>
      {/* Left: rubro navigation sidebar */}
      <Box style={{ width: 138, flexShrink: 0, padding: '7px 5px', overflow: 'auto' }}>
        <div style={{ fontSize: 8.5, fontWeight: 800, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.6, padding: '0 4px', marginBottom: 5 }}>Por rubro</div>
        {rr.map(r => {
          const isActive = selRubroId === r.id;
          const num = r.nombre.match(/^(\d+)/)?.[1];
          const label = r.nombre.replace(/^\d+\s*-\s*/, '');
          return (
            <div key={r.id}
              onClick={() => {
                setSelRubroId(r.id);
                rubroElemsRef.current[r.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              style={{ display: 'flex', flexDirection: 'column', padding: '3px 8px', borderRadius: 3, cursor: 'pointer', background: isActive ? T.accentSoft : 'transparent', borderLeft: `2px solid ${isActive ? T.accent : 'transparent'}`, marginBottom: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {num && <span style={{ fontSize: 9, color: T.ink3, fontFamily: T.fontMono, flexShrink: 0, width: 14 }}>{num}</span>}
                <span style={{ flex: 1, fontSize: 11, color: isActive ? T.ink : T.ink2, fontWeight: isActive ? 700 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
              </div>
              <span style={{ fontSize: 9, color: T.ink3, fontFamily: T.fontMono, paddingLeft: num ? 18 : 0 }}>{fmtVenta(r.venta)}</span>
            </div>
          );
        })}
      </Box>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Rubros */}
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {detalle.rubros.length === 0 && !addingRubro && (
            <Box dashed style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: T.ink3 }}>
              <div style={{ fontSize: 13 }}>Sin rubros. Agregá el primero.</div>
              <Btn sm fill onClick={() => setAddingRubro(true)}>+ Agregar rubro</Btn>
            </Box>
          )}

          {rr.map(rubro => (
            <div key={rubro.id} ref={el => { if (el) rubroElemsRef.current[rubro.id] = el; }}>
            <Box
              draggable
              onDragStart={e => onRubroDragStart(e, rubro.id)}
              onDragOver={e => onRubroDragOver(e, rubro.id)}
              onDrop={e => onRubroDrop(e, rubro.id)}
              onDragEnd={onRubroDragEnd}
              style={{ padding: 0, flexShrink: 0, borderTop: dragOverRubroId === rubro.id ? `2px solid ${T.accent}` : '2px solid transparent', opacity: dragRubroRef.current === rubro.id ? 0.5 : 1, transition: 'border-top 0.1s' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: T.dark, borderBottom: isRubroAbierto(rubro.id) ? `2px solid ${T.ok}` : 'none', cursor: 'pointer' }}
                onClick={() => { toggleRubro(rubro.id); setSelRubroId(rubro.id); setSelTask(null); }}>
                <span style={{ color: 'rgba(255,255,255,0.4)', cursor: 'grab', userSelect: 'none' }}>⋮⋮</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{isRubroAbierto(rubro.id) ? '▾' : '▸'}</span>
                <div className="k-h" style={{ fontSize: 15, color: '#fff', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>{rubro.nombre}</div>
                <span style={{ fontSize: 10, fontFamily: T.fontMono, color: '#5fcf8a', whiteSpace: 'nowrap' }}>mat {rubro.margenMat}% · MO {rubro.margenMO}%</span>
                {rubro.proveedor && (() => {
                  const prov = provListPresu.find(p => p.nombre === rubro.proveedor);
                  return prov
                    ? <span style={{ fontSize: 10, cursor: 'pointer', color: '#7fd3d4' }} onClick={e => { e.stopPropagation(); navigate(`/proveedores/${prov.id}`); }}>{rubro.proveedor} ↗</span>
                    : <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)' }}>{rubro.proveedor}</span>;
                })()}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 14, alignItems: 'center', fontFamily: T.fontMono, fontSize: 11 }}>
                  {verCostos   && <span style={{ color: 'rgba(255,255,255,0.55)' }}>costo <b>{fmtVenta(rubro.costo)}</b></span>}
                  <span style={{ color: 'rgba(255,255,255,0.85)' }}>venta <b style={{ color: '#5fcf8a' }}>{fmtVenta(rubro.venta)}</b></span>
                  {verMargenes && <span style={{ color: rubro.margen > 0 ? '#5fcf8a' : '#ff9b8a' }}><b>{rubro.margen > 0 ? '+' : ''}{rubro.margen}%</b></span>}
                </span>
                {puedeEditar && (
                  <span
                    onClick={e => { e.stopPropagation(); toggleMaterialesComprador(rubro.id); }}
                    title={rubro.materialesACargoComprador ? 'Materiales a cargo del comprador — clic para volver a incluirlos' : 'Sacar los materiales del rubro (quedan a cargo del comprador)'}
                    style={{ fontSize: 9.5, fontFamily: T.fontMono, cursor: 'pointer', padding: '2px 7px', borderRadius: 3, whiteSpace: 'nowrap',
                      background: rubro.materialesACargoComprador ? '#5fcf8a' : 'rgba(255,255,255,0.12)',
                      color: rubro.materialesACargoComprador ? '#10261a' : 'rgba(255,255,255,0.8)',
                      border: `1px solid ${rubro.materialesACargoComprador ? '#5fcf8a' : 'rgba(255,255,255,0.25)'}` }}>
                    {rubro.materialesACargoComprador ? '✓ Mat. a cargo del comprador' : 'Sacar mat.'}
                  </span>
                )}
                {puedeEditar && <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, cursor: 'pointer' }}
                  onClick={e => { e.stopPropagation(); deleteRubro(rubro.id); }}>🗑</span>}
              </div>

              {isRubroAbierto(rubro.id) && (
                <>
                  <div className="k-tr k-th" style={{ background: '#e0d9c6', borderBottom: `1.5px solid ${T.faint2}`, whiteSpace: 'nowrap' }}>
                    <div className="k-cell" style={{ flex: 3, whiteSpace: 'nowrap' }}>Tarea</div>
                    <div className="k-cell" style={{ flex: 1.1, textAlign: 'right', fontSize: 9, whiteSpace: 'nowrap' }}>{puedeCargarAvance ? 'CANTIDAD ✏' : 'CANTIDAD'}</div>
                    <div className="k-cell" style={{ flex: 0.4, whiteSpace: 'nowrap' }}>U</div>
                    {verCostos && !rubro.materialesACargoComprador && <div className="k-cell" style={{ flex: 1, textAlign: 'right', color: '#a85648', whiteSpace: 'nowrap' }}>{puedeEditar ? `${viewUSD?'U$S':'$'} Mat ✏` : `${viewUSD?'U$S':'$'} Mat`}</div>}
                    {verCostos && <div className="k-cell" style={{ flex: 1, textAlign: 'right', color: '#a85648', whiteSpace: 'nowrap' }}>{puedeEditar ? `${viewUSD?'U$S':'$'} Sub ✏` : `${viewUSD?'U$S':'$'} Sub`}</div>}
                    {cols.costoUnit  && <div className="k-cell" style={{ flex: 1, textAlign: 'right', color: '#a85648', whiteSpace: 'nowrap' }}>{viewUSD?'U$S':'$'} Costo u</div>}
                    {cols.costoTotal && <div className="k-cell" style={{ flex: 1, textAlign: 'right', color: '#a85648', whiteSpace: 'nowrap' }}>{viewUSD?'U$S':'$'} Costo T</div>}
                    {cols.margenL   && <div className="k-cell" style={{ flex: 0.9, textAlign: 'right', color: T.ok, whiteSpace: 'nowrap' }}>Margen % {puedeEditar ? '✏' : ''}</div>}
                    {cols.ventaUnit  && <div className="k-cell" style={{ flex: 1, textAlign: 'right', color: T.accent, whiteSpace: 'nowrap' }}>{viewUSD?'U$S':'$'} Venta u</div>}
                    {cols.ventaTotal && <div className="k-cell" style={{ flex: 1.1, textAlign: 'right', color: T.accent, whiteSpace: 'nowrap' }}>{viewUSD?'U$S':'$'} Venta T</div>}
                    <div className="k-cell" style={{ flex: 0.4 }}></div>
                  </div>

                  {buildVisibleTareas(rubro.tareas, collapsedSections).map((tarea, i) => {
                    if (tarea._hidden) return null;
                    const costoUnit = (rubro.materialesACargoComprador ? 0 : tarea.costoMat) + (tarea.costoSub || 0);
                    const costoTotalRow = costoUnit * tarea.cantidad;
                    const ventaUnitRow = tareaVentaUnit(tarea, rubro);
                    const ventaTotalRow = ventaUnitRow * tarea.cantidad;
                    const isSelected = selTask?.id === tarea.id;
                    const ie = inlineEdit?.taskId === tarea.id ? inlineEdit : null;

                    // InlineNum vive aca para tomar `tarea` y `ie` por closure
                    // sin pasarlos como props. Definirla DENTRO del .map() era
                    // un anti-patron (50 funciones nuevas por render con 50
                    // tareas); ahora las constantes de estilo son globales y
                    // los handlers vienen del scope superior estables.
                    const InlineNum = ({ field, value, flex, fmt, color }) => (
                      <div className="k-cell" style={{ flex, textAlign: 'right', padding: '2px 6px', cursor: puedeEditar ? 'text' : 'inherit' }}
                        onClick={e => {
                          if (!puedeEditar) return; // bloqueado si presupuesto aprobado
                          e.stopPropagation();
                          if (!(ie?.taskId === tarea.id && ie?.field === field)) setInlineEdit({ taskId: tarea.id, field, value: String(value) });
                        }}>
                        {ie?.field === field
                          ? <input autoFocus type="number" min="0" step="any" style={INLINE_INPUT_ST} value={ie.value} onClick={e => e.stopPropagation()}
                              onFocus={e => e.target.select()}
                              onChange={e => setInlineEdit(x => ({ ...x, value: e.target.value }))}
                              onBlur={saveInlineCost}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  saveInlineCost();
                                  if (field === 'cantidad') {
                                    const idx = allVisibleTaskIds.indexOf(tarea.id);
                                    const nextId = allVisibleTaskIds[idx + 1];
                                    if (nextId) {
                                      let nextT = null;
                                      for (const r of detalle.rubros) { nextT = r.tareas.find(t => t.id === nextId); if (nextT) break; }
                                      if (nextT) setInlineEdit({ taskId: nextId, field: 'cantidad', value: String(nextT.cantidad) });
                                    }
                                  }
                                }
                                if (e.key === 'Escape') setInlineEdit(null);
                              }} />
                          : <span style={{ ...INLINE_CELL_ST, ...(color ? { color } : {}) }}>{fmt ? fmt(value) : value}</span>}
                      </div>
                    );

                    if (tarea.tipo === 'seccion') {
                      const indent = (tarea.nivel || 1) === 2 ? 36 : 16;
                      const bg = tarea.nivel === 2 ? T.faint : '#e4eaf0';
                      const isCollapsed = collapsedSections.has(tarea.id);
                      return (
                        <div key={tarea.id}
                          draggable
                          onDragStart={e => onTaskDragStart(e, rubro.id, tarea.id)}
                          onDragOver={e => onTaskDragOver(e, tarea.id)}
                          onDrop={e => onTaskDrop(e, rubro.id, tarea.id)}
                          onDragEnd={onTaskDragEnd}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: `5px 12px 5px ${indent}px`, background: bg, borderTop: dragOverTaskId === tarea.id ? `2px solid ${T.accent}` : `1px solid ${T.faint2}` }}>
                          <span style={{ color: T.ink3, cursor: 'grab', fontSize: 10, userSelect: 'none' }}>⋮⋮</span>
                          <span
                            onClick={() => toggleSeccion(tarea.id)}
                            style={{ cursor: 'pointer', fontSize: 11, color: T.ink2, userSelect: 'none', width: 14, flexShrink: 0 }}>
                            {isCollapsed ? '▸' : '▾'}
                          </span>
                          {editSeccionId === tarea.id
                            ? <input autoFocus value={editSeccionNombre}
                                onChange={e => setEditSeccionNombre(e.target.value)}
                                onBlur={() => { patchSeccionNombre(tarea.id, editSeccionNombre); setEditSeccionId(null); }}
                                onKeyDown={e => { if (e.key === 'Enter') { patchSeccionNombre(tarea.id, editSeccionNombre); setEditSeccionId(null); } if (e.key === 'Escape') setEditSeccionId(null); }}
                                style={{ flex: 1, fontSize: 11, fontWeight: 800, background: 'transparent', border: 'none', borderBottom: `1.5px solid ${T.accent}`, outline: 'none', color: T.ink, fontFamily: T.font, textTransform: 'uppercase', letterSpacing: 0.5 }} />
                            : <span
                                onDoubleClick={() => { setEditSeccionId(tarea.id); setEditSeccionNombre(tarea.nombre); }}
                                style={{ flex: 1, fontSize: 11, fontWeight: 800, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, cursor: 'text', userSelect: 'none' }}>
                                {tarea.nombre}
                              </span>
                          }
                          {puedeEditar && <span style={{ color: T.accent, fontSize: 12, cursor: 'pointer', marginLeft: 'auto' }}
                            onClick={() => deleteTarea(rubro.id, tarea.id)}>🗑</span>}
                        </div>
                      );
                    }

                    return (
                      <div key={tarea.id} className="k-tr presu-row"
                        draggable
                        onDragStart={e => onTaskDragStart(e, rubro.id, tarea.id)}
                        onDragOver={e => onTaskDragOver(e, tarea.id)}
                        onDrop={e => onTaskDrop(e, rubro.id, tarea.id)}
                        onDragEnd={onTaskDragEnd}
                        style={{ alignItems: 'center', background: isSelected ? T.accentSoft : (i % 2 ? T.faint : 'transparent'), cursor: 'pointer', borderTop: dragOverTaskId === tarea.id ? `2px solid ${T.accent}` : '2px solid transparent', transition: 'border-top 0.1s, background 0.12s' }}
                        onClick={() => { setSelTask(tarea); setSelRubroId(rubro.id); setEditTask(null); }}>
                        <div className="k-cell" style={{ flex: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: T.ink3, cursor: 'grab', userSelect: 'none', fontSize: 10 }}>⋮⋮</span>
                          {ie?.field === 'nombre' ? (
                            <input
                              autoFocus
                              defaultValue={tarea.nombre}
                              onBlur={e => {
                                const val = e.target.value.trim();
                                if (val && val !== tarea.nombre) {
                                  patch(d => ({
                                    ...d,
                                    rubros: d.rubros.map(r => r.id === rubro.id
                                      ? { ...r, tareas: r.tareas.map(t => t.id === tarea.id ? { ...t, nombre: val } : t) }
                                      : r),
                                  }));
                                }
                                setInlineEdit(null);
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') e.target.blur();
                                if (e.key === 'Escape') { setInlineEdit(null); e.target.blur(); }
                              }}
                              onClick={e => e.stopPropagation()}
                              style={{ flex: 1, padding: '2px 6px', border: `1.2px solid ${T.accent}`, borderRadius: 3, fontFamily: T.font, fontSize: 13, background: T.paper, outline: 'none' }}
                            />
                          ) : (
                            <span
                              onDoubleClick={e => {
                                if (!puedeEditar) return;
                                e.stopPropagation();
                                setInlineEdit({ taskId: tarea.id, field: 'nombre', value: tarea.nombre });
                              }}
                              title={puedeEditar ? 'Doble click para editar' : ''}
                              style={{ flex: 1, cursor: puedeEditar ? 'text' : 'inherit' }}
                            >
                              {tarea.nombre}
                            </span>
                          )}
                        </div>
                        {InlineNum({ field: 'cantidad', value: tarea.cantidad, flex: 1.1 })}
                        <div className="k-cell" style={{ flex: 0.4 }}>{tarea.unidad}</div>
                        {!rubro.materialesACargoComprador && InlineNum({ field: 'costoMat', value: viewUSD ? Math.round((tarea.costoMat || 0) / tc) : (tarea.costoMat || 0), flex: 1, fmt: v => fmtVenta(viewUSD ? v * tc : v), color: '#a85648' })}
                        {InlineNum({ field: 'costoSub', value: viewUSD ? Math.round((tarea.costoSub || 0) / tc) : (tarea.costoSub || 0), flex: 1, fmt: v => fmtVenta(viewUSD ? v * tc : v), color: '#a85648' })}

                        {cols.costoUnit  && <div className="k-cell" style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, color: '#a85648' }}>{fmtVenta(costoUnit)}</div>}
                        {cols.costoTotal && <div className="k-cell" style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, fontWeight: 700, color: '#a85648' }}>{fmtVenta(costoTotalRow)}</div>}

                        {cols.margenL && (
                          <div className="k-cell" style={{ flex: 0.9, textAlign: 'right', padding: '2px 6px' }}
                            onClick={e => { e.stopPropagation(); setInlineEdit({ taskId: tarea.id, field: 'margenLinea', value: tarea.margenLinea != null ? String(tarea.margenLinea) : '' }); }}>
                            {ie?.field === 'margenLinea'
                              ? <input autoFocus type="number" min="0" step="any" style={{ ...INLINE_INPUT_ST, width: 56 }} value={ie.value}
                                  placeholder={`${rubro.margenMat}/${rubro.margenMO}`}
                                  onFocus={e => e.target.select()}
                                  onChange={e => setInlineEdit(x => ({ ...x, value: e.target.value }))}
                                  onBlur={saveInlineCost}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      saveInlineCost();
                                      const idx = allVisibleTaskIds.indexOf(tarea.id);
                                      const nextId = allVisibleTaskIds[idx + 1];
                                      if (nextId) {
                                        let nextT = null;
                                        for (const r of detalle.rubros) { nextT = r.tareas.find(t => t.id === nextId); if (nextT) break; }
                                        if (nextT) setInlineEdit({ taskId: nextId, field: 'margenLinea', value: nextT.margenLinea != null ? String(nextT.margenLinea) : '' });
                                      }
                                    }
                                    if (e.key === 'Escape') setInlineEdit(null);
                                  }} />
                              : <span style={{ ...INLINE_CELL_ST, color: tarea.margenLinea != null ? T.accent : T.ink3 }}>
                                  {tarea.margenLinea != null ? `${tarea.margenLinea}%` : 'def'}
                                </span>}
                          </div>
                        )}

                        {cols.ventaUnit  && <div className="k-cell" style={{ flex: 1, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, color: T.accent }}>{fmtVenta(ventaUnitRow)}</div>}
                        {cols.ventaTotal && <div className="k-cell" style={{ flex: 1.1, textAlign: 'right', fontFamily: T.fontMono, fontSize: 12, fontWeight: 700, color: T.accent }}>{fmtVenta(ventaTotalRow)}</div>}

                        <div className="k-cell" style={{ flex: 0.4, padding: '0 4px' }}>
                          <span style={{ color: T.accent, fontSize: 11, cursor: 'pointer' }} onClick={e => { e.stopPropagation(); deleteTarea(rubro.id, tarea.id); }}>🗑</span>
                        </div>
                      </div>
                    );
                  })}

                  <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '7px 14px', background: T.faint, borderTop: `1.5px solid ${T.faint2}`, fontFamily: T.fontMono, fontSize: 11 }}>
                    <span style={{ color: T.ink3, fontSize: 9.5, letterSpacing: 0.5, marginRight: 'auto', textTransform: 'uppercase' }}>Total {rubro.nombre}</span>
                    {verCostos   && <span style={{ color: T.ink2 }}>costo <b style={{ color: T.ink }}>{fmtVenta(rubro.costo)}</b></span>}
                    <span style={{ color: T.ink2 }}>venta <b style={{ color: T.ok }}>{fmtVenta(rubro.venta)}</b></span>
                    {verMargenes && <span style={{ color: rubro.margen > 0 ? T.ok : '#a85648' }}><b>{rubro.margen > 0 ? '+' : ''}{rubro.margen}%</b></span>}
                  </div>

                  {addingTask === rubro.id ? (
                    <div style={{ padding: '10px 12px', background: T.accentSoft, borderTop: `1px solid ${T.accent}` }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 0.7fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                        <FRow label="Nombre tarea">
                          <TaskAutocomplete
                            value={newTask.nombre}
                            onChange={v => setNewTask(p => ({ ...p, nombre: v }))}
                            suggestions={allSuggestions}
                            onSelect={s => setNewTask(p => ({ ...p, nombre: s.nombre, unidad: s.unidad, costoMat: s.costoMat, costoSub: s.costoSub, codigo: s.codigo || p.codigo }))}
                          />
                        </FRow>
                        <FInput label="Cantidad" value={newTask.cantidad} onChange={v => setNewTask(p => ({ ...p, cantidad: v }))} type="number" />
                        <FInput label="Unidad" value={newTask.unidad} onChange={v => setNewTask(p => ({ ...p, unidad: v }))} />
                        <FInput label="$ Materiales" value={newTask.costoMat} onChange={v => setNewTask(p => ({ ...p, costoMat: v }))} type="number" />
                        <FInput label="$ M.O" value={newTask.costoSub} onChange={v => setNewTask(p => ({ ...p, costoSub: v }))} type="number" />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginBottom: 8 }}>
                        <FInput label="Código (opcional)" value={newTask.codigo} onChange={v => setNewTask(p => ({ ...p, codigo: v }))} placeholder="ELE-BOC-001" />
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <Btn sm onClick={() => setAddingTask(null)}>Cancelar</Btn>
                        <Btn sm accent onClick={saveTask}>+ Agregar</Btn>
                      </div>
                    </div>
                  ) : (
                    <div className="k-tr" style={{ cursor: 'pointer', gap: 0 }}>
                      <div className="k-cell" style={{ flex: 1, color: T.accent, fontSize: 12 }} onClick={() => { setAddingTask(rubro.id); setSelTask(null); }}>+ Agregar tarea</div>
                      {puedeEditar && <>
                        <div className="k-cell" style={{ color: T.ink2, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => addSeccion(rubro.id, 1)}>§ Sección</div>
                        <div className="k-cell" style={{ color: T.ink3, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => addSeccion(rubro.id, 2)}>§§ Sub-sección</div>
                      </>}
                    </div>
                  )}
                </>
              )}
            </Box>
            </div>
          ))}

          {addingRubro && (() => {
            const selCatRubro = (catalog.rubros || []).find(r => r.id === newRubro.rubroId);
            const tareasDispo = selCatRubro
              ? (catalog.tareas || []).filter(t => t.rubroNombre === selCatRubro.nombre)
              : [];
            const toggleTarea = (id) => setSelectedTareas(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
            return (
              <FormPanel title="Nuevo rubro" onSave={saveRubro} onCancel={() => { setAddingRubro(false); setNewRubro({ rubroId: '', margenMat: 20, margenMO: 35, proveedor: '' }); setSelectedTareas(new Set()); }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.5fr', gap: 10 }}>
                  <FRow label="Rubro">
                    <select style={{ ...inputSt, cursor: 'pointer' }} value={newRubro.rubroId}
                      onChange={e => { setNewRubro(p => ({ ...p, rubroId: e.target.value })); setSelectedTareas(new Set()); }}>
                      <option value="">— Seleccionar rubro —</option>
                      {(catalog.rubros || []).map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                    </select>
                  </FRow>
                  <FInput label="% margen mat" value={newRubro.margenMat} onChange={v => setNewRubro(p => ({ ...p, margenMat: v }))} type="number" />
                  <FInput label="% margen Sub" value={newRubro.margenMO} onChange={v => setNewRubro(p => ({ ...p, margenMO: v }))} type="number" />
                  <FInput label="Proveedor" value={newRubro.proveedor} onChange={v => setNewRubro(p => ({ ...p, proveedor: v }))} placeholder="Nombre proveedor" />
                </div>
                {newRubro.rubroId && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Tareas disponibles {selectedTareas.size > 0 && <span style={{ color: T.accent }}>· {selectedTareas.size} seleccionadas</span>}
                      </div>
                      {tareasDispo.length > 0 && (
                        <span style={{ fontSize: 10, color: T.accent, cursor: 'pointer', fontWeight: 700 }}
                          onClick={() => setSelectedTareas(selectedTareas.size === tareasDispo.length ? new Set() : new Set(tareasDispo.map(t => t.id)))}>
                          {selectedTareas.size === tareasDispo.length ? 'Deseleccionar todo' : 'Seleccionar todo'}
                        </span>
                      )}
                    </div>
                    {tareasDispo.length === 0
                      ? <div style={{ fontSize: 12, color: T.ink3, padding: '8px 0' }}>No hay tareas cargadas en este rubro del catálogo.</div>
                      : <div style={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${T.faint2}`, borderRadius: 4, background: T.paper }}>
                          {tareasDispo.map(t => {
                            const checked = selectedTareas.has(t.id);
                            const { mat, sub, mo, gen } = calcTarea(t, catalogIndex);
                            return (
                              <div key={t.id} onClick={() => toggleTarea(t.id)}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer', background: checked ? T.accentSoft : 'transparent', borderBottom: `1px solid ${T.faint}` }}>
                                <input type="checkbox" readOnly checked={checked} style={{ cursor: 'pointer', flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12, fontWeight: checked ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.nombre}</div>
                                  <div style={{ fontSize: 10, color: T.ink3 }}>{t.unidad} · mat ${fmtN(Math.round(mat + gen))} · sub ${fmtN(Math.round(sub + mo))}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                    }
                  </div>
                )}
              </FormPanel>
            );
          })()}
        </div>
      </div>

      {/* Modal: Desde plantilla */}
      {showPlantillas && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowPlantillas(false)}>
          <div style={{ background: T.paper, borderRadius: 8, padding: 22, width: 580, maxHeight: '75vh', overflow: 'auto', boxShadow: '0 6px 32px rgba(0,0,0,0.22)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 6 }}>Importar desde plantilla</div>
            <div style={{ fontSize: 12, color: T.ink2, marginBottom: 14 }}>Los rubros y tareas se agregarán al presupuesto actual.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {plantillas.length === 0 && <div style={{ color: T.ink3, fontSize: 12, padding: 16, textAlign: 'center' }}>Sin plantillas disponibles</div>}
              {plantillas.map(p => {
                const nRubros = (p.rubros || []).length;
                const nTareas = (p.rubros || []).reduce((s, r) => s + (r.tareas || []).length, 0);
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', background: T.faint, borderRadius: 4, border: `1px solid ${T.faint2}`, gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{p.nombre}</div>
                      <div style={{ fontSize: 11, color: T.ink2 }}>{p.descripcion || p.tipo}</div>
                    </div>
                    <Chip style={{ fontSize: 10 }}>{nRubros} rubros</Chip>
                    <Chip style={{ fontSize: 10 }}>{nTareas} tareas</Chip>
                    <Btn sm fill onClick={() => importarPlantilla(p)}>Importar →</Btn>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 14, textAlign: 'right' }}><Btn sm onClick={() => setShowPlantillas(false)}>Cerrar</Btn></div>
          </div>
        </div>
      )}

      {/* Modal: Guardar como plantilla */}
      {showSavePlantilla && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowSavePlantilla(false)}>
          <div style={{ background: T.paper, borderRadius: 8, padding: 24, width: 460, boxShadow: '0 6px 32px rgba(0,0,0,0.22)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>Guardar como plantilla</div>
            <div style={{ fontSize: 12, color: T.ink2, marginBottom: 16 }}>
              Se guardará una copia del presupuesto actual con {detalle.rubros.length} rubros y {detalle.rubros.reduce((s, r) => s + (r.tareas || []).filter(t => t.tipo !== 'seccion').length, 0)} tareas (incluyendo secciones y sub-secciones).
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FRow label="Nombre de la plantilla">
                <input autoFocus style={inputSt} value={savePlantillaForm.nombre}
                  onChange={e => setSavePlantillaForm(p => ({ ...p, nombre: e.target.value }))}
                  placeholder="Ej: Panadería 130m²" />
              </FRow>
              <FRow label="Tipo">
                <select style={{ ...inputSt, cursor: 'pointer' }} value={savePlantillaForm.tipo}
                  onChange={e => setSavePlantillaForm(p => ({ ...p, tipo: e.target.value }))}>
                  {['Comercial', 'Vivienda', 'Industrial', 'Refacción'].map(t => <option key={t}>{t}</option>)}
                </select>
              </FRow>
              <FRow label="Descripción (opcional)">
                <input style={inputSt} value={savePlantillaForm.descripcion}
                  onChange={e => setSavePlantillaForm(p => ({ ...p, descripcion: e.target.value }))}
                  placeholder="Breve descripción del modelo" />
              </FRow>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
              <Btn sm onClick={() => setShowSavePlantilla(false)}>Cancelar</Btn>
              <Btn sm fill style={{ opacity: savePlantillaForm.nombre.trim() ? 1 : 0.5 }} onClick={guardarComoPlantilla}>Guardar plantilla</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Panel APU eliminado: la edicion de cantidad, costo mat, costo sub,
          margen, venta y avance ya se hace inline en la tabla del cómputo.
          El nombre tambien es editable con doble-click. La receta detallada
          (componentes individuales) queda pendiente — si se necesita, se
          accede via un boton/modal por tarea. */}
    </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2: MATERIALES
// ─────────────────────────────────────────────────────────────────────────────
function TabMateriales({ detalle, obra }) {
  const [selCategoria, setSelCategoria] = useState(null);
  const { catalog } = useCatalog();

  // Aggregate all materials globally, grouped by material category
  const catMats = useMemo(() => {
    const catalogByNombre = new Map((catalog.tareas || []).map(ct => [ct.nombre, ct]));
    const globalMap = new Map();
    for (const rubro of (detalle.rubros || [])) {
      for (const t of (rubro.tareas || []).filter(t => t.tipo !== 'seccion')) {
        const recipeMats = (t.receta?.materiales || []).length > 0
          ? t.receta.materiales
          : (catalogByNombre.get(t.nombre)?.materiales || []);
        for (const m of recipeMats) {
          if (!m.nombre) continue;
          const stored = m.cantidad || 0;
          const precio = m.precio || 0;
          const costoUnit = m.costoUnit || 0;
          let cantUnit = stored;
          if (stored > 0 && precio > 0 && costoUnit > 0 && Math.abs(stored * precio - costoUnit) > costoUnit * 0.01 + 0.01) {
            cantUnit = costoUnit / precio;
          } else if (stored === 0 && precio > 0 && costoUnit > 0) {
            cantUnit = costoUnit / precio;
          }
          const qty = cantUnit * t.cantidad;
          if (globalMap.has(m.nombre)) {
            globalMap.get(m.nombre).cantidad += qty;
          } else {
            globalMap.set(m.nombre, { nombre: m.nombre, unidad: m.unidad || '', categoria: m.categoria || 'General', cantidad: qty });
          }
        }
      }
    }
    // Group by material category
    const catMap = new Map();
    for (const mat of globalMap.values()) {
      const cat = mat.categoria;
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat).push(mat);
    }
    return [...catMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'es'))
      .map(([categoria, materiales]) => ({ categoria, materiales: materiales.sort((a, b) => a.nombre.localeCompare(b.nombre)) }));
  }, [detalle.rubros, catalog.tareas]);

  const globalMats = useMemo(() => {
    return catMats.flatMap(c => c.materiales).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [catMats]);

  const visibleMats = selCategoria
    ? (catMats.find(c => c.categoria === selCategoria)?.materiales || [])
    : globalMats;

  const exportarLista = () => {
    const titulo = selCategoria
      ? selCategoria
      : 'Todos los materiales';
    const fecha = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
    const rows = visibleMats.map((m, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><b>${esc(m.nombre)}</b></td>
        <td>${esc(m.categoria)}</td>
        <td>${esc(m.unidad)}</td>
        <td style="text-align:right;font-family:monospace">${fmtQ(m.cantidad)}</td>
        <td style="width:120px"></td>
      </tr>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Lista de Materiales — ${esc(obra?.nombre || '')}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:12px;padding:16mm 20mm;color:#1a1a1a}
  h2{margin:0 0 2px;font-size:17px;letter-spacing:0.5px}
  .sub{font-size:11px;color:#666;margin-bottom:18px}
  table{width:100%;border-collapse:collapse}
  th{background:#1f2024;color:#fff;padding:7px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px}
  th:nth-child(5),th:nth-child(6){text-align:right}
  td{padding:6px 10px;border-bottom:1px solid #e8e8e8;vertical-align:top}
  tr:nth-child(even) td{background:#f7f7f7}
  .note{font-size:10px;color:#888;margin-top:14px}
  @media print{body{padding:8mm 12mm}.note{display:none}}
</style></head><body>
<h2>LISTA DE MATERIALES · ${esc((obra?.nombre || '').toUpperCase())}</h2>
<div class="sub">${esc(titulo)} · Para cotización · ${esc(fecha)}</div>
<table>
  <thead><tr>
    <th style="width:32px">#</th>
    <th>Material / Descripción</th>
    <th>Categoría</th>
    <th>Unidad</th>
    <th style="text-align:right;width:90px">Cantidad</th>
    <th style="text-align:right;width:120px">Precio unitario</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="note">* Lista generada automáticamente desde Kamak · Precios a confirmar por proveedor</div>
<script>setTimeout(()=>window.print(),400)</script>
</body></html>`;
    abrirHTML(html);
  };

  return (
    <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 240px)' }}>

      {/* Sidebar: material categories */}
      <div style={{ width: 200, flexShrink: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div onClick={() => setSelCategoria(null)}
          style={{ padding: '8px 10px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${!selCategoria ? T.accent : T.faint2}`, background: !selCategoria ? T.accentSoft : T.paper }}>
          <div style={{ fontSize: 12, fontWeight: !selCategoria ? 700 : 400 }}>Todos los materiales</div>
          <div style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink3, marginTop: 2 }}>{globalMats.length} materiales</div>
        </div>
        {catMats.map(({ categoria, materiales }) => (
          <div key={categoria} onClick={() => setSelCategoria(categoria)}
            style={{ padding: '8px 10px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${selCategoria === categoria ? T.accent : T.faint2}`, background: selCategoria === categoria ? T.accentSoft : T.paper }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{categoria}</div>
            <div style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink3, marginTop: 2 }}>{materiales.length} materiales</div>
          </div>
        ))}
      </div>

      {/* Main table */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>
            {visibleMats.length} {visibleMats.length === 1 ? 'material' : 'materiales'}
          </div>
          <Btn sm onClick={exportarLista} disabled={visibleMats.length === 0}>
            📋 Exportar para cotización
          </Btn>
        </div>

        <Box style={{ flex: 1, padding: 0, overflow: 'auto' }}>
          {visibleMats.length === 0 && (
            <div style={{ padding: 48, textAlign: 'center', color: T.ink3 }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>🧱</div>
              <div style={{ fontSize: 12 }}>Sin materiales registrados. Agregá recetas APU a las tareas desde la pestaña Presupuesto.</div>
            </div>
          )}
          {visibleMats.length > 0 && (
            <>
              <div className="k-tr" style={{ background: T.faint, fontWeight: 700, fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                <div className="k-cell" style={{ flex: 3 }}>Material</div>
                <div className="k-cell" style={{ flex: 0.9 }}>Categoría</div>
                <div className="k-cell" style={{ flex: 0.6, textAlign: 'right' }}>Unidad</div>
                <div className="k-cell" style={{ flex: 0.9, textAlign: 'right' }}>Cantidad total</div>
              </div>
              {visibleMats.map((m, i) => (
                <div key={m.nombre} className="k-tr" style={{ alignItems: 'center' }}>
                  <div className="k-cell" style={{ flex: 3, fontWeight: 600, fontSize: 12 }}>{m.nombre}</div>
                  <div className="k-cell" style={{ flex: 0.9 }}>
                    <Chip style={{ fontSize: 9 }}>{m.categoria}</Chip>
                  </div>
                  <div className="k-cell" style={{ flex: 0.6, fontFamily: T.fontMono, textAlign: 'right', fontSize: 12, color: T.ink2 }}>{m.unidad}</div>
                  <div className="k-cell" style={{ flex: 0.9, fontFamily: T.fontMono, textAlign: 'right', fontWeight: 700, fontSize: 13 }}>{fmtQ(m.cantidad)}</div>
                </div>
              ))}
            </>
          )}
        </Box>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3: ADICIONALES
// ─────────────────────────────────────────────────────────────────────────────
const fmtU = (n) => n != null && n !== '' ? fmtN(n) : '—';

// ── Export HTML helpers (adicionales + resumen) ───────────────────────────────
const fmtNE  = (n) => Math.round(n ?? 0).toLocaleString('es-AR');
const fmtME  = (n, m) => m === 'USD' ? `U$S ${fmtNE(n)}` : `$ ${fmtNE(n)}`;
const fmtDE  = (iso) => !iso ? '—' : iso.split('-').reverse().join('/');
const fechaE = () => new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });

// BASE_CSS se importa desde src/lib/printTheme.js (identidad visual compartida
// con la factura electrónica). Ver el import arriba.

function generarHTMLAdicionales({ obra, detalle, moneda }) {
  const adic = detalle.adicionales || [];
  const monedaStr = moneda || 'ARS';
  const aprobados = adic.filter(a => a.estado === 'aprobado');
  const totalCosto = aprobados.reduce((s, a) => s + (a.costoTotal ?? a.monto ?? 0), 0);
  const totalVenta = aprobados.reduce((s, a) => s + (a.valorVentaTotal ?? a.monto ?? 0), 0);

  const rows = adic.map((a, i) => {
    const estadoPill = a.estado === 'aprobado'
      ? `<span class="pill ok">aprobado</span>`
      : a.estado === 'rechazado'
        ? `<span class="pill accent">rechazado</span>`
        : `<span class="pill warn">pendiente</span>`;
    return `<tr${i % 2 === 1 ? ' class="alt"' : ''}>
      <td>${i + 1}</td>
      <td class="b">${esc(a.descripcion || '—')}</td>
      <td>${esc(a.tarea || '—')}</td>
      <td class="r">${a.cantidad != null ? fmtNE(a.cantidad) : '—'}</td>
      <td class="r">${esc(a.unidad || '—')}</td>
      <td class="r">${a.costoTotal != null ? fmtME(a.costoTotal, monedaStr) : '—'}</td>
      <td class="r b" style="color:#1a9b9c">${a.valorVentaTotal != null ? fmtME(a.valorVentaTotal, monedaStr) : '—'}</td>
      <td>${estadoPill}</td>
      <td class="r">${fmtDE(a.fecha)}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Adicionales — ${esc(obra?.nombre || '')}</title><style>${BASE_CSS}</style></head><body>
<div class="hdr">
  <div><div class="logo">KAMAK</div><div style="font-size:9px;color:#9a9892;font-family:'JetBrains Mono',monospace;margin-top:2px">KAMAKDESARROLLOS@GMAIL.COM</div></div>
  <div class="hdr-r">ADICIONALES DE OBRA<br>${fechaE()}</div>
</div>
<div class="title">ADICIONALES</div>
<div class="obra-info">${esc((obra?.nombre || '').toUpperCase())}${obra?.cliente ? ' · ' + esc(obra.cliente) : ''}${obra?.tipo ? ' · ' + esc(obra.tipo) : ''} · ${adic.length} adicionales · ${aprobados.length} aprobados</div>
<table>
  <thead><tr>
    <th>#</th><th>Descripción</th><th>Tarea</th><th class="r">Cant</th><th class="r">Un</th>
    <th class="r">Costo total</th><th class="r">Venta total</th><th>Estado</th><th class="r">Fecha</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  ${aprobados.length > 0 ? `<tfoot>
    <tr class="subtot"><td colspan="5"></td><td class="r">${fmtME(totalCosto, monedaStr)}</td><td class="r" style="color:#1a9b9c">${fmtME(totalVenta, monedaStr)}</td><td colspan="2"></td></tr>
  </tfoot>` : ''}
</table>
<div class="ftr"><span>KAMAK DESARROLLOS</span><span>NO INCLUYE IVA</span><span>${fechaE()}</span></div>
</body></html>`;
}

function generarHTMLResumen({ obra, detalle, moneda, incluirPagos, dolarVenta, logoLight, cobradoUSD = 0 }) {
  const tc = dolarVenta || 1070;
  const toUSD  = n => `U$S ${fmtNE(Math.round(n / tc))}`; // ARS → USD display
  const fmtUSD = n => `U$S ${fmtNE(n)}`;                  // already-USD display
  const cuotaMonto = c => (c._usd || (moneda || 'ARS') !== 'USD') ? c.monto : Math.round(c.monto / tc);

  const rubros = detalle.rubros || [];
  const adic = (detalle.adicionales || []).filter(a => a.estado === 'aprobado' && a.aplicaACliente !== false);
  const cuotas = detalle.cuotas || [];
  // Lo cobrado por cuota DERIVADO de los movimientos (mismo criterio que la
  // pantalla), repartido sobre las cuotas en orden.
  const _repartoPdf = repartirCobroEnCuotas(cuotas, cobradoUSD, moneda || 'ARS', tc);
  const fin = detalle.financiacion || {};

  let ventaBase = 0;
  const rubroRows = rubros.map((rubro, ri) => {
    let rubroVenta = 0;
    const tareaRows = rubro.tareas.filter(t => t.tipo !== 'seccion').map((t, ti) => {
      const cu = t.costoMat + (t.costoSub || 0);
      const vu = t.margenLinea != null ? cu * (1 + t.margenLinea / 100) : t.costoMat * (1 + (rubro.margenMat || 0) / 100) + (t.costoSub || 0) * (1 + (rubro.margenMO || 0) / 100);
      const vt = Math.round(vu * t.cantidad);
      rubroVenta += vt;
      return `<tr${ti % 2 === 1 ? ' class="alt"' : ''}><td style="padding-left:20px">${t.nombre}</td><td class="r">${fmtNE(t.cantidad)}</td><td class="r">${t.unidad}</td><td class="r">${toUSD(vt)}</td></tr>`;
    }).join('');
    ventaBase += rubroVenta;
    return `<tr class="rubro"><td colspan="3">RUBRO ${String(ri+1).padStart(2,'0')} · ${rubro.nombre.toUpperCase()}</td><td class="r">${toUSD(rubroVenta)}</td></tr>${tareaRows}`;
  }).join('');

  const adicRows = adic.map((a, i) => `<tr${i % 2 === 1 ? ' class="alt"' : ''}><td style="padding-left:20px">${a.descripcion}</td><td class="r">${a.cantidad != null ? fmtNE(a.cantidad) : ''}</td><td class="r">${a.unidad || ''}</td><td class="r" style="color:#1a9b9c">${toUSD(a.valorVentaTotal ?? a.monto ?? 0)}</td></tr>`).join('');
  // Fórmula unificada con TabFinanciacion / TabResumen / TabCuentaCorriente:
  // valorVentaTotal > costoTotal > monto (para que el PDF coincida con la UI).
  const totalAdic = adic.reduce((s, a) => s + (a.valorVentaTotal ?? a.costoTotal ?? a.monto ?? 0), 0);
  const interes = parseFloat(fin.interes) || 0;
  const totalCliente = Math.round((ventaBase + totalAdic) * (1 + interes / 100));
  // Precio fijo en USD si la obra lo tiene cargado (deuda del cliente en dólares).
  const totalClienteUSDpdf = calcTotalClienteUSD(detalle, ventaBase, totalAdic, interes, tc);

  const cuotaRows = incluirPagos && cuotas.length > 0 ? cuotas.map((c, i) => {
    const m = cuotaMonto(c); // already USD
    const estadoC = cuotaEstadoDesdeCobrado(c, _repartoPdf[c.id], moneda || 'ARS', tc);
    const pagadaC = estadoC === 'pagado';
    return `<tr${i % 2 === 1 ? ' class="alt"' : ''}><td>${c.n || i+1}</td><td>${c.descripcion}</td><td class="r">${fmtDE(c.fecha)}</td><td class="r">${fmtUSD(m)}</td><td><span class="pill ${pagadaC ? 'ok' : 'warn'}">${estadoC}</span></td></tr>`;
  }).join('') : '';
  const pagado = Math.round(cobradoUSD);
  const saldo = totalClienteUSDpdf - pagado;

  const logoHtml = logoLight
    ? `<img src="${logoLight}" style="height:26px;object-fit:contain;display:block" />`
    : `<span style="font-weight:900;font-size:18px;letter-spacing:2px;color:#fff">KAMAK</span>`;

  const STRIPES = `<svg viewBox="0 0 620 620" width="620" height="620" style="display:block"><rect x="-64" y="245" width="900" height="50" fill="#1a9b9c" transform="rotate(62 386 270)"/><rect x="-140" y="285" width="900" height="50" fill="#1a9b9c" transform="rotate(62 310 310)"/><rect x="-216" y="325" width="900" height="50" fill="#1a9b9c" transform="rotate(62 234 350)"/></svg>`;

  const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&family=JetBrains+Mono:wght@400;700&display=swap');
@page{size:A4;margin:0}
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
body{font-family:'Montserrat',sans-serif;font-size:11px;color:#1f2024;background:#fff}
.kmk-hdr{background:#1f2024;padding:14px 18mm;display:flex;align-items:center;justify-content:space-between;position:relative;overflow:hidden}
.kmk-wm{position:absolute;top:-160px;right:-160px;opacity:.07;pointer-events:none}
.kmk-hdr-left{display:flex;align-items:center;gap:12px;position:relative;z-index:1}
.kmk-hdr-sep{color:rgba(255,255,255,0.25);font-size:20px;line-height:1}
.kmk-hdr-label{color:#fff;font-weight:800;font-size:11px;letter-spacing:1px}
.kmk-hdr-sub{color:#1a9b9c;font-size:7.5px;font-family:'JetBrains Mono',monospace;letter-spacing:.8px;margin-top:2px}
.kmk-hdr-right{text-align:right;font-family:'JetBrains Mono',monospace;font-size:7.5px;color:#9a9892;line-height:1.7;position:relative;z-index:1}
.kmk-rule{height:4px;background:#1a9b9c;position:relative;margin-bottom:0}
.kmk-diamond{position:absolute;left:50%;top:-6px;margin-left:-6px;width:12px;height:12px;background:#1a9b9c;transform:rotate(45deg)}
.kmk-content{padding:16px 18mm 20mm}
.tc-ref{font-size:8px;color:#9a9892;font-family:'JetBrains Mono',monospace;margin-bottom:14px;text-align:right}
.title{font-weight:900;font-size:16px;letter-spacing:1px;color:#1a9b9c;margin-bottom:2px}
.obra-info{font-size:10px;color:#5a5a58;margin-bottom:16px}
table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:14px}
th{background:#1f2024;color:#fff;padding:5px 8px;text-align:left;font-size:8.5px;letter-spacing:.8px;font-family:'JetBrains Mono',monospace;font-weight:700}
th.r{text-align:right}
td{padding:5px 8px;border-bottom:1px solid #e8e4d8}
td.r{text-align:right;font-family:'JetBrains Mono',monospace}
td.b{font-weight:700}
tr.alt td{background:#f9f7f2}
tr.rubro td{background:#1a9b9c18;font-weight:800;font-size:10.5px;color:#1a9b9c}
tr.subtot td{background:#d6efef;font-weight:800}
tr.total td{background:#1f2024;color:#fff;font-weight:900;font-family:'JetBrains Mono',monospace;font-size:12px}
.pill{display:inline-block;padding:1px 7px;border-radius:8px;font-size:8px;font-weight:700;font-family:'JetBrains Mono',monospace}
.ok{background:#d1fae5;color:#065f46}
.warn{background:#fef3c7;color:#92400e}
.ftr{margin-top:20px;padding-top:8px;border-top:1px solid #e8e4d8;display:flex;justify-content:space-between;font-size:8px;color:#9a9892;font-family:'JetBrains Mono',monospace}
.rsm-pg{width:210mm;min-height:297mm;background:#1f2024;color:#fff;display:flex;flex-direction:column;position:relative;overflow:hidden}
.rsm-pg-after{page-break-after:always;break-after:page}
.rsm-pg-before{page-break-before:always;break-before:page}
.rsm-pg-hdr{height:70px;padding:16px 44px;display:flex;align-items:center;justify-content:space-between;position:relative;z-index:1}
.rsm-teal{height:6px;background:#1a9b9c;position:relative;z-index:1}
.rsm-dc{position:absolute;left:50%;top:-10px;margin-left:-10px;width:20px;height:20px;background:#1a9b9c;transform:rotate(45deg);box-shadow:0 0 0 3px #1f2024}
.rsm-hero{flex:1;padding:50px 56px 30px;display:flex;flex-direction:column;align-items:center;position:relative;z-index:1}
.rsm-eyebrow{font-size:10px;letter-spacing:8px;color:#1a9b9c;font-weight:600}
.rsm-frame{margin-top:22px;width:82%;position:relative;padding:30px 26px}
.rsm-frame-lbl{position:absolute;top:-2px;left:50%;transform:translateX(-50%);font-size:9px;color:#1a9b9c;letter-spacing:4px;font-family:'JetBrains Mono',monospace;font-weight:700;background:#1f2024;padding:0 12px;white-space:nowrap;z-index:2}
.rsm-proj{font-weight:900;letter-spacing:2px;font-size:28px;text-align:center;line-height:1.15;color:#fff;text-shadow:0 2px 12px rgba(26,155,156,.25)}
.rsm-sub-r{margin-top:22px;width:65%;display:flex;align-items:center;gap:14px}
.rsm-hl{flex:1;height:1px;background:#3a3a3e}
.rsm-sub-lbl{font-weight:700;font-size:11px;letter-spacing:5px;color:#9a9892;white-space:nowrap}
.rsm-bot{background:#171818;padding:18px 44px 20px;display:grid;grid-template-columns:1fr 1fr;gap:18px 28px;position:relative;z-index:1}
.rsm-cl{font-size:10px;color:#1a9b9c;letter-spacing:2px;font-family:'JetBrains Mono',monospace}
.rsm-cv{font-size:15px;font-weight:700;margin-top:5px;color:#fff;line-height:1.2}
.rsm-cv-lg{font-size:22px;font-weight:800;margin-top:3px;color:#fff;line-height:1.1}
.rsm-cv-sub{font-size:11px;color:#9a9892;margin-top:3px}
.rsm-body{background:#fff}
@media screen{html{background:#555}body{padding:16px 0;margin:0 auto}.rsm-pg,.rsm-body{width:794px;margin:0 auto 16px;box-shadow:0 4px 24px rgba(0,0,0,.4)}}`;

  const CORNERS = `
    <div style="position:absolute;top:0;left:0;width:28px;height:28px;border-top:2px solid #1a9b9c;border-left:2px solid #1a9b9c;"></div>
    <div style="position:absolute;top:0;right:0;width:28px;height:28px;border-top:2px solid #1a9b9c;border-right:2px solid #1a9b9c;"></div>
    <div style="position:absolute;bottom:0;left:0;width:28px;height:28px;border-bottom:2px solid #1a9b9c;border-left:2px solid #1a9b9c;"></div>
    <div style="position:absolute;bottom:0;right:0;width:28px;height:28px;border-bottom:2px solid #1a9b9c;border-right:2px solid #1a9b9c;"></div>`;

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Resumen — ${obra?.nombre || ''}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>

<div class="rsm-pg rsm-pg-after">
  <div class="kmk-wm">${STRIPES}</div>
  <div class="rsm-pg-hdr">
    ${logoHtml}
    <div style="font-size:8.5px;color:#aaa;text-align:right;font-family:'JetBrains Mono',monospace;line-height:1.6">7630 NECOCHEA<br>BUENOS AIRES · ARGENTINA<br>KAMAKDESARROLLOS@GMAIL.COM</div>
  </div>
  <div class="rsm-teal"><div class="rsm-dc"></div></div>
  <div class="rsm-hero">
    <div class="rsm-eyebrow">RESUMEN TOTAL DE OBRA</div>
    <div class="rsm-frame">
      <div class="rsm-frame-lbl">◆ NOMBRE DE LA OBRA ◆</div>
      ${CORNERS}
      <div class="rsm-proj">${(obra?.nombre || 'OBRA').toUpperCase()}</div>
    </div>
    <div class="rsm-sub-r">
      <div class="rsm-hl"></div>
      <div class="rsm-sub-lbl">RESUMEN TOTAL</div>
      <div class="rsm-hl"></div>
    </div>
    <div style="margin-top:8px;font-size:9.5px;color:#9a9892;font-family:'JetBrains Mono',monospace;letter-spacing:2px">RES-${new Date().getFullYear()} &nbsp;·&nbsp; ${fechaE()}</div>
  </div>
  <div class="rsm-bot">
    <div><div class="rsm-cl">CLIENTE</div><div class="rsm-cv">${obra?.cliente || '—'}</div></div>
    <div><div class="rsm-cl">TIPO DE OBRA</div><div class="rsm-cv">${obra?.tipo || '—'}</div></div>
    <div><div class="rsm-cl">FECHA DE EMISIÓN</div><div class="rsm-cv">${fechaE()}</div></div>
    <div><div class="rsm-cl">TOTAL (U$S + IVA)</div><div class="rsm-cv-lg">U$S ${fmtNE(totalClienteUSDpdf)}</div><div class="rsm-cv-sub">TC BNA $${fmtNE(tc)}</div></div>
  </div>
</div>

<div class="rsm-body">
<div class="kmk-hdr">
  <div class="kmk-wm">${STRIPES}</div>
  <div class="kmk-hdr-left">
    ${logoHtml}
    <div class="kmk-hdr-sep">|</div>
    <div>
      <div class="kmk-hdr-label">RESUMEN TOTAL DE OBRA</div>
      <div class="kmk-hdr-sub">KAMAKDESARROLLOS@GMAIL.COM · NECOCHEA, BUENOS AIRES</div>
    </div>
  </div>
  <div class="kmk-hdr-right">${(obra?.nombre || '').toUpperCase()}<br>${obra?.cliente ? obra.cliente + (obra?.tipo ? ' · ' + obra.tipo : '') : (obra?.tipo || '')}<br>${fechaE()}</div>
</div>
<div class="kmk-rule"><div class="kmk-diamond"></div></div>
<div class="kmk-content">

<div class="tc-ref">TC BNA $${fmtNE(tc)} · Todos los precios en dólares estadounidenses (U$S)</div>

<table>
  <thead><tr><th>Tarea / Descripción</th><th class="r">Cant</th><th class="r">Un</th><th class="r">Subtotal</th></tr></thead>
  <tbody>
    ${rubros.length > 0 ? `<tr class="rubro"><td colspan="4">▸ PRESUPUESTO BASE</td></tr>${rubroRows}
    <tr class="subtot"><td colspan="3">SUBTOTAL PRESUPUESTO BASE</td><td class="r">${toUSD(ventaBase)}</td></tr>` : ''}
    ${adic.length > 0 ? `<tr class="rubro"><td colspan="4">▸ ADICIONALES APROBADOS</td></tr>${adicRows}
    <tr class="subtot"><td colspan="3">SUBTOTAL ADICIONALES</td><td class="r" style="color:#1a9b9c">${toUSD(totalAdic)}</td></tr>` : ''}
    ${interes > 0 ? `<tr><td colspan="3" style="font-style:italic;color:#9a9892">Interés financiero (${interes}%)</td><td class="r">${toUSD(Math.round((ventaBase + totalAdic) * interes / 100))}</td></tr>` : ''}
    <tr class="total"><td colspan="3">TOTAL CLIENTE</td><td class="r" style="font-size:14px">U$S ${fmtNE(totalClienteUSDpdf)}</td></tr>
  </tbody>
</table>

${incluirPagos && cuotas.length > 0 ? `
<div class="title" style="font-size:13px;margin-top:10px;margin-bottom:10px">PLAN DE PAGOS</div>
<table>
  <thead><tr><th>#</th><th>Cuota</th><th class="r">Fecha</th><th class="r">Monto (U$S)</th><th>Estado</th></tr></thead>
  <tbody>${cuotaRows}</tbody>
  <tfoot>
    <tr class="subtot"><td colspan="3">Pagado</td><td class="r">${fmtUSD(pagado)}</td><td></td></tr>
    <tr class="total"><td colspan="3">Saldo pendiente</td><td class="r">${fmtUSD(Math.max(0, saldo))}</td><td></td></tr>
  </tfoot>
</table>` : ''}

${fin.notaPortal ? `<div style="margin-top:12px;padding:8px 12px;background:#f9f7f2;border-left:3px solid #1a9b9c;font-size:10px;color:#5a5a58">📋 ${fin.notaPortal}</div>` : ''}
<div class="ftr"><span>KAMAK DESARROLLOS</span><span>NO INCLUYE IVA</span><span>${fechaE()}</span></div>
</div>
</div>

<div class="rsm-pg rsm-pg-before">
  <div class="kmk-wm">${STRIPES}</div>
  <div class="rsm-pg-hdr">
    ${logoHtml}
    <div style="font-size:7.5px;color:#9a9892;text-align:right;font-family:'JetBrains Mono',monospace;line-height:1.7">${(obra?.nombre || '').toUpperCase()}<br>${obra?.cliente || ''}<br>${fechaE()}</div>
  </div>
  <div class="rsm-teal"><div class="rsm-dc"></div></div>
  <div style="flex:1;padding:40px 56px;display:flex;flex-direction:column;position:relative;z-index:1">
    <div style="font-weight:900;font-size:20px;letter-spacing:5px;color:#fff;margin-bottom:8px">CONFORMIDAD</div>
    <div style="height:1px;background:#1a9b9c;margin-bottom:20px"></div>
    <div style="font-size:11px;color:#9a9892;line-height:1.9;max-width:430px">
      El presente resumen es emitido por <b style="color:#fff">Kamak Desarrollos</b> con carácter informativo.<br>
      Los valores en U$S están calculados al TC BNA $${fmtNE(tc)} vigente a la fecha de emisión.<br>
      No incluye IVA. Los montos pueden variar según adicionales o ajustes aprobados.
    </div>
    <div style="margin-top:auto;display:grid;grid-template-columns:1fr 1fr;gap:44px;padding-top:60px">
      <div>
        <div style="height:80px"></div>
        <div style="height:1px;background:#1a9b9c;margin-bottom:8px"></div>
        <div style="font-size:8.5px;color:#9a9892;letter-spacing:2px;font-family:'JetBrains Mono',monospace">FIRMA Y SELLO · EMPRESA</div>
        <div style="font-size:13px;font-weight:700;margin-top:5px;color:#fff">KAMAK DESARROLLOS</div>
        <div style="font-size:9px;color:#9a9892;margin-top:2px">NECOCHEA, BUENOS AIRES</div>
      </div>
      <div>
        <div style="height:80px"></div>
        <div style="height:1px;background:#1a9b9c;margin-bottom:8px"></div>
        <div style="font-size:8.5px;color:#9a9892;letter-spacing:2px;font-family:'JetBrains Mono',monospace">CONFORMIDAD DEL CLIENTE</div>
        <div style="font-size:13px;font-weight:700;margin-top:5px;color:#fff">${esc(obra?.cliente || '___________________________')}</div>
        <div style="font-size:9px;color:#9a9892;margin-top:2px">FECHA: ___________________</div>
      </div>
    </div>
  </div>
  <div style="padding:10px 44px;background:#171818;display:flex;justify-content:space-between;font-size:8px;color:#9a9892;font-family:'JetBrains Mono',monospace;letter-spacing:1.2px;position:relative;z-index:1">
    <span>7630 NECOCHEA · BUENOS AIRES · ARGENTINA</span>
    <span>KAMAKDESARROLLOS@GMAIL.COM</span>
    <span>${fechaE()}</span>
  </div>
</div>

</body></html>`;
}

function abrirExport(html, titulo) {
  const w = abrirHTML(html, { width: 794, height: 1000 });
  if (w) setTimeout(() => { w.focus(); w.print(); }, 800);
}

// ─────────────────────────────────────────────────────────────────────────────
function TabAdicionales({ detalle, patch, moneda, obra }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const defaultForm = {
    descripcion: '', tarea: '', cantidad: '', unidad: '',
    costoUnit: '', costoTotal: '',
    valorVentaUnit: '', valorVentaTotal: '',
    montoProveedor: '',
    cantidadProveedor: '', costoUnitProveedor: '',
    aplicaACliente: true, aplicaAProveedor: false,
    fecha: new Date().toISOString().split('T')[0], estado: 'pendiente',
  };
  const [form, setForm] = useState(defaultForm);

  const autoCalc = (f, field, val) => {
    const updated = { ...f, [field]: val };
    const cant = parseFloat(updated.cantidad) || 0;
    if (cant > 0) {
      if ((field === 'costoUnit' || field === 'cantidad') && updated.costoUnit && !updated.costoTotal)
        updated.costoTotal = String(Math.round(cant * (parseFloat(updated.costoUnit) || 0)));
      if ((field === 'valorVentaUnit' || field === 'cantidad') && updated.valorVentaUnit && !updated.valorVentaTotal)
        updated.valorVentaTotal = String(Math.round(cant * (parseFloat(updated.valorVentaUnit) || 0)));
    }
    return updated;
  };
  const set = (field) => (val) => setForm(p => autoCalc(p, field, val));

  const save = () => {
    if (!form.descripcion.trim()) return;
    const costoTot  = parseFloat(form.costoTotal)  || (parseFloat(form.cantidad || 0) * parseFloat(form.costoUnit || 0)) || null;
    const ventaTot  = parseFloat(form.valorVentaTotal) || (parseFloat(form.cantidad || 0) * parseFloat(form.valorVentaUnit || 0)) || null;
    const entry = {
      id:              editingId || newId(),
      descripcion:     form.descripcion,
      tarea:           form.tarea || '',
      cantidad:        parseFloat(form.cantidad) || null,
      unidad:          form.unidad || '',
      costoUnit:       parseFloat(form.costoUnit) || null,
      costoTotal:      costoTot,
      valorVentaUnit:  parseFloat(form.valorVentaUnit) || null,
      valorVentaTotal: ventaTot,
      montoProveedor:    form.montoProveedor !== '' ? parseFloat(form.montoProveedor) : null,
      cantidadProveedor: parseFloat(form.cantidadProveedor) || null,
      costoUnitProveedor: parseFloat(form.costoUnitProveedor) || null,
      aplicaACliente:    form.aplicaACliente !== false,
      aplicaAProveedor:  !!form.aplicaAProveedor,
      monto:             ventaTot ?? costoTot ?? 0,
      fecha:             form.fecha,
      estado:            form.estado || 'pendiente',
    };
    if (editingId) {
      patch(d => ({ ...d, adicionales: d.adicionales.map(a => a.id === editingId ? entry : a) }));
    } else {
      patch(d => ({ ...d, adicionales: [...d.adicionales, entry] }));
    }
    setAdding(false);
    setEditingId(null);
    setForm(defaultForm);
  };

  const startEdit = (a) => {
    setForm({
      descripcion: a.descripcion || '', tarea: a.tarea || '',
      cantidad: a.cantidad ?? '', unidad: a.unidad || '',
      costoUnit: a.costoUnit ?? '', costoTotal: a.costoTotal ?? '',
      valorVentaUnit: a.valorVentaUnit ?? '', valorVentaTotal: a.valorVentaTotal ?? '',
      montoProveedor: a.montoProveedor ?? '',
      cantidadProveedor: a.cantidadProveedor ?? '', costoUnitProveedor: a.costoUnitProveedor ?? '',
      aplicaACliente: a.aplicaACliente !== false, aplicaAProveedor: !!a.aplicaAProveedor,
      fecha: a.fecha || new Date().toISOString().split('T')[0], estado: a.estado || 'pendiente',
    });
    setEditingId(a.id);
    setAdding(true);
  };

  const setEstado = (id, estado) => patch(d => ({ ...d, adicionales: d.adicionales.map(a => a.id === id ? { ...a, estado } : a) }));
  const del = (id) => patch(d => ({ ...d, adicionales: d.adicionales.filter(a => a.id !== id) }));

  const aplicarAContrato = (a) => {
    const tareaKey = (a.tarea || '').toLowerCase();
    patch(d => {
      const contratos = d.contratos || [];
      const cIdx = contratos.findIndex(c =>
        (c.tareas || []).some(t => t.nombre?.toLowerCase().includes(tareaKey) || tareaKey.includes(t.nombre?.toLowerCase() || ''))
      );
      if (cIdx < 0) { alert('No se encontró un contrato MO con la tarea "' + a.tarea + '".\nCreá primero el contrato MO para ese rubro.'); return d; }
      const cantProv = a.cantidadProveedor || a.cantidad || 1;
      const precioProv = a.costoUnitProveedor || a.costoUnit || 0;
      const extraTarea = { tareaId: newId(), nombre: `Adicional: ${a.descripcion}`, unidad: a.unidad || '', cantidadTotal: cantProv, cantidadContratada: cantProv, precioUnit: precioProv };
      const montoExtra = cantProv * precioProv;
      const updatedContratos = contratos.map((c, i) => i !== cIdx ? c : { ...c, tareas: [...(c.tareas || []), extraTarea], monto: (c.monto || 0) + montoExtra });
      const updatedAdicionales = d.adicionales.map(x => x.id === a.id ? { ...x, aplicadoAContrato: true } : x);
      return { ...d, contratos: updatedContratos, adicionales: updatedAdicionales };
    });
  };

  const aprobados   = detalle.adicionales.filter(a => a.estado === 'aprobado');
  const totalCosto  = aprobados.reduce((s, a) => s + (a.costoTotal ?? a.monto ?? 0), 0);
  const totalVenta  = aprobados.reduce((s, a) => s + (a.valorVentaTotal ?? a.monto ?? 0), 0);
  const totalProv   = aprobados.filter(a => a.montoProveedor != null).reduce((s, a) => s + (a.montoProveedor || 0), 0);

  const colH = { fontSize: 10, fontWeight: 700, color: T.ink3, padding: '5px 8px', textAlign: 'right', borderBottom: `1px solid ${T.faint2}`, whiteSpace: 'nowrap', background: T.faint };
  const colD = { fontSize: 11, padding: '9px 8px', textAlign: 'right', fontFamily: T.fontMono };

  // Grupos de encabezado
  const thSpan = (label, cols, align = 'center', accent = false) => (
    <th colSpan={cols} style={{ fontSize: 9, fontWeight: 700, color: accent ? T.accent : T.ink3, padding: '4px 8px', textAlign: align, borderBottom: `1px solid ${T.faint2}`, background: T.faint, letterSpacing: 0.8, textTransform: 'uppercase' }}>
      {label}
    </th>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: T.ink2, display: 'flex', gap: 16 }}>
          <span>{detalle.adicionales.length} adicionales</span>
          {totalCosto > 0 && <span>Costo aprobado: <b>{fmtM(totalCosto, moneda)}</b></span>}
          {totalVenta > 0 && <span style={{ color: T.ok }}>Venta aprobada: <b>{fmtM(totalVenta, moneda)}</b></span>}
          {totalProv  > 0 && <span style={{ color: T.ink3 }}>Prov: <b>{fmtM(totalProv, moneda)}</b></span>}
        </div>
        <Btn sm onClick={() => abrirExport(generarHTMLAdicionales({ obra, detalle, moneda }), 'Adicionales')}>↗ Exportar</Btn>
        <Btn sm fill onClick={() => { setAdding(true); setEditingId(null); setForm(defaultForm); }}>+ Adicional</Btn>
      </div>

      {adding && (
        <FormPanel title={editingId ? 'Editar adicional' : 'Nuevo adicional'} onSave={save} onCancel={() => { setAdding(false); setEditingId(null); setForm(defaultForm); }} style={{ marginBottom: 14 }}>
          <FInput label="Descripción" value={form.descripcion} onChange={v => setForm(p => ({ ...p, descripcion: v }))} placeholder="Ej: Ampliación tablero secundario" />
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10 }}>
            <FInput label="Tarea" value={form.tarea} onChange={v => setForm(p => ({ ...p, tarea: v }))} placeholder="Ej: Pintura interior látex" />
            <FInput label="Cantidad" value={form.cantidad} onChange={set('cantidad')} type="number" />
            <FInput label="Unidad" value={form.unidad} onChange={v => setForm(p => ({ ...p, unidad: v }))} placeholder="m², u..." />
            <FInput label="Fecha" value={form.fecha} onChange={v => setForm(p => ({ ...p, fecha: v }))} type="date" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginTop: 4 }}>
            <FInput label="Costo / unidad" value={form.costoUnit} onChange={set('costoUnit')} type="number" />
            <FInput label="Costo total" value={form.costoTotal} onChange={set('costoTotal')} type="number" />
            <FInput label="Venta / unidad (cliente)" value={form.valorVentaUnit} onChange={set('valorVentaUnit')} type="number" />
            <FInput label="Venta total (cliente)" value={form.valorVentaTotal} onChange={set('valorVentaTotal')} type="number" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto auto', gap: 10, marginTop: 8, alignItems: 'end' }}>
            <FInput label="Cant. proveedor MO" value={form.cantidadProveedor} onChange={v => setForm(p => ({ ...p, cantidadProveedor: v }))} type="number" placeholder="Si difiere de cant. cliente" />
            <FInput label="Costo/u proveedor MO" value={form.costoUnitProveedor} onChange={v => setForm(p => ({ ...p, costoUnitProveedor: v }))} type="number" />
            <FInput label="Monto prov. total" value={form.montoProveedor} onChange={v => setForm(p => ({ ...p, montoProveedor: v }))} type="number" placeholder="Opcional" />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.ink2, cursor: 'pointer', paddingBottom: 6 }}>
              <input type="checkbox" checked={!!form.aplicaAProveedor} onChange={e => setForm(p => ({ ...p, aplicaAProveedor: e.target.checked }))} />
              Aplica a proveedor MO
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.ink2, cursor: 'pointer', paddingBottom: 6 }}>
              <input type="checkbox" checked={form.aplicaACliente !== false} onChange={e => setForm(p => ({ ...p, aplicaACliente: e.target.checked }))} />
              Aplica a cliente
            </label>
          </div>
        </FormPanel>
      )}

      {detalle.adicionales.length === 0 ? (
        <div style={{ color: T.ink3, padding: 24, textAlign: 'center' }}>Sin adicionales registrados</div>
      ) : (
        <Box style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 820 }}>
            <thead>
              <tr>
                {thSpan('', 1, 'left')}
                {thSpan('Cantidad', 2, 'center')}
                {thSpan('Costo', 2, 'center')}
                {thSpan('Venta (cliente)', 2, 'center', true)}
                {thSpan('Proveedor', 1, 'center')}
                {thSpan('', 2, 'center')}
              </tr>
              <tr>
                <th style={{ ...colH, textAlign: 'left', minWidth: 180 }}>Descripción / Tarea</th>
                <th style={colH}>Cant.</th>
                <th style={colH}>Unidad</th>
                <th style={colH}>$/u</th>
                <th style={colH}>Total costo</th>
                <th style={{ ...colH, color: T.accent }}>$/u</th>
                <th style={{ ...colH, color: T.accent }}>Total venta</th>
                <th style={colH}>Monto prov.</th>
                <th style={{ ...colH, textAlign: 'center' }}>Estado</th>
                <th style={colH}></th>
              </tr>
            </thead>
            <tbody>
              {detalle.adicionales.map((a, i) => (
                <tr key={a.id} style={{ borderBottom: i < detalle.adicionales.length - 1 ? `1px solid ${T.faint2}` : 'none' }}>
                  <td style={{ ...colD, textAlign: 'left', maxWidth: 200 }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.descripcion}</div>
                    {a.tarea && a.tarea !== a.descripcion && <div style={{ fontSize: 10, color: T.ink3 }}>{a.tarea}</div>}
                    <div style={{ fontSize: 10, color: T.ink3 }}>{fmtD(a.fecha)}</div>
                  </td>
                  <td style={colD}>{a.cantidad != null ? fmtU(a.cantidad) : '—'}</td>
                  <td style={colD}>{a.unidad || '—'}</td>
                  <td style={colD}>{a.costoUnit != null ? fmtM(a.costoUnit, moneda) : '—'}</td>
                  <td style={{ ...colD, fontWeight: 600 }}>{a.costoTotal != null ? fmtM(a.costoTotal, moneda) : (a.monto ? fmtM(a.monto, moneda) : '—')}</td>
                  <td style={{ ...colD, color: T.accent }}>{a.valorVentaUnit != null ? fmtM(a.valorVentaUnit, moneda) : '—'}</td>
                  <td style={{ ...colD, fontWeight: 700, color: T.accent }}>{a.valorVentaTotal != null ? fmtM(a.valorVentaTotal, moneda) : '—'}</td>
                  <td style={{ ...colD, color: T.ink2 }}>
                    {a.montoProveedor != null ? fmtM(a.montoProveedor, moneda) : '—'}
                    {a.cantidadProveedor != null && a.cantidadProveedor !== a.cantidad && (
                      <div style={{ fontSize: 9, color: T.ink3 }}>{fmtQ(a.cantidadProveedor)} {a.unidad}</div>
                    )}
                  </td>
                  <td style={{ ...colD, textAlign: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                      <Chip ok={a.estado === 'aprobado'} warn={a.estado === 'pendiente'} accent={a.estado === 'rechazado'} style={{ fontSize: 10 }}>{a.estado}</Chip>
                      <div style={{ display: 'flex', gap: 3 }}>
                        {a.aplicaACliente !== false && <span title="Aplica a cliente" style={{ fontSize: 9, color: T.accent, background: T.faint, padding: '1px 4px', borderRadius: 3 }}>💰 cliente</span>}
                        {a.aplicaAProveedor && <span title="Aplica a proveedor MO" style={{ fontSize: 9, color: T.ink2, background: T.faint, padding: '1px 4px', borderRadius: 3 }}>{a.aplicadoAContrato ? '✓ contrato' : '🔧 prov'}</span>}
                      </div>
                    </div>
                  </td>
                  <td style={{ ...colD, textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      {a.estado === 'pendiente' && <>
                        <Btn sm onClick={() => setEstado(a.id, 'aprobado')}>✓</Btn>
                        <Btn sm style={{ color: T.accent, borderColor: T.accent }} onClick={() => setEstado(a.id, 'rechazado')}>✕</Btn>
                      </>}
                      {a.estado === 'aprobado' && a.aplicaAProveedor && !a.aplicadoAContrato && (
                        <Btn sm onClick={() => aplicarAContrato(a)} style={{ fontSize: 9 }}>→ MO</Btn>
                      )}
                      <Btn sm onClick={() => startEdit(a)}>✎</Btn>
                      <span style={{ color: T.accent, cursor: 'pointer', fontSize: 11, padding: '2px 4px' }} onClick={() => del(a.id)}>🗑</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 10: FINANCIACIÓN
// ─────────────────────────────────────────────────────────────────────────────
function TabFinanciacion({ obra, detalle, patch, moneda, onExport }) {
  const fin = detalle.financiacion || {};
  const { dolarVenta } = useDolar();
  const enviada    = !!fin.propuestaEnviada;
  const confirmada = !!fin.propuestaConfirmada;
  const locked     = enviada || confirmada;

  const [editingFin, setEditingFin] = useState(false);
  const [finForm, setFinForm] = useState({ interes: String(fin.interes || 0), notaPortal: fin.notaPortal || '' });
  const [addingCuota, setAddingCuota] = useState(false);
  const [cuotaForm, setCuotaForm] = useState({ descripcion: '', monto: '', fecha: '', n: '' });
  const [editCuotaId, setEditCuotaId] = useState(null);
  const [genAuto, setGenAuto] = useState(false);
  // anticipoPct: porcentaje del total cliente (0-100). El monto se calcula
  // automaticamente al generar las cuotas. Antes era monto absoluto en USD,
  // pero pensar en % es mas natural para el user (ej. "30% de adelanto").
  const [genForm, setGenForm] = useState({ n: '6', primerFecha: '', intervalo: '1-meses', anticipoPct: '', anticipoFecha: '' });

  const { venta: ventaBase } = calcObra(detalle.rubros);
  // FILTRO importante: solo adicionales aprobados Y que apliquen al cliente.
  // Antes este lugar no filtraba aplicaACliente y sobreestimaba el total.
  const adicionalCliente = (detalle.adicionales || [])
    .filter(a => a.estado === 'aprobado' && a.aplicaACliente !== false)
    .reduce((s, a) => s + (a.valorVentaTotal ?? a.costoTotal ?? a.monto ?? 0), 0);
  const interes = parseFloat(fin.interes) || 0;
  const baseTotal = ventaBase + adicionalCliente;
  const tc = dolarVenta || 1070;
  // Cobrado/estado de cuota DERIVADO de los movimientos (libro único).
  const { movimientos: _movsFin, cajas: _cajasFin } = useMovimientos();
  const { cuotaEstadoCalc } = buildCuotaDerivados(detalle.cuotas || [], _movsFin, _cajasFin, obra.id, obra?.moneda || 'ARS', tc);

  // Input de interes — controlled con state local. interesLive es el valor
  // que se está mostrando en el input AHORA (no el del detalle): el "Total
  // cliente" se recalcula en vivo mientras tipeas, sin esperar al blur.
  // Al blur, handleInteresChange persiste el valor al detalle.
  const [interesEdit, setInteresEdit] = useState(String(interes));
  useEffect(() => { setInteresEdit(String(interes)); }, [interes]);
  const handleInteresChange = (val) => {
    const num = parseFloat(val);
    if (isNaN(num)) return;
    patch(d => ({ ...d, financiacion: { ...(d.financiacion || {}), interes: num } }));
  };
  const interesLive = interesEdit === '' ? 0 : (parseFloat(interesEdit) || 0);
  // Total cliente se calcula con interesLive (live preview del input).
  const totalConInteres = Math.round(baseTotal * (1 + interesLive / 100));
  // Precio fijo en USD si está cargado (la deuda del cliente es en dólares y no
  // se mueve con el tc); sino, el cálculo viejo (presupuesto en pesos ÷ tc).
  const totalUSD = calcTotalClienteUSD(detalle, baseTotal, 0, interesLive, tc);
  const fmtUSD = n => `U$S ${fmtN(n)}`;
  // cuotas antiguas en obras moneda:USD tenían monto en ARS; _usd:true marca las nuevas
  const cuotaMonto = c => (c._usd || moneda !== 'USD') ? c.monto : Math.round(c.monto / tc);

  const cuotas = detalle.cuotas || [];
  const totalCuotas = cuotas.reduce((s, c) => s + cuotaMonto(c), 0);
  const cuotasPagadas = cuotas.filter(c => cuotaEstadoCalc(c, moneda, tc) === 'pagado').reduce((s, c) => s + cuotaMonto(c), 0);
  const saldoCuotas = totalCuotas - cuotasPagadas;
  const diferencia = totalUSD - totalCuotas;

  const saveFin = () => {
    patch(d => ({ ...d, financiacion: { ...(d.financiacion || {}), interes: parseFloat(finForm.interes) || 0, notaPortal: finForm.notaPortal } }));
    setEditingFin(false);
  };

  const saveCuota = () => {
    const n = parseInt(cuotaForm.n) || cuotas.length + 1;
    const entry = { id: editCuotaId || newId(), n, descripcion: cuotaForm.descripcion || `Cuota ${n}`, monto: parseFloat(cuotaForm.monto) || 0, fecha: cuotaForm.fecha || '', estado: 'pendiente', _usd: true };
    if (editCuotaId) {
      patch(d => ({ ...d, cuotas: d.cuotas.map(c => c.id === editCuotaId ? { ...c, ...entry } : c) }));
    } else {
      patch(d => ({ ...d, cuotas: [...(d.cuotas || []), entry] }));
    }
    setAddingCuota(false); setEditCuotaId(null); setCuotaForm({ descripcion: '', monto: '', fecha: '', n: '' });
  };

  const startEditCuota = (c) => {
    setCuotaForm({ descripcion: c.descripcion || '', monto: String(c.monto || ''), fecha: c.fecha || '', n: String(c.n || '') });
    setEditCuotaId(c.id); setAddingCuota(true);
  };

  const togglePago = (id) => patch(d => ({ ...d, cuotas: d.cuotas.map(c => c.id === id ? { ...c, estado: c.estado === 'pagado' ? 'pendiente' : 'pagado' } : c) }));
  const delCuota = (id) => patch(d => ({ ...d, cuotas: d.cuotas.filter(c => c.id !== id) }));

  const agregarFecha = (base, i, intervalo) => {
    const d = new Date(base);
    const [c, unit] = intervalo.split('-');
    const n = parseInt(c) || 1;
    if (unit === 'dias') d.setDate(d.getDate() + i * n);
    else if (unit === 'semanas') d.setDate(d.getDate() + i * n * 7);
    else d.setMonth(d.getMonth() + i * n);
    return d.toISOString().split('T')[0];
  };

  const generarAutomatico = () => {
    const num = parseInt(genForm.n) || 1;
    if (!num) return;
    // Adelanto en % → monto: si pct=30 y totalUSD=10000 → adelanto=3000.
    const pct = parseFloat(genForm.anticipoPct) || 0;
    const anticipoMonto = pct > 0 ? Math.round(totalUSD * pct / 100) : 0;
    const saldo = totalUSD - anticipoMonto;
    const nuevas = [];
    if (anticipoMonto > 0) {
      nuevas.push({ id: newId(), n: 1, descripcion: `Adelanto de obra (${pct}%)`, monto: anticipoMonto, fecha: genForm.anticipoFecha || '', estado: 'pendiente', _usd: true });
    }
    const offset = nuevas.length;
    const montoCuota = num > 0 ? Math.round(saldo / num) : 0;
    for (let i = 0; i < num; i++) {
      nuevas.push({
        id: newId(), n: offset + i + 1,
        descripcion: num === 1 ? 'Saldo' : `Cuota ${i + 1} de ${num}`,
        monto: i === num - 1 ? saldo - montoCuota * (num - 1) : montoCuota,
        fecha: genForm.primerFecha ? agregarFecha(genForm.primerFecha, i, genForm.intervalo) : '',
        estado: 'pendiente', _usd: true,
      });
    }
    patch(d => ({ ...d, cuotas: nuevas }));
    setGenAuto(false);
  };

  const enviarPropuesta = () => {
    patch(d => ({ ...d, financiacion: { ...(d.financiacion || {}), propuestaEnviada: true, fechaPropuesta: new Date().toISOString().split('T')[0] } }));
    onExport?.();
  };
  const confirmarPropuesta = () => {
    patch(d => ({ ...d, financiacion: { ...(d.financiacion || {}), propuestaConfirmada: true, fechaConfirmacion: new Date().toISOString().split('T')[0] } }));
  };
  const reabrirNegociacion = () => {
    patch(d => ({ ...d, financiacion: { ...(d.financiacion || {}), propuestaEnviada: false, propuestaConfirmada: false } }));
  };

  const kSt = { fontSize: 9, color: T.ink3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, fontFamily: T.fontMono };
  const vSt = { fontSize: 14, fontWeight: 800, fontFamily: T.fontMono, color: T.ink, marginTop: 2 };

  // (interesEdit / handleInteresChange ya declarados arriba junto a los
  // cálculos de totalConInteres / totalUSD que dependen de interesLive.)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Banner: plan cerrado/aprobado. Bloquea toda edición. */}
      {confirmada && (
        <div style={{ padding: '11px 14px', background: '#f0faf2', borderLeft: `3px solid ${T.ok}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#166534' }}>Plan de pagos cerrado</div>
            <div style={{ fontSize: 11, color: '#15803d', marginTop: 2, opacity: 0.85 }}>
              {fin.fechaConfirmacion ? `Aprobado el ${fmtD(fin.fechaConfirmacion)}` : ''}
              {' · '}Para modificarlo hay que reabrirlo.
            </div>
          </div>
          <Btn sm onClick={reabrirNegociacion}>Editar plan</Btn>
        </div>
      )}

      {/* Bloque unificado: KPIs + interés editable + cuotas. Todo en un solo
          Box para no fragmentar visualmente la info de financiación. */}
      <Box style={{ padding: 0, overflow: 'hidden' }}>
        {/* KPIs strip — fondo blanco para que los numeros (lo MAS importante)
            no compitan con el fondo. Cada KPI separado por divider sutil. */}
        <div style={{
          padding: '14px 16px',
          display: 'grid',
          gridTemplateColumns: `1fr 1fr 1fr ${moneda === 'ARS' ? '1fr ' : ''}1fr 1.3fr`,
          gap: 0,
          alignItems: 'center',
        }}>
          <div style={{ paddingRight: 14 }}>
            <div style={kSt}>Presupuesto venta</div>
            <div style={{ ...vSt, fontSize: 17 }}>{fmtUSD(Math.round(ventaBase / tc))}</div>
          </div>
          <div style={{ paddingLeft: 14, paddingRight: 14, borderLeft: `1px solid ${T.faint2}` }}>
            <div style={kSt}>Adicionales</div>
            <div style={{ ...vSt, fontSize: 17, color: adicionalCliente > 0 ? T.accent : T.ink }}>{fmtUSD(Math.round(adicionalCliente / tc))}</div>
          </div>
          <div style={{ paddingLeft: 14, paddingRight: 14, borderLeft: `1px solid ${T.faint2}` }}>
            <div style={kSt}>Base total</div>
            <div style={{ ...vSt, fontSize: 17 }}>{fmtUSD(Math.round(baseTotal / tc))}</div>
          </div>
          {moneda === 'ARS' && (
            <div style={{ paddingLeft: 14, paddingRight: 14, borderLeft: `1px solid ${T.faint2}` }}>
              <div style={kSt}>TC BNA</div>
              <div style={{ ...vSt, fontSize: 13, color: T.ink2 }}>${fmtN(tc)}</div>
            </div>
          )}
          <div style={{ paddingLeft: 14, paddingRight: 14, borderLeft: `1px solid ${T.faint2}` }}>
            <div style={kSt}>Interés</div>
            {locked ? (
              <div style={{ ...vSt, fontSize: 17, color: interes > 0 ? T.warn : T.ink3 }}>{interes > 0 ? `${interes}%` : '—'}</div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginTop: 2 }}>
                <input
                  type="number"
                  value={interesEdit}
                  onChange={e => setInteresEdit(e.target.value)}
                  onBlur={() => handleInteresChange(interesEdit)}
                  onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                  placeholder="0"
                  style={{
                    width: 56,
                    padding: '2px 6px',
                    border: `1.2px solid ${T.faint2}`,
                    borderRadius: 4,
                    fontFamily: T.fontMono,
                    fontSize: 17,
                    fontWeight: 800,
                    color: interes > 0 ? T.warn : T.ink,
                    background: T.paper,
                    outline: 'none',
                    textAlign: 'right',
                  }}
                />
                <span style={{ fontFamily: T.fontMono, fontSize: 14, fontWeight: 700, color: T.ink2 }}>%</span>
              </div>
            )}
          </div>
          <div style={{ paddingLeft: 14, borderLeft: `3px solid ${T.accent}` }}>
            <div style={kSt}>Total cliente</div>
            <div style={{ ...vSt, color: T.accent, fontSize: 22 }}>{fmtUSD(totalUSD)}</div>
            {!locked && (
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, color: T.ink2, whiteSpace: 'nowrap' }}>Precio fijo U$S</span>
                <input type="number" min="0" placeholder="auto (s/dólar)"
                  value={detalle.precioVentaUSD ?? ''}
                  onChange={e => { const v = e.target.value; patch(d => ({ ...d, precioVentaUSD: v === '' ? null : Number(v) })); }}
                  title="Si lo cargás, la deuda del cliente queda fija en dólares y no se mueve con el tipo de cambio."
                  style={{ width: 120, padding: '3px 6px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.fontMono, fontSize: 12, textAlign: 'right', outline: 'none', background: T.paper }} />
              </div>
            )}
          </div>
        </div>

        {/* Sub-header cuotas — sin fondo gris para no robar protagonismo. */}
        <div style={{ padding: '8px 16px', borderTop: `1px solid ${T.faint2}`, borderBottom: `1px solid ${T.faint2}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 11, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 1, fontWeight: 700, textTransform: 'uppercase' }}>
            Plan de cuotas
            {cuotas.length > 0 && (
              <span style={{ marginLeft: 12, color: T.ink2, letterSpacing: 0, textTransform: 'none', fontWeight: 500, fontSize: 11 }}>
                {fmtUSD(cuotasPagadas)} cobrado · {fmtUSD(saldoCuotas)} saldo
                {Math.abs(diferencia) > 1 && (
                  <span style={{ color: diferencia > 0 ? T.warn : T.ok, marginLeft: 6 }}>
                    {diferencia > 0 ? `· ⚠ faltan U$S ${fmtN(diferencia)}` : `· ✓ U$S ${fmtN(Math.abs(diferencia))} extra`}
                  </span>
                )}
              </span>
            )}
          </div>
          {!locked && (
            <div style={{ display: 'flex', gap: 6 }}>
              <Btn sm onClick={() => { setGenAuto(true); setAddingCuota(false); }}>⚡ Generar automático</Btn>
              <Btn sm fill onClick={() => { setAddingCuota(true); setGenAuto(false); setEditCuotaId(null); setCuotaForm({ descripcion: '', monto: '', fecha: '', n: String(cuotas.length + 1) }); }}>+ Cuota manual</Btn>
            </div>
          )}
        </div>

        {/* Generador automático */}
        {!locked && genAuto && (
          <div style={{ padding: '12px 18px', borderBottom: `1px solid ${T.faint2}`, background: T.faint }}>
            <FormPanel title="Generar cuotas automáticamente" onSave={generarAutomatico} onCancel={() => setGenAuto(false)} saveLabel="Generar">
              {(() => {
                const pct = parseFloat(genForm.anticipoPct) || 0;
                const anticipoMonto = pct > 0 ? Math.round(totalUSD * pct / 100) : 0;
                const saldo = totalUSD - anticipoMonto;
                const cantCuotas = parseInt(genForm.n) || 0;
                const montoCuota = cantCuotas > 0 ? Math.round(saldo / cantCuotas) : 0;
                return (
                  <>
                    <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${T.faint2}` }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>Adelanto de obra (opcional)</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                          <FInput label="Adelanto (%)" value={genForm.anticipoPct} onChange={v => setGenForm(p => ({ ...p, anticipoPct: v }))} type="number" placeholder="Ej: 30" />
                          {pct > 0 && totalUSD > 0 && (
                            <div style={{ fontSize: 10.5, color: T.accent, marginTop: 3, fontFamily: T.fontMono, fontWeight: 700 }}>
                              ≈ {fmtUSD(anticipoMonto)} · queda {fmtUSD(saldo)} en cuotas
                            </div>
                          )}
                        </div>
                        <FInput label="Fecha del adelanto" value={genForm.anticipoFecha} onChange={v => setGenForm(p => ({ ...p, anticipoFecha: v }))} type="date" />
                      </div>
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>Saldo en cuotas</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                      <FInput label="Cantidad de cuotas" value={genForm.n} onChange={v => setGenForm(p => ({ ...p, n: v }))} type="number" placeholder="6" />
                      <FInput label="Primera fecha de pago" value={genForm.primerFecha} onChange={v => setGenForm(p => ({ ...p, primerFecha: v }))} type="date" />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.6 }}>Cada</label>
                        <select value={genForm.intervalo} onChange={e => setGenForm(p => ({ ...p, intervalo: e.target.value }))}
                          style={{ padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper }}>
                          <option value="7-dias">7 días</option>
                          <option value="15-dias">15 días</option>
                          <option value="1-meses">1 mes</option>
                          <option value="2-meses">2 meses</option>
                          <option value="3-meses">3 meses</option>
                          <option value="6-meses">6 meses</option>
                        </select>
                      </div>
                    </div>
                    {cantCuotas > 0 && (
                      <div style={{ marginTop: 8, fontSize: 11, color: T.ink3 }}>
                        {anticipoMonto > 0 && <span>Adelanto {fmtUSD(anticipoMonto)} ({pct}%) + </span>}
                        {cantCuotas} cuota{cantCuotas !== 1 ? 's' : ''} de aprox. {fmtUSD(montoCuota)} c/u
                        {genForm.intervalo && <span>, cada {genForm.intervalo.replace('-', ' ')}</span>}
                        {totalUSD > 0 && <span> · Total {fmtUSD(totalUSD)}</span>}
                      </div>
                    )}
                  </>
                );
              })()}
            </FormPanel>
          </div>
        )}

        {/* Cuota manual */}
        {!locked && addingCuota && (
          <div style={{ padding: '12px 18px', borderBottom: `1px solid ${T.faint2}` }}>
            <FormPanel title={editCuotaId ? 'Editar cuota' : 'Nueva cuota'} onSave={saveCuota} onCancel={() => { setAddingCuota(false); setEditCuotaId(null); }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr', gap: 10 }}>
                <FInput label="N°" value={cuotaForm.n} onChange={v => setCuotaForm(p => ({ ...p, n: v }))} type="number" />
                <FInput label="Descripción" value={cuotaForm.descripcion} onChange={v => setCuotaForm(p => ({ ...p, descripcion: v }))} placeholder="Ej: Anticipo / Cuota 1 de 6..." />
                <FInput label="Monto (U$S)" value={cuotaForm.monto} onChange={v => setCuotaForm(p => ({ ...p, monto: v }))} type="number" />
                <FInput label="Fecha de pago" value={cuotaForm.fecha} onChange={v => setCuotaForm(p => ({ ...p, fecha: v }))} type="date" />
              </div>
            </FormPanel>
          </div>
        )}

        {cuotas.length === 0 && !addingCuota && !genAuto ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: T.ink3, fontSize: 13 }}>
            Sin cuotas. Usá "⚡ Generar automático" para distribuir o "+ Cuota manual" para agregar una por una.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: T.faint }}>
                <th style={{ ...colH2, textAlign: 'center', width: 40 }}>#</th>
                <th style={{ ...colH2, textAlign: 'left' }}>Descripción</th>
                <th style={colH2}>Monto (USD)</th>
                <th style={colH2}>Fecha</th>
                <th style={colH2}></th>
              </tr>
            </thead>
            <tbody>
              {cuotas.map((c, i) => (
                <tr key={c.id} style={{ borderBottom: i < cuotas.length - 1 ? `1px solid ${T.faint2}` : 'none' }}>
                  <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: T.ink2 }}>{c.n}</td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: T.ink }}>{c.descripcion}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: T.fontMono, fontSize: 13, fontWeight: 700, color: T.ink }}>{fmtUSD(cuotaMonto(c))}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, color: T.ink3 }}>{fmtD(c.fecha)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    {!locked && (
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <Btn sm onClick={() => startEditCuota(c)}>✎</Btn>
                        <span style={{ color: T.accent, cursor: 'pointer', padding: '2px 4px', fontSize: 11 }} onClick={() => delCuota(c.id)}>🗑</span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {cuotas.length > 1 && (
              <tfoot>
                <tr style={{ background: T.faint }}>
                  <td colSpan={2} style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700, color: T.ink3 }}>TOTAL</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: T.fontMono, fontSize: 13, fontWeight: 800, color: T.ink }}>{fmtUSD(totalCuotas)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </Box>

      {/* Botones de acción */}
      {!locked && cuotas.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn onClick={() => onExport?.()} style={{ padding: '8px 18px' }}>↗ Generar propuesta</Btn>
          <Btn fill onClick={() => {
            // No dejar cerrar si las cuotas no cubren el total (diferencia >1 USD
            // de tolerancia para errores de redondeo).
            if (Math.abs(diferencia) > 1) {
              alert(
                diferencia > 0
                  ? `No se puede cerrar el plan: faltan U$S ${fmtN(diferencia)} por asignar en cuotas.\n\nAjustá los montos o agregá una cuota más para cubrir el total.`
                  : `No se puede cerrar el plan: las cuotas suman U$S ${fmtN(Math.abs(diferencia))} más que el total acordado.\n\nAjustá los montos para que coincidan con el total.`
              );
              return;
            }
            if (!confirm('¿Cerrar el plan de pagos?\n\nUna vez cerrado, no podrás modificar interés, cuotas, montos ni fechas. Para volver a editar, hay que reabrirlo con "↩ Editar plan".')) return;
            patch(d => ({ ...d, financiacion: { ...(d.financiacion || {}), propuestaConfirmada: true, fechaConfirmacion: new Date().toISOString().split('T')[0] } }));
          }} style={{ padding: '8px 18px', fontSize: 13, opacity: Math.abs(diferencia) > 1 ? 0.6 : 1 }}
            title={Math.abs(diferencia) > 1 ? `El plan debe sumar exactamente el total acordado (faltan/sobran U$S ${fmtN(Math.abs(diferencia))})` : 'Cerrar el plan'}>
            🔒 Cerrar plan de pagos
          </Btn>
        </div>
      )}
    </div>
  );
}
const colH2 = { fontSize: 10, fontWeight: 700, color: T.ink3, padding: '6px 12px', textAlign: 'right', borderBottom: `1px solid ${T.faint2}` };

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3: MOVIMIENTOS (connected to MovimientosContext)
// ─────────────────────────────────────────────────────────────────────────────
const inputStMov = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none' };
const fmtFechaShort = (iso) => { if (!iso) return ''; const [, m, d] = iso.split('-'); return `${d}/${m}`; };
const todayStrOp = () => new Date().toISOString().split('T')[0];

function ObraMovRow({ m, cajas, onRemove }) {
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
      <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink3, width: 32, flexShrink: 0 }}>{fmtFechaShort(m.fecha)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.descripcion}</div>
        <div style={{ fontSize: 10, color: T.ink3, display: 'flex', gap: 5, marginTop: 1 }}>
          {caja && <span>{caja.nombre}</span>}
          {m.proveedor && (() => {
            const prov = m.proveedorId ? provsList.find(p => p.id === m.proveedorId) : provsList.find(p => p.nombre === m.proveedor);
            return prov
              ? <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }} onClick={e => { e.stopPropagation(); navigate(`/proveedores/${prov.id}`); }}>· {m.proveedor}</span>
              : <span>· {m.proveedor}</span>;
          })()}
          {m.medioPago && m.medioPago !== 'Transferencia' && <span>· {m.medioPago}</span>}
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

function ObraQuickAddForm({ tipo, cajas, proveedores, clientes, dolarVenta, obraId, obraNombre, obraMoneda, onSave, onCancel }) {
  const isGasto = tipo === 'gasto';
  const color = isGasto ? T.warn : T.ok;
  const navigate = useNavigate();

  const [desc,          setDesc]          = useState('');
  const [monto,         setMonto]         = useState('');
  const [fecha,         setFecha]         = useState(todayStrOp);
  const [medio,         setMedio]         = useState('Transferencia');
  const [contraparteId, setContraparteId] = useState('');
  const [monedaIngreso, setMonedaIngreso] = useState(() => obraMoneda === 'USD' ? 'USD' : 'ARS');
  const [monedaGasto,   setMonedaGasto]   = useState('ARS');
  const [montoDolar,    setMontoDolar]    = useState('');
  const [tipoCambio,    setTipoCambio]    = useState(() => String(Math.round(dolarVenta || 1070)));

  const monedaActual = isGasto ? monedaGasto : (monedaIngreso === 'USD' ? 'USD' : 'ARS');
  const cajasMoneda  = cajas.filter(c => c.activa && c.moneda === monedaActual);
  const cajaIsUSD    = monedaActual === 'USD';
  const [cajaId, setCajaId] = useState(() => cajas.filter(c => c.activa && c.moneda === 'ARS')[0]?.id || '');

  useEffect(() => {
    const firstMatch = cajas.filter(c => c.activa && c.moneda === monedaActual)[0];
    if (firstMatch) setCajaId(firstMatch.id);
  }, [monedaActual]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsedMonto = parseFloat(monto.replace(/[^0-9.]/g, '')) || 0;
  const parsedDolar = parseFloat(montoDolar.replace(/[^0-9.]/g, '')) || 0;
  const parsedTC    = parseFloat(tipoCambio.replace(/[^0-9.]/g, '')) || dolarVenta || 1070;

  const montoFinal = (!isGasto && monedaIngreso === 'USD_ARS')
    ? Math.round(parsedDolar * parsedTC)
    : Math.round(parsedMonto);

  const canSave = montoFinal > 0 && desc.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    const effectiveCajaId = cajasMoneda.find(c => c.id === cajaId) ? cajaId : cajasMoneda[0]?.id || cajaId;
    let contraparteName = '';
    const extra = {};
    if (isGasto) {
      const prov = proveedores.find(p => p.id === contraparteId);
      contraparteName = prov?.nombre || '';
      extra.proveedorId = contraparteId || null;
    } else {
      const cli = clientes.find(c => c.id === contraparteId);
      contraparteName = cli?.nombre || '';
      extra.clienteId = contraparteId || null;
      if (monedaIngreso === 'USD_ARS') {
        extra.tipoCambio = parsedTC;
        extra.montoDolar = parsedDolar;
      }
    }
    onSave({
      tipo,
      descripcion: desc.trim(),
      monto: montoFinal,
      fecha,
      obraId,
      obraNombre,
      cajaId: effectiveCajaId,
      cajaDestinoId: null,
      proveedor: contraparteName,
      categoria: isGasto ? 'general' : 'cobro-cliente',
      medioPago: medio,
      referencia: '',
      fondoReparo: false,
      ...extra,
    });
    setDesc(''); setMonto(''); setMontoDolar(''); setContraparteId('');
  };

  const onKey = (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div style={{ padding: '12px 14px', background: isGasto ? 'rgba(212,146,58,.07)' : 'rgba(61,122,74,.07)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input autoFocus style={{ ...inputStMov, flex: 1 }}
          value={desc} onChange={e => setDesc(e.target.value)} onKeyDown={onKey}
          placeholder={isGasto ? 'Descripción del gasto…' : 'Descripción del ingreso…'} />
        {!isGasto && monedaIngreso === 'USD_ARS' ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
            <input style={{ ...inputStMov, width: 90, fontFamily: T.fontMono, fontWeight: 700 }}
              type="number" min="0" placeholder="USD"
              value={montoDolar} onChange={e => setMontoDolar(e.target.value)} onKeyDown={onKey} />
            <span style={{ fontSize: 11, color: T.ink3 }}>× TC</span>
            <input style={{ ...inputStMov, width: 85, fontFamily: T.fontMono }}
              type="number" min="0" placeholder="TC"
              value={tipoCambio} onChange={e => setTipoCambio(e.target.value)} onKeyDown={onKey} />
            <span style={{ fontSize: 11, color: T.ink3 }}>=</span>
            <div style={{ ...inputStMov, width: 105, fontFamily: T.fontMono, fontWeight: 700, color: T.ok, background: T.faint, display: 'flex', alignItems: 'center', cursor: 'default' }}>
              $ {montoFinal > 0 ? fmtN(montoFinal) : '0'}
            </div>
          </div>
        ) : (
          <input style={{ ...inputStMov, width: 130, fontFamily: T.fontMono, fontWeight: 700 }}
            type="number" min="0" placeholder={cajaIsUSD ? 'USD' : '$ Monto'}
            value={monto} onChange={e => setMonto(e.target.value)} onKeyDown={onKey} />
        )}
        <input type="date" style={{ ...inputStMov, width: 140 }}
          value={fecha} onChange={e => setFecha(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1.4, gap: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{isGasto ? 'Proveedor' : 'Cliente'}</span>
            {isGasto && contraparteId && (
              <span style={{ fontSize: 10, color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
                onClick={() => navigate(`/proveedores/${contraparteId}`)}>Ver CC →</span>
            )}
          </div>
          <select style={{ ...inputStMov, cursor: 'pointer', width: '100%' }}
            value={contraparteId} onChange={e => setContraparteId(e.target.value)}>
            <option value="">{isGasto ? '— Sin proveedor' : '— Sin cliente'}</option>
            {isGasto
              ? proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}{p.tipo ? ` · ${p.tipo}` : ''}</option>)
              : clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}{c.empresa ? ` · ${c.empresa}` : ''}</option>)
            }
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Moneda</span>
          {isGasto ? (
            <select style={{ ...inputStMov, width: 110, cursor: 'pointer' }}
              value={monedaGasto} onChange={e => setMonedaGasto(e.target.value)}>
              <option value="ARS">Pesos (ARS)</option>
              <option value="USD">Dólares (USD)</option>
            </select>
          ) : (
            <select style={{ ...inputStMov, width: 110, cursor: 'pointer' }}
              value={monedaIngreso} onChange={e => setMonedaIngreso(e.target.value)}>
              {obraMoneda !== 'USD' && <option value="ARS">Pesos (ARS)</option>}
              <option value="USD">Dólares (USD)</option>
              <option value="USD_ARS">USD → Pesos</option>
            </select>
          )}
        </div>
        <select style={{ ...inputStMov, flex: 1, cursor: 'pointer' }}
          value={cajasMoneda.find(c => c.id === cajaId) ? cajaId : cajasMoneda[0]?.id || ''}
          onChange={e => setCajaId(e.target.value)}>
          {cajasMoneda.length === 0
            ? <option value="">Sin cajas {monedaActual}</option>
            : cajasMoneda.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)
          }
        </select>
        <select style={{ ...inputStMov, width: 120, cursor: 'pointer' }} value={medio} onChange={e => setMedio(e.target.value)}>
          {['Transferencia','Efectivo','Cheque','E-cheq','Débito','Tarjeta'].map(v => <option key={v}>{v}</option>)}
        </select>
        <Btn sm onClick={onCancel}>✕</Btn>
        <button onClick={save}
          style={{ padding: '6px 16px', borderRadius: 4, border: 'none', fontFamily: T.font, fontWeight: 700, fontSize: 12, cursor: canSave ? 'pointer' : 'not-allowed', background: canSave ? color : T.faint2, color: canSave ? '#fff' : T.ink3, transition: 'background .15s', flexShrink: 0 }}>
          ↵ Guardar
        </button>
      </div>
      <div style={{ fontSize: 10, color: T.ink3 }}>Enter guarda · Esc cierra</div>
    </div>
  );
}

function ObraPanel({ tipo, movs, cajas, proveedores, clientes, dolarVenta, obraId, obraNombre, obraMoneda, addMovimiento, removeMovimiento }) {
  const [open, setOpen] = useState(false);
  const isIngreso = tipo === 'ingreso';
  const color = isIngreso ? T.ok : T.warn;
  const label = isIngreso ? 'Ingresos' : 'Gastos';
  const arrow = isIngreso ? '↑' : '↓';
  const total = movs.reduce((s, m) => s + m.monto, 0);

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
        <ObraQuickAddForm
          tipo={tipo}
          cajas={cajas}
          proveedores={proveedores}
          clientes={clientes}
          dolarVenta={dolarVenta}
          obraId={obraId}
          obraNombre={obraNombre}
          obraMoneda={obraMoneda}
          onSave={(data) => addMovimiento(data)}
          onCancel={() => setOpen(false)}
        />
      )}
      <div style={{ overflow: 'auto', maxHeight: 460 }}>
        {movs.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: T.ink3, fontSize: 12 }}>
            Sin {label.toLowerCase()} registrados
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setOpen(true)}
                style={{ padding: '5px 14px', borderRadius: 4, border: `1px solid ${color}`, background: 'transparent', color, fontFamily: T.font, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                + Registrar {isIngreso ? 'ingreso' : 'gasto'}
              </button>
            </div>
          </div>
        )}
        {movs.map(m => <ObraMovRow key={m.id} m={m} cajas={cajas} onRemove={removeMovimiento} />)}
      </div>
    </Box>
  );
}

function TabMovimientos({ obra, moneda }) {
  const { movimientos, cajas: allCajas, addMovimiento, removeMovimiento } = useMovimientos();
  const { proveedores } = useProveedores();
  const { clientes }    = useClientes();
  const { dolarVenta }  = useDolar();
  const navigate        = useNavigate();
  const { currentUser } = useUsuarios();
  const isAdmin = currentUser?.rol === 'Admin';
  const cajas = cajasDelUsuario(allCajas, currentUser);
  const cajaIdsMias = cajas.map(c => c.id);

  const movsObra = useMemo(() =>
    movimientos.filter(m => {
      if (m.obraId !== obra.id) return false;
      if (m.ccPrevia) return false; // arrastre de cuenta corriente: no es movimiento de caja
      // No-admin: solo movimientos de SUS cajas (responsable + asignadas a mano).
      if (!isAdmin && (!m.cajaId || !cajaIdsMias.includes(m.cajaId))) return false;
      return true;
    }).sort((a, b) => b.fecha.localeCompare(a.fecha)),
    [movimientos, obra.id, isAdmin, cajaIdsMias]);
  const ingresos = useMemo(() => movsObra.filter(m => m.tipo === 'ingreso'), [movsObra]);
  const gastos   = useMemo(() => movsObra.filter(m => m.tipo === 'gasto'),   [movsObra]);

  const totalIngresos = ingresos.reduce((s, m) => s + m.monto, 0);
  const totalGastos   = gastos.reduce((s, m) => s + m.monto, 0);
  const neto          = totalIngresos - totalGastos;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
          onClick={() => navigate(`/movimientos?obra=${obra.id}`)}>
          Ver todos en Movimientos →
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 14 }}>
        <Box style={{ padding: '10px 16px' }}>
          <div style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Ingresos</div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: T.fontMono, color: T.ok, marginTop: 2 }}>$ {fmtN(totalIngresos)}</div>
        </Box>
        <Box style={{ padding: '10px 16px' }}>
          <div style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Gastos</div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: T.fontMono, color: T.warn, marginTop: 2 }}>$ {fmtN(totalGastos)}</div>
        </Box>
        <Box style={{ padding: '10px 16px' }}>
          <div style={{ fontSize: 10, color: T.ink2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Neto</div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: T.fontMono, color: neto >= 0 ? T.ok : T.warn, marginTop: 2 }}>$ {fmtN(neto)}</div>
        </Box>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <ObraPanel
          tipo="ingreso"
          movs={ingresos}
          cajas={cajas}
          proveedores={proveedores}
          clientes={clientes}
          dolarVenta={dolarVenta}
          obraId={obra.id}
          obraNombre={obra.nombre}
          obraMoneda={obra.moneda}
          addMovimiento={addMovimiento}
          removeMovimiento={removeMovimiento}
        />
        <ObraPanel
          tipo="gasto"
          movs={gastos}
          cajas={cajas}
          proveedores={proveedores}
          clientes={clientes}
          dolarVenta={dolarVenta}
          obraId={obra.id}
          obraNombre={obra.nombre}
          obraMoneda={obra.moneda}
          addMovimiento={addMovimiento}
          removeMovimiento={removeMovimiento}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 4: CUENTA CLIENTE
// ─────────────────────────────────────────────────────────────────────────────
function TabCuentaCliente({ detalle, moneda, obra }) {
  const { dolarVenta } = useDolar();
  const tc = dolarVenta || 1070;
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState(null);
  // Para el boton de exportar resumen total (movido aca desde TabResumen
  // por pedido del user: la accion vive donde estan los datos de cobranza).
  const [incluirPagos, setIncluirPagos] = useState(true);
  const { currentUser } = useUsuarios();
  const isAdmin = currentUser?.rol === 'Admin';

  // En Kamak la venta al cliente SIEMPRE se expresa en USD (independiente
  // de la moneda nominal de la obra). Las compras a proveedores quedan en
  // pesos pero eso se ve en TabResumen.
  const fmt = n => `U$S ${fmtN(n)}`;

  // Totales financieros — todo convertido a USD para el display al cliente.
  const { venta: ventaBaseARS } = calcObra(detalle.rubros || []);
  // Misma fórmula que TabFinanciacion / TabResumen / TabCuentaCorriente para
  // evitar diferencias: prefiere valorVentaTotal, sino costoTotal, sino monto.
  const adicionalClienteARS = (detalle.adicionales || [])
    .filter(a => a.estado === 'aprobado' && a.aplicaACliente !== false)
    .reduce((s, a) => s + (a.valorVentaTotal ?? a.costoTotal ?? a.monto ?? 0), 0);
  const interes = parseFloat((detalle.financiacion || {}).interes) || 0;
  const totalARS = Math.round((ventaBaseARS + adicionalClienteARS) * (1 + interes / 100));
  const total = calcTotalClienteUSD(detalle, ventaBaseARS, adicionalClienteARS, interes, tc);
  const ventaDisplay = arsToUSD(ventaBaseARS, tc);
  const adicDisplay  = arsToUSD(adicionalClienteARS, tc);

  const cuotas = detalle.cuotas || [];
  // Cobrado por cuota DERIVADO de los movimientos de ingreso de la obra (libro
  // único). Sombreamos cuotaCobrado/cuotaEstadoCalc con las versiones derivadas.
  const { movimientos: _movsCC, cajas: _cajasCC } = useMovimientos();
  const { cuotaCobrado, cuotaEstadoCalc, cuotaPagos, cobradoTotalUSD } = buildCuotaDerivados(cuotas, _movsCC, _cajasCC, obra.id, obra?.moneda || 'ARS', tc);
  const totalCobrado = cobradoTotalUSD;

  const saldoPendiente = Math.max(0, total - totalCobrado);
  const cuotasPagadas = cuotas.filter(c => cuotaEstadoCalc(c, moneda, tc) === 'pagado').length;
  // Suma de cuotas armadas en USD, para chequear si el plan completa el total.
  const sumaCuotasUSD = cuotas.reduce((s, c) => s + cuotaMontoUSD(c, moneda || 'ARS', tc), 0);
  const diferenciaPlan = total - sumaCuotasUSD;

  const rowSt = (i) => ({
    display: 'flex', alignItems: 'center', padding: '11px 14px', gap: 12,
    borderBottom: i < cuotas.length - 1 ? `1px solid ${T.faint2}` : 'none',
    cursor: 'pointer', background: 'transparent',
  });
  const numSt = (estado) => ({
    width: 28, height: 28, borderRadius: 14, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 800, fontSize: 12,
    background: estado === 'pagado' ? T.ok : estado === 'parcial' ? T.warn : T.faint2,
    color: estado !== 'pendiente' ? '#fff' : T.ink3,
  });

  return (
    <div>
      {/* Header sección — mismo formato que todos los otros bloques del Resumen
          (◆ + mono uppercase verde accent, link/info a la derecha). */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
        flexWrap: 'wrap',
        gap: 8,
      }}>
        <div style={{ fontSize: 9.5, color: T.accent, fontFamily: T.fontMono, letterSpacing: 1.5, fontWeight: 700, textTransform: 'uppercase' }}>
          ◆ Detalle de cobranza
          <span style={{ marginLeft: 8, color: T.ink3, letterSpacing: 1, fontWeight: 600 }}>
            {cuotasPagadas} / {cuotas.length} cuotas cobradas
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {obra?.cliente && (
            <div style={{ fontSize: 11, color: T.ink2, display: 'flex', alignItems: 'center', gap: 4 }}>
              Cliente:
              <span style={{ color: T.accent, cursor: 'pointer', fontWeight: 700 }}
                onClick={() => navigate(`/clientes?q=${encodeURIComponent(obra.cliente)}`)}>
                {obra.cliente} ↗
              </span>
            </div>
          )}
          {/* Exportar resumen total — solo admin (PDF incluye precios de venta) */}
          {isAdmin && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: T.ink2, cursor: 'pointer' }}>
                <input type="checkbox" checked={incluirPagos} onChange={e => setIncluirPagos(e.target.checked)} />
                Incluir plan de pagos
              </label>
              <Btn sm onClick={() => { const origin = window.location.origin; abrirExport(generarHTMLResumen({ obra, detalle, moneda, incluirPagos, dolarVenta, logoLight: `${origin}/assets/kamak-logo-light.png`, cobradoUSD: cobradoTotalUSD }), 'Resumen'); }}>↗ Exportar resumen total</Btn>
            </>
          )}
        </div>
      </div>

      {/* Banner: cuotas no cubren el total acordado */}
      {cuotas.length > 0 && Math.abs(diferenciaPlan) > 1 && (
        <div style={{
          background: diferenciaPlan > 0 ? '#fff4e5' : '#ffe5e5',
          border: `1.5px solid ${diferenciaPlan > 0 ? T.warn : T.accent}`,
          borderRadius: 4,
          padding: '9px 14px',
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 12,
        }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: T.ink }}>
              {diferenciaPlan > 0
                ? `El plan de cuotas no cubre el total acordado`
                : `El plan de cuotas excede el total acordado`}
            </div>
            <div style={{ color: T.ink2, marginTop: 2 }}>
              Total a cobrar: {fmt(total)} · Cuotas: {fmt(sumaCuotasUSD)} ·
              <b style={{ color: diferenciaPlan > 0 ? T.warn : T.accent, marginLeft: 4 }}>
                {diferenciaPlan > 0 ? `Falta asignar ${fmt(diferenciaPlan)}` : `Excede en ${fmt(-diferenciaPlan)}`}
              </b>
            </div>
          </div>
        </div>
      )}

      {/* Lista de cuotas con header de tabla */}
      {cuotas.length === 0 ? (
        <Box style={{ padding: '32px 20px', textAlign: 'center', color: T.ink3, fontSize: 13 }}>
          Sin cuotas definidas. Configurá el plan de pagos en la pestaña Presupuesto → Plan de pagos y cuotas.
        </Box>
      ) : (
        <Box style={{ padding: 0, overflow: 'hidden' }}>
          {/* Header tabla */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '7px 14px',
            background: T.dark,
            color: '#fff',
            fontSize: 9.5,
            fontFamily: T.fontMono,
            letterSpacing: 1.2,
            fontWeight: 700,
          }}>
            <div style={{ width: 28, flexShrink: 0, textAlign: 'center' }}>#</div>
            <div style={{ flex: 1 }}>CUOTA</div>
            <div style={{ width: 110, textAlign: 'right' }}>MONTO (USD)</div>
            <div style={{ width: 90, textAlign: 'center' }}>ESTADO</div>
            <div style={{ width: 14, flexShrink: 0 }} />
          </div>
          {cuotas.map((c, i) => {
            const estado = cuotaEstadoCalc(c, moneda, tc);
            // Mostramos en USD (regla: venta al cliente siempre en USD).
            const monto  = cuotaMontoUSD(c, moneda || 'ARS', tc);
            const cobrado = cuotaCobrado(c, 'USD', tc);
            const saldo  = Math.max(0, monto - cobrado);
            const pagos  = cuotaPagos(c); // derivados de movimientos (en USD)
            const isOpen = expandedId === c.id;
            return (
              <div key={c.id}>
                <div style={rowSt(i)} onClick={() => setExpandedId(isOpen ? null : c.id)}>
                  <div style={numSt(estado)}>{c.n}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.descripcion}</div>
                    {c.fecha && <div style={{ fontSize: 11, color: T.ink2 }}>{fmtD(c.fecha)}</div>}
                  </div>
                  <div style={{ width: 110, textAlign: 'right' }}>
                    <div style={{ fontFamily: T.fontMono, fontWeight: 700, fontSize: 13 }}>{fmt(monto)}</div>
                    {estado === 'parcial' && (
                      <div style={{ fontSize: 10, color: T.warn }}>cobrado {fmt(cobrado)} · falta {fmt(saldo)}</div>
                    )}
                  </div>
                  <div style={{ width: 90, textAlign: 'center' }}>
                    <Chip ok={estado === 'pagado'} warn={estado === 'parcial'} style={{ fontSize: 10 }}>{estado}</Chip>
                  </div>
                  <span style={{ width: 14, fontSize: 10, color: T.ink3, flexShrink: 0, textAlign: 'right' }}>{isOpen ? '▲' : '▼'}</span>
                </div>

                {/* Detalle de pagos */}
                {isOpen && (
                  <div style={{ background: T.faint, borderBottom: `1px solid ${T.faint2}` }}>
                    {pagos.length === 0 ? (
                      <div style={{ padding: '10px 14px 10px 54px', fontSize: 11, color: T.ink3 }}>Sin cobros registrados aún</div>
                    ) : pagos.map((p, pi) => (
                      <div key={pi} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: `${pi === 0 ? 10 : 6}px 14px ${pi === pagos.length - 1 ? 10 : 6}px 54px`, borderTop: pi > 0 ? `1px solid ${T.faint2}` : 'none' }}>
                        <span style={{ fontSize: 11, color: T.ink2, flexShrink: 0 }}>{fmtD(p.fecha)}</span>
                        <span style={{ fontFamily: T.fontMono, fontWeight: 700, fontSize: 12, color: T.ok }}>U$S {fmtN(p.monto)}</span>
                        {p.cajaNombre && <span style={{ fontSize: 11, color: T.ink2, flexShrink: 0 }}>{p.cajaNombre}</span>}
                        {p.concepto && <span style={{ fontSize: 11, color: T.ink3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.concepto}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </Box>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB CUENTA CORRIENTE — wrapper que agrupa Adicionales + Plan de pagos +
// Detalle de cobranza en una sola pestaña con KPIs arriba. Reemplaza la
// info dispersa que antes estaba en Resumen (bloque cuenta cliente),
// Presupuesto (acordeón plan de pagos) y la tab Adicionales.
// ─────────────────────────────────────────────────────────────────────────────
function TabCuentaCorriente({ obra, detalle, patch, moneda, onExport }) {
  const { dolarVenta } = useDolar();
  const { currentUser } = useUsuarios();
  const isAdmin = currentUser?.rol === 'Admin';
  const tc = dolarVenta || 1070;
  const obraMon = obra?.moneda || 'ARS';

  // Toggle U$S / $ — coherente con el Resumen.
  const [vistaMoneda, setVistaMoneda] = useState('USD');
  // Acordeones — todos abiertos por default; el user los colapsa si quiere.
  const [showAdicionales, setShowAdicionales] = useState(true);
  const [showPlan, setShowPlan] = useState(true);
  // Para el botón exportar resumen total (vive en el header de cuenta cte).
  const [incluirPagos, setIncluirPagos] = useState(true);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const { venta: ventaBaseARS } = calcObra(detalle.rubros || []);
  const adicionalARS = (detalle.adicionales || [])
    .filter(a => a.estado === 'aprobado' && a.aplicaACliente !== false)
    .reduce((s, a) => s + (a.valorVentaTotal ?? a.costoTotal ?? a.monto ?? 0), 0);
  const interes = parseFloat((detalle.financiacion || {}).interes) || 0;
  const totalARS = Math.round((ventaBaseARS + adicionalARS) * (1 + interes / 100));
  const totalUSD = calcTotalClienteUSD(detalle, ventaBaseARS, adicionalARS, interes, tc);
  const adicionalUSD = arsToUSD(adicionalARS, tc);
  const cuotas = detalle.cuotas || [];
  // Lo cobrado de cada cuota se DERIVA de los movimientos de ingreso de la obra
  // (libro único). Sombreamos cuotaCobrado/cuotaEstadoCalc localmente con las
  // versiones derivadas, así todos los usos de abajo quedan consistentes.
  const { movimientos: _movs, cajas: _cajas } = useMovimientos();
  const { cuotaCobrado, cuotaEstadoCalc, cuotaFechaPagada, cobradoTotalUSD } = buildCuotaDerivados(cuotas, _movs, _cajas, obra.id, obraMon, tc);
  const cobradoUSD = cobradoTotalUSD;
  const saldoUSD = Math.max(0, totalUSD - cobradoUSD);

  const fmtPesos = (n) => `$ ${fmtN(n)}`;
  const fmtUSD = (n) => `U$S ${fmtN(n)}`;
  const enUSD = vistaMoneda === 'USD';
  const fmtMon = enUSD ? fmtUSD : fmtPesos;
  const usdToMon = (n) => enUSD ? n : Math.round(n * tc);

  // Header de acordeón reutilizable.
  const AccordionHeader = ({ label, open, onToggle, extra }) => (
    <div
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 0',
        cursor: 'pointer',
        userSelect: 'none',
        borderTop: `1.5px solid ${T.faint2}`,
        borderBottom: open ? `1.5px solid ${T.faint2}` : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, background: T.accent, transform: 'rotate(45deg)', flexShrink: 0 }} />
        <span className="k-h" style={{ fontSize: 14, lineHeight: 1.1, color: T.ink }}>{label}</span>
        {extra}
      </div>
      <span style={{ fontSize: 10.5, color: T.ink3, fontWeight: 600, fontFamily: T.fontMono, letterSpacing: 0.5 }}>
        {open ? '▲ Cerrar' : '▼ Ver'}
      </span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── KPIs ──────────────────────────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 9.5, color: T.accent, fontFamily: T.fontMono, letterSpacing: 1.5, fontWeight: 700, textTransform: 'uppercase' }}>
            ◆ Cuenta corriente del cliente
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {obra?.cliente && (
              <span style={{ fontSize: 11, color: T.ink2 }}>
                Cliente: <span style={{ color: T.accent, fontWeight: 700 }}>{obra.cliente}</span>
              </span>
            )}
            {/* Toggle moneda */}
            <div style={{ display: 'flex', border: `1px solid ${T.faint2}`, borderRadius: 4, overflow: 'hidden', fontSize: 11, fontFamily: T.fontMono, fontWeight: 700 }}>
              <span onClick={() => setVistaMoneda('USD')}
                style={{ padding: '3px 10px', cursor: 'pointer', background: enUSD ? T.accent : T.paper, color: enUSD ? '#fff' : T.ink2, transition: 'all .12s' }}>U$S</span>
              <span onClick={() => setVistaMoneda('ARS')}
                style={{ padding: '3px 10px', cursor: 'pointer', background: !enUSD ? T.accent : T.paper, color: !enUSD ? '#fff' : T.ink2, transition: 'all .12s', borderLeft: `1px solid ${T.faint2}` }}>$</span>
            </div>
            {/* Exportar resumen total */}
            {isAdmin && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: T.ink2, cursor: 'pointer' }}>
                  <input type="checkbox" checked={incluirPagos} onChange={e => setIncluirPagos(e.target.checked)} />
                  Incluir plan de pagos
                </label>
                <Btn sm onClick={() => { const origin = window.location.origin; abrirExport(generarHTMLResumen({ obra, detalle, moneda, incluirPagos, dolarVenta, logoLight: `${origin}/assets/kamak-logo-light.png`, cobradoUSD: cobradoTotalUSD }), 'Resumen'); }}>↗ Exportar resumen total</Btn>
              </>
            )}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <Box style={{ padding: '13px 16px', borderLeft: `3px solid ${T.accent}` }}>
            <div style={{ fontSize: 9.5, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 1.2, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Monto total obra</div>
            <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 22, color: T.accent, lineHeight: 1.1 }}>{fmtMon(usdToMon(totalUSD))}</div>
          </Box>
          <Box style={{ padding: '13px 16px' }}>
            <div style={{ fontSize: 9.5, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 1.2, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Adicionales</div>
            <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 22, color: adicionalUSD > 0 ? T.warn : T.ink3, lineHeight: 1.1 }}>{fmtMon(usdToMon(adicionalUSD))}</div>
          </Box>
          <Box style={{ padding: '13px 16px' }}>
            <div style={{ fontSize: 9.5, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 1.2, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Cobrado</div>
            <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 22, color: T.ok, lineHeight: 1.1 }}>{fmtMon(usdToMon(cobradoUSD))}</div>
          </Box>
          <Box style={{ padding: '13px 16px' }}>
            <div style={{ fontSize: 9.5, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 1.2, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Saldo a cobrar</div>
            <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 22, color: saldoUSD > 0 ? T.warn : T.ok, lineHeight: 1.1 }}>{fmtMon(usdToMon(saldoUSD))}</div>
          </Box>
        </div>
      </div>

      {/* ── Pagos recibidos (detalle, independiente del plan de cuotas) ────── */}
      {(() => {
        const pagos = ingresosObraUSD(_movs, _cajas, obra.id, tc)
          .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')); // nuevos arriba, viejos abajo
        if (pagos.length === 0) return null;
        const totalPagos = pagos.reduce((s, p) => s + p.monto, 0);
        return (
          <Box style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '9px 14px', background: T.dark, color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, fontWeight: 700 }}>
              <span>◆ Pagos recibidos ({pagos.length})</span>
              <span style={{ fontFamily: T.fontMono, color: '#7ee0b8' }}>{fmtMon(usdToMon(totalPagos))}</span>
            </div>
            {pagos.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', borderTop: i > 0 ? `1px solid ${T.faint2}` : 'none', fontSize: 12.5 }}>
                <span style={{ width: 84, flexShrink: 0, fontFamily: T.fontMono, color: T.ink2 }}>{fmtD(p.fecha)}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.concepto}</span>
                <span style={{ fontFamily: T.fontMono, fontWeight: 700, color: T.ok, flexShrink: 0 }}>+ {fmtMon(usdToMon(p.monto))}</span>
              </div>
            ))}
          </Box>
        );
      })()}

      {/* ── Acordeón Adicionales ──────────────────────────────────────────── */}
      <div>
        <AccordionHeader
          label="Adicionales"
          open={showAdicionales}
          onToggle={() => setShowAdicionales(v => !v)}
          extra={(detalle.adicionales || []).length > 0 && (
            <span style={{ fontSize: 11, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 0.8, fontWeight: 600 }}>
              {(detalle.adicionales || []).length}
            </span>
          )}
        />
        {showAdicionales && (
          <div style={{ paddingTop: 14 }}>
            <TabAdicionales detalle={detalle} patch={patch} moneda={moneda} obra={obra} />
          </div>
        )}
      </div>

      {/* ── Acordeón Estado de cuenta ────────────────────────────────────
          Solo cobranza: muestra cuotas con estado, cobrado, falta. SIN edición
          (las cuotas se marcan pagadas automáticamente al registrar el ingreso
          en Movimientos). La edición del plan vive en Presupuesto. */}
      <div>
        <AccordionHeader
          label="Estado de cuenta"
          open={showPlan}
          onToggle={() => setShowPlan(v => !v)}
          extra={(detalle.cuotas || []).length > 0 && (
            <span style={{ fontSize: 11, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 0.8, fontWeight: 600 }}>
              {(detalle.cuotas || []).filter(c => cuotaEstadoCalc(c, obraMon, tc) === 'pagado').length} / {(detalle.cuotas || []).length} cuotas pagas
            </span>
          )}
        />
        {showPlan && (
          <div style={{ paddingTop: 14 }}>
            <EstadoDeCuenta obra={obra} detalle={detalle} tc={tc} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EstadoDeCuenta — vista de cobranza pura: muestra estado de cada cuota,
// cuándo se cobró, cuánto. SIN edición manual (las cuotas se marcan pagadas
// automáticamente cuando se registra un ingreso asociado a la cuota desde
// Movimientos). La edición del plan vive en Presupuesto → Plan de pagos.
//
// Coloreo por urgencia de vencimiento (cuotas no pagadas):
//   - verde: faltan más de 3 días
//   - amarillo: vence en 0-3 días
//   - rojo: vencida (hoy o anterior)
// ─────────────────────────────────────────────────────────────────────────────
function urgenciaCuota(c, estado, hoyStr) {
  if (estado === 'pagado') return 'pagado';
  if (!c.fecha) return 'sin-fecha';
  if (c.fecha < hoyStr) return 'vencida';
  if (c.fecha === hoyStr) return 'vencida'; // hoy = ya tendría que estar cobrada
  // Diff en días
  const d1 = new Date(hoyStr);
  const d2 = new Date(c.fecha);
  const dias = Math.round((d2 - d1) / 86400000);
  if (dias <= 3) return 'proxima';
  return 'a-tiempo';
}

function EstadoDeCuenta({ obra, detalle, tc }) {
  const navigate = useNavigate();
  const obraMon = obra?.moneda || 'ARS';
  const cuotas = detalle.cuotas || [];
  const fmtUSD = (n) => `U$S ${fmtN(n)}`;
  const hoyStr = new Date().toISOString().slice(0, 10);

  // Libro único: derivamos cobrado/estado/fechaPagada de los movimientos de
  // ingreso de la obra. Sombreamos cuotaCobrado/cuotaEstadoCalc localmente con
  // las versiones derivadas — sin esto, cuotaFechaPagada quedaba sin definir y
  // la cuenta corriente tiraba "cuotaFechaPagada is not defined".
  const { movimientos: _movsEC, cajas: _cajasEC } = useMovimientos();
  const { cuotaCobrado, cuotaEstadoCalc, cuotaFechaPagada } = buildCuotaDerivados(cuotas, _movsEC, _cajasEC, obra.id, obraMon, tc);

  // Conteo para banner de alerta arriba.
  const cuotasUrgentes = cuotas.map(c => ({ c, estado: cuotaEstadoCalc(c, obraMon, tc) }))
    .filter(({ estado }) => estado !== 'pagado')
    .map(({ c, estado }) => urgenciaCuota(c, estado, hoyStr));
  const vencidas = cuotasUrgentes.filter(u => u === 'vencida').length;
  const proximas = cuotasUrgentes.filter(u => u === 'proxima').length;

  if (cuotas.length === 0) {
    return (
      <Box style={{ padding: '32px 20px', textAlign: 'center', color: T.ink3, fontSize: 13 }}>
        Sin cuotas definidas. Armá el plan de pagos en{' '}
        <span style={{ color: T.accent, cursor: 'pointer', fontWeight: 700 }}
          onClick={() => navigate(`/obras/${obra.id}/presupuesto?tab=2`)}>
          Presupuesto → Plan de pagos y cuotas
        </span>.
      </Box>
    );
  }

  return (
    <div>
      {/* Banner alerta: cuotas vencidas o próximas a vencer (3 días). */}
      {(vencidas > 0 || proximas > 0) && (
        <div style={{
          background: vencidas > 0 ? '#fef2f2' : '#fffbeb',
          borderLeft: `3px solid ${vencidas > 0 ? '#b91c1c' : '#b45309'}`,
          padding: '9px 14px',
          marginBottom: 10,
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          fontSize: 12,
        }}>
          <span style={{ fontSize: 10, fontFamily: T.fontMono, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: vencidas > 0 ? '#b91c1c' : '#b45309' }}>
            {vencidas > 0 ? 'Atención' : 'Aviso'}
          </span>
          <div style={{ flex: 1, color: vencidas > 0 ? '#7f1d1d' : '#78350f' }}>
            <span style={{ fontWeight: 700 }}>
              {vencidas > 0 && `${vencidas} cuota${vencidas !== 1 ? 's' : ''} vencida${vencidas !== 1 ? 's' : ''}`}
              {vencidas > 0 && proximas > 0 && ' · '}
              {proximas > 0 && `${proximas} próxima${proximas !== 1 ? 's' : ''} (≤3 días)`}
            </span>
            <span style={{ marginLeft: 6, opacity: 0.75, fontSize: 11 }}>· revisá el detalle abajo.</span>
          </div>
        </div>
      )}
      <Box style={{ padding: 0, overflow: 'hidden' }}>
      {/* Header tabla */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '7px 14px',
        background: T.dark,
        color: '#fff',
        fontSize: 9.5,
        fontFamily: T.fontMono,
        letterSpacing: 1.2,
        fontWeight: 700,
      }}>
        <div style={{ width: 28, flexShrink: 0, textAlign: 'center' }}>#</div>
        <div style={{ flex: 1 }}>CUOTA</div>
        <div style={{ width: 95, textAlign: 'right' }}>VENCE</div>
        <div style={{ width: 100, textAlign: 'right' }}>MONTO USD</div>
        <div style={{ width: 100, textAlign: 'right' }}>COBRADO</div>
        <div style={{ width: 100, textAlign: 'center' }}>ESTADO</div>
      </div>
      {cuotas.map((c, i) => {
        const estado = cuotaEstadoCalc(c, obraMon, tc);
        const pagada = estado === 'pagado';
        const parcial = estado === 'parcial';
        const monto = cuotaMontoUSD(c, obraMon, tc);
        const cobrado = cuotaCobrado(c, 'USD', tc);
        const fechaPagada = cuotaFechaPagada(c); // derivada del último movimiento que la saldó
        const urg = urgenciaCuota(c, estado, hoyStr);
        // Colores por urgencia: verde claro (a tiempo), amarillo (próxima),
        // rojo (vencida), verde sólido (pagada).
        const rowBg = pagada ? '#f0faf2'
          : urg === 'vencida' ? '#fee2e2'
          : urg === 'proxima' ? '#fff7e0'
          : urg === 'a-tiempo' ? '#f4faf5'
          : 'transparent';
        const borderLeftColor = pagada ? T.ok
          : urg === 'vencida' ? '#dc2626'
          : urg === 'proxima' ? '#d97706'
          : urg === 'a-tiempo' ? T.ok
          : T.faint2;
        // Días para vencer (texto extra debajo de la fecha para guiar al ojo).
        const diasEtiqueta = (() => {
          if (pagada || !c.fecha) return null;
          const d1 = new Date(hoyStr), d2 = new Date(c.fecha);
          const dias = Math.round((d2 - d1) / 86400000);
          if (dias < 0) return { txt: `${Math.abs(dias)}d vencida`, color: '#dc2626' };
          if (dias === 0) return { txt: 'HOY', color: '#dc2626' };
          if (dias === 1) return { txt: 'mañana', color: '#d97706' };
          if (dias <= 3) return { txt: `en ${dias}d`, color: '#d97706' };
          return null;
        })();
        return (
          <div key={c.id} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 14px',
            borderBottom: i < cuotas.length - 1 ? `1px solid ${T.faint2}` : 'none',
            background: rowBg,
            borderLeft: `3px solid ${borderLeftColor}`,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 14, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: 12,
              background: pagada ? T.ok : urg === 'vencida' ? '#dc2626' : parcial ? T.warn : T.faint2,
              color: pagada || urg === 'vencida' || parcial ? '#fff' : T.ink3,
            }}>{c.n}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.descripcion}</div>
              {pagada && fechaPagada && (
                <div style={{ fontSize: 11, color: '#166534', fontFamily: T.fontMono, marginTop: 1 }}>
                  Cobrada el {fmtD(fechaPagada)}
                </div>
              )}
              {parcial && (
                <div style={{ fontSize: 11, color: '#92400e', fontFamily: T.fontMono, marginTop: 1 }}>
                  Pendiente U$S {fmtN(monto - cobrado)}
                </div>
              )}
            </div>
            <div style={{ width: 95, textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: T.ink3, fontFamily: T.fontMono }}>{fmtD(c.fecha)}</div>
              {diasEtiqueta && (
                <div style={{ fontSize: 9.5, color: diasEtiqueta.color, fontFamily: T.fontMono, fontWeight: 800, marginTop: 1, letterSpacing: 0.5 }}>
                  {diasEtiqueta.txt}
                </div>
              )}
            </div>
            <div style={{ width: 100, textAlign: 'right', fontFamily: T.fontMono, fontWeight: 700, fontSize: 13, color: T.ink }}>{fmtUSD(monto)}</div>
            <div style={{ width: 100, textAlign: 'right', fontFamily: T.fontMono, fontWeight: 700, fontSize: 13, color: cobrado > 0 ? T.ok : T.ink3 }}>
              {cobrado > 0 ? fmtUSD(cobrado) : '—'}
            </div>
            <div style={{ width: 100, textAlign: 'center' }}>
              {pagada ? (
                <span style={{ fontSize: 10, background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: 3, fontWeight: 600, border: '1px solid #bbf7d0' }}>Pagada</span>
              ) : urg === 'vencida' ? (
                <span style={{ fontSize: 10, background: '#fef2f2', color: '#991b1b', padding: '2px 8px', borderRadius: 3, fontWeight: 600, border: '1px solid #fecaca' }}>Vencida</span>
              ) : urg === 'proxima' ? (
                <span style={{ fontSize: 10, background: '#fffbeb', color: '#78350f', padding: '2px 8px', borderRadius: 3, fontWeight: 600, border: '1px solid #fde68a' }}>Próxima</span>
              ) : parcial ? (
                <span style={{ fontSize: 10, background: '#fffbeb', color: '#92400e', padding: '2px 8px', borderRadius: 3, fontWeight: 600, border: '1px solid #fde68a' }}>Parcial</span>
              ) : (
                <span style={{ fontSize: 10, background: T.faint, color: T.ink2, padding: '2px 8px', borderRadius: 3, fontWeight: 600, border: `1px solid ${T.faint2}` }}>Al día</span>
              )}
            </div>
          </div>
        );
      })}
      {/* Footer total */}
      {cuotas.length > 1 && (() => {
        const totalUSD = cuotas.reduce((s, c) => s + cuotaMontoUSD(c, obraMon, tc), 0);
        const cobradoUSD = cuotas.reduce((s, c) => s + cuotaCobrado(c, 'USD', tc), 0);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: T.faint, borderTop: `1.5px solid ${T.faint2}`, fontSize: 12 }}>
            <div style={{ width: 28, flexShrink: 0 }} />
            <div style={{ flex: 1, fontWeight: 700, color: T.ink2, fontFamily: T.fontMono, letterSpacing: 1, fontSize: 11, textTransform: 'uppercase' }}>Total</div>
            <div style={{ width: 95 }} />
            <div style={{ width: 100, textAlign: 'right', fontFamily: T.fontMono, fontWeight: 800, fontSize: 13 }}>{fmtUSD(totalUSD)}</div>
            <div style={{ width: 100, textAlign: 'right', fontFamily: T.fontMono, fontWeight: 800, fontSize: 13, color: T.ok }}>{fmtUSD(cobradoUSD)}</div>
            <div style={{ width: 100 }} />
          </div>
        );
      })()}
      <div style={{ padding: '8px 14px', fontSize: 10.5, color: T.ink3, background: T.faint, borderTop: `1px solid ${T.faint2}` }}>
        Las cuotas se marcan pagadas automáticamente al registrar el ingreso en{' '}
        <span style={{ color: T.accent, cursor: 'pointer', fontWeight: 700 }} onClick={() => navigate(`/movimientos?obra=${obra.id}`)}>
          Movimientos
        </span>
        . Para editar el plan →{' '}
        <span style={{ color: T.accent, cursor: 'pointer', fontWeight: 700 }} onClick={() => navigate(`/obras/${obra.id}/presupuesto?tab=2`)}>
          Presupuesto → Plan de pagos
        </span>
      </div>
    </Box>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 5: CONTRATOS MO
// ─────────────────────────────────────────────────────────────────────────────
const makeFormInit = () => ({ proveedor: '', cuit: '', fechaInicio: '', fechaFin: '', fondoReparo: 5, formaPago: 'Por avance certificado mensualmente', rubrosAgregados: [] });
const makeRubroFormInit = () => ({ rubroId: '', tareasSel: {} });

function TabContratosMO({ detalle, patch, moneda, obra }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(makeFormInit);
  const [formError, setFormError] = useState('');
  const [addingRubro, setAddingRubro] = useState(false);
  const [editingRubroId, setEditingRubroId] = useState(null);
  const [rubroForm, setRubroForm] = useState(makeRubroFormInit);
  const [printContrato, setPrintContrato] = useState(null);
  const { proveedores: proveedoresDyn } = useProveedores();
  const navigate = useNavigate();

  const rubros = detalle.rubros || [];
  const contratos = detalle.contratos || [];

  const allTareasSel = form.rubrosAgregados
    .filter(r => r.rubroId !== editingRubroId)
    .flatMap(r => Object.keys(r.tareasSel));
  const rubroSel = rubros.find(r => r.id === rubroForm.rubroId) || null;
  const tareasDisponibles = rubroSel
    ? (rubroSel.tareas || []).filter(t =>
        t.tipo !== 'seccion' &&
        calcTareaContratada(t.id, contratos) < (t.cantidad || 0) &&
        !allTareasSel.includes(t.id))
    : [];

  const onTareaToggle = (t) => {
    setRubroForm(p => {
      if (p.tareasSel[t.id]) {
        const next = { ...p.tareasSel };
        delete next[t.id];
        return { ...p, tareasSel: next };
      }
      const disponible = t.cantidad - calcTareaContratada(t.id, contratos);
      return { ...p, tareasSel: { ...p.tareasSel, [t.id]: { cantidad: disponible, precioUnit: Math.round(t.costoSub || t.costoMO) || 0 } } };
    });
  };

  const agregarRubroAlForm = () => {
    if (!rubroForm.rubroId) return;
    const rubro = rubros.find(r => r.id === rubroForm.rubroId);
    if (!rubro) return;
    if (editingRubroId) {
      setForm(p => ({ ...p, rubrosAgregados: p.rubrosAgregados.map(ra => ra.rubroId === editingRubroId ? { rubroId: rubroForm.rubroId, rubroNombre: rubro.nombre, tareasSel: rubroForm.tareasSel } : ra) }));
      setEditingRubroId(null);
    } else {
      const existing = form.rubrosAgregados.find(r => r.rubroId === rubroForm.rubroId);
      if (existing) {
        setForm(p => ({ ...p, rubrosAgregados: p.rubrosAgregados.map(r => r.rubroId === rubroForm.rubroId ? { ...r, tareasSel: { ...r.tareasSel, ...rubroForm.tareasSel } } : r) }));
      } else {
        setForm(p => ({ ...p, rubrosAgregados: [...p.rubrosAgregados, { rubroId: rubroForm.rubroId, rubroNombre: rubro.nombre, tareasSel: rubroForm.tareasSel }] }));
      }
    }
    setRubroForm(makeRubroFormInit());
    setAddingRubro(false);
  };

  const removeRubro = (rubroId) => setForm(p => ({ ...p, rubrosAgregados: p.rubrosAgregados.filter(r => r.rubroId !== rubroId) }));

  const startEditRubro = (ra) => {
    setEditingRubroId(ra.rubroId);
    setRubroForm({ rubroId: ra.rubroId, tareasSel: { ...ra.tareasSel } });
    setAddingRubro(true);
  };

  const totalContrato = form.rubrosAgregados.reduce((sum, ra) =>
    sum + Object.values(ra.tareasSel).reduce((s, v) => s + (v.cantidad || 0) * (v.precioUnit || 0), 0), 0);

  const save = () => {
    if (!form.proveedor.trim()) { setFormError('Ingresá el nombre del contratista'); return; }
    if (form.rubrosAgregados.length === 0) { setFormError('Agregá al menos un rubro con tareas'); return; }
    setFormError('');
    const tareas = form.rubrosAgregados.flatMap(ra => {
      const rubro = rubros.find(r => r.id === ra.rubroId);
      if (!rubro) return [];
      return Object.entries(ra.tareasSel)
        .filter(([, v]) => (v.cantidad || 0) > 0)
        .map(([tareaId, v]) => {
          const t = (rubro.tareas || []).find(x => x.id === tareaId);
          if (!t) return null;
          return { tareaId, rubroId: ra.rubroId, rubroNombre: ra.rubroNombre, nombre: t.nombre, unidad: t.unidad, cantidadTotal: t.cantidad, cantidadContratada: +v.cantidad, precioUnit: +v.precioUnit };
        })
        .filter(Boolean);
    });
    patch(d => ({ ...d, contratos: [...(d.contratos || []), { id: newId(), proveedor: form.proveedor, cuit: form.cuit, fechaInicio: form.fechaInicio, fechaFin: form.fechaFin, fondoReparo: +form.fondoReparo, formaPago: form.formaPago, estado: 'activo', tareas, monto: totalContrato }] }));
    setAdding(false);
    setForm(makeFormInit());
    setAddingRubro(false);
    setEditingRubroId(null);
    setRubroForm(makeRubroFormInit());
  };

  const toggleEstado = (id) => patch(d => ({ ...d, contratos: d.contratos.map(c => c.id === id ? { ...c, estado: c.estado === 'activo' ? 'cerrado' : 'activo' } : c) }));
  const del = (id) => patch(d => ({ ...d, contratos: d.contratos.filter(c => c.id !== id) }));

  return (
    <div style={{ maxWidth: 800 }}>
      {printContrato && <ContratoMOModal contrato={printContrato} obra={obra} onClose={() => setPrintContrato(null)} />}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Btn sm fill onClick={() => setAdding(true)}>+ Contrato MO</Btn>
      </div>

      {adding && (
        <FormPanel title="Nuevo contrato MO" onSave={save} onCancel={() => { setAdding(false); setForm(makeFormInit()); setAddingRubro(false); setEditingRubroId(null); setRubroForm(makeRubroFormInit()); setFormError(''); }} style={{ marginBottom: 14 }}>
          {formError && <div style={{ color: '#dc2626', fontSize: 12, fontWeight: 600, padding: '4px 0' }}>{formError}</div>}

          {/* Fila 1: proveedor + cuit */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FRow label="Proveedor / contratista">
              <input
                list="contrato-prov-list"
                style={inputSt}
                placeholder="Nombre del contratista"
                value={form.proveedor}
                onChange={e => {
                  const prov = proveedoresDyn.find(p => p.nombre === e.target.value);
                  setForm(p => ({ ...p, proveedor: e.target.value, cuit: prov?.cuit || p.cuit }));
                }}
              />
              <datalist id="contrato-prov-list">
                {proveedoresDyn.map(p => <option key={p.id} value={p.nombre} />)}
              </datalist>
            </FRow>
            <FInput label="CUIT contratista" value={form.cuit} onChange={v => setForm(p => ({ ...p, cuit: v }))} placeholder="20-XXXXXXXX-X" />
          </div>

          {/* Fila 2: fechas + fondo + forma de pago */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.6fr 1fr', gap: 10 }}>
            <FInput label="Fecha inicio" value={form.fechaInicio} onChange={v => setForm(p => ({ ...p, fechaInicio: v }))} type="date" />
            <FInput label="Fecha fin" value={form.fechaFin} onChange={v => setForm(p => ({ ...p, fechaFin: v }))} type="date" />
            <FInput label="Fondo reparo %" value={form.fondoReparo} onChange={v => setForm(p => ({ ...p, fondoReparo: v }))} type="number" />
            <FInput label="Forma de pago" value={form.formaPago} onChange={v => setForm(p => ({ ...p, formaPago: v }))} />
          </div>

          {/* Rubros ya agregados */}
          {form.rubrosAgregados.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Rubros del contrato</div>
              {form.rubrosAgregados.map(ra => {
                const subTotal = Object.values(ra.tareasSel).reduce((s, v) => s + (v.cantidad || 0) * (v.precioUnit || 0), 0);
                const rubro = rubros.find(r => r.id === ra.rubroId);
                return (
                  <div key={ra.rubroId} style={{ marginBottom: 6, background: T.faint, borderRadius: 5, border: `1px solid ${T.faint2}`, padding: '8px 10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: T.ink }}>{ra.rubroNombre}</span>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, fontFamily: T.fontMono, fontWeight: 700, color: T.accent }}>$ {Math.round(subTotal).toLocaleString('es-AR')}</span>
                        <span style={{ fontSize: 10, color: T.accent, cursor: 'pointer', fontWeight: 700 }} onClick={() => startEditRubro(ra)}>✏ editar</span>
                        <span style={{ fontSize: 10, color: '#dc2626', cursor: 'pointer', fontWeight: 700 }} onClick={() => removeRubro(ra.rubroId)}>✕ quitar</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {Object.entries(ra.tareasSel).map(([tareaId, v]) => {
                        const t = (rubro?.tareas || []).find(x => x.id === tareaId);
                        return t ? (
                          <span key={tareaId} style={{ fontSize: 10, background: T.accentSoft, borderRadius: 3, padding: '2px 7px', color: T.ink2 }}>
                            {t.nombre} ({v.cantidad} {t.unidad})
                          </span>
                        ) : null;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Sub-form agregar rubro */}
          {addingRubro ? (
            <div style={{ marginTop: 6, background: T.faint, borderRadius: 5, border: `1.5px solid ${T.accent}`, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.accent, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>{editingRubroId ? 'Editar rubro' : 'Agregar rubro'}</div>
              <FRow label="Rubro">
                <select style={{ ...inputSt, cursor: 'pointer' }} value={rubroForm.rubroId} onChange={e => setRubroForm({ rubroId: e.target.value, tareasSel: {} })}>
                  <option value="">— Seleccionar rubro —</option>
                  {rubros.filter(r => {
                    if (editingRubroId && r.id === editingRubroId) return true;
                    if (form.rubrosAgregados.find(ra => ra.rubroId === r.id)) return false;
                    const tareasSinSec = (r.tareas || []).filter(t => t.tipo !== 'seccion' && (t.cantidad || 0) > 0);
                    return tareasSinSec.some(t => calcTareaContratada(t.id, contratos) < t.cantidad);
                  }).map(r => (
                    <option key={r.id} value={r.id}>{r.nombre}</option>
                  ))}
                </select>
              </FRow>

              {rubroSel && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, marginTop: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Tareas disponibles — {rubroSel.nombre}
                    </div>
                    {tareasDisponibles.length > 0 && (
                      <span style={{ fontSize: 10, color: T.accent, cursor: 'pointer', fontWeight: 700 }}
                        onClick={() => {
                          const allSel = tareasDisponibles.every(t => rubroForm.tareasSel[t.id]);
                          if (allSel) {
                            setRubroForm(p => ({ ...p, tareasSel: {} }));
                          } else {
                            const next = { ...rubroForm.tareasSel };
                            tareasDisponibles.forEach(t => {
                              if (!next[t.id]) {
                                const disponible = t.cantidad - calcTareaContratada(t.id, contratos);
                                next[t.id] = { cantidad: disponible, precioUnit: Math.round(t.costoSub || t.costoMO) || 0 };
                              }
                            });
                            setRubroForm(p => ({ ...p, tareasSel: next }));
                          }
                        }}>
                        {tareasDisponibles.every(t => rubroForm.tareasSel[t.id]) ? 'Deseleccionar todo' : 'Seleccionar todo'}
                      </span>
                    )}
                  </div>
                  {tareasDisponibles.length === 0 ? (
                    <div style={{ fontSize: 12, color: T.ink3, padding: '8px 0' }}>Todas las tareas de este rubro ya están completamente contratadas.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {tareasDisponibles.map(t => {
                        const disponible = t.cantidad - calcTareaContratada(t.id, contratos);
                        const sel = rubroForm.tareasSel[t.id];
                        return (
                          <div key={t.id} style={{ padding: '6px 8px', background: sel ? T.accentSoft : T.paper, borderRadius: 4, border: `1px solid ${sel ? T.accent : T.faint2}` }}>
                            {/* Línea 1: checkbox + nombre + disp */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <input type="checkbox" checked={!!sel} onChange={() => onTareaToggle(t)} style={{ accentColor: T.accent, cursor: 'pointer', flexShrink: 0 }} />
                              <span style={{ flex: 1, fontSize: 12, fontWeight: sel ? 600 : 400 }}>{t.nombre}</span>
                              <span style={{ fontSize: 10, color: T.ink3, fontFamily: T.fontMono, whiteSpace: 'nowrap' }}>{t.unidad} · disp: {disponible}/{t.cantidad}</span>
                            </div>
                            {/* Línea 2: inputs (solo cuando está seleccionado) */}
                            {sel && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, paddingLeft: 24 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                  <span style={{ fontSize: 9, color: T.ink3 }}>Cantidad</span>
                                  <input type="number" value={sel.cantidad} min="0" max={disponible}
                                    onChange={e => setRubroForm(p => ({ ...p, tareasSel: { ...p.tareasSel, [t.id]: { ...sel, cantidad: +e.target.value } } }))}
                                    style={{ width: 80, padding: '3px 6px', border: `1px solid ${T.accent}`, borderRadius: 3, fontFamily: T.fontMono, fontSize: 12, textAlign: 'right' }} />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                  <span style={{ fontSize: 9, color: T.ink3 }}>$ Unit MO</span>
                                  <input type="number" value={sel.precioUnit} min="0"
                                    onChange={e => setRubroForm(p => ({ ...p, tareasSel: { ...p.tareasSel, [t.id]: { ...sel, precioUnit: +e.target.value } } }))}
                                    style={{ width: 110, padding: '3px 6px', border: `1px solid ${T.accent}`, borderRadius: 3, fontFamily: T.fontMono, fontSize: 12, textAlign: 'right' }} />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end' }}>
                                  <span style={{ fontSize: 9, color: T.ink3 }}>Subtotal</span>
                                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: T.fontMono, color: T.accent, whiteSpace: 'nowrap' }}>
                                    $ {Math.round((sel.cantidad || 0) * (sel.precioUnit || 0)).toLocaleString('es-AR')}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                <Btn sm onClick={() => { setAddingRubro(false); setEditingRubroId(null); setRubroForm(makeRubroFormInit()); }}>Cancelar</Btn>
                <Btn sm fill onClick={agregarRubroAlForm}>{editingRubroId ? 'Guardar cambios' : 'Agregar rubro'}</Btn>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 6 }}>
              <span
                onClick={() => setAddingRubro(true)}
                style={{ fontSize: 12, color: T.accent, cursor: 'pointer', fontWeight: 700 }}>
                + Agregar rubro
              </span>
            </div>
          )}

          {totalContrato > 0 && (
            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end', fontSize: 14, fontWeight: 800, fontFamily: T.fontMono, color: T.accent }}>
              Total contrato: $ {Math.round(totalContrato).toLocaleString('es-AR')}
            </div>
          )}
        </FormPanel>
      )}

      {contratos.length === 0 ? (
        <div style={{ color: T.ink3, padding: 24, textAlign: 'center' }}>Sin contratos</div>
      ) : contratos.map((c) => {
        const monto = c.monto || 0;
        const avPct = c.avancePct ?? 0;
        const cert = Math.round(monto * avPct / 100);
        const reparo = Math.round(cert * (c.fondoReparo || 0) / 100);
        const aLiquidar = cert - reparo;
        const tareas = Array.isArray(c.tareas) ? c.tareas : [];
        const rubrosNombres = c.gremio
          ? [c.gremio]
          : [...new Set(tareas.map(t => t.rubroNombre).filter(Boolean))];
        return (
          <Box key={c.id} style={{ padding: '12px 14px', marginBottom: 8, opacity: c.estado === 'cerrado' ? 0.7 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {(() => {
                    const prov = proveedoresDyn.find(p => p.nombre === c.proveedor || (c.cuit && p.cuit && p.cuit.replace(/[-\s]/g,'') === c.cuit.replace(/[-\s]/g,'')));
                    return prov
                      ? <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate(`/proveedores/${prov.id}`)}>{c.proveedor || c.gremio}</span>
                      : (c.proveedor || c.gremio || '—');
                  })()}
                  {c.cuit ? <span style={{ fontSize: 11, color: T.ink2, fontWeight: 400 }}> · CUIT {c.cuit}</span> : ''}
                </div>
                {rubrosNombres.length > 0 && (
                  <div style={{ fontSize: 11, color: T.ink2, marginTop: 2 }}>{rubrosNombres.join(' · ')}</div>
                )}
              </div>
              <div style={{ fontFamily: T.fontMono, fontWeight: 700, fontSize: 16 }}>{fmtM(monto, moneda)}</div>
              <Chip ok={c.estado === 'activo'} style={{ fontSize: 10 }}>{c.estado}</Chip>
              <div style={{ display: 'flex', gap: 6 }}>
                <Btn sm onClick={() => setPrintContrato(c)}>Imprimir</Btn>
                <Btn sm onClick={() => toggleEstado(c.id)}>{c.estado === 'activo' ? '✓ Cerrar' : '↩ Reabrir'}</Btn>
                <span style={{ color: T.accent, cursor: 'pointer' }} onClick={() => del(c.id)}>🗑</span>
              </div>
            </div>

            {tareas.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {tareas.map((t, i) => (
                  <span key={i} style={{ fontSize: 10, background: T.faint, borderRadius: 3, padding: '2px 7px', color: T.ink2 }}>{t.nombre} ({t.cantidadContratada} {t.unidad})</span>
                ))}
              </div>
            )}

            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                <span style={{ color: T.ink2 }}>Avance certificado</span>
                <span style={{ fontFamily: T.fontMono, fontWeight: 700, color: avPct >= 100 ? T.ok : T.accent }}>{avPct}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: T.faint2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${avPct}%`, background: avPct >= 100 ? T.ok : T.accent, borderRadius: 3, transition: 'width 0.3s' }} />
              </div>
            </div>

            {avPct > 0 && (
              <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {[
                  { label: 'Certificado', value: fmtM(cert, moneda), color: T.ink },
                  { label: `Fondo reparo (${c.fondoReparo}%)`, value: `− ${fmtM(reparo, moneda)}`, color: T.warn },
                  { label: 'A liquidar', value: fmtM(aLiquidar, moneda), color: T.ok },
                ].map(k => (
                  <div key={k.label} style={{ background: T.faint, borderRadius: 4, padding: '6px 10px' }}>
                    <div style={{ fontSize: 10, color: T.ink2, marginBottom: 2 }}>{k.label}</div>
                    <div style={{ fontFamily: T.fontMono, fontWeight: 700, fontSize: 13, color: k.color }}>{k.value}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 8, fontSize: 11, color: T.ink2, display: 'flex', gap: 16 }}>
              <span>Inicio: {fmtD(c.fechaInicio)}</span>
              <span>Fin: {fmtD(c.fechaFin)}</span>
              <span>Fondo reparo: {c.fondoReparo}%</span>
              {c.formaPago && <span>Pago: {c.formaPago}</span>}
            </div>
          </Box>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 6: DOCUMENTOS -> ./tabs/TabDocumentos.jsx
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// TAB 7: FOTOS
// ─────────────────────────────────────────────────────────────────────────────
function TabFotos({ detalle, patch, obraId }) {
  const [adding,      setAdding]      = useState(false);
  const [form,        setForm]        = useState({ label: '', fecha: new Date().toISOString().split('T')[0], rubro: '' });
  const [editingFoto, setEditingFoto] = useState(null);   // foto being edited
  const [editForm,    setEditForm]    = useState({});
  const [pendingFile, setPendingFile] = useState(null);
  const [previewUrl,  setPreviewUrl]  = useState(null);
  const [uploading,   setUploading]   = useState(false);
  const [uploadErr,   setUploadErr]   = useState('');
  const fileRef      = useRef(null);

  // ── Modo subida múltiple ──────────────────────────────────────────────────
  const [multiMode,   setMultiMode]   = useState(false);
  const [multiFiles,  setMultiFiles]  = useState([]); // { file, previewUrl, label, status }
  const [multiFecha,  setMultiFecha]  = useState(new Date().toISOString().split('T')[0]);
  const [multiRubro,  setMultiRubro]  = useState('');
  const [multiProgress, setMultiProgress] = useState(null); // null | { done, total }
  const multiRef = useRef(null);

  const handleMultiSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const items = files.map(f => ({
      file: f,
      previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      label: f.name.replace(/\.[^.]+$/, ''),
      status: 'pending',
    }));
    setMultiFiles(items);
    e.target.value = '';
  };

  const cancelMulti = () => {
    multiFiles.forEach(m => m.previewUrl && URL.revokeObjectURL(m.previewUrl));
    setMultiFiles([]);
    setMultiMode(false);
    setMultiProgress(null);
  };

  const uploadAll = async () => {
    if (!multiFiles.length) return;
    setMultiProgress({ done: 0, total: multiFiles.length });
    const nuevasFotos = [];
    for (let i = 0; i < multiFiles.length; i++) {
      const m = multiFiles[i];
      setMultiFiles(prev => prev.map((x, idx) => idx === i ? { ...x, status: 'uploading' } : x));
      let url = null;
      try {
        const ext  = m.file.name.split('.').pop() || 'jpg';
        const path = `obras/${obraId}/fotos/${Date.now()}-${i}.${ext}`;
        const { error } = await supabase.storage.from('kamak-fotos').upload(path, m.file, { upsert: true });
        if (!error) url = supabase.storage.from('kamak-fotos').getPublicUrl(path).data.publicUrl;
        setMultiFiles(prev => prev.map((x, idx) => idx === i ? { ...x, status: error ? 'error' : 'done' } : x));
      } catch {
        setMultiFiles(prev => prev.map((x, idx) => idx === i ? { ...x, status: 'error' } : x));
      }
      nuevasFotos.push({ id: newId(), label: m.label, fecha: multiFecha, rubro: multiRubro, url });
      setMultiProgress({ done: i + 1, total: multiFiles.length });
    }
    patch(d => ({ ...d, fotos: [...d.fotos, ...nuevasFotos] }));
    cancelMulti();
  };

  const handleFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setPendingFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const cancelAdding = () => {
    setAdding(false);
    setPendingFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setUploadErr('');
    setForm({ label: '', fecha: new Date().toISOString().split('T')[0], rubro: '' });
  };

  const save = async () => {
    if (!form.label.trim()) return;
    let url = null;
    if (pendingFile) {
      setUploading(true);
      setUploadErr('');
      const ext  = pendingFile.name.split('.').pop() || 'jpg';
      const path = `obras/${obraId}/fotos/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('kamak-fotos').upload(path, pendingFile, { upsert: true });
      if (error) { setUploadErr('Error al subir: ' + error.message); setUploading(false); return; }
      url = supabase.storage.from('kamak-fotos').getPublicUrl(path).data.publicUrl;
      setUploading(false);
    }
    patch(d => ({ ...d, fotos: [...d.fotos, { id: newId(), ...form, url }] }));
    cancelAdding();
  };

  const del = (id) => patch(d => ({ ...d, fotos: d.fotos.filter(f => f.id !== id) }));

  const startEditFoto = (f) => {
    // Buscar el avance actual de la tarea asociada a esta foto
    let avanceActual = null;
    for (const r of detalle.rubros) {
      for (const t of (r.tareas || [])) {
        if (t.nombre === f.rubro || t.id === f.tareaId) { avanceActual = t.avance ?? 0; break; }
      }
      if (avanceActual !== null) break;
    }
    setEditingFoto(f);
    setEditForm({ label: f.label || '', fecha: f.fecha || '', rubro: f.rubro || '', avance: avanceActual !== null ? avanceActual : '' });
  };

  const saveEditFoto = () => {
    const nuevoAvance = editForm.avance !== '' ? Math.min(100, Math.max(0, parseInt(editForm.avance) || 0)) : null;
    patch(d => ({
      ...d,
      fotos: d.fotos.map(f => f.id === editingFoto.id
        ? { ...f, label: editForm.label, fecha: editForm.fecha, rubro: editForm.rubro }
        : f
      ),
      // Si cambió el avance, actualizar la tarea que tenga el mismo nombre de rubro
      rubros: nuevoAvance !== null ? d.rubros.map(r => ({
        ...r,
        tareas: (r.tareas || []).map(t =>
          (t.nombre === editingFoto.rubro || t.id === editingFoto.tareaId)
            ? { ...t, avance: nuevoAvance }
            : t
        ),
      })) : d.rubros,
    }));
    setEditingFoto(null);
  };

  const statusColor = { pending: T.ink3, uploading: T.accent, done: T.ok, error: '#dc2626' };
  const statusIcon  = { pending: '⏳', uploading: '⬆', done: '✓', error: '✕' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: T.ink2 }}>{detalle.fotos.length} fotos</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn sm onClick={() => { setMultiMode(true); setAdding(false); }}>📁 Subir carpeta</Btn>
          <Btn sm fill onClick={() => { setAdding(true); setMultiMode(false); }}>📷 Agregar foto</Btn>
        </div>
      </div>

      {/* ── Subida múltiple ── */}
      {multiMode && (
        <div style={{ background: T.accentSoft, border: `1.5px solid ${T.accent}`, borderRadius: 6, padding: 14, marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Subir varias fotos</div>

          {multiFiles.length === 0 ? (
            <div style={{ border: `1.5px dashed ${T.faint2}`, borderRadius: 6, padding: 24, textAlign: 'center', cursor: 'pointer', background: T.faint }}
              onClick={() => multiRef.current?.click()}>
              <input ref={multiRef} type="file" accept="image/*,.pdf" multiple style={{ display: 'none' }} onChange={handleMultiSelect} />
              <div style={{ fontSize: 28, marginBottom: 6 }}>📁</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Seleccionar fotos</div>
              <div style={{ fontSize: 11, color: T.ink2, marginTop: 4 }}>Podés seleccionar múltiples archivos a la vez</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <FRow label="Fecha">
                  <input style={inputSt} type="date" value={multiFecha} onChange={e => setMultiFecha(e.target.value)} />
                </FRow>
                <FRow label="Rubro (común)">
                  <input style={inputSt} value={multiRubro} onChange={e => setMultiRubro(e.target.value)} placeholder="Ej: Albañilería" />
                </FRow>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 12, maxHeight: 360, overflowY: 'auto' }}>
                {multiFiles.map((m, i) => (
                  <div key={i} style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', border: `1.5px solid ${m.status === 'error' ? '#dc2626' : T.faint2}`, background: T.faint2 }}>
                    {m.previewUrl ? (
                      <img src={m.previewUrl} alt="" style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <div style={{ aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>📄</div>
                    )}
                    <div style={{ padding: '4px 6px', background: T.paper }}>
                      <input
                        style={{ ...inputSt, fontSize: 10, padding: '2px 4px' }}
                        value={m.label}
                        onChange={e => setMultiFiles(prev => prev.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))}
                        placeholder="Descripción"
                      />
                    </div>
                    <div style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: statusColor[m.status] || 'white', borderRadius: 3, fontSize: 11, padding: '1px 5px', fontWeight: 700 }}>
                      {statusIcon[m.status]}
                    </div>
                  </div>
                ))}
              </div>

              {multiProgress && (
                <div style={{ fontSize: 12, color: T.ink2, marginBottom: 8 }}>
                  Subiendo {multiProgress.done} / {multiProgress.total}…
                  <div style={{ height: 4, background: T.faint2, borderRadius: 2, marginTop: 4 }}>
                    <div style={{ height: '100%', background: T.accent, borderRadius: 2, width: `${(multiProgress.done / multiProgress.total) * 100}%`, transition: 'width 0.2s' }} />
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Btn sm onClick={cancelMulti} disabled={!!multiProgress}>Cancelar</Btn>
                <Btn sm fill onClick={uploadAll} disabled={!!multiProgress}>
                  {multiProgress ? 'Subiendo…' : `⬆ Subir ${multiFiles.length} foto${multiFiles.length !== 1 ? 's' : ''}`}
                </Btn>
              </div>
            </>
          )}

          {!multiFiles.length && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <Btn sm onClick={cancelMulti}>Cancelar</Btn>
            </div>
          )}
        </div>
      )}

      {/* ── Agregar foto individual ── */}
      {adding && (
        <FormPanel title="Agregar foto" onSave={save} onCancel={cancelAdding}
          style={{ marginBottom: 14, maxWidth: 500 }} saveLabel={uploading ? 'Subiendo...' : 'Guardar'} saveDisabled={uploading}>
          <FInput label="Descripción" value={form.label} onChange={v => setForm(p => ({ ...p, label: v }))} placeholder="Ej: Tablero instalado" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FInput label="Fecha" value={form.fecha} onChange={v => setForm(p => ({ ...p, fecha: v }))} type="date" />
            <FInput label="Rubro" value={form.rubro} onChange={v => setForm(p => ({ ...p, rubro: v }))} placeholder="Ej: Electricidad" />
          </div>
          <div style={{ border: `1.5px dashed ${T.faint2}`, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', background: T.faint }}
            onClick={() => fileRef.current?.click()}>
            <input ref={fileRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={handleFile} />
            {previewUrl ? (
              <img src={previewUrl} alt="" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', display: 'block' }} />
            ) : (
              <div style={{ padding: 20, fontSize: 12, color: T.ink2, textAlign: 'center' }}>
                📷 Clic para seleccionar imagen o PDF
              </div>
            )}
          </div>
          {uploadErr && <div style={{ fontSize: 11, color: '#dc2626' }}>{uploadErr}</div>}
        </FormPanel>
      )}

      {/* Modal de edición de foto */}
      {editingFoto && (
        <FormPanel
          title="Editar foto / avance"
          onSave={saveEditFoto}
          onCancel={() => setEditingFoto(null)}
          style={{ marginBottom: 14, maxWidth: 500 }}
        >
          <FInput label="Descripción" value={editForm.label} onChange={v => setEditForm(p => ({ ...p, label: v }))} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FInput label="Fecha" value={editForm.fecha} onChange={v => setEditForm(p => ({ ...p, fecha: v }))} type="date" />
            <FInput label="Tarea / Rubro" value={editForm.rubro} onChange={v => setEditForm(p => ({ ...p, rubro: v }))} />
          </div>
          {editForm.avance !== '' && (
            <div>
              <div style={{ fontSize: 11, color: T.ink2, marginBottom: 4 }}>
                Avance de tarea <b style={{ color: T.ink }}>{editForm.rubro}</b>
                <span style={{ color: T.ink3 }}> — Corregir si la cantidad era incorrecta</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="range" min={0} max={100} step={1}
                  value={editForm.avance}
                  onChange={e => setEditForm(p => ({ ...p, avance: +e.target.value }))}
                  style={{ flex: 1, accentColor: T.accent }}
                />
                <input
                  type="number" min={0} max={100}
                  value={editForm.avance}
                  onChange={e => setEditForm(p => ({ ...p, avance: +e.target.value }))}
                  style={{ width: 58, padding: '4px 6px', border: `1px solid ${T.faint2}`, borderRadius: 4, fontSize: 12, textAlign: 'center', fontFamily: T.fontMono }}
                />
                <span style={{ fontSize: 12, color: T.ink2 }}>%</span>
              </div>
              <Bar pct={editForm.avance} ok={editForm.avance === 100} style={{ marginTop: 4 }} />
            </div>
          )}
        </FormPanel>
      )}

      {detalle.fotos.length === 0 ? (
        <div style={{ color: T.ink3, padding: 40, textAlign: 'center' }}>Sin fotos. Agregá la primera.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
          {detalle.fotos.map(f => (
            <div key={f.id} style={{ position: 'relative' }}>
              <a href={f.url || undefined} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', display: 'block' }}>
                <div style={{ borderRadius: 6, aspectRatio: '4/3', overflow: 'hidden', border: `1.5px solid ${T.faint2}`, background: T.faint2, position: 'relative' }}>
                  {f.url ? (
                    <img src={f.url} alt={f.label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>📷</div>
                  )}
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.55)', color: 'white', padding: '4px 8px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.label}</div>
                    <div style={{ fontSize: 9, opacity: 0.8 }}>{fmtD(f.fecha)}{f.rubro ? ` · ${f.rubro}` : ''}</div>
                  </div>
                </div>
              </a>
              {/* Botones editar / eliminar */}
              <div style={{ position: 'absolute', top: 5, right: 5, display: 'flex', gap: 4 }}>
                <span
                  title="Editar"
                  style={{ background: 'rgba(0,0,0,0.6)', color: 'white', borderRadius: 3, fontSize: 10, padding: '2px 6px', cursor: 'pointer' }}
                  onClick={() => startEditFoto(f)}>✎</span>
                <span
                  title="Eliminar"
                  style={{ background: 'rgba(0,0,0,0.6)', color: 'white', borderRadius: 3, fontSize: 10, padding: '2px 6px', cursor: 'pointer' }}
                  onClick={() => del(f.id)}>✕</span>
              </div>
            </div>
          ))}
          <div style={{ background: T.faint, borderRadius: 6, aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.ink3, cursor: 'pointer', border: `1.5px dashed ${T.faint2}` }}
            onClick={() => setAdding(true)}>
            <div style={{ textAlign: 'center' }}><div style={{ fontSize: 24 }}>+</div><div style={{ fontSize: 11 }}>Foto</div></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TabArchivos — wrapper de Documentos + Fotos en una sola tab con sub-tabs
// internas. Antes eran dos tabs separadas (Documentos / Fotos); unificadas
// porque conceptualmente ambos son archivos adjuntos de la obra.
// ─────────────────────────────────────────────────────────────────────────────
function TabArchivos({ detalle, patch, obraId }) {
  const [sub, setSub] = useState('docs'); // 'docs' | 'fotos'
  const docsCount = (detalle.documentos || []).length;
  const fotosCount = (detalle.fotos || []).length;

  const tabSt = (active) => ({
    padding: '8px 16px',
    fontSize: 12,
    fontWeight: active ? 700 : 500,
    color: active ? T.accent : T.ink2,
    borderBottom: active ? `2px solid ${T.accent}` : '2px solid transparent',
    cursor: 'pointer',
    marginBottom: -1.5,
    transition: 'color .15s, border-bottom .15s',
  });

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: `1.5px solid ${T.faint2}`, gap: 4, marginBottom: 14 }}>
        <span onClick={() => setSub('docs')} style={tabSt(sub === 'docs')}>
          Documentos{docsCount > 0 ? ` · ${docsCount}` : ''}
        </span>
        <span onClick={() => setSub('fotos')} style={tabSt(sub === 'fotos')}>
          Fotos{fotosCount > 0 ? ` · ${fotosCount}` : ''}
        </span>
      </div>
      {sub === 'docs' && <TabDocumentos detalle={detalle} patch={patch} obraId={obraId} />}
      {sub === 'fotos' && <TabFotos detalle={detalle} patch={patch} obraId={obraId} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
// "Adicionales" eliminado como tab — su contenido vive ahora dentro de
// "Cuenta corriente" como acordeón. Documentos+Fotos unificados en "Archivos".
const TABS_DEF = ['Resumen', 'Cuenta corriente', 'Presupuesto', 'Materiales', 'Gantt', 'Movimientos', 'Contratos MO', 'Archivos', 'Portal cliente'];

export default function ObraPresupuesto() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { obras, getDetalle, patchDetalle, updateObra, setEstado } = useObras();
  const { clientes } = useClientes();
  const { currentUser, usuarios } = useUsuarios();
  const { addTarea } = useTareas();
  // catalog estaba SIN declarar en este componente y handleApprove lo usaba
  // (generarTareasObra) → las tareas estándar (rubro/tipo/APU) nunca se generaban.
  const { catalog } = useCatalog();
  // Para Pieza 2 (auto-aprobar al recibir dinero): cobrado de la obra.
  const { movimientos: allMovs, cajas: allCajasGlobal } = useMovimientos();
  const { dolarVenta } = useDolar();
  const isAdmin = currentUser?.rol === 'Admin';
  // Pestañas ocultas por rol (mapa único compartido — antes estaba duplicado y con drift).
  const rolHiddenTabs = isAdmin ? [] : (ROL_TABS_OCULTAS[currentUser?.rol] ?? ROL_TABS_OCULTAS_DEFAULT);
  const tabsOcultos = currentUser?.tabsOcultos ?? [];
  const allHiddenTabs = new Set([...tabsOcultos, ...rolHiddenTabs]);
  const [activeTab, setActiveTab] = useState(() => {
    const t = parseInt(searchParams.get('tab'), 10);
    return isNaN(t) ? 0 : t;
  });
  // Cuando la URL cambia desde afuera (breadcrumb que navega a la obra
  // sin ?tab), sincroniza activeTab. Idempotente: solo updatea si difiere.
  useEffect(() => {
    const t = parseInt(searchParams.get('tab'), 10);
    const next = isNaN(t) ? 0 : t;
    setActiveTab(prev => prev === next ? prev : next);
  }, [searchParams]);
  const [showExport, setShowExport] = useState(false);
  const [showClienteQR, setShowClienteQR] = useState(false);

  const obra = obras.find(o => o.id === id) ?? { id, nombre: id, cliente: '', moneda: 'ARS', presupuesto: 0, avance: 0 };
  const detalle = getDetalle(id);
  const patch = (fn) => patchDetalle(id, fn);
  const moneda = obra.moneda;

  // Acordeones de la tab Presupuesto: abiertos por default EXCEPTO cuando
  // ya están aprobados/cerrados (quedan minimizados como referencia, no se
  // pueden modificar). El user puede maximizarlos manualmente. Si los
  // aprueba en runtime, se minimizan solos.
  // NOTA: estos useState van DESPUES de declarar `detalle` — meterlos arriba
  // tira TDZ "Cannot access 'detalle' before initialization".
  // Override local "estoy editando" — prevale sobre el detalle aunque un
  // broadcast remoto traiga presupuestoAprobado=true. Sin esto, cuando el
  // user apretaba Editar, el broadcast inmediato pisaba el state y la
  // edición quedaba bloqueada de nuevo.
  const [forcedUnfrozenPresu, setForcedUnfrozenPresu] = useState(false);
  const [forcedUnfrozenPlan,  setForcedUnfrozenPlan]  = useState(false);
  const presupuestoFrozenReal = !!detalle.presupuestoAprobado && !forcedUnfrozenPresu;
  const planAprobado = !!detalle.financiacion?.propuestaConfirmada && !forcedUnfrozenPlan;
  // Acordeones de Presupuesto: state local que NO se re-sincroniza por
  // useEffect. Se controla solo por los handlers (handleApprove minimiza,
  // handleReopen maximiza). El useEffect sincronizador anterior generaba un
  // loop con el broadcast remoto.
  const [showComputo, setShowComputo] = useState(!detalle.presupuestoAprobado);
  const [showFinanciacion, setShowFinanciacion] = useState(!planAprobado);

  const { costo, venta, margen } = calcObra(detalle.rubros);
  const gastado = detalle.movimientos.filter(m => m.tipo === 'gasto').reduce((s, m) => s + m.monto, 0);

  // Labels con contador. Indices:
  // 0 Resumen · 1 Cuenta corriente · 2 Presupuesto · 3 Materiales · 4 Gantt
  // 5 Movimientos · 6 Contratos MO · 7 Archivos · 8 Portal cliente
  const tabLabels = TABS_DEF.map((t, i) => {
    if (i === 1 && (detalle.adicionales || []).length > 0) return `Cuenta corriente · ${detalle.adicionales.length} adic.`;
    if (i === 5) return `Movimientos${detalle.movimientos.length > 0 ? ' · ' + detalle.movimientos.length : ''}`;
    if (i === 6) return `Contratos MO${detalle.contratos.length > 0 ? ' · ' + detalle.contratos.length : ''}`;
    if (i === 7) {
      const total = (detalle.documentos || []).length + (detalle.fotos || []).length;
      return total > 0 ? `Archivos · ${total}` : 'Archivos';
    }
    return t;
  });

  // Filter to visible tab indices; if current tab is hidden, fall back to first visible
  const visibleTabIndices = TABS_DEF.reduce((acc, t, i) => { if (!allHiddenTabs.has(t)) acc.push(i); return acc; }, []);
  const displayTab = visibleTabIndices.includes(activeTab) ? activeTab : (visibleTabIndices[0] ?? 0);

  const handleTab = (i) => {
    if (TABS_DEF[i] === 'Gantt') { navigate(`/obras/${id}/gantt`); return; }
    if (TABS_DEF[i] === 'Portal cliente') { window.open(`/portal/cliente/${id}`, '_blank'); return; }
    setActiveTab(i);
  };

  const estadoColor = { activa: T.ok, 'en-presupuesto': T.ink2, pausada: T.warn, finalizada: T.accent, archivada: T.ink3 };

  const aprobarPresupuesto = ({ silent = false } = {}) => {
    const hoy = new Date().toISOString().split('T')[0];
    // Generar tareas automáticas: tareasBase del tipo de obra + tareasEstandar
    // de cada rubro + tareasEstandar de cada APU del presupuesto. Idempotente
    // vía detalle.tareasGeneradas.
    const detalleConFecha = { ...detalle, fechaAprobacion: hoy };
    const { tareasNuevas, rubrosAplicados, tipoAplicado, apusAplicados } = generarTareasObra({
      obra, detalle: detalleConFecha, catalog, usuarios,
      generadoPor: currentUser?.id,
    });
    patch(d => ({
      ...d,
      presupuestoAprobado: true,
      fechaAprobacion: hoy,
      tareasGeneradas: { tipoIdAplicado: tipoAplicado, rubrosAplicados, apusAplicados },
    }));
    tareasNuevas.forEach(payload => addTarea(payload));
    if (obra.estado === 'en-presupuesto') updateObra(obra.id, { estado: 'activa' });
    setForcedUnfrozenPresu(false);
    setShowComputo(false);
    if (!silent) {
      handleTab(2);
      if (tareasNuevas.length > 0) {
        setTimeout(() => alert(`Presupuesto aprobado.\nSe generaron ${tareasNuevas.length} tarea${tareasNuevas.length === 1 ? '' : 's'} automática${tareasNuevas.length === 1 ? '' : 's'} en /tareas.`), 100);
      }
    } else {
      window.dispatchEvent(new CustomEvent('kamak:toast', { detail: { type: 'ok', msg: `Presupuesto aprobado automáticamente al recibir un pago${tareasNuevas.length ? ` · ${tareasNuevas.length} tarea${tareasNuevas.length === 1 ? '' : 's'} generada${tareasNuevas.length === 1 ? '' : 's'}` : ''}.` } }));
    }
  };

  const handleApprove = () => {
    if (!confirm('¿Aprobar y congelar el presupuesto?\n\nUna vez aprobado no podrás modificar rubros ni tareas.\nLos cambios futuros van en Cuenta corriente → Adicionales.')) return;
    aprobarPresupuesto({ silent: false });
  };

  // PIEZA 2 — auto-aprobar al recibir dinero: si la obra ya tiene cobros y el
  // presupuesto no está aprobado (y tiene rubros), se aprueba solo y dispara las
  // tareas. Reversible con "Reabrir". Ref para no re-disparar en el mismo montaje.
  const autoAprobRef = useRef(false);
  useEffect(() => {
    // Esperamos a que el catálogo esté cargado: si auto-aprobamos con el catálogo
    // vacío, generarTareasObra no genera NINGUNA tarea y autoAprobRef bloquea el
    // reintento → el cobro quedaría sin disparar tareas para siempre.
    if (autoAprobRef.current || detalle.presupuestoAprobado || !(detalle.rubros || []).length || !(catalog?.tareas || []).length) return;
    const cobrado = cobradoObraUSD(allMovs, allCajasGlobal, obra.id, dolarVenta || 1070);
    if (cobrado > 0) {
      autoAprobRef.current = true;
      aprobarPresupuesto({ silent: true });
    }
  }, [allMovs, allCajasGlobal, dolarVenta, detalle.presupuestoAprobado, detalle.rubros, obra.id, catalog]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReopen = () => {
    if (!confirm('¿Reabrir el presupuesto para editar?\n\nEl plan de pagos también se va a reabrir para que ajustes los montos a los nuevos totales.')) return;
    // Override local primero — para que ni un broadcast remoto pueda volver
    // a bloquear la edicion mientras el user está corrigiendo.
    setForcedUnfrozenPresu(true);
    setForcedUnfrozenPlan(true);
    patch(d => ({
      ...d,
      presupuestoAprobado: false,
      financiacion: { ...(d.financiacion || {}), propuestaConfirmada: false, propuestaEnviada: false },
    }));
    setShowComputo(true);
    setShowFinanciacion(true);
  };

  return (
    <PageLayout breadcrumb={[
      { label: 'Obras', to: '/obras' },
      { label: obra.nombre, to: `/obras/${obra.id}/presupuesto` },
      tabLabels[displayTab],
    ]} active="Obras">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="k-h" style={{ fontSize: 26 }}>{obra.nombre}</div>
            {obra.estado && <Chip ok={obra.estado === 'activa'} warn={obra.estado === 'pausada'} style={{ fontSize: 10 }}>{obra.estado}</Chip>}
          </div>
          <div style={{ fontSize: 12, color: T.ink2, marginTop: 2 }}>
            {obra.cliente && <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate(`/clientes?q=${encodeURIComponent(obra.cliente)}`)}>{obra.cliente}</span>}{obra.cliente && <span> · </span>}
            <span>{obra.tipo || 'Obra'}{isAdmin ? ` · ${moneda}` : ''}</span>
            {obra.fechaFinEstim && <span> · entrega est. {fmtD(obra.fechaFinEstim)}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn sm onClick={() => navigate('/obras')}>← Obras</Btn>
          <Btn sm onClick={() => setShowClienteQR(true)}>📲 QR cliente</Btn>
          {isAdmin && obra.estado === 'activa' && (
            <Btn sm fill onClick={() => { if (window.confirm(`¿Finalizar la obra "${obra.nombre}"?`)) setEstado(obra.id, 'finalizada'); }}>✓ Finalizar obra</Btn>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="k-tabs" style={{ marginBottom: 10, overflowX: 'auto' }}>
        {tabLabels.map((tab, i) => {
          if (!visibleTabIndices.includes(i)) return null;
          return (
            <span key={i} className={`k-tab${displayTab === i && TABS_DEF[i] !== 'Gantt' && TABS_DEF[i] !== 'Portal cliente' ? ' k-tab-on' : ''}`}
              style={{ whiteSpace: 'nowrap' }} onClick={() => handleTab(i)}>{tab}</span>
          );
        })}
      </div>

      {/* Content. Indices nuevos despues de insertar "Cuenta corriente" en
          posicion 1 y eliminar "Adicionales":
          0 Resumen · 1 Cuenta corriente · 2 Presupuesto · 3 Materiales
          4 Gantt (redirect) · 5 Movimientos · 6 Contratos MO · 7 Docs
          8 Fotos · 9 Portal cliente (redirect). */}
      {displayTab === 0 && (
        <TabResumen obra={obra} detalle={detalle} moneda={moneda} onChangeTab={handleTab} />
      )}
      {displayTab === 1 && (
        <TabCuentaCorriente obra={obra} detalle={detalle} patch={patch} moneda={moneda} onExport={() => setShowExport(true)} />
      )}
      {displayTab === 2 && (
        <>
          {/* Acordeón "Cómputo y presupuesto" — la edición del cómputo + tareas
              + rubros. Default: abierto, salvo presupuesto aprobado. */}
          <div
            onClick={() => setShowComputo(v => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 0',
              cursor: 'pointer',
              userSelect: 'none',
              borderTop: `1.5px solid ${T.faint2}`,
              borderBottom: showComputo ? `1.5px solid ${T.faint2}` : 'none',
              marginBottom: showComputo ? 14 : 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, background: T.accent, transform: 'rotate(45deg)', flexShrink: 0 }} />
              <span className="k-h" style={{ fontSize: 14, lineHeight: 1.1, color: T.ink }}>Cómputo y presupuesto</span>
            </div>
            <span style={{ fontSize: 10.5, color: T.ink3, fontWeight: 600, fontFamily: `'JetBrains Mono', monospace`, letterSpacing: 0.5 }}>
              {showComputo ? '▲ Cerrar' : '▼ Ver'}
            </span>
          </div>
          {showComputo && (
            <TabPresupuesto obra={obra} detalle={detalle} patch={patch} moneda={moneda} frozen={presupuestoFrozenReal} onApprove={handleApprove} onReopen={handleReopen} onExport={() => setShowExport(true)} />
          )}

          {/* Acordeón "Plan de pagos y cuotas" — armar el plan con intereses
              y cuotas. La cobranza (cuotas pagadas) se ve en Cuenta corriente
              → Estado de cuenta, no acá. */}
          <div style={{ marginTop: 20 }}>
            <div
              onClick={() => setShowFinanciacion(v => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 0',
                cursor: 'pointer',
                userSelect: 'none',
                borderTop: `1.5px solid ${T.faint2}`,
                borderBottom: showFinanciacion ? `1.5px solid ${T.faint2}` : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, background: T.accent, transform: 'rotate(45deg)', flexShrink: 0 }} />
                <span className="k-h" style={{ fontSize: 14, lineHeight: 1.1, color: T.ink }}>Plan de pagos y cuotas</span>
              </div>
              <span style={{ fontSize: 10.5, color: T.ink3, fontWeight: 600, fontFamily: `'JetBrains Mono', monospace`, letterSpacing: 0.5 }}>
                {showFinanciacion ? '▲ Cerrar' : '▼ Ver'}
              </span>
            </div>
            {showFinanciacion && (
              <div style={{ paddingTop: 14 }}>
                <TabFinanciacion obra={obra} detalle={detalle} patch={patch} moneda="USD" onExport={() => setShowExport(true)} />
              </div>
            )}
          </div>
        </>
      )}
      {displayTab === 3 && <TabMateriales detalle={detalle} obra={obra} />}
      {displayTab === 5 && <TabMovimientos obra={obra} moneda={moneda} />}
      {displayTab === 6 && <TabContratosMO detalle={detalle} patch={patch} moneda={moneda} obra={obra} />}
      {displayTab === 7 && <TabArchivos detalle={detalle} patch={patch} obraId={id} />}

      {showExport && <ExportModal onClose={() => setShowExport(false)} obra={obra} detalle={detalle} />}

      {showClienteQR && (
        <ClienteAccesoModal
          obra={obra}
          cliente={
            // Resolver el cliente: primero por clienteId (FK), despues por
            // nombre (legacy), y si no, fallback con el texto de obra.cliente
            // para no romper el modal.
            (obra.clienteId && clientes.find(c => c.id === obra.clienteId)) ||
            clientes.find(c => (c.nombre || '').toLowerCase().trim() === (obra.cliente || '').toLowerCase().trim()) ||
            { nombre: obra.cliente }
          }
          onClose={() => setShowClienteQR(false)}
        />
      )}

    </PageLayout>
  );
}
