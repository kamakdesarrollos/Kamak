import { useState, useMemo, useEffect, useRef } from 'react';
import { Btn } from '../../components/ui';
import { T } from '../../theme';
import useSyncedSharedData from '../../lib/useSyncedSharedData';
import { patchItemInSharedArray } from '../../lib/dbHelpers';
import { PLACEHOLDERS, TIPOS_DOC } from '../../lib/contratistaDocs';

// Editor de las PLANTILLAS de contratista (Régimen PADIC). Viven en
// shared_data['crm_plantillas_contratistas'] como un array { id, tipo, nombre, html }.
// Permite editar el campo `html` de cada plantilla (las 6 sembradas) y guarda
// ATÓMICAMENTE por id (patchItemInSharedArray → RPC patch_item_in_shared_array,
// con fallback read-modify-write). Así dos personas editando plantillas distintas
// a la vez no se pisan (mismo blindaje que el catálogo y las alertas).
//
// Solo Admin/Administración (el botón que lo abre ya está gateado en la tab).

const KEY = 'crm_plantillas_contratistas';
const LS_KEY = 'kamak_plantillas_contratistas_v1';

// Variables disponibles agrupadas, con una descripción corta. Se derivan de
// PLACEHOLDERS de la lib (fuente de verdad) para no quedar desincronizadas: si
// la lib agrega una variable nueva, aparece acá aunque no esté en GRUPOS.
const RAW_VARS = new Set(['tareasTabla', 'planPagosTabla', 'nominaTabla']);
const VAR_DESC = {
  'contratista.nombre': 'Nombre del contratista',
  'contratista.cuit': 'CUIT del contratista',
  'contratista.categoriaPADIC': 'Categoría PADIC (ej. Monotributo A)',
  'contratista.domicilio': 'Domicilio fiscal del contratista',
  'obra.nombre': 'Nombre de la obra',
  'obra.direccion': 'Dirección de la obra',
  'montoTotal': 'Monto total del contrato ($)',
  'tareasResumen': 'Tareas del contrato en una línea',
  'tareasTabla': 'TABLA de tareas (cant. · p.unit · total)',
  'planPagosTabla': 'TABLA del plan de pagos (concepto · % · monto)',
  'nominaTabla': 'TABLA de colaboradores (nombre · DNI · CUIT · dom.)',
  'fechaInicio': 'Fecha de inicio del contrato',
  'plazo': 'Plazo de ejecución',
  'fecha': 'Fecha de hoy',
  'lugar': 'Lugar de firma',
  'colaborador.nombre': 'Nombre del colaborador (solo loc. servicios)',
  'colaborador.cuit': 'CUIT del colaborador',
  'colaborador.domicilio': 'Domicilio del colaborador',
  'colaborador.montoDia': 'Monto por día del colaborador ($)',
};

