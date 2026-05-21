import { useState, useMemo } from 'react';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn, Chip } from '../components/ui';
import { T } from '../theme';
import { useMovimientos } from '../store/MovimientosContext';
import { useDolar } from '../store/DolarContext';
import { useUsuarios } from '../store/UsuariosContext';
import TraspasoModal from './modales/TraspasoModal';

const inputSt = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };
const fmtN = (n) => Math.round(Math.abs(n)).toLocaleString('es-AR');

const TIPO_LABEL = { efectivo: 'Efectivo', banco: 'Banco', billetera: 'Billetera', obra: 'Caja de obra', rendicion: 'Rendición' };
const fmtFecha = (iso) => { if (!iso) return ''; const [, m, d] = iso.split('-'); return `${d}/${m}`; };

function CajaMovimientosModal({ caja, onClose }) {
  const { movimientos, cajas } = useMovimientos();
  const movs = useMemo(() =>
    movimientos.filter(m => m.cajaId === caja.id || m.cajaDestinoId === caja.id)
      .sort((a, b) => b.fecha.localeCompare(a.fecha)),
    [movimientos, caja.id]
  );
  const isUSD = caja.moneda === 'USD';
  const simbolo = isUSD ? 'USD' : '$';
  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, fontFamily: T.font }}>{caja.nombre}</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              {TIPO_LABEL[caja.tipo] || caja.tipo}{caja.propietario ? ` · ${caja.propietario}` : ''} · {caja.moneda}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, opacity: 0.6 }}>Saldo actual</div>
              <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 18, color: (caja.saldo || 0) < 0 ? '#ef4444' : T.accent }}>
                {simbolo} {fmtN(caja.saldo || 0)}
              </div>
            </div>
            <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
          </div>
        </div>
        <div style={{ overflow: 'auto', flex: 1 }}>
          {movs.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: T.ink3, fontSize: 13 }}>
              Sin movimientos registrados para esta caja
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 90px', padding: '6px 14px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}`, fontSize: 10, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                <span>Fecha</span>
                <span>Descripción</span>
                <span style={{ textAlign: 'right' }}>Importe</span>
              </div>
              {movs.map(m => {
                const isIngreso = m.tipo === 'ingreso';
                const isDestino = m.cajaDestinoId === caja.id;
                const color = (isIngreso || isDestino) ? T.ok : T.warn;
                const signo = (isIngreso || isDestino) ? '+' : '−';
                return (
                  <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 90px', padding: '9px 14px', borderBottom: `1px solid ${T.faint2}`, alignItems: 'center', fontSize: 12 }}>
                    <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ink3 }}>{fmtFecha(m.fecha)}</span>
                    <div>
                      <div style={{ fontWeight: 600 }}>{m.descripcion}</div>
                      <div style={{ fontSize: 10, color: T.ink3, marginTop: 1, display: 'flex', gap: 5 }}>
                        <span style={{ background: T.faint2, borderRadius: 2, padding: '0 4px' }}>{m.tipo}</span>
                        {m.obraNombre && m.obraNombre !== 'General' && <span>{m.obraNombre}</span>}
                        {m.proveedor && <span>· {m.proveedor}</span>}
                      </div>
                    </div>
                    <span style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 13, color, textAlign: 'right' }}>
                      {signo}{simbolo} {fmtN(m.monto)}
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </div>
        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, textAlign: 'right' }}>
          <Btn sm onClick={onClose}>Cerrar</Btn>
        </div>
      </div>
    </div>
  );
}

function NuevaCajaModal({ onClose }) {
  const { addCaja } = useMovimientos();
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState('efectivo');
  const [moneda, setMoneda] = useState('ARS');
  const [propietario, setPropietario] = useState('');
  const [saldoInicial, setSaldoInicial] = useState('');

  const confirmar = () => {
    if (!nombre.trim()) return;
    addCaja({
      nombre: nombre.trim(),
      tipo, moneda,
      propietario: propietario.trim(),
      color: T.ink2,
      saldo: parseFloat(saldoInicial) || 0,
    });
    onClose();
  };

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 380 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 17, fontFamily: T.font }}>Nueva caja</div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={labelSt}>Nombre</label>
            <input style={inputSt} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Caja Martínez" autoFocus />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={labelSt}>Tipo</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={tipo} onChange={e => setTipo(e.target.value)}>
                {Object.entries(TIPO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label style={labelSt}>Moneda</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={moneda} onChange={e => setMoneda(e.target.value)}>
                <option>ARS</option>
                <option>USD</option>
              </select>
            </div>
          </div>
          <div>
            <label style={labelSt}>Propietario / asignado a</label>
            <input style={inputSt} value={propietario} onChange={e => setPropietario(e.target.value)} placeholder="Opcional" />
          </div>
          <div>
            <label style={labelSt}>Saldo inicial</label>
            <input style={{ ...inputSt, fontFamily: T.fontMono, fontWeight: 700 }}
              type="number" min="0" placeholder="0" value={saldoInicial} onChange={e => setSaldoInicial(e.target.value)} />
          </div>
        </div>
        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill onClick={confirmar} style={{ opacity: nombre.trim() ? 1 : 0.5 }}>Crear caja</Btn>
        </div>
      </div>
    </div>
  );
}

function CajaCard({ caja, onTraspaso, onRemove, onClick }) {
  const isNeg = (caja.saldo || 0) < 0;
  const isLow = caja.tipo === 'obra' && (caja.saldo || 0) < 30000;
  return (
    <Box style={{ padding: 11, borderLeft: `3px solid ${caja.color || T.ink2}`, cursor: 'pointer' }} onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700 }}>{caja.nombre}</div>
          <div style={{ fontSize: 11, color: T.ink2 }}>{TIPO_LABEL[caja.tipo] || caja.tipo}{caja.propietario ? ` · ${caja.propietario}` : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {isLow && <Chip warn style={{ fontSize: 9 }}>⚠ bajo</Chip>}
          <span style={{ color: T.accent, cursor: 'pointer', fontSize: 13, opacity: 0.6 }}
            onClick={e => { e.stopPropagation(); onRemove(); }}>×</span>
        </div>
      </div>
      <div className="k-stat-sm" style={{ marginTop: 6, color: isNeg ? T.accent : T.ink }}>
        {caja.moneda === 'USD' ? 'U$S' : '$'} {fmtN(caja.saldo || 0)}
      </div>
      <div style={{ fontSize: 10, color: T.ink3, fontFamily: T.fontMono }}>{caja.moneda}</div>
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
        <Btn sm onClick={e => { e.stopPropagation(); onTraspaso(); }}>↔ Traspasar</Btn>
        <span style={{ fontSize: 10, color: T.ink3, alignSelf: 'center', marginLeft: 2 }}>Ver movimientos →</span>
      </div>
    </Box>
  );
}

export default function Cajas() {
  const { cajas, removeCaja } = useMovimientos();
  const { dolarVenta } = useDolar();
  const { currentUser } = useUsuarios();
  const [traspaso, setTraspaso] = useState(false);
  const [nuevaCaja, setNuevaCaja] = useState(false);
  const [cajaSel, setCajaSel] = useState(null);

  const cv = currentUser?.cajasVisibles ?? '*';
  const puedoVer = (c) => cv === '*' || (Array.isArray(cv) && cv.includes(c.id));

  const cajasActivas    = cajas.filter(c => c.activa && puedoVer(c));
  const cajasARS        = cajasActivas.filter(c => c.moneda === 'ARS' && c.tipo !== 'rendicion');
  const cajasUSD        = cajasActivas.filter(c => c.moneda === 'USD');
  const cajasRendicion  = cajasActivas.filter(c => c.tipo === 'rendicion');

  const totalARS       = cajasActivas.filter(c => c.moneda === 'ARS').reduce((s, c) => s + (c.saldo || 0), 0);
  const totalUSD       = cajasActivas.filter(c => c.moneda === 'USD').reduce((s, c) => s + (c.saldo || 0), 0);
  const totalUSDenARS  = totalUSD * dolarVenta;
  const equivTotalUSD  = (totalARS + totalUSDenARS) / dolarVenta;

  const handleRemove = (caja) => {
    if (confirm(`¿Eliminar la caja "${caja.nombre}"? Esta acción no revertirá los movimientos.`)) {
      removeCaja(caja.id);
    }
  };

  return (
    <PageLayout breadcrumb={['Cajas']} active="Cajas">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div className="k-h" style={{ fontSize: 28 }}>Cajas</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn sm onClick={() => setTraspaso(true)}>↔ Traspaso rápido</Btn>
          <Btn sm fill onClick={() => setNuevaCaja(true)}>+ Nueva caja</Btn>
        </div>
      </div>

      {/* Totales */}
      <div style={{ display: 'flex', gap: 0, background: '#f6efd9', borderRadius: 4, marginBottom: 14, overflow: 'hidden', border: `1px solid #e8d89a` }}>
        {[
          { label: 'Total ARS', value: `$ ${fmtN(totalARS)}` },
          { label: 'Total USD', value: `U$S ${fmtN(totalUSD)}` },
          { label: 'Equiv. total USD', value: `U$S ${fmtN(equivTotalUSD)}` },
          { label: 'Equiv. total ARS', value: `$ ${fmtN(totalARS + totalUSDenARS)}` },
        ].map((s, i) => (
          <div key={s.label} style={{ flex: 1, padding: '10px 14px', borderLeft: i ? `1px solid #e8d89a` : 'none' }}>
            <div style={{ fontSize: 9, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>{s.label}</div>
            <div style={{ fontWeight: 800, fontFamily: T.fontMono, fontSize: 15, color: T.ink }}>{s.value}</div>
          </div>
        ))}
        <div style={{ padding: '10px 14px', borderLeft: `1px solid #e8d89a`, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Chip style={{ fontSize: 9 }}>TC BNA · $ {fmtN(dolarVenta)}</Chip>
        </div>
      </div>

      {/* ARS */}
      {cajasARS.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <div className="k-h" style={{ fontSize: 18 }}>ARS</div>
            <Chip style={{ fontSize: 9 }}>{cajasARS.length} caja{cajasARS.length !== 1 ? 's' : ''}</Chip>
            <div className="k-divider" style={{ flex: 1, marginLeft: 8 }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, marginBottom: 16 }}>
            {cajasARS.map(c => (
              <CajaCard key={c.id} caja={c} onTraspaso={() => setTraspaso(true)} onRemove={() => handleRemove(c)} onClick={() => setCajaSel(c)} />
            ))}
          </div>
        </>
      )}

      {/* USD */}
      {cajasUSD.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <div className="k-h" style={{ fontSize: 18 }}>USD</div>
            <Chip style={{ fontSize: 9 }}>{cajasUSD.length} caja{cajasUSD.length !== 1 ? 's' : ''}</Chip>
            <div className="k-divider" style={{ flex: 1, marginLeft: 8 }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, marginBottom: 16 }}>
            {cajasUSD.map(c => (
              <CajaCard key={c.id} caja={c} onTraspaso={() => setTraspaso(true)} onRemove={() => handleRemove(c)} onClick={() => setCajaSel(c)} />
            ))}
          </div>
        </>
      )}

      {/* Rendición */}
      {cajasRendicion.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <div className="k-h" style={{ fontSize: 18 }}>Rendición de fondos</div>
            <Chip style={{ fontSize: 9 }}>{cajasRendicion.length} usuario{cajasRendicion.length !== 1 ? 's' : ''}</Chip>
            <div className="k-divider" style={{ flex: 1, marginLeft: 8 }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, marginBottom: 16 }}>
            {cajasRendicion.map(c => (
              <CajaCard key={c.id} caja={c} onTraspaso={() => setTraspaso(true)} onRemove={() => handleRemove(c)} onClick={() => setCajaSel(c)} />
            ))}
          </div>
          <div style={{ fontSize: 11, color: T.ink2, padding: '6px 10px', background: T.faint, borderRadius: 4, maxWidth: 420 }}>
            Rendición = caja asignada a un usuario con fondos adelantados. Saldo negativo indica que la empresa le debe al usuario.
          </div>
        </>
      )}

      {cajasActivas.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: T.ink3 }}>Sin cajas registradas. Creá la primera.</div>
      )}

      {traspaso && <TraspasoModal onClose={() => setTraspaso(false)} />}
      {nuevaCaja && <NuevaCajaModal onClose={() => setNuevaCaja(false)} />}
      {cajaSel && <CajaMovimientosModal caja={cajaSel} onClose={() => setCajaSel(null)} />}
    </PageLayout>
  );
}
