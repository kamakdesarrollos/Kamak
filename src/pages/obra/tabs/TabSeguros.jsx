import { useState } from 'react';
import { Box, Btn } from '../../../components/ui';
import { T } from '../../../theme';
import { newId } from '../../../lib/id';
import { FInput, FormPanel } from '../forms';

// Nómina de seguros del personal de la obra. Solo visible en obras
// confirmadas (la visibilidad la decide ObraPresupuesto vía visibleTabIndices).
// CRUD atómico vía patch (nunca el blob entero) — mismo patrón que TabDocumentos.

// Mismo formato de fecha que el resto de las tabs (DD/MM/YYYY).
const fmtD = (iso) => !iso ? '—' : iso.split('-').reverse().join('/');

const EMPTY_FORM = { nombre: '', dni: '', aseguradora: '', poliza: '', vencimiento: '' };

export default function TabSeguros({ detalle, patch }) {
  const [adding,    setAdding]    = useState(false);
  const [form,      setForm]      = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);

  const nomina = detalle.nominaSeguros || [];

  const resetAndClose = () => {
    setAdding(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const startAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setAdding(true);
  };

  const startEdit = (s) => {
    setAdding(false);
    setEditingId(s.id);
    setForm({ nombre: s.nombre || '', dni: s.dni || '', aseguradora: s.aseguradora || '', poliza: s.poliza || '', vencimiento: s.vencimiento || '' });
  };

  const save = () => {
    if (!form.nombre.trim()) return;
    if (editingId) {
      patch(d => ({ ...d, nominaSeguros: (d.nominaSeguros || []).map(s => s.id === editingId ? { ...s, ...form } : s) }));
    } else {
      patch(d => ({ ...d, nominaSeguros: [...(d.nominaSeguros || []), { id: newId('seg'), ...form }] }));
    }
    resetAndClose();
  };

  const del = (id) => patch(d => ({ ...d, nominaSeguros: (d.nominaSeguros || []).filter(s => s.id !== id) }));

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: T.ink2 }}>Nómina de seguros del personal de la obra.</div>
        <Btn sm fill onClick={startAdd}>+ Persona</Btn>
      </div>

      {(adding || editingId) && (
        <FormPanel
          title={editingId ? 'Editar persona' : 'Agregar persona a la nómina'}
          onSave={save}
          onCancel={resetAndClose}
          style={{ marginBottom: 14 }}
          saveDisabled={!form.nombre.trim()}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FInput label="Nombre y apellido" value={form.nombre} onChange={v => setForm(p => ({ ...p, nombre: v }))} placeholder="Ej: Juan Pérez" />
            <FInput label="DNI" value={form.dni} onChange={v => setForm(p => ({ ...p, dni: v }))} placeholder="Ej: 30.123.456" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FInput label="Aseguradora / ART" value={form.aseguradora} onChange={v => setForm(p => ({ ...p, aseguradora: v }))} placeholder="Ej: Provincia ART" />
            <FInput label="N° de póliza" value={form.poliza} onChange={v => setForm(p => ({ ...p, poliza: v }))} placeholder="Ej: 123456-7" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FInput label="Vencimiento" value={form.vencimiento} onChange={v => setForm(p => ({ ...p, vencimiento: v }))} type="date" />
          </div>
        </FormPanel>
      )}

      {nomina.length === 0 ? (
        <div style={{ color: T.ink3, padding: 24, textAlign: 'center' }}>Sin personal en la nómina de seguros.</div>
      ) : (
        <Box style={{ padding: 0, overflow: 'hidden' }}>
          {nomina.map((s, i) => (
            <div
              key={s.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '10px 14px',
                borderBottom: i < nomina.length - 1 ? `1px solid ${T.faint2}` : 'none',
                gap: 12,
              }}
            >
              <span style={{ fontSize: 22 }}>🛡️</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s.nombre}{s.dni ? <span style={{ color: T.ink3, fontWeight: 400 }}> · DNI {s.dni}</span> : null}</div>
                <div style={{ fontSize: 11, color: T.ink2 }}>
                  {s.aseguradora || '—'}
                  {s.poliza ? ` · Póliza ${s.poliza}` : ''}
                  {s.vencimiento ? ` · Vence ${fmtD(s.vencimiento)}` : ''}
                </div>
              </div>
              <Btn sm onClick={() => startEdit(s)}>Editar</Btn>
              <span
                style={{ color: T.accent, cursor: 'pointer', fontSize: 12 }}
                onClick={() => del(s.id)}
                role="button"
                aria-label="Eliminar persona"
              >🗑</span>
            </div>
          ))}
        </Box>
      )}
    </div>
  );
}
