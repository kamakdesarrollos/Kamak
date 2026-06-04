import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn, Chip, Bar, Label } from '../components/ui';
import PageHero from '../components/ui/PageHero';
import { T } from '../theme';
import { useObras, EMPTY_DETALLE } from '../store/ObrasContext';
import NuevaObraModal from './modales/NuevaObraModal';
import { useUsuarios } from '../store/UsuariosContext';
import { useMovimientos } from '../store/MovimientosContext';
import { useDolar } from '../store/DolarContext';
import { calcObra, calcTotalClienteUSD, cobradoObraUSD } from './obra/helpers';

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n, moneda) => {
  if (!n) return moneda === 'USD' ? 'U$S 0' : '$ 0';
  const s = n.toLocaleString('es-AR');
  return moneda === 'USD' ? `U$S ${s}` : `$ ${s}`;
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
};

const margenColor = (m) => m < 0 ? T.accent : m < 20 ? T.warn : T.ok;

// ── Calcula stats reales desde el detalle + movs globales ────────────────────
// Item 3.8: ahora 'gastado' viene de MovimientosContext (la fuente unica de
// movimientos en runtime), no de detalle.movimientos (que es solo semilla).
function computeStats(obra, detalle, movimientos) {
  const rubros = detalle.rubros || [];

  // Usar calcObra (la MISMA funcion que el interior de la obra) para que
  // los numeros de la tarjeta coincidan exactamente con lo que el usuario
  // ve al entrar a la obra: venta, costo, margen teorico del presupuesto.
  // Antes habia un calculo duplicado aca que daba diferencias por:
  // - obra.presupuesto manual sobreescribia el calculado,
  // - margen se calculaba como (presupuesto - gastado)/presupuesto en vez
  //   de (venta - costo)/venta como el interior.
  const { costo, venta, margen } = calcObra(rubros);

  // Gastado: suma de movimientos tipo "gasto" con obraId. Identico al
  // calculo del header de ObraPresupuesto.
  const gastado = (movimientos || [])
    .filter(m => m.tipo === 'gasto' && m.obraId === obra.id)
    .reduce((s, m) => s + (m.monto || 0), 0);

  // Avance: promedio simple de avance de tareas (mismo criterio que usa
  // el interior cuando no hay un avance manual cargado en la obra).
  const todasTareas = rubros.flatMap(r => r.tareas || []);
  const avance = todasTareas.length > 0
    ? Math.round(todasTareas.reduce((s, t) => s + (t.avance || 0), 0) / todasTareas.length)
    : (obra.avance || 0);

  // "presupuesto" se mantiene como alias de venta para no romper consumers
  // (CardActiva, CardFinalizada). Es lo mismo que ve el usuario en el
  // interior como "venta total al cliente".
  return { presupuesto: venta, venta, costo, gastado, avance, margen };
}

// Estado de la CUENTA CORRIENTE del cliente (en USD), mismo criterio que la tab
// Cuenta corriente. Sirve para clasificar una obra finalizada en "con saldo" o
// "saldada" automáticamente. Para obras de arrastre el total sale de
// precioVentaUSD y lo cobrado de los montoDolar (independiente del dólar).
function ccObra(obra, detalle, movimientos, cajas, tc) {
  const { venta: ventaBaseARS } = calcObra(detalle.rubros || []);
  const adicionalARS = (detalle.adicionales || [])
    .filter(a => a.estado === 'aprobado' && a.aplicaACliente !== false)
    .reduce((s, a) => s + (a.valorVentaTotal ?? a.costoTotal ?? a.monto ?? 0), 0);
  const interes = parseFloat((detalle.financiacion || {}).interes) || 0;
  const totalUSD   = Math.round(calcTotalClienteUSD(detalle, ventaBaseARS, adicionalARS, interes, tc));
  const cobradoUSD = Math.round(cobradoObraUSD(movimientos, cajas, obra.id, tc));
  const saldoUSD   = Math.max(0, totalUSD - cobradoUSD);
  return { totalUSD, cobradoUSD, saldoUSD, saldada: saldoUSD <= 1 };
}

