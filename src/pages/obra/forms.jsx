import { T } from '../../theme';
import { Btn } from '../../components/ui';

// Estilos compartidos para formularios inline. Antes vivian repetidos en
// ObraPresupuesto.jsx (~3700 lineas). Extraidos aca para que las tabs nuevas
// los importen sin duplicar.

export const inputSt = {
  padding: '5px 8px',
  border: `1.2px solid ${T.faint2}`,
  borderRadius: 4,
  fontFamily: T.font,
  fontSize: 12,
  background: T.paper,
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
};

export const labelSt = {
  fontSize: 10,
  color: T.ink2,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  fontWeight: 700,
  marginBottom: 3,
};

export function FRow({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={labelSt}>{label}</div>
      {children}
    </div>
  );
}

export function FInput({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <FRow label={label}>
      <input
        style={inputSt}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        step={type === 'number' ? 'any' : undefined}
      />
    </FRow>
  );
}

export function FSelect({ label, value, onChange, options }) {
  return (
    <FRow label={label}>
      <select
        style={{ ...inputSt, cursor: 'pointer' }}
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </FRow>
  );
}

// Panel de form inline (fondo accentSoft + borde accent + botones Cancelar/Guardar).
// Usado en TabPresupuesto, TabAdicionales, TabContratos, TabDocumentos, etc.
export function FormPanel({ title, children, onSave, onCancel, style, saveLabel = 'Guardar', saveDisabled = false }) {
  return (
    <div style={{
      background: T.accentSoft,
      border: `1.5px solid ${T.accent}`,
      borderRadius: 6,
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      ...style,
    }}>
      {title && <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>}
      {children}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <Btn sm onClick={onCancel}>Cancelar</Btn>
        <Btn sm accent onClick={onSave} style={{
          opacity: saveDisabled ? 0.5 : 1,
          pointerEvents: saveDisabled ? 'none' : 'auto',
        }}>{saveLabel}</Btn>
      </div>
    </div>
  );
}
