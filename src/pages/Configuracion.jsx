import { useState, useRef, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn, Label, Divider, Chip } from '../components/ui';
import PageHero from '../components/ui/PageHero';
import { T } from '../theme';
import { useConfiguracion } from '../store/ConfiguracionContext';
import { useDolar } from '../store/DolarContext';
import { useIndices } from '../store/IndicesContext';
import { useUsuarios } from '../store/UsuariosContext';
import { INDICES_TIPO, getIndiceTipo, redeterminar, valorIndice, variacionPct } from '../lib/indices';

const inputSt = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };
const fmtN = (n) => Math.round(n).toLocaleString('es-AR');

function FField({ label, value, onChange, type = 'text', readOnly = false }) {
  return (
    <div>
      <label style={labelSt}>{label}</label>
      <input style={{ ...inputSt, background: readOnly ? T.faint : T.paper, color: readOnly ? T.ink2 : T.ink }}
        type={type} value={value} readOnly={readOnly}
        onChange={onChange ? e => onChange(e.target.value) : undefined} />
    </div>
  );
}

function FSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label style={labelSt}>{label}</label>
      <select style={{ ...inputSt, cursor: 'pointer' }} value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <div style={{ width: 36, height: 20, borderRadius: 10, background: on ? T.ok : T.faint2, cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}
      onClick={() => onChange(!on)}>
      <div style={{ position: 'absolute', top: 3, left: on ? 18 : 3, width: 14, height: 14, borderRadius: 50, background: T.paper, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
    </div>
  );
}

function Row({ label, on, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${T.faint2}` }}>
      <span style={{ fontSize: 12 }}>{label}</span>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}

// ── Tipo de cambio ─────────────────────────────────────────────────────────────
function DolarSection() {
  const { dolarVenta, dolarCompra, updatedAt, loading, error, manual, setManual, setAutoMode, fetchBNA } = useDolar();
  const [manualInput, setManualInput] = useState(String(dolarVenta));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>Modo</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn sm style={{ background: manual ? T.faint : T.accent, color: manual ? T.ink : T.paper }} onClick={setAutoMode}>
            Auto (BNA)
          </Btn>
          <Btn sm style={{ background: !manual ? T.faint : T.dark, color: !manual ? T.ink : T.paper }} onClick={() => setManual(dolarVenta)}>
            Manual
          </Btn>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        <div>
          <label style={labelSt}>Dólar VENTA (ARS)</label>
          {manual ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={{ ...inputSt, fontFamily: T.fontMono, fontWeight: 800, fontSize: 14, color: T.accent }}
                type="number" min="1" value={manualInput}
                onChange={e => setManualInput(e.target.value)}
                onBlur={() => setManual(manualInput)}
                onKeyDown={e => e.key === 'Enter' && setManual(manualInput)} />
            </div>
          ) : (
            <div style={{ ...inputSt, fontFamily: T.fontMono, fontWeight: 800, fontSize: 14, color: T.accent, background: T.faint }}>
              $ {fmtN(dolarVenta)}
            </div>
          )}
        </div>
        <div>
          <label style={labelSt}>Dólar COMPRA (ARS)</label>
          <div style={{ ...inputSt, fontFamily: T.fontMono, fontSize: 13, color: T.ink2, background: T.faint }}>
            $ {fmtN(dolarCompra)}
          </div>
        </div>
      </div>

      {updatedAt && (
        <div style={{ fontSize: 10, color: T.ink3 }}>
          Actualizado: {new Date(updatedAt).toLocaleString('es-AR')} · Fuente: BNA vía dolarapi.com
        </div>
      )}
      {manual && <div style={{ fontSize: 10, color: T.warn, marginTop: 2 }}>Modo manual — no se actualiza automáticamente</div>}
      {error && <div style={{ fontSize: 10, color: T.accent, marginTop: 4 }}>{error}</div>}

      <Btn sm onClick={fetchBNA} style={{ marginTop: 8 }}>
        {loading ? 'Actualizando…' : '↻ Actualizar desde BNA'}
      </Btn>
    </div>
  );
}


// ── Medios de pago ────────────────────────────────────────────────────────────
function MediosDePago({ medios, onChange }) {
  const [nuevo, setNuevo] = useState('');
  const inputRef = useRef(null);

  const agregar = () => {
    const v = nuevo.trim();
    if (!v || medios.includes(v)) return;
    onChange([...medios, v]);
    setNuevo('');
    inputRef.current?.focus();
  };

  const quitar = (m) => onChange(medios.filter(x => x !== m));

  const mover = (i, dir) => {
    const arr = [...medios];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange(arr);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {medios.map((m, i) => (
          <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: T.faint, borderRadius: 4, border: `1px solid ${T.faint2}` }}>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{m}</span>
            <button onClick={() => mover(i, -1)} disabled={i === 0} style={{ border: 'none', background: 'none', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? T.faint2 : T.ink2, fontSize: 12, padding: '0 2px' }}>▲</button>
            <button onClick={() => mover(i, 1)} disabled={i === medios.length - 1} style={{ border: 'none', background: 'none', cursor: i === medios.length - 1 ? 'default' : 'pointer', color: i === medios.length - 1 ? T.faint2 : T.ink2, fontSize: 12, padding: '0 2px' }}>▼</button>
            <button onClick={() => quitar(m)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: T.accent, fontSize: 13, padding: '0 2px', lineHeight: 1 }}>✕</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input ref={inputRef} style={{ ...inputSt, flex: 1 }} placeholder="Nuevo medio…" value={nuevo}
          onChange={e => setNuevo(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && agregar()} />
        <Btn sm fill onClick={agregar}>+ Agregar</Btn>
      </div>
    </div>
  );
}

// ── Página ─────────────────────────────────────────────────────────────────────
// Carga manual de los índices CAC por mes + calculadora de redeterminación.
// El CAC publica el día 25 (camarco.org.ar); no hay API oficial, se carga a mano.
function IndicesCacSection() {
  const { indices, setMesIndice, removeMesIndice } = useIndices();
  const mesHoy = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
  const [mes, setMes] = useState(mesHoy);
  const [vals, setVals] = useState({ cacGeneral: '', cacMateriales: '', cacManoObra: '' });
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const s = indices[mes] || {};
    setVals({
      cacGeneral:    s.cacGeneral    != null ? String(s.cacGeneral)    : '',
      cacMateriales: s.cacMateriales != null ? String(s.cacMateriales) : '',
      cacManoObra:   s.cacManoObra   != null ? String(s.cacManoObra)   : '',
    });
  }, [mes, indices]);

  const guardar = () => {
    setMesIndice(mes, {
      cacGeneral:    Number(vals.cacGeneral)    || 0,
      cacMateriales: Number(vals.cacMateriales) || 0,
      cacManoObra:   Number(vals.cacManoObra)   || 0,
    });
    setOk(true); setTimeout(() => setOk(false), 1800);
  };

  const meses = Object.keys(indices).sort();
  // Calculadora de redeterminación.
  const [monto, setMonto] = useState('');
  const [base, setBase] = useState('');
  const [act, setAct] = useState('');
  const [tipo, setTipo] = useState('cacGeneral');
  useEffect(() => {
    if (meses.length && !base) setBase(meses[0]);
    if (meses.length && !act) setAct(meses[meses.length - 1]);
  }, [meses, base, act]);
  const redet = redeterminar(Number(monto) || 0, valorIndice(indices, base, tipo), valorIndice(indices, act, tipo));
  const varCalc = variacionPct(indices, base, act, tipo);

  const numInput = { ...inputSt, fontFamily: T.fontMono, textAlign: 'right' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, color: T.ink2 }}>
        Cargá el valor del índice CAC cada mes (lo publica la Cámara el día 25). Se usa para redeterminar
        montos: <i>monto × (índice actual / índice base)</i>.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ width: 130 }}>
          <label style={labelSt}>Mes</label>
          <input type="month" style={inputSt} value={mes} onChange={e => setMes(e.target.value)} />
        </div>
        <div style={{ flex: 1, minWidth: 80 }}>
          <label style={labelSt}>General</label>
          <input style={numInput} inputMode="decimal" value={vals.cacGeneral} onChange={e => setVals(v => ({ ...v, cacGeneral: e.target.value }))} placeholder="0" />
        </div>
        <div style={{ flex: 1, minWidth: 80 }}>
          <label style={labelSt}>Materiales</label>
          <input style={numInput} inputMode="decimal" value={vals.cacMateriales} onChange={e => setVals(v => ({ ...v, cacMateriales: e.target.value }))} placeholder="0" />
        </div>
        <div style={{ flex: 1, minWidth: 80 }}>
          <label style={labelSt}>Mano de obra</label>
          <input style={numInput} inputMode="decimal" value={vals.cacManoObra} onChange={e => setVals(v => ({ ...v, cacManoObra: e.target.value }))} placeholder="0" />
        </div>
        <Btn sm fill onClick={guardar}>{ok ? '✓' : 'Guardar mes'}</Btn>
      </div>

      {meses.length > 0 && (
        <div style={{ border: `1px solid ${T.faint2}`, borderRadius: 4, overflow: 'hidden' }}>
          {meses.map((mk, i) => {
            const v = variacionPct(indices, meses[i - 1], mk, 'cacGeneral');
            return (
              <div key={mk} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 10px', borderTop: i > 0 ? `1px solid ${T.faint2}` : 'none', fontSize: 11.5 }}>
                <span style={{ fontFamily: T.fontMono, fontWeight: 700 }}>{mk}</span>
                <span style={{ fontFamily: T.fontMono, color: T.ink2 }}>
                  G {fmtN(indices[mk].cacGeneral || 0)} · M {fmtN(indices[mk].cacMateriales || 0)} · MO {fmtN(indices[mk].cacManoObra || 0)}
                  {v != null && <b style={{ marginLeft: 6, color: v >= 0 ? T.warn : T.ok }}>{v >= 0 ? '+' : ''}{v}%</b>}
                </span>
                <span style={{ color: T.ink3, cursor: 'pointer', fontSize: 13 }} onClick={() => { if (window.confirm(`¿Borrar índices de ${mk}?`)) removeMesIndice(mk); }}>×</span>
              </div>
            );
          })}
        </div>
      )}

      <Divider style={{ margin: '4px 0' }} />
      <Label style={{ fontSize: 12 }}>Calculadora de redeterminación</Label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 100 }}>
          <label style={labelSt}>Monto base $</label>
          <input style={numInput} inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)} placeholder="0" />
        </div>
        <div style={{ width: 110 }}>
          <label style={labelSt}>Mes base</label>
          <select style={{ ...inputSt, cursor: 'pointer' }} value={base} onChange={e => setBase(e.target.value)}>
            {meses.map(mk => <option key={mk}>{mk}</option>)}
          </select>
        </div>
        <div style={{ width: 110 }}>
          <label style={labelSt}>Mes actual</label>
          <select style={{ ...inputSt, cursor: 'pointer' }} value={act} onChange={e => setAct(e.target.value)}>
            {meses.map(mk => <option key={mk}>{mk}</option>)}
          </select>
        </div>
        <div style={{ width: 120 }}>
          <label style={labelSt}>Índice</label>
          <select style={{ ...inputSt, cursor: 'pointer' }} value={tipo} onChange={e => setTipo(e.target.value)}>
            {INDICES_TIPO.map(t => <option key={t.id} value={t.id}>{getIndiceTipo(t.id)?.nombre}</option>)}
          </select>
        </div>
      </div>
      {Number(monto) > 0 && (
        <div style={{ background: T.faint, borderRadius: 4, padding: '8px 12px', fontSize: 12.5 }}>
          Redeterminado: <b style={{ fontFamily: T.fontMono }}>$ {fmtN(redet)}</b>
          {varCalc != null
            ? <span style={{ color: T.ink3 }}> ({varCalc >= 0 ? '+' : ''}{varCalc}% por índice {getIndiceTipo(tipo)?.nombre})</span>
            : <span style={{ color: T.warn }}> · faltan índices de esos meses</span>}
        </div>
      )}
    </div>
  );
}

export default function Configuracion() {
  const { config, patchEmpresa, patchNotificaciones, patchSeguridad, patchApariencia, patchRoot } = useConfiguracion();
  const { currentUser } = useUsuarios();
  const [saved, setSaved] = useState(false);

  const save = (patchFn, changes) => {
    patchFn(changes);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // Vista reducida para usuarios no-admin → todo el perfil vive en /perfil.
  if (currentUser?.rol !== 'Admin') {
    return <Navigate to="/perfil" replace />;
  }

  return (
    <PageLayout breadcrumb={['Configuración']} active="Configuración">
      <PageHero
        label="PARÁMETROS DEL SISTEMA"
        title="Configuración"
        subtitle="Empresa · integraciones · seguridad · apariencia"
        actions={saved && <Chip ok style={{ fontSize: 12 }}>✓ Guardado</Chip>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, maxWidth: 900, alignItems: 'start' }}>

        {/* Empresa */}
        <Box style={{ padding: 16 }}>
          <Label style={{ fontSize: 14, marginBottom: 12 }}>Datos de empresa</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <FField label="Razón social" value={config.empresa.razonSocial} onChange={v => save(patchEmpresa, { razonSocial: v })} />
            <FField label="CUIT" value={config.empresa.cuit} onChange={v => save(patchEmpresa, { cuit: v })} />
            <FField label="Dirección" value={config.empresa.direccion} onChange={v => save(patchEmpresa, { direccion: v })} />
            <FField label="Email" value={config.empresa.email} type="email" onChange={v => save(patchEmpresa, { email: v })} />
            <FField label="Teléfono" value={config.empresa.telefono} onChange={v => save(patchEmpresa, { telefono: v })} />
          </div>
        </Box>

        {/* Tipo de cambio */}
        <Box style={{ padding: 16 }}>
          <Label style={{ fontSize: 14, marginBottom: 12 }}>Tipo de cambio · Dólar BNA</Label>
          <DolarSection />
          <Divider style={{ margin: '14px 0' }} />
          <Label style={{ fontSize: 14, marginBottom: 10 }}>Ejercicio fiscal</Label>
          <FField label="Inicio ejercicio (DD/MM)" value={config.ejercicioInicio}
            onChange={v => save(patchRoot, { ejercicioInicio: v })} />
          <div style={{ marginTop: 10 }}>
            <Row label="Mostrar doble moneda en UI" on={config.doubleCurrency}
              onChange={v => save(patchRoot, { doubleCurrency: v })} />
          </div>
        </Box>

        {/* Índices de redeterminación (CAC) */}
        <Box style={{ padding: 16, gridColumn: '1 / -1' }}>
          <Label style={{ fontSize: 14, marginBottom: 12 }}>Índices de redeterminación · CAC</Label>
          <IndicesCacSection />
        </Box>

        {/* Notificaciones */}
        <Box style={{ padding: 16 }}>
          <Label style={{ fontSize: 14, marginBottom: 10 }}>Notificaciones</Label>
          <Row label="Alertas de pago pendiente" on={config.notificaciones.pagosPendientes}
            onChange={v => save(patchNotificaciones, { pagosPendientes: v })} />
          <Row label="Avance de obra por email" on={config.notificaciones.avanceEmail}
            onChange={v => save(patchNotificaciones, { avanceEmail: v })} />
          <Row label="Resumen semanal" on={config.notificaciones.resumenSemanal}
            onChange={v => save(patchNotificaciones, { resumenSemanal: v })} />
          <Row label="Notificaciones WhatsApp bot" on={config.notificaciones.whatsappBot}
            onChange={v => save(patchNotificaciones, { whatsappBot: v })} />
          <Row label="Alertas de stock bajo" on={config.notificaciones.stockBajo}
            onChange={v => save(patchNotificaciones, { stockBajo: v })} />
        </Box>

        {/* Seguridad */}
        <Box style={{ padding: 16 }}>
          <Label style={{ fontSize: 14, marginBottom: 10 }}>Seguridad</Label>
          <Row label="Doble factor (2FA)" on={config.seguridad.dosFactor}
            onChange={v => save(patchSeguridad, { dosFactor: v })} />
          <Row label="Sesiones múltiples" on={config.seguridad.sesionesMultiples}
            onChange={v => save(patchSeguridad, { sesionesMultiples: v })} />
          <Row label="Log de auditoría" on={config.seguridad.logAuditoria}
            onChange={v => save(patchSeguridad, { logAuditoria: v })} />
          <Row label="IP whitelist" on={config.seguridad.ipWhitelist}
            onChange={v => save(patchSeguridad, { ipWhitelist: v })} />
        </Box>

        {/* Apariencia */}
        <Box style={{ padding: 16 }}>
          <Label style={{ fontSize: 14, marginBottom: 10 }}>Apariencia</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <FSelect label="Idioma" value={config.apariencia.idioma}
              onChange={v => save(patchApariencia, { idioma: v })}
              options={['Español (Argentina)', 'Español (México)', 'English']} />
            <FSelect label="Zona horaria" value={config.apariencia.timezone}
              onChange={v => save(patchApariencia, { timezone: v })}
              options={['America/Buenos_Aires', 'America/Santiago', 'UTC']} />
            <FSelect label="Formato de fecha" value={config.apariencia.formatoFecha}
              onChange={v => save(patchApariencia, { formatoFecha: v })}
              options={['DD/MM/AAAA', 'MM/DD/YYYY', 'AAAA-MM-DD']} />
            <FSelect label="Formato de moneda" value={config.apariencia.formatoMoneda}
              onChange={v => save(patchApariencia, { formatoMoneda: v })}
              options={['$ 1.234.567,00', '$ 1,234,567.00']} />
          </div>
        </Box>

        {/* Medios de pago */}
        <Box style={{ padding: 16 }}>
          <Label style={{ fontSize: 14, marginBottom: 4 }}>Medios de pago</Label>
          <div style={{ fontSize: 11, color: T.ink2, marginBottom: 10 }}>
            Usados en todos los formularios de pago y movimientos del sistema
          </div>
          <MediosDePago
            medios={config.mediosDePago || []}
            onChange={v => save(patchRoot, { mediosDePago: v })}
          />
        </Box>

      </div>
    </PageLayout>
  );
}
