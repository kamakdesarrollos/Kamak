import { useState } from 'react';
import Modal from '../../components/ui/Modal';
import { Btn } from '../../components/ui';
import { T } from '../../theme';

// Modal que pide el motivo (obligatorio) al marcar una oportunidad como Perdida.
export default function PerdidaModal({ nombre, onClose, onConfirm }) {
  const [motivo, setMotivo] = useState('');
  const ok = motivo.trim().length > 0;
  return (
    <Modal
      title="Marcar como Perdida"
      subtitle={nombre}
      onClose={onClose}
      width={420}
      footer={<>
        <Btn sm onClick={onClose}>Cancelar</Btn>
        <Btn sm accent onClick={() => ok && onConfirm(motivo.trim())}
             style={ok ? undefined : { opacity: 0.5, pointerEvents: 'none' }}>
          Confirmar pérdida
        </Btn>
      </>}
    >
      <div style={{ fontSize: 12, color: T.ink2, marginBottom: 8 }}>
        ¿Por qué se perdió esta oportunidad? (obligatorio)
      </div>
      <textarea
        value={motivo}
        onChange={e => setMotivo(e.target.value)}
        placeholder="Ej: precio, eligió otro proveedor, no había presupuesto…"
        autoFocus
        style={{ width: '100%', minHeight: 80, padding: 10, fontFamily: T.font, fontSize: 13,
                 border: `1.5px solid ${T.faint2}`, borderRadius: 6, resize: 'vertical', outline: 'none' }}
      />
    </Modal>
  );
}
