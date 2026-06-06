import { useState } from 'react';
import PageLayout from '../components/layout/PageLayout';
import { Box, Btn } from '../components/ui';
import PageHero from '../components/ui/PageHero';
import { T } from '../theme';
import { useUsuarios } from '../store/UsuariosContext';
import { useAuth } from '../store/AuthContext';
import { supabase } from '../lib/supabase';
import { useIsMobile } from '../hooks/useMediaQuery';

const inputSt = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };

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

function MiPerfil() {
  const { currentUser, updateUsuario } = useUsuarios();
  const [nombre, setNombre] = useState(currentUser?.nombre || '');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const guardar = async () => {
    if (!nombre.trim() || loading) return;
    setLoading(true);
    await updateUsuario(currentUser.id, { nombre: nombre.trim() });
    setLoading(false);
    setMsg('Nombre actualizado');
    setTimeout(() => setMsg(''), 2000);
  };

  return (
    <Box style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontFamily: T.fontMono, fontSize: 9.5, letterSpacing: 1, color: T.ink3, fontWeight: 700, textTransform: 'uppercase' }}>
        ◆ Datos del perfil
      </div>
      <FField label="Nombre" value={nombre} onChange={setNombre} />
      <FField label="Email" value={currentUser?.email || ''} readOnly />
      <FField label="Rol" value={currentUser?.rol || ''} readOnly />
      {msg && <div style={{ fontSize: 12, color: T.ok }}>{msg}</div>}
      <Btn sm fill onClick={guardar} style={{ opacity: loading ? 0.5 : 1, alignSelf: 'flex-start' }}>
        {loading ? 'Guardando…' : 'Guardar nombre'}
      </Btn>
    </Box>
  );
}

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
    <Box style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontFamily: T.fontMono, fontSize: 9.5, letterSpacing: 1, color: T.ink3, fontWeight: 700, textTransform: 'uppercase' }}>
        ◆ Cambiar contraseña
      </div>
      <FField label="Nueva contraseña" type="password" value={pass1} onChange={setPass1} />
      <FField label="Repetir contraseña" type="password" value={pass2} onChange={setPass2} />
      {err && <div style={{ fontSize: 12, color: T.accent }}>{err}</div>}
      {msg && <div style={{ fontSize: 12, color: T.ok }}>{msg}</div>}
      <Btn sm fill onClick={guardar} style={{ opacity: loading ? 0.5 : 1, alignSelf: 'flex-start' }}>
        {loading ? 'Guardando…' : 'Guardar contraseña'}
      </Btn>
    </Box>
  );
}

export default function Perfil() {
  const { currentUser } = useUsuarios();
  const { signOut } = useAuth();
  const isMobile = useIsMobile();

  return (
    <PageLayout breadcrumb={['Mi perfil']} active="">
      <PageHero
        label="MI CUENTA"
        title={currentUser?.nombre || 'Mi perfil'}
        subtitle={`${currentUser?.email || ''} · ${currentUser?.rol || ''}`}
        actions={
          <Btn sm onClick={signOut} style={{ background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid #3a3a3e' }}>
            ⏻ Cerrar sesión
          </Btn>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, maxWidth: 900 }}>
        <MiPerfil />
        <CambiarContrasena />
      </div>
    </PageLayout>
  );
}
