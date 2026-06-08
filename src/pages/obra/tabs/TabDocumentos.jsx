import { useState, useRef } from 'react';
import { Box, Btn, Chip } from '../../../components/ui';
import { T } from '../../../theme';
import { supabase } from '../../../lib/supabase';
import { newId } from '../../../lib/id';
import { FInput, FSelect, FormPanel } from '../forms';
import { useUsuarios } from '../../../store/UsuariosContext';

const TIPOS_DOC = ['Contrato', 'Presupuesto', 'Planos', 'Certificado', 'Factura', 'Permiso', 'Otro'];
// Carpetas de documentos siempre disponibles. Podés crear más con "+ Carpeta".
const CARPETAS_DOC_BASE = ['Planos', 'Contratos'];

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
  const { currentUser } = useUsuarios();
  // El Ingeniero externo (tercerizado) NO ve CONTRATOS (ni la carpeta Contratos):
  // son documentos comerciales/sensibles. Solo ve el resto de los archivos/planos.
  const esExterno = currentUser?.rol === 'Ingeniero externo';
  const esContratoDoc = (d) => d.tipo === 'Contrato' || (d.carpeta || '') === 'Contratos';
  const docsBase = esExterno
    ? (detalle.documentos || []).filter(d => !esContratoDoc(d))
    : (detalle.documentos || []);

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
      patch(d => ({ ...d, documentos: [...d.documentos, { id: newId('doc'), ...form, carpeta: carpetaActiva, url: null }] }));
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
      nuevos.push({ id: newId('doc'), nombre, tipo: form.tipo, fecha: form.fecha, carpeta: carpetaActiva, url });
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

  // Carpetas propias (campo `carpeta`). La seleccionada filtra la lista y es
  // donde caen los documentos que subas. "+ Carpeta" crea una nueva.
  const [carpetaSel,    setCarpetaSel]    = useState('todos');
  const [carpetasExtra, setCarpetasExtra] = useState([]);
  const carpetaActiva = carpetaSel === 'todos' ? '' : carpetaSel;
  const usadas = Array.from(new Set(docsBase.map(d => d.carpeta).filter(Boolean)));
  const carpetas = Array.from(new Set([...CARPETAS_DOC_BASE, ...carpetasExtra, ...usadas]))
    .filter(c => !(esExterno && c === 'Contratos'));   // el externo no ve la carpeta Contratos
  const docsFiltrados = carpetaSel === 'todos'
    ? docsBase
    : docsBase.filter(d => (d.carpeta || '') === carpetaSel);
  const moverDoc = (id, carpeta) => patch(d => ({ ...d, documentos: d.documentos.map(dc => dc.id === id ? { ...dc, carpeta } : dc) }));

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Btn sm fill onClick={() => setAdding(true)}>+ Documento</Btn>
      </div>

      {/* Barra de carpetas. La seleccionada filtra la lista y es donde caen los
          documentos que subas. "+ Carpeta" crea una nueva. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {['todos', ...carpetas].map(c => {
          const count = c === 'todos' ? docsBase.length : docsBase.filter(d => (d.carpeta || '') === c).length;
          const on = carpetaSel === c;
          return (
            <span key={c} onClick={() => setCarpetaSel(c)}
              style={{ fontSize: 11, padding: '3px 9px', borderRadius: 12, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                background: on ? T.accent : T.paper, color: on ? '#fff' : T.ink2, border: `1px solid ${on ? T.accent : T.faint2}`, fontWeight: on ? 700 : 500 }}>
              📁 {c === 'todos' ? 'Todos' : c}{count ? ` · ${count}` : ''}
            </span>
          );
        })}
        <span onClick={() => { const n = window.prompt('Nombre de la nueva carpeta:'); const name = (n || '').trim(); if (name) { setCarpetasExtra(prev => prev.includes(name) ? prev : [...prev, name]); setCarpetaSel(name); } }}
          style={{ fontSize: 11, padding: '3px 9px', borderRadius: 12, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', background: T.faint, color: T.accent, border: `1px dashed ${T.accent}` }}>
          + Carpeta
        </span>
      </div>

      {adding && (
        <FormPanel
          title={carpetaActiva ? `Agregar documento → 📁 ${carpetaActiva}` : 'Agregar documento'}
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
        <div style={{ color: T.ink3, padding: 24, textAlign: 'center' }}>{carpetaSel === 'todos' ? 'Sin documentos' : 'No hay documentos en esta carpeta.'}</div>
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
              <select value={dc.carpeta || ''} onChange={e => moverDoc(dc.id, e.target.value)} title="Mover a carpeta"
                style={{ fontSize: 10, padding: '2px 4px', border: `1px solid ${dc.carpeta ? '#a5b4fc' : T.faint2}`, borderRadius: 3, background: dc.carpeta ? '#eef2ff' : T.paper, color: dc.carpeta ? '#3949ab' : T.ink3, maxWidth: 120, cursor: 'pointer' }}>
                <option value="">📁 (sin carpeta)</option>
                {carpetas.map(c => <option key={c} value={c}>📁 {c}</option>)}
              </select>
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
