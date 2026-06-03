import { useState } from 'react';
import { T } from '../../theme';
import { Btn } from '../../components/ui';

// Editor reutilizable de "tareas estándar". Se usa dentro de:
// - Rubros del catálogo (rubro.tareasEstandar): se generan al usar el
//   rubro en una obra.
// - Tipos de obra del catálogo (tipoObra.tareasBase): se generan al
//   confirmar una obra de ese tipo.
//
// Cada tarea: { id, titulo, descripcion, rol, diasOffset, prioridad, checklist }
// El callback `onChange(nextArray)` se dispara con la lista actualizada.

// Roles REALES del sistema (deben coincidir con ROLES de UsuariosContext).
// Antes había roles fantasma ('Comprador'/'Director de obra'/'Capataz') que no
// existen → las tareas caían siempre en Admin (resolverUserPorRol no los encontraba).
const ROLES_DEFAULT = ['Admin', 'Administración', 'Jefe de obra', 'Logística y compras', 'Contador externo'];
const PRIORIDADES  = [['baja','Baja'], ['media','Media'], ['alta','Alta']];

const newId = () => `te-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const inputSt = {
  padding: '4px 7px',
  border: `1px solid ${T.faint2}`,
  borderRadius: 3,
  fontFamily: T.font,
  fontSize: 11,
  background: T.paper,
  outline: 'none',
};

export default function TareasEstandarEditor({ value = [], onChange, roles = ROLES_DEFAULT }) {
  const [expandedId, setExpandedId] = useState(null);

  const items = Array.isArray(value) ? value : [];

  const addTarea = () => {
    const nueva = {
      id: newId(),
      titulo: '',
      descripcion: '',
      rol: roles[0] || 'Admin',
      diasOffset: 0,
      prioridad: 'media',
      checklist: [],
    };
    onChange([...items, nueva]);
    setExpandedId(nueva.id);
  };

  const updateTarea = (id, patch) => {
    onChange(items.map(t => t.id === id ? { ...t, ...patch } : t));
  };

  const removeTarea = (id) => {
    onChange(items.filter(t => t.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const addChecklistItem = (id) => {
    const t = items.find(x => x.id === id);
    if (!t) return;
    updateTarea(id, { checklist: [...(t.checklist || []), ''] });
  };

  const updateChecklistItem = (id, idx, val) => {
    const t = items.find(x => x.id === id);
    if (!t) return;
    const next = [...(t.checklist || [])];
    next[idx] = val;
    updateTarea(id, { checklist: next });
  };

  const removeChecklistItem = (id, idx) => {
    const t = items.find(x => x.id === id);
    if (!t) return;
    updateTarea(id, { checklist: (t.checklist || []).filter((_, i) => i !== idx) });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.length === 0 && (
        <div style={{ padding: '8px 10px', fontSize: 11, color: T.ink3, fontStyle: 'italic', background: '#fbf9f1', borderRadius: 4, border: `1px dashed ${T.faint2}` }}>
          Sin tareas estándar. Agregá una para que se generen automáticamente al usar este {/* contexto-dependiente — el caller decide */}.
        </div>
      )}

      {items.map(t => {
        const expanded = expandedId === t.id;
        return (
          <div key={t.id} style={{ border: `1px solid ${T.faint2}`, borderRadius: 4, background: T.paper, overflow: 'hidden' }}>
            {/* Fila compacta */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px' }}>
              <input
                type="text"
                value={t.titulo}
                onChange={e => updateTarea(t.id, { titulo: e.target.value })}
                placeholder="Título de la tarea…"
                style={{ ...inputSt, flex: 2, fontWeight: 600 }}
              />
              <select
                value={t.rol}
                onChange={e => updateTarea(t.id, { rol: e.target.value })}
                style={{ ...inputSt, width: 110, cursor: 'pointer' }}>
                {roles.map(r => <option key={r}>{r}</option>)}
              </select>
              <input
                type="number"
                value={t.diasOffset}
                onChange={e => updateTarea(t.id, { diasOffset: parseInt(e.target.value, 10) || 0 })}
                title="Días desde la aprobación del presupuesto"
                style={{ ...inputSt, width: 50, textAlign: 'right' }}
              />
              <span style={{ fontSize: 9, color: T.ink3 }}>días</span>
              <select
                value={t.prioridad}
                onChange={e => updateTarea(t.id, { prioridad: e.target.value })}
                style={{ ...inputSt, width: 70, cursor: 'pointer' }}>
                {PRIORIDADES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <span
                onClick={() => setExpandedId(expanded ? null : t.id)}
                title={expanded ? 'Contraer' : 'Editar descripción y checklist'}
                style={{ cursor: 'pointer', fontSize: 11, color: T.ink3, padding: '0 4px' }}>
                {expanded ? '▾' : '▸'}
              </span>
              <span
                onClick={() => removeTarea(t.id)}
                title="Eliminar"
                style={{ cursor: 'pointer', fontSize: 13, color: T.accent, padding: '0 4px' }}>
                ×
              </span>
            </div>

            {/* Expandible: descripción + checklist */}
            {expanded && (
              <div style={{ borderTop: `1px solid ${T.faint2}`, padding: '8px 10px', background: '#fbf9f1', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 9, color: T.ink3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 2 }}>Descripción</label>
                  <textarea
                    value={t.descripcion || ''}
                    onChange={e => updateTarea(t.id, { descripcion: e.target.value })}
                    placeholder="(opcional)"
                    rows={2}
                    style={{ ...inputSt, width: '100%', resize: 'vertical', fontFamily: T.font, fontSize: 11 }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 9, color: T.ink3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>Checklist (opcional)</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {(t.checklist || []).map((item, i) => (
                      <div key={i} style={{ display: 'flex', gap: 4 }}>
                        <input
                          type="text"
                          value={item}
                          onChange={e => updateChecklistItem(t.id, i, e.target.value)}
                          placeholder={`Item ${i + 1}`}
                          style={{ ...inputSt, flex: 1 }}
                        />
                        <span
                          onClick={() => removeChecklistItem(t.id, i)}
                          style={{ cursor: 'pointer', fontSize: 12, color: T.accent, padding: '0 4px', alignSelf: 'center' }}>×</span>
                      </div>
                    ))}
                    <span
                      onClick={() => addChecklistItem(t.id)}
                      style={{ cursor: 'pointer', fontSize: 10, color: T.accent, marginTop: 2, alignSelf: 'flex-start' }}>
                      + Agregar ítem
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div>
        <Btn sm onClick={addTarea} style={{ marginTop: 4 }}>+ Agregar tarea estándar</Btn>
      </div>
    </div>
  );
}
