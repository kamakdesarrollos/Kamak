import { useState } from 'react';
import { Btn, Divider } from '../../components/ui';
import { T } from '../../theme';
import { useClientes } from '../../store/ClientesContext';

const TIPOS = [
  'Estación de Servicio', 'Panadería completa', 'Vivienda unifamiliar',
  'Vivienda 2 plantas', 'Local comercial', 'Galpón industrial',
  'Refacción baño', 'Pileta + obras civiles', 'Otro',
];

const inputStyle = {
  width: '100%', padding: '6px 10px', border: `1.2px solid ${T.ink}`,
  borderRadius: 4, background: T.paper, fontFamily: T.font, fontSize: 13,
  fontWeight: 500, boxSizing: 'border-box', outline: 'none',
};
const labelSt = { fontSize: 11, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };

// ── Mini modal para crear un cliente rápido ────────────────────────────────────
function NuevoClienteQuickModal({ onClose, onSave }) {
  const [nombre,   setNombre]   = useState('');
  const [empresa,  setEmpresa]  = useState('');
  const [cuit,     setCuit]     = useState('');
  const [telefono, setTelefono] = useState('');
  const [email,    setEmail]    = useState('');

  const handleSave = () => {
    if (!nombre.trim()) return;
    onSave({ nombre: nombre.trim(), empresa, cuit, telefono, email, notas: '' });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: T.paper, borderRadius: 8, width: 420, padding: 20, boxShadow: '0 8px 32px rgba(0,0,0,.5)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 14, fontFamily: T.font }}>Nuevo cliente</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={labelSt}>Nombre / Razón social <span style={{ color: T.accent }}>*</span></label>
            <input style={{ ...inputStyle }} value={nombre}
              onChange={e => setNombre(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="Ej: Familia Pérez" autoFocus />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>Empresa</label>
              <input style={{ ...inputStyle }} value={empresa}
                onChange={e => setEmpresa(e.target.value)} placeholder="Razón social (opcional)" />
            </div>
            <div>
              <label style={labelSt}>CUIT</label>
              <input style={{ ...inputStyle }} value={cuit}
                onChange={e => setCuit(e.target.value)} placeholder="20-12345678-9" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>Teléfono</label>
              <input style={{ ...inputStyle }} value={telefono}
                onChange={e => setTelefono(e.target.value)} placeholder="+54 11 ..." />
            </div>
            <div>
              <label style={labelSt}>Email</label>
              <input style={{ ...inputStyle }} type="email" value={email}
                onChange={e => setEmail(e.target.value)} />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm accent onClick={handleSave}>Crear cliente</Btn>
        </div>
      </div>
    </div>
  );
}

// ── Selector de cliente con botón "Nuevo" ──────────────────────────────────────
function ClienteSelector({ clienteId, onSelect, error }) {
  const { clientes, addCliente } = useClientes();
  const [miniModal, setMiniModal] = useState(false);

  const handleCreate = (data) => {
    const id = addCliente(data);
    onSelect(id, data.nombre);
    setMiniModal(false);
  };

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <label style={labelSt}>Cliente <span style={{ color: T.accent }}>*</span></label>
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            value={clienteId}
            onChange={e => {
              const c = clientes.find(c => c.id === e.target.value);
              onSelect(c?.id || '', c?.nombre || '');
            }}
            style={{ ...inputStyle, flex: 1, cursor: 'pointer', border: error ? `1.5px solid ${T.accent}` : `1.2px solid ${T.ink}` }}>
            <option value="">Seleccionar cliente…</option>
            {clientes.map(c => (
              <option key={c.id} value={c.id}>
                {c.nombre}{c.empresa ? ` · ${c.empresa}` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setMiniModal(true)}
            style={{ padding: '6px 13px', borderRadius: 4, border: `1.5px solid ${T.accent}`, background: T.accentSoft, color: T.accent, fontFamily: T.font, fontWeight: 700, fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>
            + Nuevo
          </button>
        </div>
        {error && <div style={{ color: T.accent, fontSize: 11, marginTop: 2 }}>{error}</div>}
      </div>
      {miniModal && (
        <NuevoClienteQuickModal
          onClose={() => setMiniModal(false)}
          onSave={handleCreate}
        />
      )}
    </>
  );
}

// ── Inputs de formulario ───────────────────────────────────────────────────────
function Input({ label, value, onChange, placeholder, type = 'text', required }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ fontSize: 11, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>
        {label}{required && <span style={{ color: T.accent }}>*</span>}
      </div>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...inputStyle, ...(focused ? { borderColor: T.accent } : {}) }}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      />
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ fontSize: 11, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>{label}</div>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function Textarea({ label, value, onChange, placeholder }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ fontSize: 11, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>{label}</div>
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ ...inputStyle, resize: 'vertical', minHeight: 56 }} />
    </div>
  );
}

// ── Modal principal ────────────────────────────────────────────────────────────
export default function NuevaObraModal({ obra, onSave, onClose }) {
  const { clientes } = useClientes();

  const EMPTY = {
    nombre: '', cliente: '', clienteId: '', direccion: '', tipo: TIPOS[0],
    moneda: 'ARS', presupuesto: '', fechaInicio: '', fechaFinEstim: '', notas: '',
  };

  const [form, setForm] = useState(() => {
    if (!obra) return EMPTY;
    const clienteId = obra.clienteId || clientes.find(c => c.nombre === obra.cliente)?.id || '';
    return {
      nombre: obra.nombre,
      cliente: obra.cliente,
      clienteId,
      direccion: obra.direccion,
      tipo: obra.tipo,
      moneda: obra.moneda,
      presupuesto: obra.presupuesto ? String(obra.presupuesto) : '',
      fechaInicio: obra.fechaInicio,
      fechaFinEstim: obra.fechaFinEstim,
      notas: obra.notas,
    };
  });

  const [errors, setErrors] = useState({});

  const set = (key) => (val) => setForm(f => ({ ...f, [key]: val }));

  const validate = () => {
    const e = {};
    if (!form.nombre.trim()) e.nombre = 'Requerido';
    if (!form.clienteId) e.cliente = 'Debe seleccionar un cliente';
    return e;
  };

  const handleSave = () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    onSave({ ...form, presupuesto: Number(form.presupuesto.replace(/\D/g, '')) || 0 });
    onClose();
  };

  const isEdit = !!obra;

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 540, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}>

        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: T.font, fontWeight: 800, fontSize: 18 }}>{isEdit ? 'Editar obra' : 'Nueva obra'}</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{isEdit ? obra.nombre : 'Se crea en estado "En presupuesto"'}</div>
          </div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>

        <div style={{ padding: '18px 20px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Input label="Nombre de obra" value={form.nombre} onChange={set('nombre')} placeholder="Ej: Baradero · Shell" required />
            {errors.nombre && <div style={{ color: T.accent, fontSize: 11, marginTop: 2 }}>{errors.nombre}</div>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <ClienteSelector
                clienteId={form.clienteId}
                onSelect={(id, nombre) => setForm(f => ({ ...f, clienteId: id, cliente: nombre }))}
                error={errors.cliente}
              />
            </div>
            <Input label="Dirección" value={form.direccion} onChange={set('direccion')} placeholder="Calle, ciudad" />
            <Select label="Tipo de obra" value={form.tipo} onChange={set('tipo')} options={TIPOS} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
            <Input
              label="Presupuesto estimado ($)"
              value={form.presupuesto} onChange={set('presupuesto')}
              placeholder="Ej: 18500000"
              type="text"
            />
          </div>

          <Divider />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="Fecha inicio" value={form.fechaInicio} onChange={set('fechaInicio')} type="date" />
            <Input label="Fecha fin estimada" value={form.fechaFinEstim} onChange={set('fechaFinEstim')} type="date" />
          </div>

          <Textarea label="Notas internas" value={form.notas} onChange={set('notas')} placeholder="Observaciones, condiciones especiales…" />

          {!isEdit && (
            <div style={{ background: T.accentSoft, borderRadius: 4, padding: '8px 12px', fontSize: 12, color: T.accent }}>
              La obra se creará en estado <b>En presupuesto</b>. Podés iniciarla desde el listado cuando esté aprobada.
            </div>
          )}
        </div>

        <div style={{ padding: '10px 20px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm accent onClick={handleSave}>{isEdit ? 'Guardar cambios' : '+ Crear obra'}</Btn>
        </div>
      </div>
    </div>
  );
}
