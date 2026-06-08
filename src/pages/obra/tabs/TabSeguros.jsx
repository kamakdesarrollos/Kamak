import { useState } from 'react';
import { Box, Btn } from '../../../components/ui';
import { T } from '../../../theme';
import { newId } from '../../../lib/id';
import { uploadFoto } from '../../../lib/upload';
import { FInput, FormPanel } from '../forms';

// Nómina de seguros del personal de la obra. Solo visible en obras
// confirmadas (la visibilidad la decide ObraPresupuesto vía visibleTabIndices).
// CRUD atómico vía patch (nunca el blob entero) — mismo patrón que TabDocumentos.
//
// La nómina se ARMA SOLA desde detalle.contratos[]: por cada contrato, el
// contratista (líder PADIC) + sus colaboradores son los asegurados. Se muestran
// agrupados por contratista. Las entradas manuales (detalle.nominaSeguros) se
// mantienen aparte (no se rompen / no se mezclan con lo derivado).
//
// PÓLIZA por contratista: se sube el documento (carpeta polizas/<obraId>) y se
// guarda { polizaUrl, polizaVence } en detalle.segurosPorContrato[contratoId]
// (estructura propia, atómica, que NUNCA colisiona con la edición del contrato).

// Mismo formato de fecha que el resto de las tabs (DD/MM/YYYY).
const fmtD = (iso) => !iso ? '—' : iso.split('-').reverse().join('/');

const EMPTY_FORM = { nombre: '', dni: '', aseguradora: '', poliza: '', vencimiento: '' };

// Estado de vencimiento de una póliza respecto de hoy.
// vigente (verde) · próxima a vencer <30 días (naranja) · vencida (naranja fuerte).
function estadoPoliza(polizaUrl, polizaVence) {
  if (!polizaUrl) return { label: 'Falta póliza', color: T.warn, falta: true };
  if (!polizaVence) return { label: 'Póliza cargada', color: T.ok };
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const vence = new Date(polizaVence + 'T00:00:00');
  const dias = Math.ceil((vence - hoy) / 86400000);
  if (dias < 0)  return { label: `Vencida ${fmtD(polizaVence)}`, color: T.warn };
  if (dias <= 30) return { label: `Vence ${fmtD(polizaVence)} (en ${dias}d)`, color: T.warn };
  return { label: `Vigente · vence ${fmtD(polizaVence)}`, color: T.ok };
}

// Fila de un asegurado (derivado o manual).
function FilaAsegurado({ s, rol, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '8px 14px', gap: 12, borderTop: `1px solid ${T.faint2}` }}>
      <span style={{ fontSize: 18 }}>{rol === 'lider' ? '👷' : '🛡️'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {s.nombre || '—'}
          {rol === 'lider' && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: T.accent2, background: T.accentSoft, padding: '1px 6px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: 0.4 }}>Contratista</span>}
        </div>
        <div style={{ fontSize: 11, color: T.ink2 }}>
          {s.dni ? `DNI ${s.dni}` : ''}
          {s.dni && s.cuit ? ' · ' : ''}
          {s.cuit ? `CUIT ${s.cuit}` : ''}
          {!s.dni && !s.cuit ? '—' : ''}
        </div>
      </div>
      {children}
    </div>
  );
}

