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
  const [adding,       setAdding]       = useState(false);
  const [form,         setForm]         = useState({ nombre: '', tipo: 'Contrato', fecha: new Date().toISOString().split('T')[0] });
  // pendingFiles: lista de { file, status: 'pending'|'uploading'|'done'|'error', error? }.
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploading,    setUploading]    = useState(false);
  const [uploadErr,    setUploadErr]    = useState('');
  const fileRef = useRef(null);

  const resetAndClose = () => {
    setAdding(false);
    setForm({ nombre: '', tipo: 'Contrato', fecha: new Date().toISOString().split('T')[0] });
    setPendingFiles([]);
    setUploadErr('');
  };

  // Permite elegir uno o VARIOS archivos; se acumulan (podés agregar en tandas).
  const handleFiles = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    // Si es el primer y único archivo y no hay nombre, lo prellenamos (comodidad
    // para el caso de 1 solo documento).
    if (!form.nombre.trim() && files.length === 1 && pendingFiles.length === 0) {
      setForm(p => ({ ...p, nombre: files[0].name.replace(/\.[^.]+$/, '') }));
    }
    setPendingFiles(prev => [...prev, ...files.map(f => ({ file: f, status: 'pending' }))]);
    e.target.value = ''; // permite volver a elegir el mismo archivo si hace falta
  };

  const removeFile = (i) => setPendingFiles(prev => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    // Sin archivos: documento solo-metadata (necesita nombre). Igual que antes.
    if (pendingFiles.length === 0) {
      if (!form.nombre.trim()) return;
      patch(d => ({ ...d, documentos: [...d.documentos, { id: newId('doc'), ...form, url: null }] }));
      resetAndClose();
      return;
    }

    setUploading(true);
    setUploadErr('');
    setPendingFiles(prev => prev.map(pf => ({ ...pf, status: 'uploading', error: undefined })));

    const single = pendingFiles.length === 1;
    const nuevos = [];
    const failed = [];

    for (let i = 0; i < pendingFiles.length; i++) {
      const file = pendingFiles[i].file;
      const ext  = file.name.split('.').pop();
      const path = `obras/${obraId}/docs/${Date.now()}-${i}.${ext}`;
      const { error } = await supabase.storage.from('kamak-fotos').upload(path, file, { upsert: true });
      if (error) {
        failed.push(i);
        setPendingFiles(prev => prev.map((pf, idx) => idx === i ? { ...pf, status: 'error', error: error.message } : pf));
        continue;
      }
      const url = supabase.storage.from('kamak-fotos').getPublicUrl(path).data.publicUrl;
      // Con 1 archivo se respeta el nombre tipeado; con varios, el de cada archivo.
      const nombre = (single && form.nombre.trim()) ? form.nombre.trim() : file.name.replace(/\.[^.]+$/, '');
      nuevos.push({ id: newId('doc'), nombre, tipo: form.tipo, fecha: form.fecha, url });
      setPendingFiles(prev => prev.map((pf, idx) => idx === i ? { ...pf, status: 'done' } : pf));
    }

    if (nuevos.length) patch(d => ({ ...d, documentos: [...d.documentos, ...nuevos] }));
    setUploading(false);

    if (failed.length === 0) {
      resetAndClose();
    } else {
      // Dejamos solo los que fallaron, listos para reintentar.
      setPendingFiles(prev => prev.filter((_, idx) => failed.includes(idx)).map(pf => ({ ...pf, status: 'pending', error: undefined })));
      setUploadErr(`${failed.length} archivo(s) no se pudieron subir. Reintentá o quitalos de la lista.`);
    }
  };

  const del = (id) => patch(d => ({ ...d, documentos: d.documentos.filter(dc => dc.id !== id) }));

  const multi = pendingFiles.length > 1;

  // Carpetas = los TIPOS de documento (Planos, Contrato, etc.). El selector
  // filtra la lista por carpeta/tipo.
  const [tipoSel, setTipoSel] = useState('todos');
  const tiposPresentes = Array.from(new Set((detalle.documentos || []).map(d => d.tipo || 'Otro')));
  const docsFiltrados = tipoSel === 'todos'
    ? (detalle.documentos || [])
    : (detalle.documentos || []).filter(d => (d.tipo || 'Otro') === tipoSel);

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Btn sm fill onClick={() => setAdding(true)}>+ Documento</Btn>
      </div>

      {/* Carpetas por tipo: Todos + cada tipo presente (con su conteo). */}
      {detalle.documentos.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          {['todos', ...tiposPresentes].map(t => {
            const count = t === 'todos' ? detalle.documentos.length : detalle.documentos.filter(d => (d.tipo || 'Otro') === t).length;
            const on = tipoSel === t;
            return (
              <span key={t} onClick={() => setTipoSel(t)}
                style={{ fontSize: 11, padding: '3px 9px', borderRadius: 12, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                  background: on ? T.accent : T.paper, color: on ? '#fff' : T.ink2, border: `1px solid ${on ? T.accent : T.faint2}`, fontWeight: on ? 700 : 500 }}>
                📁 {t === 'todos' ? 'Todos' : t}{count ? ` · ${count}` : ''}
              </span>
            );
          })}
        </div>
      )}

      {adding && (
        <FormPanel
          title="Agregar documento"
          onSave={save}
          onCancel={resetAndClose}
          style={{ marginBottom: 14 }}
          saveLabel={uploading ? 'Subiendo...' : (multi ? `Subir ${pendingFiles.length} archivos` : 'Guardar')}
          saveDisabled={uploading || (pendingFiles.length === 0 && !form.nombre.trim())}
        >
          <FInput
            label={multi ? 'Nombre (se ignora con varios archivos)' : 'Nombre del documento'}
            value={form.nombre}
            onChange={v => setForm(p => ({ ...p, nombre: v }))}
            placeholder={multi ? 'Se usa el nombre de cada archivo' : 'Ej: Contrato de obra firmado'}
          />
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
              multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
              style={{ display: 'none' }}
              onChange={handleFiles}
            />
            {pendingFiles.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pendingFiles.map((pf, i) => (
                  <div key={i} style={{ fontSize: 12, color: T.ink, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>📎</span>
                    <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pf.file.name}</span>
                    <span style={{ color: T.ink3, flexShrink: 0 }}>({(pf.file.size / 1024).toFixed(0)} KB)</span>
                    {pf.status === 'uploading' && <span style={{ color: T.accent, flexShrink: 0 }}>subiendo…</span>}
                    {pf.status === 'done'      && <span style={{ color: T.ok, flexShrink: 0 }}>✓</span>}
                    {pf.status === 'error'     && <span style={{ color: '#dc2626', flexShrink: 0 }} title={pf.error}>error</span>}
                    {!uploading && pf.status !== 'done' && (
                      <span
                        onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                        style={{ color: T.ink3, cursor: 'pointer', flexShrink: 0 }}
                        role="button"
                        aria-label="Quitar archivo"
                      >🗑</span>
                    )}
                  </div>
                ))}
                {!uploading && <div style={{ fontSize: 11, color: T.accent, textAlign: 'center', marginTop: 4 }}>+ Clic para agregar más archivos</div>}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: T.ink2, textAlign: 'center' }}>📎 Clic para seleccionar uno o varios archivos (PDF, Word, Excel, imágenes)</div>
            )}
          </div>
          {uploadErr && <div style={{ fontSize: 11, color: '#dc2626' }}>{uploadErr}</div>}
        </FormPanel>
      )}

      {docsFiltrados.length === 0 ? (
        <div style={{ color: T.ink3, padding: 24, textAlign: 'center' }}>{tipoSel === 'todos' ? 'Sin documentos' : 'No hay documentos en esta carpeta.'}</div>
      ) : (
        <Box style={{ padding: 0, overflow: 'hidden' }}>
          {docsFiltrados.map((dc, i) => (
            <div
              key={dc.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '10px 14px',
                borderBottom: i < docsFiltrados.length - 1 ? `1px solid ${T.faint2}` : 'none',
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