// ── Menu contextual de una obra ───────────────────────────────────────────────
function ObraMenu({ obra, onTransicion, onEditar, onEliminar }) {
  const [open, setOpen] = useState(false);

  const ACCIONES = {
    'en-presupuesto': [
      { label: 'Iniciar obra →',  next: 'activa',     icon: '▶' },
      { label: 'Editar',          fn: 'editar',        icon: '✎' },
      { label: 'Eliminar',        fn: 'eliminar',      icon: '🗑', danger: true },
    ],
    activa: [
      { label: 'Marcar finalizada', next: 'finalizada', icon: '✓' },
      { label: 'Editar',          fn: 'editar',        icon: '✎' },
    ],
    finalizada: [
      { label: 'Archivar',        next: 'archivada',   icon: '📁' },
      { label: 'Editar',          fn: 'editar',        icon: '✎' },
    ],
    archivada: [
      { label: 'Desarchivar',     next: 'en-presupuesto', icon: '↩' },
      { label: 'Eliminar',        fn: 'eliminar',      icon: '🗑', danger: true },
    ],
  };

  const acciones = ACCIONES[obra.estado] || [];

  return (
    <div style={{ position: 'relative' }}>
      <span
        style={{ cursor: 'pointer', fontSize: 18, padding: '2px 6px', borderRadius: 3, userSelect: 'none', color: T.ink2 }}
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
      >⋮</span>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', top: 24, right: 0, zIndex: 100,
            background: T.paper, border: `1.5px solid ${T.ink}`,
            borderRadius: 5, boxShadow: '2px 4px 12px rgba(0,0,0,0.14)',
            minWidth: 180, overflow: 'hidden',
          }}>
            {acciones.map((a, i) => (
              <div key={i}
                style={{
                  padding: '8px 14px', fontSize: 13, cursor: 'pointer',
                  color: a.danger ? T.accent : T.ink,
                  borderBottom: i < acciones.length - 1 ? `1px solid ${T.faint2}` : 'none',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
                onMouseEnter={e => e.currentTarget.style.background = T.faint}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                onClick={e => {
                  e.stopPropagation();
                  setOpen(false);
                  if (a.fn === 'editar') onEditar();
                  else if (a.fn === 'eliminar') onEliminar();
                  else onTransicion(a.next);
                }}
              >
                <span>{a.icon}</span>{a.label}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Card: obra activa ─────────────────────────────────────────────────────────
function CardActiva({ obra, stats, onClick, onTransicion, onEditar, onEliminar, isAdmin = true }) {
  const [hover, setHover] = useState(false);
  const navigate = useNavigate();
  const { presupuesto, gastado, avance, margen } = stats;
  const sobrec = margen < 0;
  const alertCerrar = avance >= 85;
  const pctGastado = presupuesto > 0 ? Math.min(Math.round(gastado / presupuesto * 100), 100) : 0;

  return (
    <Box
      style={{ padding: 13, cursor: 'pointer', transition: 'box-shadow 0.15s', boxShadow: hover ? '4px 4px 0 rgba(0,0,0,0.1)' : 'none', position: 'relative' }}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="k-h" style={{ fontSize: 19, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{obra.nombre}</div>
          <div style={{ fontSize: 12, color: T.ink2, marginTop: 1 }}>
            {obra.cliente
              ? <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={e => { e.stopPropagation(); navigate(`/clientes?q=${encodeURIComponent(obra.cliente)}`); }}>
                  {obra.cliente}
                </span>
              : '—'
            }
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8, flexShrink: 0 }}>
          {sobrec && <Chip accent style={{ fontSize: 9 }}>sobrecosto</Chip>}
          {alertCerrar && !sobrec && <Chip warn style={{ fontSize: 9 }}>⚡ cierre</Chip>}
          <div
            style={{ width: 34, height: 34, borderRadius: 50, background: margenColor(margen), color: '#fff', fontFamily: T.fontMono, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}
          >{avance}%</div>
          <div onClick={e => e.stopPropagation()}>
            <ObraMenu obra={obra} onTransicion={onTransicion} onEditar={onEditar} onEliminar={onEliminar} />
          </div>
        </div>
      </div>

      {/* Bloque KPIs (Presu / Gastado / Margen) — destacado en caja gris
          para que se lea de un vistazo. Antes habia una foto-placeholder
          arriba que no aportaba; ahora el espacio se usa para info real. */}
      {isAdmin && (
        <div style={{
          marginTop: 10,
          background: T.faint,
          borderRadius: 4,
          padding: '8px 10px',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 6,
        }}>
          <div>
            <div style={{ fontSize: 8.5, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 1.2, fontWeight: 700, textTransform: 'uppercase' }}>Presu</div>
            <div className="k-mono" style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginTop: 1 }}>{fmt(presupuesto, obra.moneda)}</div>
          </div>
          <div style={{ borderLeft: `1px solid ${T.faint2}`, paddingLeft: 8 }}>
            <div style={{ fontSize: 8.5, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 1.2, fontWeight: 700, textTransform: 'uppercase' }}>Gastado</div>
            <div className="k-mono" style={{ fontSize: 13, fontWeight: 700, color: sobrec ? T.accent : T.ink, marginTop: 1 }}>{fmt(gastado, obra.moneda)}</div>
          </div>
          <div style={{ borderLeft: `1px solid ${T.faint2}`, paddingLeft: 8 }}>
            <div style={{ fontSize: 8.5, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 1.2, fontWeight: 700, textTransform: 'uppercase' }}>Margen</div>
            <div className="k-mono" style={{ fontSize: 13, fontWeight: 800, color: margenColor(margen), marginTop: 1 }}>{margen}%</div>
          </div>
        </div>
      )}

      {/* Barras de progreso */}
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.ink2, marginBottom: 3 }}>
          <span>Avance tareas</span><span className="k-mono">{avance}%</span>
        </div>
        <Bar pct={avance} ok={avance === 100} warn={alertCerrar && !sobrec} accent={sobrec} />
      </div>

      {isAdmin && presupuesto > 0 && (
        <div style={{ marginTop: 7 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.ink2, marginBottom: 3 }}>
            <span>Gasto vs presu</span>
            <span className="k-mono" style={{ color: sobrec ? T.accent : T.ink2 }}>{pctGastado}%</span>
          </div>
          <div style={{ height: 5, background: T.faint2, borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pctGastado}%`, background: sobrec ? T.accent : T.warn, borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
        </div>
      )}

      {/* Footer: tipo · moneda · fecha estim */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTop: `1px dashed ${T.faint2}`, fontSize: 10.5, color: T.ink2 }}>
        {isAdmin ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 9, background: T.faint2, padding: '1.5px 6px', borderRadius: 3, fontWeight: 600 }}>{obra.tipo}</span>
            <span style={{ fontFamily: T.fontMono, fontSize: 9.5 }}>{obra.moneda}</span>
          </span>
        ) : <span />}
        <span style={{ fontFamily: T.fontMono, fontSize: 9.5 }}>fin est. {fmtDate(obra.fechaFinEstim)}</span>
      </div>

      {/* Finalizar obra: pasa la obra a "Finalizada". El saldo (con/sin deuda) lo
          calcula sola la pestaña Finalizadas desde la cuenta corriente. */}
      {isAdmin && (
        <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
          <Btn sm style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => { if (window.confirm(`¿Finalizar la obra "${obra.nombre}"?`)) onTransicion('finalizada'); }}>
            ✓ Finalizar obra
          </Btn>
        </div>
      )}
    </Box>
  );
}

// ── Card: en presupuesto ──────────────────────────────────────────────────────
function CardPresupuesto({ obra, onClick, onTransicion, onEditar, onEliminar }) {
  const navigate = useNavigate();
  return (
    <Box style={{ padding: 13, borderStyle: 'dashed', cursor: 'pointer', position: 'relative' }} onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="k-h" style={{ fontSize: 19 }}>{obra.nombre}</div>
          <div style={{ fontSize: 12, color: T.ink2 }}>
            {obra.cliente
              ? <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={e => { e.stopPropagation(); navigate(`/clientes?q=${encodeURIComponent(obra.cliente)}`); }}>
                  {obra.cliente}
                </span>
              : '—'
            }
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
          <Chip style={{ fontSize: 9 }}>borrador</Chip>
          <ObraMenu obra={obra} onTransicion={onTransicion} onEditar={onEditar} onEliminar={onEliminar} />
        </div>
      </div>

      <div style={{ margin: '10px 0', background: T.faint, borderRadius: 4, padding: '8px 10px', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: T.ink2 }}>Tipo</span><span>{obra.tipo}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: T.ink2 }}>Presu est.</span>
          <span className="k-mono" style={{ fontWeight: 700 }}>{fmt(obra.presupuesto, obra.moneda)}</span>
        </div>
        {obra.fechaFinEstim && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: T.ink2 }}>Entrega est.</span><span>{fmtDate(obra.fechaFinEstim)}</span>
          </div>
        )}
        {obra.notas && (
          <div style={{ color: T.ink3, fontSize: 11, fontStyle: 'italic', marginTop: 2 }}>"{obra.notas}"</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
        <Btn sm style={{ flex: 1, justifyContent: 'center' }} onClick={onClick}>Ver presupuesto</Btn>
        <Btn sm fill style={{ flex: 1, justifyContent: 'center' }}
          onClick={() => onTransicion('activa')}>Iniciar obra ▶</Btn>
      </div>
    </Box>
  );
}

// ── Card: pausada ─────────────────────────────────────────────────────────────
function CardPausada({ obra, stats, onClick, onTransicion, onEditar, onEliminar }) {
  const { presupuesto, gastado, avance, margen } = stats;
  const navigate = useNavigate();
  return (
    <Box style={{ padding: 13, position: 'relative', opacity: 0.9 }} onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="k-h" style={{ fontSize: 19, color: T.ink2 }}>{obra.nombre}</div>
          <div style={{ fontSize: 12, color: T.ink3 }}>
            {obra.cliente
              ? <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={e => { e.stopPropagation(); navigate(`/clientes?q=${encodeURIComponent(obra.cliente)}`); }}>
                  {obra.cliente}
                </span>
              : '—'
            }
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
          <Chip warn style={{ fontSize: 9 }}>⏸ pausada</Chip>
          <ObraMenu obra={obra} onTransicion={onTransicion} onEditar={onEditar} onEliminar={onEliminar} />
        </div>
      </div>

      {/* barra congelada */}
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
          <span style={{ color: T.ink2 }}>Avance al pausar</span>
          <span className="k-mono">{avance}%</span>
        </div>
        <Bar pct={avance} />
      </div>

      <div style={{ marginTop: 8, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
        <div><Label>Gastado</Label><div className="k-mono">{fmt(gastado, obra.moneda)}</div></div>
        <div><Label>Presup.</Label><div className="k-mono">{fmt(presupuesto, obra.moneda)}</div></div>
        <div><Label>Margen</Label><div className="k-mono" style={{ fontWeight: 700, color: margenColor(margen) }}>{margen}%</div></div>
      </div>

      {obra.notas && (
        <div style={{ marginTop: 8, fontSize: 11, color: T.ink2, background: '#fff7e6', borderRadius: 4, padding: '5px 8px', fontStyle: 'italic' }}>
          {obra.notas}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 10 }} onClick={e => e.stopPropagation()}>
        <Btn sm style={{ flex: 1, justifyContent: 'center' }} onClick={() => onTransicion('activa')}>▶ Reactivar</Btn>
        <Btn sm style={{ flex: 1, justifyContent: 'center' }} onClick={onClick}>Ver detalle</Btn>
      </div>
    </Box>
  );
}

// ── Card: finalizada — con estado de la cuenta corriente (Total/Cobrado/Saldo) ──
function CardFinalizada({ obra, cc, onClick, onTransicion, onEditar }) {
  const navigate = useNavigate();
  const fmtU = (n) => `U$S ${Math.round(n).toLocaleString('es-AR')}`;

  return (
    <Box style={{ padding: 13, cursor: 'pointer' }} onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="k-h" style={{ fontSize: 17, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{obra.nombre}</div>
          <div style={{ fontSize: 12, color: T.ink2 }}>
            {obra.cliente
              ? <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={e => { e.stopPropagation(); navigate(`/clientes?q=${encodeURIComponent(obra.cliente)}`); }}>
                  {obra.cliente}
                </span>
              : '—'
            }
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {cc.saldada
            ? <Chip ok style={{ fontSize: 9 }}>✓ Saldada</Chip>
            : <Chip warn style={{ fontSize: 9 }}>⏳ Debe {fmtU(cc.saldoUSD)}</Chip>}
          <ObraMenu obra={obra} onTransicion={onTransicion} onEditar={onEditar} onEliminar={() => {}} />
        </div>
      </div>

      <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 11 }}>
        <div style={{ background: T.faint, borderRadius: 4, padding: '6px 8px' }}>
          <div style={{ color: T.ink2 }}>Total</div>
          <div className="k-mono" style={{ fontWeight: 700, fontSize: 12 }}>{fmtU(cc.totalUSD)}</div>
        </div>
        <div style={{ background: T.faint, borderRadius: 4, padding: '6px 8px' }}>
          <div style={{ color: T.ink2 }}>Cobrado</div>
          <div className="k-mono" style={{ fontWeight: 700, fontSize: 12, color: T.ok }}>{fmtU(cc.cobradoUSD)}</div>
        </div>
        <div style={{ background: cc.saldada ? T.faint : '#fff3e0', borderRadius: 4, padding: '6px 8px' }}>
          <div style={{ color: T.ink2 }}>Saldo</div>
          <div className="k-mono" style={{ fontWeight: 700, fontSize: 12, color: cc.saldoUSD > 0 ? T.warn : T.ok }}>{fmtU(cc.saldoUSD)}</div>
        </div>
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: T.ink2, display: 'flex', justifyContent: 'space-between' }}>
        <span>Inicio: {fmtDate(obra.fechaInicio)}</span>
        <span>Cierre: {fmtDate(obra.fechaFin)}</span>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 10 }} onClick={e => e.stopPropagation()}>
        <Btn sm style={{ flex: 1, justifyContent: 'center' }} onClick={onClick}>Ver cuenta corriente</Btn>
        <Btn sm style={{ flex: 1, justifyContent: 'center' }} onClick={() => onTransicion('archivada')}>📁 Archivar</Btn>
      </div>
    </Box>
  );
}

// ── Fila: archivada (lista compacta) ─────────────────────────────────────────
function FilaArchivada({ obra, onClick, onTransicion, onEliminar }) {
  const navigate = useNavigate();
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${T.faint2}`, cursor: 'pointer', gap: 10 }}
      onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.background = T.faint}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{ flex: 1.5 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{obra.nombre}</div>
        <div style={{ fontSize: 11, color: T.ink2 }}>
          {obra.cliente
            ? <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
                onClick={e => { e.stopPropagation(); navigate(`/clientes?q=${encodeURIComponent(obra.cliente)}`); }}>
                {obra.cliente}
              </span>
            : '—'
          }
        </div>
      </div>
      <div style={{ flex: 1, fontSize: 11, color: T.ink2 }}>{obra.tipo}</div>
      <div style={{ flex: 1, fontFamily: T.fontMono, fontSize: 12 }}>{fmt(obra.presupuesto, obra.moneda)}</div>
      <div style={{ flex: 0.8, fontSize: 11, color: T.ink2 }}>
        {fmtDate(obra.fechaFin || obra.fechaFinEstim)}
      </div>
      <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
        <Btn sm onClick={() => onTransicion('en-presupuesto')}>↩ Desarchivar</Btn>
        <Btn sm style={{ color: T.accent, borderColor: T.accent }} onClick={onEliminar}>🗑</Btn>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function Obras() {
  const navigate = useNavigate();
  const { obras, detalles, addObra, updateObra, setEstado, deleteObra, byEstado } = useObras();
  const { movimientos, cajas } = useMovimientos();
  const { dolarVenta } = useDolar();
  const { currentUser } = useUsuarios();
  const isAdmin = currentUser?.rol === 'Admin';
  const tc = dolarVenta || 1070;

  const ov = currentUser?.obrasVisibles ?? '*';
  const puedeVer = (o) => ov === '*' || (Array.isArray(ov) && ov.includes(o.id));
  const canCreate = isAdmin || currentUser?.permisos?.crearObra === true;

  // Item 3.8: 'gastado' por obra ahora viene de los movs reales (no de la semilla).
  const getStats = (obra) => computeStats(obra, detalles[obra.id] || EMPTY_DETALLE, movimientos);
  const getCC = (obra) => ccObra(obra, detalles[obra.id] || EMPTY_DETALLE, movimientos, cajas, tc);

  const [searchParams] = useSearchParams();
  const [tabIdx, setTabIdx] = useState(0);
  const [showNueva, setShowNueva] = useState(false);
  const [editando, setEditando] = useState(null);
  const [busqueda, setBusqueda] = useState(() => searchParams.get('q') || '');

  // Sync busqueda from URL param (e.g. navigating from Clientes)
  useEffect(() => {
    const q = searchParams.get('q');
    if (q) setBusqueda(q);
  }, [searchParams]);

  const activas      = byEstado('activa').filter(puedeVer);
  const enPresu      = byEstado('en-presupuesto').filter(puedeVer);
  const finalizadas  = byEstado('finalizada').filter(puedeVer);
  const archivadas   = byEstado('archivada').filter(puedeVer);

  // 2 tipos de finalizadas, calculado solo desde la cuenta corriente (saldo).
  const finConSaldo = finalizadas.filter(o => !getCC(o).saldada);
  const finSaldadas = finalizadas.filter(o => getCC(o).saldada);

  const TABS = [
    { label: 'Activas',        count: activas.length },
    { label: 'En presupuesto', count: enPresu.length },
    { label: 'Finalizadas',    count: finalizadas.length },
    { label: 'Archivadas',     count: archivadas.length },
  ];
  const visibleTabs = isAdmin ? TABS : TABS.slice(0, 1); // non-admin: only "Activas"

  // Filtro de búsqueda sobre la lista activa
  const filtrar = (lista) => {
    if (!busqueda.trim()) return lista;
    const q = busqueda.toLowerCase();
    return lista.filter(o =>
      (o.nombre  || '').toLowerCase().includes(q) ||
      (o.cliente || '').toLowerCase().includes(q) ||
      (o.tipo    || '').toLowerCase().includes(q)
    );
  };

  const goObra = (o) => navigate(`/obras/${o.id}/presupuesto`);

  const handleTransicion = (id, nuevoEstado) => {
    setEstado(id, nuevoEstado);
    // Si la obra activa se pasa a 'activa' y estábamos en pestaña en-presupuesto → saltar a activas
    if (nuevoEstado === 'activa' && tabIdx === 1) setTabIdx(0);
    if (nuevoEstado === 'finalizada') setTabIdx(2);
    if (nuevoEstado === 'archivada') setTabIdx(3);
  };

  const handleEliminar = (id) => {
    // IR-01 (parcial): el borrado NO cascadea movimientos/CC (la plata ya se
    // movió en su caja; borrarlos alteraría saldos — es decisión de negocio).
    // Pero avisamos qué queda asociado para que no sea un orfanato silencioso.
    const movs = movimientos.filter(m => m.obraId === id).length;
    const aviso = movs > 0
      ? `Esta obra tiene ${movs} movimiento(s) de caja asociados. Si la eliminás, esos movimientos NO se borran (siguen impactando sus cajas) pero quedan sin obra. ¿Eliminar igual?`
      : '¿Eliminar esta obra? Esta acción no se puede deshacer.';
    if (window.confirm(aviso)) deleteObra(id);
  };

  const handleSaveNueva = (datos) => {
    addObra(datos);
    setTabIdx(1); // ir a "En presupuesto"
  };

  const handleSaveEdit = (datos) => {
    updateObra(editando.id, datos);
    setEditando(null);
  };

  return (
    <PageLayout breadcrumb={[{ label: 'Inicio', to: '/' }, 'Obras']} active="Obras">
      <PageHero
        label="GESTIÓN DE OBRAS"
        title="Obras"
        subtitle={`${activas.length + enPresu.length} obras en curso`}
        actions={
          <>
            <input
              value={busqueda} onChange={e => setBusqueda(e.target.value)}
              placeholder="⌕ Buscar obra o cliente…"
              style={{ padding: '5px 10px', border: `1.2px solid #3a3a3e`, borderRadius: 4, fontSize: 12, fontFamily: T.font, width: 200, outline: 'none', background: 'rgba(255,255,255,0.06)', color: '#fff' }}
            />
            {canCreate && <Btn sm fill onClick={() => setShowNueva(true)}>+ Nueva obra</Btn>}
          </>
        }
        kpis={(isAdmin
          ? [
              { label: 'Activas',        value: activas.length,     color: T.ok,    onClick: () => setTabIdx(0), active: tabIdx === 0 },
              { label: 'En presupuesto', value: enPresu.length,     color: T.accent, onClick: () => setTabIdx(1), active: tabIdx === 1 },
              { label: 'Finalizadas',    value: finalizadas.length, color: T.ink,    onClick: () => setTabIdx(2), active: tabIdx === 2 },
              { label: 'Archivadas',     value: archivadas.length,  color: T.ink3,   onClick: () => setTabIdx(3), active: tabIdx === 3 },
            ]
          : [
              { label: 'Activas', value: activas.length, color: T.ok, active: true },
            ]
        )}
      />

      {/* Tabs separados eliminados: ahora los KPIs del banner funcionan
          como filtros clickeables. El KPI activo se ve resaltado. */}
      <div style={{ marginBottom: 14 }} />

      {/* ── TAB 0: Activas ── */}
      {tabIdx === 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {filtrar(activas).map(o => (
            <CardActiva key={o.id} obra={o} stats={getStats(o)}
              onClick={() => goObra(o)}
              onTransicion={(est) => handleTransicion(o.id, est)}
              onEditar={() => setEditando(o)}
              onEliminar={() => handleEliminar(o.id)}
              isAdmin={isAdmin}
            />
          ))}
          {!busqueda && canCreate && (
            <Box dashed style={{ padding: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 180, color: T.ink3, fontSize: 14, cursor: 'pointer' }}
              onClick={() => setShowNueva(true)}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 30 }}>+</div>
                <div>Nueva obra</div>
              </div>
            </Box>
          )}
          {filtrar(activas).length === 0 && busqueda && (
            <div style={{ gridColumn: '1/-1', color: T.ink3, padding: 24 }}>Sin resultados para "{busqueda}"</div>
          )}
        </div>
      )}

      {/* ── TAB 1: En presupuesto ── */}
      {tabIdx === 1 && (
        <div>
          {filtrar(enPresu).length === 0 && !busqueda ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 260, color: T.ink3, gap: 12 }}>
              <div style={{ fontSize: 40 }}>📋</div>
              <div style={{ fontSize: 15 }}>No hay obras en presupuesto</div>
              {canCreate && <Btn sm fill onClick={() => setShowNueva(true)}>+ Nueva obra</Btn>}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {filtrar(enPresu).map(o => (
                <CardPresupuesto key={o.id} obra={o}
                  onClick={() => goObra(o)}
                  onTransicion={(est) => handleTransicion(o.id, est)}
                  onEditar={() => setEditando(o)}
                  onEliminar={() => handleEliminar(o.id)}
                />
              ))}
              {!busqueda && (
                <Box dashed style={{ padding: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 160, color: T.ink3, cursor: 'pointer' }}
                  onClick={() => setShowNueva(true)}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 28 }}>+</div>
                    <div>Nueva cotización</div>
                  </div>
                </Box>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: Finalizadas — 2 grupos según la cuenta corriente ── */}
      {tabIdx === 2 && (
        <div>
          {filtrar(finalizadas).length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 260, color: T.ink3, gap: 8 }}>
              <div style={{ fontSize: 40 }}>✅</div>
              <div style={{ fontSize: 15 }}>No hay obras finalizadas</div>
            </div>
          ) : (
            [
              { titulo: '⏳ Finalizadas con saldo pendiente', lista: filtrar(finConSaldo), color: T.warn },
              { titulo: '✓ Finalizadas y saldadas (cobradas 100%)', lista: filtrar(finSaldadas), color: T.ok },
            ].filter(s => s.lista.length > 0).map(s => (
              <div key={s.titulo} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: s.color, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
                  {s.titulo} <span style={{ color: T.ink3 }}>· {s.lista.length}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  {s.lista.map(o => (
                    <CardFinalizada key={o.id} obra={o} cc={getCC(o)}
                      onClick={() => goObra(o)}
                      onTransicion={(est) => handleTransicion(o.id, est)}
                      onEditar={() => setEditando(o)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── TAB 3: Archivadas ── */}
      {tabIdx === 3 && (
        <Box style={{ padding: 0, overflow: 'hidden' }}>
          {/* header tabla */}
          <div style={{ display: 'flex', padding: '7px 14px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}`, fontSize: 11, fontWeight: 700, color: T.ink2, gap: 10 }}>
            <span style={{ flex: 1.5 }}>Obra / Cliente</span>
            <span style={{ flex: 1 }}>Tipo</span>
            <span style={{ flex: 1 }}>Presupuesto</span>
            <span style={{ flex: 0.8 }}>Cierre</span>
            <span style={{ flex: 1.2 }}>Acciones</span>
          </div>
          {filtrar(archivadas).length === 0 ? (
            <div style={{ padding: 24, color: T.ink3, textAlign: 'center' }}>
              {busqueda ? `Sin resultados para "${busqueda}"` : 'No hay obras archivadas'}
            </div>
          ) : filtrar(archivadas).map(o => (
            <FilaArchivada key={o.id} obra={o}
              onClick={() => goObra(o)}
              onTransicion={(est) => handleTransicion(o.id, est)}
              onEliminar={() => handleEliminar(o.id)}
            />
          ))}
        </Box>
      )}

      {/* Modales */}
      {showNueva && (
        <NuevaObraModal onSave={handleSaveNueva} onClose={() => setShowNueva(false)} />
      )}
      {editando && (
        <NuevaObraModal obra={editando} onSave={handleSaveEdit} onClose={() => setEditando(null)} />
      )}
    </PageLayout>
  );
}