export default function PlantillasContratistaModal({ onClose }) {
  // Lectura sincronizada (igual patrón que los providers / el catálogo).
  const [plantillas, setPlantillas] = useSyncedSharedData(KEY, [], { lsKey: LS_KEY });

  const [selId, setSelId] = useState(null);
  const [draft, setDraft] = useState('');         // html en edición
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [copiedVar, setCopiedVar] = useState('');
  const savedTimer = useRef(null);

  // Ordena por el orden canónico de TIPOS_DOC (Anexo I, II, III, IV, locaciones)
  // y deja al final cualquier plantilla de tipo no reconocido.
  const ordered = useMemo(() => {
    const orderOf = (tipo) => {
      const i = TIPOS_DOC.findIndex(t => t.id === tipo);
      return i === -1 ? 999 : i;
    };
    return [...(plantillas || [])].sort((a, b) => orderOf(a.tipo) - orderOf(b.tipo));
  }, [plantillas]);

  // Selección inicial: la primera plantilla disponible.
  useEffect(() => {
    if (selId == null && ordered.length > 0) {
      setSelId(ordered[0].id);
      setDraft(ordered[0].html || '');
      setDirty(false);
    }
  }, [ordered, selId]);

  const selected = useMemo(() => (plantillas || []).find(p => p.id === selId) || null, [plantillas, selId]);

  // Si un broadcast remoto trae un html nuevo para la plantilla seleccionada y
  // el usuario NO tiene cambios sin guardar, refrescamos el draft. Si está
  // editando (dirty), respetamos lo que tiene escrito.
  useEffect(() => {
    if (!selected) return;
    if (!dirty) setDraft(selected.html || '');
  }, [selected, dirty]);

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const elegir = (p) => {
    if (dirty && p.id !== selId) {
      const ok = window.confirm('Tenés cambios sin guardar en esta plantilla. ¿Descartarlos?');
      if (!ok) return;
    }
    setSelId(p.id);
    setDraft(p.html || '');
    setDirty(false);
    setSavedMsg('');
  };

  const onChangeDraft = (v) => {
    setDraft(v);
    setDirty(v !== (selected?.html || ''));
    setSavedMsg('');
  };

  const guardar = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setSavedMsg('');
    // Escritura ATÓMICA por id: patchea SOLO el html de esta plantilla en el
    // array remoto, sin pisar las otras 5 (read-modify-write fresco si la RPC
    // no está). Optimista: actualizamos el state local en el acto.
    const ok = await patchItemInSharedArray(KEY, selected.id, { html: draft });
    if (ok) {
      setPlantillas(prev => (prev || []).map(p => p.id === selected.id ? { ...p, html: draft } : p));
      setDirty(false);
      setSavedMsg('Guardado ✓');
    } else {
      setSavedMsg('No se pudo guardar. Reintentá.');
    }
    setSaving(false);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedMsg(''), 3000);
  };

  const copiarVar = async (token) => {
    const text = `{{${token}}}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback para navegadores sin clipboard API (o sin permiso).
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* noop */ }
      document.body.removeChild(ta);
    }
    setCopiedVar(token);
    setTimeout(() => setCopiedVar(c => (c === token ? '' : c)), 1200);
  };

  const cerrar = () => {
    if (dirty) {
      const ok = window.confirm('Tenés cambios sin guardar. ¿Cerrar igual?');
      if (!ok) return;
    }
    onClose?.();
  };

  return (
    <div className="k-modal-overlay" onClick={cerrar}>
      <div
        className="k-modal"
        style={{ width: 'min(96vw, 980px)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>Plantillas de contratista</div>
            <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>Régimen PADIC · editá el texto de los contratos y anexos</div>
          </div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={cerrar}>✕</span>
        </div>

        {/* Body: lista de plantillas (izq) + editor (der) */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', minHeight: 0 }}>
          {/* Lista */}
          <div style={{ width: 240, flexShrink: 0, borderRight: `1.5px solid ${T.faint2}`, overflowY: 'auto', background: T.faint }}>
            {ordered.length === 0 ? (
              <div style={{ padding: 16, fontSize: 12, color: T.ink3 }}>No hay plantillas cargadas.</div>
            ) : ordered.map(p => {
              const active = p.id === selId;
              return (
                <div
                  key={p.id}
                  onClick={() => elegir(p)}
                  style={{
                    padding: '10px 14px',
                    cursor: 'pointer',
                    borderBottom: `1px solid ${T.faint2}`,
                    background: active ? T.paper : 'transparent',
                    borderLeft: `3px solid ${active ? T.accent : 'transparent'}`,
                  }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: active ? 800 : 600, color: active ? T.ink : T.ink2, lineHeight: 1.25 }}>
                    {p.nombre || p.tipo || p.id}
                    {dirty && active && <span style={{ color: T.warn, marginLeft: 4 }}>•</span>}
                  </div>
                  <div style={{ fontSize: 10, color: T.ink3, marginTop: 2, fontFamily: T.fontMono }}>{p.tipo}</div>
                </div>
              );
            })}
          </div>

          {/* Editor */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {!selected ? (
              <div style={{ padding: 24, color: T.ink3, fontSize: 13 }}>Elegí una plantilla de la izquierda para editarla.</div>
            ) : (
              <>
                <div style={{ padding: '12px 16px 8px', flexShrink: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>{selected.nombre}</div>
                  <div style={{ fontSize: 11, color: T.ink3, marginTop: 2 }}>
                    Editás el HTML del documento. Las <b>{'{{variables}}'}</b> se reemplazan al imprimir el contrato.
                  </div>
                </div>

                {/* Variables disponibles (copiables) */}
                <div style={{ padding: '0 16px 8px', flexShrink: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>
                    Variables disponibles · clic para copiar
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 96, overflowY: 'auto' }}>
                    {PLACEHOLDERS.map(token => {
                      const isRaw = RAW_VARS.has(token);
                      const copied = copiedVar === token;
                      return (
                        <span
                          key={token}
                          onClick={() => copiarVar(token)}
                          title={VAR_DESC[token] || token}
                          style={{
                            fontSize: 10.5,
                            fontFamily: T.fontMono,
                            background: copied ? T.ok : (isRaw ? T.accentSoft : T.faint),
                            color: copied ? T.paper : (isRaw ? T.accent : T.ink2),
                            border: `1px solid ${copied ? T.ok : T.faint2}`,
                            borderRadius: 4,
                            padding: '2px 7px',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            userSelect: 'none',
                          }}
                        >
                          {copied ? '¡copiado!' : `{{${token}}}`}
                        </span>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 10, color: T.ink3, marginTop: 4 }}>
                    Las resaltadas (<span style={{ color: T.accent, fontWeight: 700 }}>tablas</span>) insertan HTML armado automáticamente.
                  </div>
                </div>

                {/* Textarea grande */}
                <div style={{ flex: 1, minHeight: 0, padding: '0 16px 8px', display: 'flex' }}>
                  <textarea
                    value={draft}
                    onChange={e => onChangeDraft(e.target.value)}
                    spellCheck={false}
                    style={{
                      flex: 1,
                      width: '100%',
                      resize: 'none',
                      fontFamily: T.fontMono,
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: T.ink,
                      background: T.paper,
                      border: `1.5px solid ${dirty ? T.accent : T.faint2}`,
                      borderRadius: 6,
                      padding: '10px 12px',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: savedMsg.startsWith('No se pudo') ? '#dc2626' : (savedMsg ? T.ok : (dirty ? T.warn : T.ink3)) }}>
            {savedMsg || (dirty ? 'Cambios sin guardar' : 'Sin cambios pendientes')}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn sm onClick={cerrar}>Cerrar</Btn>
            <Btn sm accent fill onClick={guardar} style={{ opacity: (!selected || !dirty || saving) ? 0.5 : 1, pointerEvents: (!selected || !dirty || saving) ? 'none' : 'auto' }}>
              {saving ? 'Guardando…' : 'Guardar plantilla'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
