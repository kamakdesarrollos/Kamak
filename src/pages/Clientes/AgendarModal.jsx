import { useState } from 'react';
import Modal from '../../components/ui/Modal';
import { Btn } from '../../components/ui';
import { T } from '../../theme';
import { supabase } from '../../lib/supabase';
import { useUsuarios } from '../../store/UsuariosContext';
import { googleCalendarUrl } from '../../lib/calendarLinks';

// Agenda un contacto/llamada/reunión/visita a futuro: crea el evento REAL en el
// calendario compartido vía POST /api/campana/agendar (service account, el
// mismo endpoint de la campaña — sin operadorId/estacionId NO registra
// actividad de campaña) y el caller lo registra como actividad comercial en la
// ficha. Antes armaba un link de Google Calendar que el usuario tenía que
// confirmar en un popup: si no confirmaba, no quedaba nada en ningún lado.
const TIPOS = [
  { id: 'llamada',  label: 'Llamada',  canal: 'llamada',  titulo: (n) => `📞 Llamar a ${n}` },
  { id: 'reunion',  label: 'Reunión',  canal: 'reunion',  titulo: (n) => `🤝 Reunión con ${n}` },
  { id: 'visita',   label: 'Visita',   canal: 'otro',     titulo: (n) => `📍 Visita a ${n}` },
  { id: 'whatsapp', label: 'WhatsApp', canal: 'whatsapp', titulo: (n) => `💬 WhatsApp a ${n}` },
  { id: 'nota',     label: 'Otro',     canal: 'otro',     titulo: (n) => `📌 Contactar a ${n}` },
];

// Sin hora elegida el evento va a esta hora: el endpoint no maneja eventos de
// día completo (necesita un instante para el fin y la alarma).
const HORA_DEFAULT = '09:00';

// POST /api/campana/agendar → evento en el calendario compartido, con alarma.
// Mismo patrón de fetch autenticado que UsuariosContext.updateUsuario y que
// campanas/ColaLlamadas. Respuestas: {ok, htmlLink} | {skipped:'…'} | {error}.
const agendarEnCalendario = async (body) => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return { error: { message: 'No hay sesión activa.' } };
    const r = await fetch('/api/campana/agendar', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const resp = await r.json().catch(() => ({}));
    if (!r.ok || resp?.error) return { error: { message: resp?.error || `Error ${r.status} al agendar` } };
    return resp;
  } catch (e) {
    return { error: { message: e?.message || 'Error de red al agendar' } };
  }
};

