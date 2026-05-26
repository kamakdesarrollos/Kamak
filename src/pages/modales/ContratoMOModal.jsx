import { Btn } from '../../components/ui';
import { T } from '../../theme';

const fmtN = (n) => Math.round(n).toLocaleString('es-AR');
const fmtM = (n) => `$ ${fmtN(n)}`;
const fmtFecha = () => new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
const fmtD = (iso) => !iso ? '—' : iso.split('-').reverse().join('/');

const STRIPES_SVG = `<svg viewBox="0 0 620 620" width="620" height="620" style="display:block">
  <rect x="-64" y="245" width="900" height="50" fill="#1a9b9c" transform="rotate(62 386 270)"/>
  <rect x="-140" y="285" width="900" height="50" fill="#1a9b9c" transform="rotate(62 310 310)"/>
  <rect x="-216" y="325" width="900" height="50" fill="#1a9b9c" transform="rotate(62 234 350)"/>
</svg>`;

function generarHTMLContrato({ contrato, obra, logoLight, logoDark }) {
  const c = contrato;
  const tareas = Array.isArray(c.tareas) ? c.tareas : [];
  const monto = tareas.length > 0
    ? tareas.reduce((s, t) => s + (t.cantidadContratada || 0) * (t.precioUnit || 0), 0)
    : (c.monto || 0);
  const numContrato = `MO-${new Date().getFullYear()}-${c.id.slice(-4).toUpperCase()}`;
  const fecha = fmtFecha();

  const imgLight = logoLight
    ? `<img src="${logoLight}" style="height:34px;object-fit:contain;display:block" />`
    : `<div class="logo">KAMAK</div>`;
  const imgDark = logoDark
    ? `<img src="${logoDark}" style="height:20px;object-fit:contain;display:block" />`
    : `<div class="logo-sm">KAMAK</div>`;

  // Group tasks by rubro (supports old single-rubro format via c.gremio)
  const rubroGroups = [];
  if (tareas.length > 0) {
    const hasRubroNames = tareas.some(t => t.rubroNombre);
    if (hasRubroNames) {
      const groupMap = new Map();
      tareas.forEach(t => {
        const key = t.rubroNombre || '—';
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key).push(t);
      });
      groupMap.forEach((ts, nombre) => rubroGroups.push({ nombre, tareas: ts }));
    } else {
      rubroGroups.push({ nombre: c.gremio || '', tareas });
    }
  }

  let rowIdx = 0;
  const taskRows = rubroGroups.map(group => {
    const sectionHeader = rubroGroups.length > 1
      ? `<div class="sec-ttl" style="margin-top:6px"><span class="dmnd-sm"></span>${group.nombre.toUpperCase()}</div>`
      : '';
    const rows = group.tareas.map(t => {
      const cls = rowIdx++ % 2 === 1 ? ' alt' : '';
      return `<div class="task-row${cls}">
        <div class="tc tc-name">${t.nombre}</div>
        <div class="tc tc-un">${t.unidad}</div>
        <div class="tc tc-num">${fmtN(t.cantidadContratada)}</div>
        <div class="tc tc-num">${fmtM(t.precioUnit)}</div>
        <div class="tc tc-num bold">${fmtM((t.cantidadContratada || 0) * (t.precioUnit || 0))}</div>
      </div>`;
    }).join('');
    return sectionHeader + rows;
  }).join('');

  const css = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;700&display=swap');
