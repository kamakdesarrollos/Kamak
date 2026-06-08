import { useState } from 'react';
import Modal from '../../components/ui/Modal';
import { Btn } from '../../components/ui';
import { T } from '../../theme';
import { googleCalendarUrl } from '../../lib/calendarLinks';

// Agenda un contacto/llamada/reunión/visita a futuro: arma el evento de Google
// Calendar (el celu lo sincroniza) y lo registra como actividad en la ficha.
const TIPOS = [
  { id: 'llamada',  label: 'Llamada',  verbo: 'Llamar a' },
  { id: 'reunion',  label: 'Reunión',  verbo: 'Reunión con' },
  { id: 'visita',   label: 'Visita',   verbo: 'Visitar a' },
  { id: 'whatsapp', label: 'WhatsApp', verbo: 'Escribir a' },
  { id: 'nota',     label: 'Otro',     verbo: 'Contactar a' },
];

export default function AgendarModal({ cliente, onClose, onAgendado }) {
  const [tipo, setTipo]   = useState('llamada');
  const [fecha, setFecha] = useState('');
  const [hora, setHora]   = useState('');
  const [nota, setNota]   = useState('');

  const t = TIPOS.find(x => x.id === tipo) || TIPOS[0];
  const titulo = `${t.verbo} ${cliente.nombre}`;
  const detalles = [nota, cliente.telefono && `Tel: ${cliente.telefono}`].filter(Boolean).join('\n');
  const url = fecha ? googleCalendarUrl({ titulo, fecha, hora, detalles }) : null;
  const ok = !!fecha;

  const confirmar = () => {
    if (!ok) return;
    onAgendado({ tipo, tipoLabel: t.label, fecha, hora, nota: nota.trim() });
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
      footer={<>
        <Btn sm onClick={onClose}>Cancelar</Btn>
        {/* <a> en vez de onClick→window.open: abre Calendar sin que lo bloquee el navegador */}
        <a href={url || undefined} target="_blank" rel="noreferrer"
           onClick={() => confirmar()}
           style={{ textDecoration: 'none', ...(ok ? {} : { pointerEvents: 'none', opacity: 0.5 }) }}>
          <Btn sm accent>📅 Agendar en Calendar</Btn>
        </a>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        <div>
          <label style={labSt}>Tipo</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TIPOS.map(x => {
              const on = tipo === x.id;
              return (
                <span key={x.id} onClick={() => setTipo(x.id)}
                  style={{ fontSize: 12, padding: '5px 12px', borderRadius: 16, cursor: 'pointer', userSelect: 'none',
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
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inSt} />
          </div>
          <div>
            <label style={labSt}>Hora (opcional)</label>
            <input type="time" value={hora} onChange={e => setHora(e.target.value)} style={inSt} />
          </div>
        </div>
        <div style={{ fontSize: 10, color: T.ink3, marginTop: -4 }}>
          Sin hora queda como evento de día completo. Con hora, dura 1 h.
        </div>

        <div>
          <label style={labSt}>Nota</label>
          <textarea value={nota} onChange={e => setNota(e.target.value)}
                    placeholder="Ej: visitar las 3 obras del sur después de las vacaciones…"
                    style={{ ...inSt, minHeight: 56, resize: 'vertical' }} />
        </div>
      </div>
    </Modal>
  );
}
