import { useState, useMemo } from 'react';
import Modal from '../../components/ui/Modal';
import { Btn } from '../../components/ui';
import { T } from '../../theme';

// Carga un PRIMER CONTACTO en el embudo: un prospecto sin presupuesto. Crea (o
// vincula) un cliente y una obra "shell" en etapa prospecto, más la actividad
// inicial en la ficha del cliente.
const FUENTES = ['WhatsApp', 'Llamada', 'Web', 'Referido', 'Email', 'Presencial', 'Otro'];

export default function PrimerContactoModal({ clientes = [], onClose, onCrear }) {
  const [nombre, setNombre]           = useState('');
  const [telefono, setTelefono]       = useState('');
  const [fuente, setFuente]           = useState('WhatsApp');
  const [oportunidad, setOportunidad] = useState('');
  const [nota, setNota]               = useState('');

  // ¿el nombre tipeado matchea un cliente existente? -> lo vinculamos a su ficha.
  const clienteExistente = useMemo(() => {
    const n = nombre.trim().toLowerCase();
    return n ? clientes.find(c => (c.nombre || '').trim().toLowerCase() === n) : null;
  }, [nombre, clientes]);

  const ok = nombre.trim().length > 0;

  const guardar = () => {
    if (!ok) return;
    onCrear({
      clienteNombre: nombre.trim(),
      clienteId: clienteExistente?.id || null,
      telefono: (telefono.trim() || clienteExistente?.telefono || ''),
      fuente,
      nombreOportunidad: oportunidad.trim(),
      nota: nota.trim(),
    });
  };

  const inSt  = { width: '100%', padding: '8px 10px', fontFamily: T.font, fontSize: 13, border: `1.5px solid ${T.faint2}`, borderRadius: 6, outline: 'none', boxSizing: 'border-box', color: T.ink };
  const labSt = { fontSize: 11, fontWeight: 700, color: T.ink2, marginBottom: 4, display: 'block' };

  return (
    <Modal
      title="Primer contacto"
      subtitle="Nuevo prospecto en el embudo (todavía sin presupuesto)"
      onClose={onClose}
      width={460}
      footer={<>
        <Btn sm onClick={onClose}>Cancelar</Btn>
        <Btn sm accent onClick={guardar} style={ok ? undefined : { opacity: 0.5, pointerEvents: 'none' }}>
          Crear prospecto
        </Btn>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        <div>
          <label style={labSt}>Cliente / contacto *</label>
          <input list="pc-clientes" value={nombre} onChange={e => setNombre(e.target.value)} autoFocus
                 placeholder="Nombre del cliente o empresa" style={inSt} />
          <datalist id="pc-clientes">{clientes.map(c => <option key={c.id} value={c.nombre} />)}</datalist>
          {clienteExistente
            ? <div style={{ fontSize: 10.5, color: '#2e7d32', marginTop: 3 }}>✓ Cliente existente — se vincula a su ficha</div>
            : nombre.trim() && <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 3 }}>Cliente nuevo — se crea su ficha</div>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={labSt}>Teléfono</label>
            <input value={telefono} onChange={e => setTelefono(e.target.value)}
                   placeholder={clienteExistente?.telefono || 'Opcional'} style={inSt} />
          </div>
          <div>
            <label style={labSt}>¿Cómo te contactó?</label>
            <select value={fuente} onChange={e => setFuente(e.target.value)} style={{ ...inSt, cursor: 'pointer' }}>
              {FUENTES.map(f => <option key={f}>{f}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label style={labSt}>Nombre de la oportunidad</label>
          <input value={oportunidad} onChange={e => setOportunidad(e.target.value)}
                 placeholder={`Consulta — ${nombre.trim() || 'cliente'}`} style={inSt} />
          <div style={{ fontSize: 10, color: T.ink3, marginTop: 3 }}>Si lo dejás vacío, se usa “Consulta — {nombre.trim() || 'cliente'}”.</div>
        </div>

        <div>
          <label style={labSt}>Nota</label>
          <textarea value={nota} onChange={e => setNota(e.target.value)}
                    placeholder="Qué pidió, de qué obra, detalles del contacto…"
                    style={{ ...inSt, minHeight: 60, resize: 'vertical' }} />
        </div>
      </div>
    </Modal>
  );
}