export default function AgendarModal({ cliente, onClose, onAgendado }) {
  const { currentUser } = useUsuarios();
  const [tipo, setTipo]   = useState('llamada');
  const [fecha, setFecha] = useState('');
  const [hora, setHora]   = useState('');
  const [nota, setNota]   = useState('');
  const [enviando, setEnviando] = useState(false);
  // null mientras el form está activo. Si el evento no se pudo crear queda
  // {tipo:'skip'|'warn', texto?} → aviso + botón Cerrar, SIN reintento: la
  // actividad comercial ya se registró y reintentar la duplicaría.
  const [aviso, setAviso] = useState(null);

  const t = TIPOS.find(x => x.id === tipo) || TIPOS[0];
  const titulo = t.titulo(cliente.nombre);
  const detalles = [
    cliente.telefono && `Tel: ${cliente.telefono}`,
    cliente.empresa && `Empresa: ${cliente.empresa}`,
    nota.trim() && `Nota: ${nota.trim()}`,
  ].filter(Boolean).join('\n');
  const bloqueado = enviando || !!aviso;
  const ok = !!fecha && !bloqueado;

  const confirmar = async () => {
    if (!ok) return;
    const cuando = new Date(`${fecha}T${hora || HORA_DEFAULT}`);   // huso local
    if (Number.isNaN(cuando.getTime())) return;
    setEnviando(true);
    const r = await agendarEnCalendario({
      titulo,
      descripcion: detalles,
      fechaHoraISO: cuando.toISOString(),
      duracionMin: 60,                    // mismo largo que los eventos del link viejo
      canal: t.canal,
      usuario: currentUser?.id ?? null,
      // SIN operadorId/estacionId: es un cliente del ERP, no la campaña — así
      // el endpoint no toca camp_actividades (la actividad comercial la
      // registra el caller en crm_actividades).
    });
    setEnviando(false);
    // La actividad comercial se registra SIEMPRE, falle o no el calendario:
    // el compromiso existe aunque el evento no se haya podido crear.
    onAgendado({ tipo, tipoLabel: t.label, fecha, hora, nota: nota.trim(), enCalendario: !r?.error && !r?.skipped });
    if (r?.error) {
      console.warn('[AgendarModal] calendario falló:', r.error.message);
      setAviso({ tipo: 'warn', texto: 'No se pudo crear el evento en el calendario. La actividad quedó registrada igual.' });
      return;
    }
    if (r?.skipped) {
      setAviso({ tipo: 'skip' });
      return;
    }
    onClose();
  };

  const inSt  = { width: '100%', padding: '8px 10px', fontFamily: T.font, fontSize: 13, border: `1.5px solid ${T.faint2}`, borderRadius: 6, outline: 'none', boxSizing: 'border-box', color: T.ink };
  const labSt = { fontSize: 11, fontWeight: 700, color: T.ink2, marginBottom: 4, display: 'block' };

  return (
    <Modal
      title="Agendar"
      subtitle={cliente.nombre}
      onClose={onClose}
      width={440}
      footer={aviso ? (
        <Btn sm accent onClick={onClose}>Cerrar</Btn>
      ) : <>
        <Btn sm onClick={onClose}>Cancelar</Btn>
        <Btn sm accent onClick={confirmar} disabled={!ok} style={ok ? {} : { opacity: 0.5, cursor: 'default' }}>
          {enviando ? 'Agendando…' : '📅 Agendar'}
        </Btn>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        <div>
          <label style={labSt}>Tipo</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TIPOS.map(x => {
              const on = tipo === x.id;
              return (
                <span key={x.id} onClick={() => { if (!bloqueado) setTipo(x.id); }}
                  style={{ fontSize: 12, padding: '5px 12px', borderRadius: 16, cursor: bloqueado ? 'default' : 'pointer', userSelect: 'none',
                    background: on ? T.accent : T.paper, color: on ? '#fff' : T.ink2,
                    border: `1.5px solid ${on ? T.accent : T.faint2}`, fontWeight: on ? 700 : 500 }}>
                  {x.label}
                </span>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={labSt}>Fecha *</label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} disabled={bloqueado} style={inSt} />
          </div>
          <div>
            <label style={labSt}>Hora (opcional)</label>
            <input type="time" value={hora} onChange={e => setHora(e.target.value)} disabled={bloqueado} style={inSt} />
          </div>
        </div>
        <div style={{ fontSize: 10, color: T.ink3, marginTop: -4 }}>
          Sin hora se agenda a las {HORA_DEFAULT}. Dura 1 h y avisa con alarma.
        </div>

        <div>
          <label style={labSt}>Nota</label>
          <textarea value={nota} onChange={e => setNota(e.target.value)} disabled={bloqueado}
                    placeholder="Ej: visitar las 3 obras del sur después de las vacaciones…"
                    style={{ ...inSt, minHeight: 56, resize: 'vertical' }} />
        </div>

        {aviso && (
          <div style={{ fontSize: 12, color: T.ink2, background: T.faint, borderRadius: 6, padding: '8px 10px',
                        border: `1.5px solid ${aviso.tipo === 'warn' ? T.warn : T.faint2}` }}>
            {aviso.tipo === 'skip' ? (
              // Sin calendario configurado (env del server): el link viejo sirve
              // de plan B — abre Google Calendar con el evento pre-cargado.
              <>Calendario no configurado —{' '}
                <a href={googleCalendarUrl({ titulo, fecha, hora, detalles }) || undefined} target="_blank" rel="noreferrer"
                   style={{ color: T.accent, fontWeight: 700 }}>
                  agendalo a mano acá
                </a>. La actividad quedó registrada igual.</>
            ) : aviso.texto}
          </div>
        )}
      </div>
    </Modal>
  );
}
