import { useState } from 'react';
import { T } from '../../theme';
import { Btn } from '../../components/ui';

// Pantalla de firma del contrato en el portal. Recibe el contrato (sanitizado) y
// el token. Flujo: ver contrato → Firmar → nombre+DNI → pedir OTP → ingresar OTP.
export default function ContratoFirma({ contrato, token }) {
  const [paso, setPaso] = useState('ver');   // ver | datos | otp | hecho
  const [datos, setDatos] = useState({ nombre: '', dni: '' });
  const [otpId, setOtpId] = useState(null);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const firmado = contrato?.estado === 'firmado';

  const pedirOtp = async () => {
    if (!datos.nombre.trim()) { setError('Ingresá tu nombre.'); return; }
    setCargando(true); setError('');
    try {
      const r = await fetch('/api/portal/solicitar-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'No se pudo enviar el código');
      setOtpId(d.otpId); setPaso('otp');
      if (!d.enviado) setError('No pudimos enviar el código por WhatsApp. Avisá al equipo de Kamak.');
    } catch (e) { setError(e.message); } finally { setCargando(false); }
  };

  const firmar = async () => {
    if (otp.length < 4) { setError('Ingresá el código.'); return; }
    setCargando(true); setError('');
    try {
      const r = await fetch('/api/portal/firmar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, otpId, otp, nombre: datos.nombre.trim(), dni: datos.dni.trim() }) });
      const d = await r.json();
      if (!r.ok) throw new Error(({ otp_incorrecto: 'Código incorrecto.', otp_expirado: 'El código venció, pedí uno nuevo.', otp_intentos: 'Demasiados intentos, pedí un código nuevo.' })[d.error] || d.error || 'Error al firmar');
      setPaso('hecho');
    } catch (e) { setError(e.message); } finally { setCargando(false); }
  };

  if (!contrato || !['enviado', 'firmado', 'rechazado'].includes(contrato.estado)) {
    return <div style={{ padding: 40, textAlign: 'center', color: T.ink3 }}>Todavía no hay un contrato disponible para firmar.</div>;
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
      <div style={{ background: '#fff', border: `1.5px solid ${T.faint2}`, borderRadius: 8, padding: 24 }}
        dangerouslySetInnerHTML={{ __html: contrato.htmlRenderizado || '' }} />

      <div style={{ marginTop: 10, fontSize: 11, color: T.ink3, fontStyle: 'italic' }}>
        Firma electrónica simple (art. 5, Ley 25.506): tiene valor probatorio. No es firma digital.
      </div>

      {firmado ? (
        <div style={{ marginTop: 16, padding: '12px 16px', background: '#f0faf2', borderLeft: `3px solid ${T.ok}`, borderRadius: 6, color: '#166534', fontWeight: 600 }}>
          ✓ Firmado{contrato.firma?.nombre ? ` por ${contrato.firma.nombre}` : ''}{contrato.fechaFirmado ? ` el ${new Date(contrato.fechaFirmado).toLocaleDateString('es-AR')}` : ''}.
        </div>
      ) : paso === 'hecho' ? (
        <div style={{ marginTop: 16, padding: '12px 16px', background: '#f0faf2', borderLeft: `3px solid ${T.ok}`, borderRadius: 6, color: '#166534', fontWeight: 600 }}>✓ ¡Contrato firmado! Gracias.</div>
      ) : (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 360 }}>
          {paso === 'ver' && <Btn fill onClick={() => setPaso('datos')}>Firmar contrato</Btn>}
          {paso === 'datos' && <>
            <input placeholder="Nombre y apellido" value={datos.nombre} onChange={e => setDatos(d => ({ ...d, nombre: e.target.value }))} style={inp} />
            <input placeholder="DNI / CUIT" value={datos.dni} onChange={e => setDatos(d => ({ ...d, dni: e.target.value }))} style={inp} />
            <Btn fill onClick={pedirOtp} disabled={cargando}>{cargando ? 'Enviando…' : 'Recibir código por WhatsApp'}</Btn>
          </>}
          {paso === 'otp' && <>
            <div style={{ fontSize: 12, color: T.ink2 }}>Te enviamos un código por WhatsApp. Ingresalo:</div>
            <input placeholder="Código de 6 dígitos" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} style={inp} />
            <Btn fill onClick={firmar} disabled={cargando}>{cargando ? 'Firmando…' : 'Confirmar firma'}</Btn>
          </>}
          {error && <div style={{ fontSize: 12, color: '#b91c1c' }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

const inp = { padding: '8px 12px', border: '1.5px solid #d4cfbf', borderRadius: 6, fontSize: 14, fontFamily: 'inherit', outline: 'none' };
