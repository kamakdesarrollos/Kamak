import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useUsuarios } from '../store/UsuariosContext';

export default function WhatsappVerificationBanner() {
  const { currentUser } = useUsuarios();
  const [verif, setVerif]       = useState(null);
  const [loading, setLoading]   = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // Si la tabla no tiene RLS configurada para el usuario actual, recibimos
  // 403 en cada poll. Lo detectamos una vez y dejamos de polear (no tiene
  // sentido reintentar cada 15s — el error es de config, no transiente).
  const accessDenied = useRef(false);

  useEffect(() => {
    if (!currentUser?.email || dismissed || accessDenied.current) return;
    const check = async () => {
      // NOTA: NO usar .maybeSingle() acá. El bot crea una fila nueva por cada
      // código que pide el usuario (la PK es el `code`), así que puede haber
      // VARIAS verificaciones vigentes para el mismo email. .maybeSingle()
      // tira error si hay >1 fila y ese error se tragaba en silencio → el
      // banner nunca aparecía. Pedimos la lista y nos quedamos con la más nueva.
      // Email con .ilike (case-insensitive) por si el mail guardado difiere en
      // mayúsculas del de la sesión.
      const { data, error } = await supabase
        .from('whatsapp_verifications')
        .select('*')
        .ilike('user_email', currentUser.email)
        .gt('expires_at', new Date().toISOString())
        .order('expires_at', { ascending: false })
        .limit(1);
      if (error) {
        // 401/403 = no hay RLS configurada o el usuario no tiene permiso.
        // Detenemos el polling — esto no se va a arreglar reintentando.
        if (error.code === 'PGRST301' || error.code === '42501' || /403|401|forbidden|permission/i.test(error.message || '')) {
          accessDenied.current = true;
          console.warn('[WhatsappVerificationBanner] Sin permiso para leer whatsapp_verifications. Polling detenido. Configurar RLS en Supabase si querés que funcione la vinculación interactiva.');
          clearInterval(interval);
        } else {
          console.warn('[WhatsappVerificationBanner] Error leyendo verificaciones:', error.message || error);
        }
        return;
      }
      setVerif(data?.[0] || null);
    };
    check();
    const interval = setInterval(check, 15000);
    return () => clearInterval(interval);
  }, [currentUser?.email, dismissed]);

  if (!verif || dismissed) return null;

  const confirm = async () => {
    setLoading(true);
    await supabase.from('whatsapp_users').upsert({
      phone: verif.phone,
      user_id: currentUser.id,
      user_name: currentUser.nombre,
      user_rol: currentUser.rol,
      linked_at: new Date().toISOString(),
    }, { onConflict: 'phone' });
    // Borrar TODAS las verificaciones de este número (pueden haberse acumulado
    // varias si el usuario pidió el código más de una vez), no solo la actual.
    await supabase.from('whatsapp_verifications').delete().eq('phone', verif.phone);
    setVerif(null);
    setLoading(false);
  };

  const reject = async () => {
    await supabase.from('whatsapp_verifications').delete().eq('phone', verif.phone);
    setVerif(null);
  };

  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: '#1a2e1a', color: '#fff', borderRadius: 10,
      boxShadow: '0 8px 32px rgba(0,0,0,0.45)', zIndex: 9998,
      padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 16,
      border: '1.5px solid #25803a', minWidth: 360, maxWidth: 520,
      fontFamily: 'Montserrat, system-ui, sans-serif', fontSize: 13,
    }}>
      <div style={{ fontSize: 22, flexShrink: 0 }}>📱</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, marginBottom: 3 }}>Solicitud de vinculación de WhatsApp</div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>
          El número <b>+{verif.phone}</b> quiere vincularse con tu cuenta.
          Confirmá solo si sos vos.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={reject}
          style={{ padding: '6px 12px', background: 'transparent', color: '#ff9999', border: '1px solid #ff9999', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          Rechazar
        </button>
        <button
          onClick={confirm}
          disabled={loading}
          style={{ padding: '6px 14px', background: '#25803a', color: '#fff', border: 'none', borderRadius: 5, cursor: loading ? 'default' : 'pointer', fontSize: 12, fontWeight: 700, opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Vinculando…' : 'Confirmar'}
        </button>
      </div>
    </div>
  );
}