export default function TabSeguros({ detalle, patch, obraId }) {
  const [adding,    setAdding]    = useState(false);
  const [form,      setForm]      = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  // Estado de subida por contrato: { [contratoId]: bool }.
  const [subiendo,  setSubiendo]  = useState({});

  const nomina    = detalle.nominaSeguros || [];
  const contratos = detalle.contratos || [];
  const segContrato = detalle.segurosPorContrato || {};

  // ── Nómina derivada de contratos: por cada contrato, el líder + colaboradores.
  const grupos = contratos.map(c => {
    const lider = { id: `lider:${c.id}`, nombre: c.proveedor || '(sin nombre)', dni: '', cuit: c.cuit || '' };
    const colabs = (c.colaboradores || []).map(co => ({
      id: `colab:${c.id}:${co.id}`, nombre: co.nombre || '', dni: co.dni || '', cuit: co.cuit || '',
    }));
    return { contrato: c, lider, colaboradores: colabs };
  });
  const totalAseguradosDerivados = grupos.reduce((s, g) => s + 1 + g.colaboradores.length, 0);

  // ── Carga manual (legacy / personas sueltas que no salen de un contrato) ──
  const resetAndClose = () => { setAdding(false); setEditingId(null); setForm(EMPTY_FORM); };
  const startAdd = () => { setEditingId(null); setForm(EMPTY_FORM); setAdding(true); };
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
  const del = (s) => {
    if (!window.confirm(`¿Eliminar a ${s.nombre || 'esta persona'} de la nómina de seguros?`)) return;
    patch(d => ({ ...d, nominaSeguros: (d.nominaSeguros || []).filter(x => x.id !== s.id) }));
  };

  // ── Póliza por contrato (atómico sobre detalle.segurosPorContrato[contratoId]) ──
  const patchSegContrato = (contratoId, campos) => patch(d => ({
    ...d,
    segurosPorContrato: { ...(d.segurosPorContrato || {}), [contratoId]: { ...((d.segurosPorContrato || {})[contratoId] || {}), ...campos } },
  }));

  const onSubirPoliza = async (contratoId, file) => {
    if (!file) return;
    setSubiendo(p => ({ ...p, [contratoId]: true }));
    try {
      const url = await uploadFoto(file, `polizas/${obraId || 'obra'}`);
      patchSegContrato(contratoId, { polizaUrl: url });
    } catch (e) {
      window.alert(e.message || 'No se pudo subir la póliza.');
    } finally {
      setSubiendo(p => ({ ...p, [contratoId]: false }));
    }
  };
  const setVencePoliza = (contratoId, val) => patchSegContrato(contratoId, { polizaVence: val });
  const quitarPoliza = (contratoId) => {
    if (!window.confirm('¿Quitar el documento de póliza de este contratista?')) return;
    patchSegContrato(contratoId, { polizaUrl: '' });
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ fontSize: 12, color: T.ink2, marginBottom: 12 }}>
        Nómina de seguros del personal de la obra. Los asegurados se arman solos desde los
        contratos (contratista + colaboradores). Cargá la póliza de cada contratista.
      </div>

      {/* ── Asegurados por contratista (derivado de contratos) ── */}
      {grupos.length === 0 ? (
        <div style={{ color: T.ink3, padding: 18, textAlign: 'center', fontSize: 13, border: `1px dashed ${T.faint2}`, borderRadius: 6, marginBottom: 18 }}>
          No hay contratos cargados todavía. Cargá contratistas en la pestaña <b>Contratos MO</b> y
          su personal aparecerá acá automáticamente.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Asegurados por contratista · {totalAseguradosDerivados}
          </div>
          {grupos.map(g => {
            const seg = segContrato[g.contrato.id] || {};
            const est = estadoPoliza(seg.polizaUrl, seg.polizaVence);
            const cargando = !!subiendo[g.contrato.id];
            return (
              <Box key={g.contrato.id} style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
                {/* Encabezado del contratista + estado de póliza */}
                <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: T.faint }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800 }}>{g.contrato.proveedor || '(contratista sin nombre)'}</div>
                    <div style={{ fontSize: 11, color: T.ink2 }}>
                      {g.contrato.categoriaPADIC ? `${g.contrato.categoriaPADIC} · ` : ''}
                      {1 + g.colaboradores.length} {1 + g.colaboradores.length === 1 ? 'asegurado' : 'asegurados'}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: est.color, padding: '3px 9px', borderRadius: 12, whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {est.label}
                  </span>
                </div>

                {/* Asegurados: líder + colaboradores */}
                <FilaAsegurado s={g.lider} rol="lider" />
                {g.colaboradores.map(co => <FilaAsegurado key={co.id} s={co} rol="colab" />)}

                {/* Póliza del contratista */}
                <div style={{ padding: '10px 14px', borderTop: `1px solid ${T.faint2}`, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, background: T.paper }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 150 }}>
                    <div style={{ fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>Vencimiento póliza</div>
                    <input
                      type="date"
                      value={seg.polizaVence || ''}
                      onChange={e => setVencePoliza(g.contrato.id, e.target.value)}
                      style={{ padding: '5px 8px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, outline: 'none' }}
                    />
                  </div>

                  {seg.polizaUrl ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <a href={seg.polizaUrl} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 12, fontWeight: 700, color: T.accent2, textDecoration: 'none', background: T.accentSoft, padding: '6px 12px', borderRadius: 5 }}>
                        📄 Ver póliza
                      </a>
                      <span style={{ color: T.accent, cursor: 'pointer', fontSize: 12 }} role="button" aria-label="Quitar póliza" onClick={() => quitarPoliza(g.contrato.id)}>🗑</span>
                    </div>
                  ) : (
                    <label style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: cargando ? T.ink3 : T.accent, padding: '6px 12px', borderRadius: 5, cursor: cargando ? 'default' : 'pointer' }}>
                      {cargando ? 'Subiendo…' : '↑ Subir póliza'}
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        disabled={cargando}
                        style={{ display: 'none' }}
                        onChange={e => { onSubirPoliza(g.contrato.id, e.target.files?.[0]); e.target.value = ''; }}
                      />
                    </label>
                  )}
                  {seg.polizaUrl && (
                    <label style={{ fontSize: 11, color: T.ink2, cursor: cargando ? 'default' : 'pointer', textDecoration: 'underline' }}>
                      {cargando ? 'Subiendo…' : 'Reemplazar'}
                      <input type="file" accept="image/*,application/pdf" disabled={cargando} style={{ display: 'none' }}
                        onChange={e => { onSubirPoliza(g.contrato.id, e.target.files?.[0]); e.target.value = ''; }} />
                    </label>
                  )}
                </div>
              </Box>
            );
          })}
        </>
      )}

      {/* ── Carga manual (personas sueltas / nómina legacy) ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Carga manual{nomina.length ? ` · ${nomina.length}` : ''}
        </div>
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
        <div style={{ color: T.ink3, padding: 16, textAlign: 'center', fontSize: 12 }}>Sin personas cargadas a mano.</div>
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
                onClick={() => del(s)}
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
