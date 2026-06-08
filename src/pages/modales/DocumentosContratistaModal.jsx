import { useState, useMemo, useEffect } from 'react';
import { Btn } from '../../components/ui';
import { T } from '../../theme';
import { abrirHTML } from '../../lib/html';
import useSyncedSharedData from '../../lib/useSyncedSharedData';
import { TIPOS_DOC, renderDocContratista, datosDocContratista } from '../../lib/contratistaDocs';

// Generador / impresión de los documentos de contratista (Régimen PADIC).
//
// Por cada contrato (de la pestaña "Contratos MO") este modal lista los 6
// TIPOS_DOC. Para cada tipo toma su PLANTILLA editable de
// shared_data['crm_plantillas_contratistas'] (mismo array que edita
// PlantillasContratistaModal) y la renderiza reemplazando las {{variables}}
// con datosDocContratista(contrato, obra, colaborador, hoyISO).
//
// El tipo `locacion_servicios` es porColaborador:true → se genera UNA copia por
// cada colaborador del contrato (con sus datos personales).
//
// El preview muestra el HTML renderizado tal cual saldría impreso. "Imprimir"
// abre el documento en una pestaña nueva (Blob URL, anti-XSS, igual patrón que
// ContratoMOModal) para usar Ctrl+P / Guardar como PDF del navegador.

const KEY = 'crm_plantillas_contratistas';
const LS_KEY = 'kamak_plantillas_contratistas_v1';

// CSS mínimo de impresión: A4, márgenes razonables, tablas legibles. El HTML de
// las plantillas es texto legal; lo envolvemos para que imprima prolijo.
const PRINT_CSS = `
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: 'Segoe UI', Arial, sans-serif; color: #1f2024; font-size: 13px; line-height: 1.55; margin: 0; }
.doc-wrap { max-width: 720px; margin: 0 auto; padding: 24px; }
h1, h2, h3 { color: #1f2024; }
table { width: 100%; border-collapse: collapse; margin: 10px 0; }
th, td { padding: 5px 7px; }
@media screen {
  html { background: #555; }
  body { padding: 24px 0; }
  .doc-wrap { background: #fff; box-shadow: 0 4px 24px rgba(0,0,0,.4); border-radius: 4px; }
}
@media print {
  html, body { background: #fff !important; }
  .doc-wrap { box-shadow: none !important; max-width: none; padding: 0; }
}`;

const wrapHtml = (title, innerHtml) => `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=794, initial-scale=1.0">
<title>${title}</title>
<style>${PRINT_CSS}</style>
</head>
<body><div class="doc-wrap">${innerHtml}</div></body>
</html>`;

