import { useState } from 'react';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn, Label, Divider, Chip } from '../components/ui';
import { T } from '../theme';
import { useConfiguracion } from '../store/ConfiguracionContext';
import { useDolar } from '../store/DolarContext';
import { supabase } from '../lib/supabase';

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

// ── Página ─────────────────────────────────────────────────────────────────────
function CambiarContrasena() {
  const [pass1, setPass1] = useState('');
  const [pass2, setPass2] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const guardar = async () => {
    if (pass1.length < 6) { setErr('Mínimo 6 caracteres'); return; }
    if (pass1 !== pass2) { setErr('Las contraseñas no coinciden'); return; }
    setLoading(true); setErr(''); setMsg('');
    const { error } = await supabase.auth.updateUser({ password: pass1 });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setMsg('Contraseña actualizada correctamente');
    setPass1(''); setPass2('');
  };

  return (
    <Box style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 340 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>Cambiar mi contraseña</div>
      <FField label="Nueva contraseña" type="password" value={pass1} onChange={setPass1} />
      <FField label="Repetir contraseña" type="password" value={pass2} onChange={setPass2} />
      {err && <div style={{ fontSize: 12, color: T.accent }}>{err}</div>}
      {msg && <div style={{ fontSize: 12, color: T.ok }}>{msg}</div>}
      <Btn sm fill onClick={guardar} style={{ opacity: loading ? 0.5 : 1 }}>
        {loading ? 'Guardando…' : 'Guardar contraseña'}
      </Btn>
    </Box>
  );
}

export default function Configuracion() {
  const { config, patchEmpresa, patchNotificaciones, patchSeguridad, patchApariencia, patchRoot } = useConfiguracion();
  const [saved, setSaved] = useState(false);

  const save = (patchFn, changes) => {
    patchFn(changes);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <PageLayout breadcrumb={['Configuración']} active="Configuración">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div>
          <div className="k-h" style={{ fontSize: 28 }}>Configuración</div>
          <div style={{ fontSize: 12, color: T.ink2 }}>Parámetros generales del sistema · empresa · integraciones</div>
        </div>
        {saved && <Chip ok style={{ fontSize: 12 }}>✓ Guardado</Chip>}
      </div>

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

        <CambiarContrasena />

      </div>
    </PageLayout>
  );
}
