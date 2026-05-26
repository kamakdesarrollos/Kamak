import { useState, useRef } from 'react';
import { Box, Btn, Chip } from '../../../components/ui';
import { T } from '../../../theme';
import { supabase } from '../../../lib/supabase';
import { newId } from '../../../lib/id';
import { FInput, FSelect, FormPanel } from '../forms';

const TIPOS_DOC = ['Contrato', 'Presupuesto', 'Planos', 'Certificado', 'Factura', 'Permiso', 'Otro'];

// Mismo formato que el resto de las tabs (DD/MM/YYYY).
const fmtD = (iso) => !iso ? '—' : iso.split('-').reverse().join('/');

export default function TabDocumentos({ detalle, patch, obraId }) {
  const [adding,      setAdding]      = useState(false);
  const [form,        setForm]        = useState({ nombre: '', tipo: 'Contrato', fecha: new Date().toISOString().split('T')[0] });
  const [pendingFile, setPendingFile] = useState(null);
  const [uploading,   setUploading]   = useState(false);
  const [uploadErr,   setUploadErr]   = useState('');
  const fileRef = useRef(null);

  const handleFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setPendingFile(f);
    if (!form.nombre.trim()) setForm(p => ({ ...p, nombre: f.name.replace(/\.[^.]+$/, '') }));
  };

  const save = async () => {
    if (!form.nombre.trim()) return;
    let url = null;
    if (pendingFile) {
      setUploading(true);
      setUploadErr('');
      const ext  = pendingFile.name.split('.').pop();
      const path = `obras/${obraId}/docs/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('kamak-fotos').upload(path, pendingFile, { upsert: true });
      if (error) { setUploadErr('Error al subir el archivo: ' + error.message); setUploading(false); return; }
      url = supabase.storage.from('kamak-fotos').getPublicUrl(path).data.publicUrl;
      setUploading(false);
    }
    patch(d => ({ ...d, documentos: [...d.documentos, { id: newId('doc'), ...form, url }] }));
    setAdding(false);
    setForm({ nombre: '', tipo: 'Contrato', fecha: new Date().toISOString().split('T')[0] });
    setPendingFile(null);
  };

  const del = (id) => patch(d => ({ ...d, documentos: d.documentos.filter(dc => dc.id !== id) }));

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Btn sm fill onClick={() => setAdding(true)}>+ Documento</Btn>
      </div>

      {adding && (
        <FormPanel
          title="Agregar documento"
          onSave={save}
          onCancel={() => { setAdding(false); setPendingFile(null); setUploadErr(''); }}
          style={{ marginBottom: 14 }}
          saveLabel={uploading ? 'Subiendo...' : 'Guardar'}
          saveDisabled={uploading}
        >
          <FInput label="Nombre del documento" value={form.nombre} onChange={v => setForm(p => ({ ...p, nombre: v }))} placeholder="Ej: Contrato de obra firmado" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FSelect label="Tipo" value={form.tipo} onChange={v => setForm(p => ({ ...p, tipo: v }))} options={TIPOS_DOC} />
            <FInput label="Fecha" value={form.fecha} onChange={v => setForm(p => ({ ...p, fecha: v }))} type="date" />
          </div>
          <div
            style={{ background: T.faint, borderRadius: 4, padding: '10px 12px', border: `1.5px dashed ${T.faint2}`, cursor: 'pointer' }}
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
              style={{ display: 'none' }}
              onChange={handleFile}
            />
            {pendingFile ? (
              <div style={{ fontSize: 12, color: T.ink, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 18 }}>📎</span>
                <span style={{ fontWeight: 600 }}>{pendingFile.name}</span>
                <span style={{ color: T.ink3 }}>({(pendingFile.size / 1024).toFixed(0)} KB)</span>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: T.ink2, textAlign: 'center' }}>📎 Clic para seleccionar archivo (PDF, Word, Excel, imágenes)</div>
            )}
          </div>
          {uploadErr && <div style={{ fontSize: 11, color: '#dc2626' }}>{uploadErr}</div>}
        </FormPanel>
      )}

      {detalle.documentos.length === 0 ? (
        <div style={{ color: T.ink3, padding: 24, textAlign: 'center' }}>Sin documentos</div>
      ) : (
        <Box style={{ padding: 0, overflow: 'hidden' }}>
          {detalle.documentos.map((dc, i) => (
            <div
              key={dc.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '10px 14px',
                borderBottom: i < detalle.documentos.length - 1 ? `1px solid ${T.faint2}` : 'none',
                gap: 12,
              }}
            >
              <span style={{ fontSize: 22 }}>📄</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{dc.nombre}</div>
                <div style={{ fontSize: 11, color: T.ink2 }}>{dc.tipo} · {fmtD(dc.fecha)}</div>
              </div>
              <Chip style={{ fontSize: 10 }}>{dc.tipo}</Chip>
              {dc.url
                ? <a href={dc.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}><Btn sm>↓ Abrir</Btn></a>
                : <Btn sm style={{ opacity: 0.4, pointerEvents: 'none' }}>Sin archivo</Btn>
              }
              <span
                style={{ color: T.accent, cursor: 'pointer', fontSize: 12 }}
                onClick={() => del(dc.id)}
                role="button"
                aria-label="Eliminar documento"
              >🗑</span>
            </div>
          ))}
        </Box>
      )}
    </div>
  );
}