export default function DocumentosContratistaModal({ contrato, obra, onClose }) {
  // Mismo patrón de lectura que el editor de plantillas (y el resto de la app).
  const [plantillas] = useSyncedSharedData(KEY, [], { lsKey: LS_KEY });

  // hoyISO: fecha de hoy en runtime del browser, ISO string (la lib la usa para
  // armar la fecha del documento).
  const hoyISO = useMemo(() => new Date().toISOString(), []);

  const colaboradores = useMemo(
    () => (Array.isArray(contrato?.colaboradores) ? contrato.colaboradores : []),
    [contrato],
  );

  // Mapa tipo → plantilla (la primera de cada tipo). Si faltara alguna, el item
  // queda marcado como "sin plantilla" y no se puede imprimir.
  const plantillaPorTipo = useMemo(() => {
    const m = {};
    (plantillas || []).forEach(p => { if (p?.tipo && !m[p.tipo]) m[p.tipo] = p; });
    return m;
  }, [plantillas]);

  // Lista de documentos a generar. Cada item del set PADIC genera un doc; el
  // tipo porColaborador genera uno por cada colaborador del contrato.
  const docs = useMemo(() => {
    const out = [];
    TIPOS_DOC.forEach(tipo => {
      const plantilla = plantillaPorTipo[tipo.id] || null;
      if (tipo.porColaborador) {
        if (colaboradores.length === 0) {
          // Sin colaboradores no hay locación de servicios que emitir; dejamos
          // un item informativo (sin colaborador) para que se entienda por qué.
          out.push({ key: `${tipo.id}__none`, tipo, plantilla, colaborador: null, sinColaboradores: true });
        } else {
          colaboradores.forEach(co => {
            out.push({ key: `${tipo.id}__${co.id || co.dni || co.cuit || co.nombre}`, tipo, plantilla, colaborador: co, sinColaboradores: false });
          });
        }
      } else {
        out.push({ key: tipo.id, tipo, plantilla, colaborador: null, sinColaboradores: false });
      }
    });
    return out;
  }, [plantillaPorTipo, colaboradores]);

  const [selKey, setSelKey] = useState(null);

  // Selección inicial: el primer documento con plantilla disponible.
  useEffect(() => {
    if (selKey == null && docs.length > 0) {
      const firstConPlantilla = docs.find(d => d.plantilla && !d.sinColaboradores) || docs[0];
      setSelKey(firstConPlantilla.key);
    }
  }, [docs, selKey]);

  const selected = useMemo(() => docs.find(d => d.key === selKey) || null, [docs, selKey]);

  // HTML renderizado del documento seleccionado (variables ya reemplazadas).
  const renderedHtml = useMemo(() => {
    if (!selected || !selected.plantilla || selected.sinColaboradores) return '';
    const valores = datosDocContratista(contrato, obra, selected.colaborador, hoyISO);
    return renderDocContratista(selected.plantilla.html || '', valores);
  }, [selected, contrato, obra, hoyISO]);

  const tituloDoc = (d) => {
    if (!d) return '';
    if (d.tipo.porColaborador && d.colaborador) {
      return `${d.tipo.nombre} · ${d.colaborador.nombre || d.colaborador.dni || d.colaborador.cuit || 'Colaborador'}`;
    }
    return d.tipo.nombre;
  };

  const imprimir = () => {
    if (!selected || !renderedHtml) return;
    const html = wrapHtml(`${tituloDoc(selected)} — ${contrato?.proveedor || ''}`, renderedHtml);
    const w = abrirHTML(html, { width: 860, height: 1200 });
    if (w) setTimeout(() => { try { w.focus(); w.print(); } catch { /* noop */ } }, 600);
  };

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div
        className="k-modal"
        style={{ width: 'min(96vw, 1040px)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>📄 Documentos · {contrato?.proveedor || contrato?.gremio || '—'}</div>
            <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>Régimen PADIC · obra {obra?.nombre || '—'}</div>
          </div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>

        {/* Body: lista de docs (izq) + preview (der) */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', minHeight: 0 }}>
          {/* Lista */}
          <div style={{ width: 280, flexShrink: 0, borderRight: `1.5px solid ${T.faint2}`, overflowY: 'auto', background: T.faint }}>
            {docs.map(d => {
              const active = d.key === selKey;
              const disponible = !!d.plantilla && !d.sinColaboradores;
              return (
                <div
                  key={d.key}
                  onClick={() => setSelKey(d.key)}
                  style={{
                    padding: '10px 14px',
                    cursor: 'pointer',
                    borderBottom: `1px solid ${T.faint2}`,
                    background: active ? T.paper : 'transparent',
                    borderLeft: `3px solid ${active ? T.accent : 'transparent'}`,
                    opacity: disponible ? 1 : 0.6,
                  }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: active ? 800 : 600, color: active ? T.ink : T.ink2, lineHeight: 1.25 }}>
                    {d.tipo.nombre}
                  </div>
                  {d.tipo.porColaborador && d.colaborador && (
                    <div style={{ fontSize: 11, color: active ? T.accent : T.ink2, marginTop: 2, fontWeight: 600 }}>
                      {d.colaborador.nombre || d.colaborador.dni || d.colaborador.cuit || 'Colaborador'}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: T.ink3, marginTop: 2, fontFamily: T.fontMono }}>
                    {d.sinColaboradores
                      ? 'sin colaboradores'
                      : (d.plantilla ? d.tipo.id : 'sin plantilla')}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Preview */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#555' }}>
            {!selected ? (
              <div style={{ padding: 24, color: T.paper, fontSize: 13 }}>Elegí un documento de la lista.</div>
            ) : selected.sinColaboradores ? (
              <div style={{ padding: 24, color: T.paper, fontSize: 13, lineHeight: 1.6 }}>
                Este contrato no tiene colaboradores cargados, así que no hay
                <b> {selected.tipo.nombre}</b> para emitir. Agregá colaboradores
                al contrato (Editar → Colaboradores) y volvé a este modal.
              </div>
            ) : !selected.plantilla ? (
              <div style={{ padding: 24, color: T.paper, fontSize: 13, lineHeight: 1.6 }}>
                No hay una plantilla cargada para <b>{selected.tipo.nombre}</b>
                {' '}(tipo <code>{selected.tipo.id}</code>). Cargala desde
                {' '}⚙ Plantillas en la pestaña Contratos MO.
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px' }}>
                <div
                  style={{
                    maxWidth: 760,
                    margin: '0 auto',
                    background: '#fff',
                    color: '#1f2024',
                    borderRadius: 4,
                    boxShadow: '0 4px 24px rgba(0,0,0,.4)',
                    padding: '32px 36px',
                    fontFamily: "'Segoe UI', Arial, sans-serif",
                    fontSize: 13,
                    lineHeight: 1.55,
                  }}
                  dangerouslySetInnerHTML={{ __html: renderedHtml }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11.5, color: T.ink3 }}>
            {selected ? tituloDoc(selected) : ''}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn sm onClick={onClose}>Cerrar</Btn>
            <Btn
              sm accent fill
              onClick={imprimir}
              style={{ opacity: (!selected || !renderedHtml) ? 0.5 : 1, pointerEvents: (!selected || !renderedHtml) ? 'none' : 'auto' }}
            >
              🖨 Imprimir
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