@page{size:A4;margin:0}
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
body{font-family:'Montserrat',sans-serif}
.pag-dark{width:210mm;height:297mm;background:#1f2024;color:#fff;display:flex;flex-direction:column;position:relative;overflow:hidden;page-break-after:always;break-after:page}
.pag-light{width:210mm;background:#fff;color:#2d2d2d;position:relative}
.wm-tr{position:absolute;top:-120px;right:-120px;opacity:.09;pointer-events:none;z-index:0}
.wm-br{position:absolute;bottom:-180px;right:-120px;opacity:.07;pointer-events:none;z-index:0}
.wm-bl{position:absolute;bottom:-160px;left:-120px;opacity:.09;pointer-events:none;z-index:0}
/* portada dark */
.port-hdr{height:70px;padding:16px 44px;display:flex;align-items:center;justify-content:space-between;position:relative;z-index:1}
.logo{font-weight:900;font-size:24px;letter-spacing:2px;color:#fff}
.contact-r{font-size:8.5px;color:#aaa;text-align:right;font-family:'JetBrains Mono',monospace;line-height:1.6}
.teal-rule{height:6px;background:#1a9b9c;position:relative;z-index:1}
.diamond-c{position:absolute;left:50%;top:-10px;margin-left:-10px;width:20px;height:20px;background:#1a9b9c;transform:rotate(45deg);box-shadow:0 0 0 3px #1f2024}
.port-hero{flex:1;padding:32px 56px 20px;display:flex;flex-direction:column;align-items:center;position:relative;z-index:1}
.eyebrow{font-size:10px;letter-spacing:7px;color:#1a9b9c;font-weight:600}
.obra-subtitle{margin-top:10px;font-size:13px;color:#9a9892;letter-spacing:2px;font-family:'JetBrains Mono',monospace;text-align:center;text-transform:uppercase}
.obra-subtitle span{color:#fff;font-weight:700}
.title-frame{margin-top:14px;width:84%;position:relative;padding:24px 26px}
.frame-lbl{position:absolute;top:-2px;left:50%;transform:translateX(-50%);font-size:9px;color:#1a9b9c;letter-spacing:4px;font-family:'JetBrains Mono',monospace;font-weight:700;background:#1f2024;padding:0 12px;white-space:nowrap;z-index:2}
.title-main{font-weight:900;letter-spacing:2px;font-size:26px;text-align:center;line-height:1.15;color:#fff;text-shadow:0 2px 12px rgba(26,155,156,.25)}
.title-num{margin-top:10px;font-size:9.5px;color:#9a9892;font-family:'JetBrains Mono',monospace;letter-spacing:2px;text-align:center}
.corner{position:absolute;width:26px;height:26px}
.c-tl{top:0;left:0;border-top:2px solid #1a9b9c;border-left:2px solid #1a9b9c}
.c-tr{top:0;right:0;border-top:2px solid #1a9b9c;border-right:2px solid #1a9b9c}
.c-bl{bottom:0;left:0;border-bottom:2px solid #1a9b9c;border-left:2px solid #1a9b9c}
.c-br{bottom:0;right:0;border-bottom:2px solid #1a9b9c;border-right:2px solid #1a9b9c}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px 24px;padding:20px 44px;position:relative;z-index:1}
.i-lbl{font-size:9px;color:#1a9b9c;letter-spacing:2px;font-family:'JetBrains Mono',monospace}
.i-val{font-size:14px;font-weight:700;margin-top:4px;color:#fff;line-height:1.2}
.i-sub{font-size:10px;color:#9a9892;margin-top:2px}
.port-ftr{background:#171818;padding:14px 44px;display:grid;grid-template-columns:1fr 1fr;gap:14px 20px;position:relative;z-index:1}
.cell-lbl{font-size:9px;color:#1a9b9c;letter-spacing:2px;font-family:'JetBrains Mono',monospace}
.cell-val{font-size:13px;font-weight:700;margin-top:4px;color:#fff}
.cell-val-lg{font-size:18px;font-weight:800;margin-top:3px;color:#fff}
.cell-sub{font-size:10px;color:#9a9892;margin-top:2px}
/* computo light */
.comp-hdr{padding:10px 30px;display:flex;align-items:center;justify-content:space-between;border-bottom:1.5px solid #1f2024;position:relative;z-index:1}
.logo-sm{font-weight:900;font-size:15px;letter-spacing:2px;color:#1f2024}
.comp-meta{font-size:8px;color:#5a5a58;font-family:'JetBrains Mono',monospace;letter-spacing:.8px}
.sec-ttl{display:flex;align-items:center;gap:9px;font-size:11px;font-weight:800;letter-spacing:1.5px;color:#1a9b9c;margin-bottom:4px;padding:8px 30px 4px}
.dmnd-sm{display:inline-block;width:9px;height:9px;background:#1a9b9c;transform:rotate(45deg);flex-shrink:0}
.tbl-hdr{display:flex;padding:5px 30px;background:#1f2024;color:#fff;font-size:7.5px;font-family:'JetBrains Mono',monospace;letter-spacing:1.2px}
.task-row{display:flex;padding:4px 30px;border-bottom:1px solid #e4e0d2;font-size:10px}
.task-row.alt{background:#fafafa}
.tc{display:flex;align-items:center}
.tc-name{flex:3}
.tc-un{flex:.5;justify-content:center}
.tc-num{flex:1.2;justify-content:flex-end;font-family:'JetBrains Mono',monospace}
.bold{font-weight:700}
.totales-strip{padding:10px 30px;display:flex;justify-content:flex-end}
.totales-box{width:280px;background:#1f2024;color:#fff;padding:12px 15px;position:relative}
.dmnd-corner{position:absolute;top:-6px;right:15px;width:12px;height:12px;background:#1a9b9c;transform:rotate(45deg)}
.tot-lbl{font-size:8.5px;letter-spacing:2px;color:#1a9b9c;font-family:'JetBrains Mono',monospace}
.tot-rule{height:1px;background:#1a9b9c;margin:7px 0}
.tot-final{display:flex;justify-content:space-between;font-weight:800;font-size:13px}
.tot-val{font-size:16px}
.cond-sec{padding:10px 30px}
.cond-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 24px}
.c-lbl{font-size:9px;color:#5a5a58;font-family:'JetBrains Mono',monospace;letter-spacing:1px}
.c-val{font-size:11px;font-weight:600;color:#2d2d2d;margin-top:3px}
.comp-ftr{padding:8px 30px;border-top:1.5px solid #1f2024;display:flex;justify-content:space-between;font-size:7.5px;color:#5a5a58;font-family:'JetBrains Mono',monospace;margin-top:12px}
@media print{
  @page{size:A4;margin:0}
  html,body{margin:0!important;padding:0!important;width:210mm}
  .pag-dark,.pag-light{margin:0!important;box-shadow:none!important}
}
@media screen{
  html{background:#555}
  body{margin:0 auto;padding:16px 0;width:794px}
  .pag-dark,.pag-light{box-shadow:0 4px 24px rgba(0,0,0,.4);margin-bottom:16px}
}`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=794, initial-scale=1.0">
<title>Contrato MO — ${c.proveedor || c.gremio}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>

<div class="pag-dark">
  <div class="wm-tr">${STRIPES_SVG}</div>
  <div class="port-hdr">${imgLight}<div class="contact-r">7630 NECOCHEA<br>BUENOS AIRES · ARGENTINA<br>KAMAKDESARROLLOS@GMAIL.COM</div></div>
  <div class="teal-rule"><div class="diamond-c"></div></div>
  <div class="port-hero">
    <div class="eyebrow">CONTRATO DE MANO DE OBRA</div>
    <div class="obra-subtitle">OBRA · <span>${(obra?.nombre || '—').toUpperCase()}</span></div>
    <div class="title-frame">
      <div class="frame-lbl">◆ CONTRATISTA ◆</div>
      <div class="corner c-tl"></div><div class="corner c-tr"></div>
      <div class="corner c-bl"></div><div class="corner c-br"></div>
      <div class="title-main">${(c.proveedor || c.gremio || '').toUpperCase()}</div>
      <div class="title-num">${numContrato} &nbsp;·&nbsp; ${fecha}</div>
    </div>
  </div>
  <div class="info-grid">
    <div><div class="i-lbl">CONTRATANTE</div><div class="i-val">Kamak Desarrollos SRL</div></div>
    <div><div class="i-lbl">CONTRATISTA</div><div class="i-val">${c.proveedor || '—'}</div>${c.cuit ? `<div class="i-sub">CUIT ${c.cuit}</div>` : ''}</div>
    <div><div class="i-lbl">OBRA</div><div class="i-val">${obra?.nombre || '—'}</div></div>
    <div><div class="i-lbl">PERÍODO DE OBRA</div><div class="i-val" style="font-size:12px">${fmtD(c.fechaInicio)} → ${fmtD(c.fechaFin)}</div></div>
  </div>
  <div class="port-ftr">
    <div><div class="cell-lbl">FORMA DE PAGO</div><div class="cell-val">${c.formaPago || 'Por avance certificado'}</div></div>
    <div><div class="cell-lbl">MONTO TOTAL MO</div><div class="cell-val-lg">${fmtM(monto)}</div><div class="cell-sub">+ IVA · Fondo reparo ${c.fondoReparo || 5}%</div></div>
  </div>
</div>

<div class="pag-light">
  <div class="wm-br">${STRIPES_SVG}</div>
  <div class="comp-hdr">${imgDark}<div class="comp-meta">CONTRATO MO · ${(c.proveedor || c.gremio || '').toUpperCase()} · ${numContrato}</div></div>
  <div class="sec-ttl"><span class="dmnd-sm"></span>ALCANCE DE TRABAJOS</div>
  <div class="tbl-hdr">
    <div class="tc tc-name">DESCRIPCIÓN</div>
    <div class="tc tc-un">UN</div>
    <div class="tc tc-num">CANT</div>
    <div class="tc tc-num">P. UNIT MO</div>
    <div class="tc tc-num">TOTAL MO</div>
  </div>
  ${taskRows || `<div class="task-row"><div class="tc tc-name" style="color:#9a9892;font-style:italic">Contrato global sin desglose de tareas</div><div class="tc tc-num bold">${fmtM(monto)}</div></div>`}
  <div class="totales-strip">
    <div class="totales-box">
      <div class="dmnd-corner"></div>
      <div class="tot-lbl">TOTAL MANO DE OBRA</div>
      <div class="tot-rule"></div>
      <div class="tot-final"><span>TOTAL MO</span><span class="tot-val">${fmtM(monto)}</span></div>
    </div>
  </div>
  <div class="sec-ttl" style="margin-top:10px"><span class="dmnd-sm"></span>CONDICIONES CONTRACTUALES</div>
  <div class="cond-sec">
    <div class="cond-grid">
      <div><div class="c-lbl">FORMA DE PAGO</div><div class="c-val">${c.formaPago || 'Por avance certificado mensualmente'}</div></div>
      <div><div class="c-lbl">FONDO DE REPARO</div><div class="c-val">${c.fondoReparo || 5}% retenido hasta recepción definitiva</div></div>
      <div><div class="c-lbl">FECHA INICIO</div><div class="c-val">${fmtD(c.fechaInicio)}</div></div>
      <div><div class="c-lbl">FECHA FIN ESTIMADA</div><div class="c-val">${fmtD(c.fechaFin)}</div></div>
      <div><div class="c-lbl">OBRA</div><div class="c-val">${obra?.nombre || '—'}</div></div>
      <div><div class="c-lbl">CONTRATO N°</div><div class="c-val" style="font-family:'JetBrains Mono',monospace">${numContrato}</div></div>
    </div>
  </div>
  <div class="comp-ftr">
    <span>KAMAK DESARROLLOS · KAMAKDESARROLLOS@GMAIL.COM</span>
    <span>NO INCLUYE IVA</span>
    <span>2 / 2</span>
  </div>
</div>

</body>
</html>`;
}

export default function ContratoMOModal({ onClose, contrato, obra }) {
  const tareas = Array.isArray(contrato?.tareas) ? contrato.tareas : [];
  const monto = tareas.length > 0
    ? tareas.reduce((s, t) => s + (t.cantidadContratada || 0) * (t.precioUnit || 0), 0)
    : (contrato?.monto || 0);

  const imprimir = () => {
    const origin = window.location.origin;
    const html = generarHTMLContrato({
      contrato,
      obra,
      logoLight: `${origin}/assets/kamak-logo-light.png`,
      logoDark: `${origin}/assets/kamak-logo.png`,
    });
    const w = window.open('', '_blank', 'width=794,height=1000,scrollbars=yes');
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 900);
  };

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 640, maxHeight: '88vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>Contrato MO · {contrato?.proveedor || contrato?.gremio}</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              {[...new Set((contrato?.tareas || []).map(t => t.rubroNombre).filter(Boolean))].join(' · ') || contrato?.gremio || '—'}
            </div>
          </div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Info cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              { label: 'Contratista', val: contrato?.proveedor || '—' },
              { label: 'CUIT', val: contrato?.cuit || '—' },
              { label: 'Forma de pago', val: contrato?.formaPago || '—' },
              { label: 'Fondo de reparo', val: `${contrato?.fondoReparo || 5}%` },
            ].map(k => (
              <div key={k.label} style={{ background: T.faint, borderRadius: 4, padding: '8px 12px' }}>
                <div style={{ fontSize: 10, color: T.ink3, marginBottom: 3 }}>{k.label}</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{k.val}</div>
              </div>
            ))}
          </div>

          {/* Task list grouped by rubro */}
          {tareas.length > 0 && (() => {
            const hasRubroNames = tareas.some(t => t.rubroNombre);
            const groups = hasRubroNames
              ? [...tareas.reduce((m, t) => { const k = t.rubroNombre || '—'; if (!m.has(k)) m.set(k, []); m.get(k).push(t); return m; }, new Map()).entries()].map(([nombre, ts]) => ({ nombre, tareas: ts }))
              : [{ nombre: contrato?.gremio || '', tareas }];
            let rowIdx = 0;
            return (
              <div style={{ borderRadius: 4, overflow: 'hidden', border: `1px solid ${T.faint2}` }}>
                <div style={{ background: T.dark, color: T.paper, padding: '6px 12px', fontSize: 10, fontWeight: 700, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ width: 8, height: 8, background: T.accent, transform: 'rotate(45deg)' }} />
                  {tareas.length} tarea{tareas.length !== 1 ? 's' : ''}
                </div>
                {groups.map(group => (
                  <div key={group.nombre}>
                    {groups.length > 1 && (
                      <div style={{ background: T.faint2, padding: '4px 12px', fontSize: 10, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>{group.nombre}</div>
                    )}
                    {group.tareas.map((t) => {
                      const i = rowIdx++;
                      return (
                        <div key={i} style={{ display: 'flex', padding: '6px 12px', borderBottom: `1px solid ${T.faint2}`, fontSize: 11, background: i % 2 ? T.faint : T.paper, alignItems: 'center' }}>
                          <span style={{ flex: 3 }}>{t.nombre}</span>
                          <span style={{ flex: 0.5, color: T.ink2, textAlign: 'center' }}>{t.unidad}</span>
                          <span style={{ flex: 0.7, fontFamily: T.fontMono, textAlign: 'right' }}>{t.cantidadContratada}</span>
                          <span style={{ flex: 1.2, fontFamily: T.fontMono, textAlign: 'right', color: T.ink2 }}>$ {Math.round(t.precioUnit).toLocaleString('es-AR')}</span>
                          <span style={{ flex: 1.2, fontFamily: T.fontMono, textAlign: 'right', fontWeight: 700 }}>$ {Math.round((t.cantidadContratada || 0) * (t.precioUnit || 0)).toLocaleString('es-AR')}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div style={{ display: 'flex', padding: '7px 12px', background: T.accentSoft, fontSize: 12, fontWeight: 800 }}>
                  <span style={{ flex: 1 }}>TOTAL MO</span>
                  <span style={{ fontFamily: T.fontMono }}>$ {Math.round(monto).toLocaleString('es-AR')}</span>
                </div>
              </div>
            );
          })()}

          {tareas.length === 0 && (
            <div style={{ background: T.faint, borderRadius: 4, padding: '12px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: T.ink2 }}>Monto global del contrato</div>
              <div style={{ fontSize: 20, fontWeight: 800, fontFamily: T.fontMono, color: T.accent, marginTop: 4 }}>$ {Math.round(monto).toLocaleString('es-AR')}</div>
            </div>
          )}
        </div>

        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm accent onClick={imprimir}>Imprimir / Guardar PDF</Btn>
        </div>
      </div>
    </div>
  );
}
