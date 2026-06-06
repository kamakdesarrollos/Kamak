import { useState } from 'react';
import { Logo, Stripes } from '../components/ui';
import { T } from '../theme';
import { useAuth } from '../store/AuthContext';

// Signup publico deshabilitado: la creacion de usuarios se hace solo desde
// /autorizaciones (admin). Esto evita escalada de privilegios via bootstrapAdmin.

export default function Login() {
  const { signIn } = useAuth();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const inputSt = {
    width: '100%', padding: '9px 11px',
    border: `1.5px solid ${T.faint2}`, borderRadius: 5,
    fontFamily: T.font, fontSize: 13, background: T.paper,
    boxSizing: 'border-box', outline: 'none', color: T.ink,
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError('');

    const { error: err } = await signIn(email.trim(), password);

    if (err) {
      // Mensaje generico: evita enumerar cuentas (no distinguimos
      // "email no existe" de "password incorrecto").
      setError('Email o contraseña inválidos.');
      setLoading(false);
    }
    // Si login ok → AuthContext detecta el cambio y App renderiza la app
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f0ece0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.font, padding: '16px' }}>
      <div style={{ width: '100%', maxWidth: 400, background: T.paper, borderRadius: 8, boxShadow: '0 8px 48px rgba(0,0,0,0.13)', overflow: 'hidden' }}>

        <div style={{ background: T.dark, padding: '26px 30px 22px', position: 'relative', overflow: 'hidden' }}>
          <Stripes style={{ top: -20, right: -10 }} />
          <Logo h={30} dark />
          <div style={{ marginTop: 10, fontSize: 11, color: '#9a9892', fontFamily: `'JetBrains Mono',monospace`, letterSpacing: 1, textTransform: 'uppercase' }}>
            Sistema de gestión de obras
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '28px 30px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: T.ink, marginBottom: 2 }}>
            Iniciar sesión
          </div>

          <div>
            <label style={{ fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>Email</label>
            <input autoFocus type="email" value={email}
              onChange={e => { setEmail(e.target.value); setError(''); }}
              placeholder="email@empresa.com" style={inputSt} />
          </div>

          <div>
            <label style={{ fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>Contraseña</label>
            <div style={{ position: 'relative' }}>
              <input type={showPass ? 'text' : 'password'} value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                placeholder="••••••••" style={{ ...inputSt, paddingRight: 38 }} />
              <span onClick={() => setShowPass(v => !v)}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', fontSize: 15, color: T.ink3, userSelect: 'none' }}>
                {showPass ? '🙈' : '👁'}
              </span>
            </div>
          </div>

          {error && (
            <div style={{ padding: '8px 12px', background: '#fae6e0', borderRadius: 4, fontSize: 12, color: T.accent, borderLeft: `3px solid ${T.accent}` }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading || !email.trim() || !password}
            style={{ padding: '11px', background: (!email.trim() || !password) ? T.faint2 : T.accent, color: '#fff', border: 'none', borderRadius: 5, fontFamily: T.font, fontSize: 14, fontWeight: 700, cursor: (!email.trim() || !password) ? 'default' : 'pointer', transition: 'background 0.15s', marginTop: 2 }}>
            {loading ? 'Cargando…' : 'Ingresar →'}
          </button>
        </form>

        <div style={{ padding: '0 30px 20px', fontSize: 11, color: T.ink3, textAlign: 'center' }}>
          ¿Necesitás una cuenta? Contactá al administrador.
        </div>
      </div>
    </div>
  );
}
