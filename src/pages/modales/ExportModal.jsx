import { useState } from 'react';
import { Btn, Label, Divider } from '../../components/ui';
import { T } from '../../theme';
import { useDolar } from '../../store/DolarContext';
import { esc } from '../../lib/html';
import PrintPreviewModal from './PrintPreviewModal';
import { buildWaMeLink, generateQrDataUrl } from '../../lib/clienteAcceso';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtN = (n) => Math.round(n).toLocaleString('es-AR');
const fmtM = (n, m) => m === 'USD' ? `U$S ${fmtN(n)}` : `$ ${fmtN(n)}`;
const fmtFecha = () => new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });

const tareaVentaUnit = (t, rubro) => {
  const cu = t.costoMat + (t.costoSub || 0);
  if (t.margenLinea != null) return cu * (1 + t.margenLinea / 100);
  return t.costoMat * (1 + rubro.margenMat / 100) + (t.costoSub || 0) * (1 + rubro.margenMO / 100);
};

const calcRubroExport = (rubro) => {
  let cMat = 0, cSub = 0, venta = 0;
  for (const t of rubro.tareas.filter(t => t.tipo !== 'seccion')) {
    cMat += t.costoMat * t.cantidad;
    cSub += (t.costoSub || 0) * t.cantidad;
    venta += tareaVentaUnit(t, rubro) * t.cantidad;
  }
  return { cMat, cSub, costo: cMat + cSub, venta };
};

// overflow:visible + rectangulos extendidos (width 1500) para que las 3 rayas
// lleguen de borde a borde del margen, no solo la del centro. Antes con width
// 900 las laterales se cortaban antes de tocar el borde del SVG.
const STRIPES_SVG = `<svg viewBox="0 0 620 620" width="620" height="620" style="display:block;overflow:visible">
  <rect x="-364" y="245" width="1500" height="50" fill="#1a9b9c" transform="rotate(62 386 270)"/>
  <rect x="-440" y="285" width="1500" height="50" fill="#1a9b9c" transform="rotate(62 310 310)"/>
  <rect x="-516" y="325" width="1500" height="50" fill="#1a9b9c" transform="rotate(62 234 350)"/>
</svg>`;

const CORNER_BRACKETS = `
  <div style="position:absolute;top:0;left:0;width:28px;height:28px;border-top:2px solid #1a9b9c;border-left:2px solid #1a9b9c;"></div>
  <div style="position:absolute;top:0;right:0;width:28px;height:28px;border-top:2px solid #1a9b9c;border-right:2px solid #1a9b9c;"></div>
  <div style="position:absolute;bottom:0;left:0;width:28px;height:28px;border-bottom:2px solid #1a9b9c;border-left:2px solid #1a9b9c;"></div>
  <div style="position:absolute;bottom:0;right:0;width:28px;height:28px;border-bottom:2px solid #1a9b9c;border-right:2px solid #1a9b9c;"></div>`;

// ── HTML generator ────────────────────────────────────────────────────────────
function generarHTML({ obra, detalle, vigencia, nota, condiciones, formaPago, logoLight, logoDark, dolarVenta, qrDataUrl }) {
  const tc = dolarVenta || 1;
  const toUSD = n => Math.round(n / tc).toLocaleString('es-AR');
  const rubros = detalle?.rubros || [];
  const rr = rubros.map(r => ({ ...r, ...calcRubroExport(r) }));
  const totalVenta = rr.reduce((s, r) => s + r.venta, 0);
  const totalMat   = rr.reduce((s, r) => s + r.cMat, 0);
  const totalSub   = rr.reduce((s, r) => s + r.cSub, 0);
  const moneda = obra?.moneda || 'ARS';
  const fecha = fmtFecha();
  const numPresu = `PRES-${new Date().getFullYear()}-${String(rubros.length * 7 + 42).padStart(3, '0')}`;
  const totalPags = condiciones ? 3 : 2;

  const imgLight = logoLight
    ? `<img src="${logoLight}" style="height:36px;object-fit:contain;display:block" />`
    : `<div class="logo">KAMAK</div>`;
  const imgDark = logoDark
    ? `<img src="${logoDark}" style="height:22px;object-fit:contain;display:block" />`
    : `<div class="logo-sm">KAMAK</div>`;

  // ─ Portada (dark, fixed A4 portrait page) ─
  const portada = `
  <div class="portada-page dark">
    <div class="wm-tr">${STRIPES_SVG}</div>
    <div class="portada-hdr">
      ${imgLight}
      <div class="contact-r">7630 NECOCHEA<br>BUENOS AIRES · ARGENTINA<br>KAMAKDESARROLLOS@GMAIL.COM</div>
    </div>
    <div class="teal-rule"><div class="diamond-c"></div></div>
    <div class="portada-hero">
      <div class="eyebrow">CÓMPUTO Y PRESUPUESTO</div>
      <div class="proj-frame">
        <div class="frame-lbl">◆ NOMBRE DE LA OBRA ◆</div>
        ${CORNER_BRACKETS}
        <div class="proj-name">${esc((obra?.nombre || 'OBRA').toUpperCase())}</div>
      </div>
      <div class="sub-row">
        <div class="hairline"></div>
        <div class="subtitle">PRESUPUESTO DE OBRA</div>
        <div class="hairline"></div>
      </div>
      <div class="portada-num">${numPresu} &nbsp;·&nbsp; ${fecha}</div>
    </div>
    <div class="portada-ftr">
      <div><div class="cell-lbl">CLIENTE</div><div class="cell-val">${esc(obra?.cliente || '—')}</div></div>
      <div><div class="cell-lbl">TIPO DE OBRA</div><div class="cell-val">${esc(obra?.tipo || '—')}</div></div>
      <div><div class="cell-lbl">FECHA · VIGENCIA</div><div class="cell-val">${fecha}</div><div class="cell-sub">Vigencia: ${vigencia} días</div></div>
      <div><div class="cell-lbl">MONTO TOTAL</div><div class="cell-val-lg">U$S ${toUSD(totalVenta)}</div><div class="cell-sub">+ IVA</div></div>
    </div>
  </div>`;

  // ─ Cómputo (light, flows naturally across print pages — no fixed height) ─
  const rubroSections = rr.map((rubro, ri) => {
    const taskRows = rubro.tareas.map((t, ti) => {
      const vu = tareaVentaUnit(t, rubro);
      return `<div class="task-row${ti % 2 === 1 ? ' alt' : ''}">
        <div class="tc tc-name">${esc(t.nombre)}${t.codigo ? ` <span class="t-code">[${esc(t.codigo)}]</span>` : ''}</div>
        <div class="tc tc-un">${t.unidad}</div>
        <div class="tc tc-num">${fmtN(t.cantidad)}</div>
        <div class="tc tc-num">U$S ${toUSD(vu)}</div>
        <div class="tc tc-num bold">U$S ${toUSD(vu * t.cantidad)}</div>
      </div>`;
    }).join('');

    return `<div class="rubro-sec">
      <div class="rubro-ttl"><span class="dmnd-sm"></span>RUBRO ${String(ri + 1).padStart(2, '0')} · ${esc(rubro.nombre.toUpperCase())}</div>
      <div class="tbl-hdr">
        <div class="tc tc-name">TAREA / DESCRIPCIÓN</div>
        <div class="tc tc-un">UN</div>
        <div class="tc tc-num">CANT</div>
        <div class="tc tc-num">U$S UNIT</div>
        <div class="tc tc-num">U$S SUBTOTAL</div>
      </div>
      ${taskRows}
      <div class="rubro-sub">
        <div class="tc tc-name">SUBTOTAL RUBRO ${String(ri + 1).padStart(2, '0')}</div>
        <div class="tc tc-num gray" style="flex:1.5;">${rubro.tareas.length} tareas</div>
        <div class="tc tc-num bold-lg">U$S ${toUSD(rubro.venta)}</div>
      </div>
    </div>`;
  }).join('');

  const rubrosList = rr.map((r, i) => `<div>${String(i + 1).padStart(2, '0')} · ${esc(r.nombre)}</div>`).join('');

  const computo = `
  <div class="comp-flow light">
    <div class="wm-br">${STRIPES_SVG}</div>
    <div class="comp-hdr">
      ${imgDark}
      <div class="comp-meta">CÓMPUTO Y PRESUPUESTO · ${esc((obra?.nombre || '').toUpperCase())} · ${esc(numPresu)}</div>
    </div>
    <div class="comp-body">${rubroSections}</div>
    <div class="totales-strip">
      <div class="rubros-list">
        <div class="rubros-ttl">RUBROS INCLUIDOS</div>
        ${rubrosList}
      </div>
      <div class="totales-box">
        <div class="dmnd-corner"></div>
        <div class="totales-lbl">MONTOS TOTALES</div>
        <div class="totales-grid">
          <span>Subtotal materiales</span><span class="mono">$ ${fmtN(totalMat)}</span>
          <span>Subtotal subcontratos</span><span class="mono">$ ${fmtN(totalSub)}</span>
        </div>
        <div class="totales-rule"></div>
        <div class="total-final">
          <span>TOTAL USD</span>
          <span class="total-val">U$S ${toUSD(totalVenta)} <span class="iva">+ IVA</span></span>
        </div>
        <div style="margin-top:4px;font-size:9px;color:#9a9892;font-family:'JetBrains Mono',monospace;letter-spacing:1px;text-align:right">TC BNA $${Math.round(tc).toLocaleString('es-AR')}</div>
        ${nota ? `<div class="nota-pie">${esc(nota)}</div>` : ''}
      </div>
    </div>
    <div class="comp-ftr">
      <span>KAMAK DESARROLLOS · KAMAKDESARROLLOS@GMAIL.COM</span>
      <span>NO INCLUYE IVA · VIGENCIA ${vigencia} DÍAS</span>
      <span>2 / ${totalPags}</span>
    </div>
  </div>`;

  // ─ Condiciones (dark, fixed A4 portrait page, starts on new page) ─
  const condicionesPage = !condiciones ? '' : `
  <div class="cond-page dark">
    <div class="wm-bl">${STRIPES_SVG}</div>
    <div class="cond-hdr">
      ${imgLight}
      <div class="contact-r">${esc((obra?.nombre || '').toUpperCase())}<br>${esc(numPresu)}</div>
    </div>
    <div style="height:4px;background:#1a9b9c;"></div>
    <div class="cond-body">
      <div class="cond-title-row">
        <span class="dmnd-lg"></span>
        <h1 class="cond-h1">FORMAS DE PAGO</h1>
      </div>
      <div class="cond-grid">
        <div>
          <div class="cond-sec-lbl">CONDICIONES GENERALES</div>
          <div class="cond-txt">
            ${formaPago.split('\n').filter(l => l.trim()).map(l => `<p>${esc(l.trim())}</p>`).join('')}
            <p style="margin-top:12px;color:#9a9892;font-size:10px">Vigencia: <b>${vigencia} días</b> desde la fecha de emisión · ${fecha}</p>
          </div>
        </div>
        <div>
          <div class="cond-sec-lbl">RESUMEN ECONÓMICO</div>
          <div class="cond-totales">
            <div class="dmnd-corner"></div>
            <div class="totales-grid-sm">
              <span>Subtotal mat.</span><span class="mono">$ ${fmtN(totalMat)}</span>
              <span>Subtotal sub.</span><span class="mono">$ ${fmtN(totalSub)}</span>
            </div>
            <div class="totales-rule"></div>
            <div class="total-final">
              <span>TOTAL</span>
              <span class="total-val">U$S ${toUSD(totalVenta)} <span class="iva">+ IVA</span></span>
            </div>
            <div style="margin-top:6px;padding-top:6px;border-top:1px solid #2a4a4a;display:flex;justify-content:space-between;align-items:baseline">
              <span style="font-size:8px;color:#9a9892;font-family:'JetBrains Mono',monospace">TC BNA $${Math.round(tc).toLocaleString('es-AR')}</span>
              <span style="font-size:9px;color:#9a9892;font-family:'JetBrains Mono',monospace">$ ${fmtN(totalVenta)} ARS</span>
            </div>
          </div>
          ${nota ? `<div class="cond-nota">${esc(nota)}</div>` : ''}
          ${qrDataUrl ? `
          <div style="margin-top:14px;background:#171818;padding:12px;display:flex;align-items:center;gap:12px">
            <div style="background:#fff;padding:5px;border-radius:3px;flex-shrink:0">
              <img src="${qrDataUrl}" alt="QR portal cliente" style="width:95px;height:95px;display:block"/>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:8.5px;letter-spacing:1.8px;color:#1a9b9c;font-family:'JetBrains Mono',monospace;margin-bottom:4px">PORTAL DEL CLIENTE</div>
              <div style="font-size:10.5px;font-weight:700;color:#fff;line-height:1.2;margin-bottom:4px">Seguí la obra desde tu celular</div>
              <div style="font-size:8.5px;color:#9a9892;line-height:1.35">Escaneá el QR — se abre WhatsApp con el mensaje listo para enviar.</div>
            </div>
          </div>` : ''}
        </div>
      </div>
    </div>
    <div class="cond-ftr">
      <span>7630 NECOCHEA · BUENOS AIRES · ARGENTINA</span>
      <span>KAMAKDESARROLLOS@GMAIL.COM</span>
      <span>${totalPags} / ${totalPags}</span>
    </div>
  </div>`;

  const css = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;700&display=swap');
@page{size:A4;margin:0}
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
body{font-family:'Montserrat',sans-serif}
/* Page containers — portrait A4 */
.portada-page{width:210mm;height:297mm;position:relative;overflow:hidden;display:flex;flex-direction:column;page-break-after:always;break-after:page}
.comp-flow{width:210mm;position:relative}
.cond-page{width:210mm;height:297mm;position:relative;overflow:hidden;display:flex;flex-direction:column;page-break-before:always;break-before:page}
.dark{background:#1f2024;color:#fff}
.light{background:#fff;color:#2d2d2d}
/* watermarks */
.wm-tr{position:absolute;top:-120px;right:-120px;opacity:.09;pointer-events:none;z-index:0}
.wm-br{position:absolute;bottom:-180px;right:-120px;opacity:.07;pointer-events:none;z-index:0}
.wm-bl{position:absolute;bottom:-160px;left:-120px;opacity:.09;pointer-events:none;z-index:0}
/* portada */
.portada-hdr{height:70px;padding:16px 44px;display:flex;align-items:center;justify-content:space-between;position:relative;z-index:1}
.logo{font-weight:900;font-size:24px;letter-spacing:2px}
.contact-r{font-size:8.5px;color:#aaa;text-align:right;font-family:'JetBrains Mono',monospace;line-height:1.6}
.teal-rule{height:6px;background:#1a9b9c;position:relative;z-index:1}
.diamond-c{position:absolute;left:50%;top:-10px;margin-left:-10px;width:20px;height:20px;background:#1a9b9c;transform:rotate(45deg);box-shadow:0 0 0 3px #1f2024}
.portada-hero{flex:1;padding:50px 56px 30px;display:flex;flex-direction:column;align-items:center;position:relative;z-index:1}
.eyebrow{font-size:10px;letter-spacing:8px;color:#1a9b9c;font-weight:600}
.proj-frame{margin-top:22px;width:82%;position:relative;padding:30px 26px}
.frame-lbl{position:absolute;top:-2px;left:50%;transform:translateX(-50%);font-size:9px;color:#1a9b9c;letter-spacing:4px;font-family:'JetBrains Mono',monospace;font-weight:700;background:#1f2024;padding:0 12px;white-space:nowrap;z-index:2}
.proj-name{font-weight:900;letter-spacing:2px;font-size:28px;text-align:center;line-height:1.15;color:#fff;text-shadow:0 2px 12px rgba(26,155,156,.25)}
.sub-row{margin-top:22px;width:65%;display:flex;align-items:center;gap:14px}
.hairline{flex:1;height:1px;background:#3a3a3e}
.subtitle{font-weight:700;font-size:11px;letter-spacing:5px;color:#9a9892;white-space:nowrap}
.portada-num{margin-top:10px;font-size:9.5px;color:#9a9892;font-family:'JetBrains Mono',monospace;letter-spacing:2px}
.portada-ftr{background:#171818;padding:18px 44px 20px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:auto auto;gap:18px 28px;position:relative;z-index:1}
.cell-lbl{font-size:10px;color:#1a9b9c;letter-spacing:2px;font-family:'JetBrains Mono',monospace}
.cell-val{font-size:15px;font-weight:700;margin-top:5px;color:#fff;line-height:1.2}
.cell-val-lg{font-size:22px;font-weight:800;margin-top:3px;color:#fff;line-height:1.1}
.cell-sub{font-size:11px;color:#9a9892;margin-top:3px}
/* cómputo */
.comp-hdr{padding:10px 30px;display:flex;align-items:center;justify-content:space-between;border-bottom:1.5px solid #1f2024;position:relative;z-index:1}
.logo-sm{font-weight:900;font-size:15px;letter-spacing:2px;color:#1f2024}
.comp-meta{font-size:8px;color:#5a5a58;font-family:'JetBrains Mono',monospace;letter-spacing:.8px}
.comp-body{padding:0}
.rubro-sec{padding:6px 30px 4px;page-break-inside:avoid;break-inside:avoid}
.rubro-ttl{display:flex;align-items:center;gap:9px;font-size:11px;font-weight:800;letter-spacing:1.5px;color:#1a9b9c;margin-bottom:4px}
.dmnd-sm{display:inline-block;width:9px;height:9px;background:#1a9b9c;transform:rotate(45deg);flex-shrink:0}
.dmnd-lg{display:inline-block;width:18px;height:18px;background:#1a9b9c;transform:rotate(45deg);flex-shrink:0}
.tbl-hdr{display:flex;padding:5px 12px;background:#1f2024;color:#fff;font-size:7.5px;font-family:'JetBrains Mono',monospace;letter-spacing:1.2px}
.task-row{display:flex;padding:3.5px 12px;border-bottom:1px solid #e4e0d2;font-size:10px}
.task-row.alt{background:#fafafa}
.rubro-sub{display:flex;padding:5px 12px;background:#d6efef;font-size:10px;font-weight:800;border-top:1.5px solid #1a9b9c}
.tc{display:flex;align-items:center}
.tc-name{flex:3}
.tc-un{flex:.5;justify-content:center}
.tc-num{flex:1.1;justify-content:flex-end;font-family:'JetBrains Mono',monospace}
.t-code{color:#9a9892;font-size:8px;margin-left:4px;font-family:'JetBrains Mono',monospace}
.bold{font-weight:700}
.bold-lg{font-weight:800;font-size:11px}
.gray{color:#9a9892}
.mono{font-family:'JetBrains Mono',monospace;text-align:right}
/* totales */
.totales-strip{padding:10px 30px;display:flex;gap:14px;align-items:flex-end;page-break-inside:avoid;break-inside:avoid;page-break-before:avoid;break-before:avoid}
.rubros-list{flex:1;font-size:8px;color:#5a5a58;font-family:'JetBrains Mono',monospace;line-height:1.7}
.rubros-ttl{font-weight:700;color:#1f2024;margin-bottom:4px;font-size:9px}
.totales-box{width:300px;background:#1f2024;color:#fff;padding:12px 15px;position:relative}
.dmnd-corner{position:absolute;top:-6px;right:15px;width:12px;height:12px;background:#1a9b9c;transform:rotate(45deg)}
.totales-lbl{font-size:8.5px;letter-spacing:2px;color:#1a9b9c;font-family:'JetBrains Mono',monospace}
.totales-grid{display:grid;grid-template-columns:auto auto;column-gap:12px;row-gap:3px;margin-top:7px;font-size:10px}
.totales-grid-sm{display:grid;grid-template-columns:auto auto;column-gap:12px;row-gap:3px;margin-top:7px;font-size:11px}
.totales-rule{height:1px;background:#1a9b9c;margin:7px 0}
.total-final{display:flex;justify-content:space-between;font-weight:800;font-size:12px}
.total-val{font-size:14px}
.iva{font-size:8.5px;letter-spacing:1px;color:#1a9b9c;font-weight:700;margin-left:4px;font-family:'JetBrains Mono',monospace}
.nota-pie{margin-top:7px;font-size:8px;color:#9a9892;border-top:1px solid #333;padding-top:5px}
.comp-ftr{padding:6px 30px;border-top:1.5px solid #1f2024;display:flex;justify-content:space-between;font-size:7.5px;color:#5a5a58;font-family:'JetBrains Mono',monospace}
/* condiciones */
.cond-hdr{padding:16px 44px;display:flex;align-items:center;justify-content:space-between;position:relative;z-index:1}
.cond-body{padding:26px 56px;flex:1;display:flex;flex-direction:column;position:relative;z-index:1}
.cond-title-row{display:flex;align-items:center;gap:12px;margin-bottom:18px}
.cond-h1{font-weight:900;font-size:20px;letter-spacing:5px;color:#fff}
.cond-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.cond-sec-lbl{font-size:9.5px;color:#1a9b9c;font-family:'JetBrains Mono',monospace;letter-spacing:2px;margin-bottom:7px}
.cond-txt{font-size:11px;color:#fff;line-height:1.75}
.cond-txt p{margin-bottom:8px}
.cond-totales{background:#171818;padding:12px 15px;position:relative}
.cond-nota{margin-top:8px;font-size:10px;color:#9a9892;font-style:italic}
.firmas{display:grid;grid-template-columns:1fr 1fr;gap:44px;margin-top:auto;padding-top:22px}
.firma-rule{height:1px;background:#1a9b9c;margin-bottom:6px}
.firma-lbl{font-size:8.5px;color:#9a9892;letter-spacing:2px;font-family:'JetBrains Mono',monospace}
.firma-name{font-size:12px;font-weight:700;margin-top:4px;color:#fff}
.firma-sub{font-size:9px;color:#9a9892}
.cond-ftr{padding:10px 44px;background:#171818;display:flex;justify-content:space-between;font-size:8px;color:#9a9892;font-family:'JetBrains Mono',monospace;letter-spacing:1.2px;position:relative;z-index:1}
@media print{
  html,body{margin:0!important;padding:0!important;width:100%!important}
  .portada-page,.comp-flow,.cond-page{margin:0!important;box-shadow:none!important;width:100%!important}
}
@media screen{
  html{background:#555}
  body{margin:0 auto;padding:16px 0;width:794px}
  .portada-page,.comp-flow,.cond-page{margin-bottom:16px;box-shadow:0 4px 24px rgba(0,0,0,.4)}
}`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=794, initial-scale=1.0">
<title>Presupuesto — ${obra?.nombre || 'KAMAK'}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
${portada}
${computo}
${condicionesPage}
</body>
</html>`;
}

// ── Mini portada preview (React, portrait ratio) ──────────────────────────────
function PortadaPreview({ obra, vigencia, totalVenta, dolarVenta }) {
  const fecha = fmtFecha();
  const fmtV = (n) => `U$S ${fmtN(Math.round(n / (dolarVenta || 1)))}`;
  const W = 560, H = 792; // A4 portrait ratio ~1:1.414

  return (
    <div style={{ width: W, height: H, background: '#1f2024', color: '#fff', fontFamily: T.font, position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
      {/* Stripes watermark */}
      <div style={{ position: 'absolute', top: -120, right: -120, opacity: 0.09, pointerEvents: 'none' }}>
        <svg viewBox="0 0 620 620" width="620" height="620">
          <rect x="-64" y="245" width="900" height="50" fill="#1a9b9c" transform="rotate(62 386 270)" />
          <rect x="-140" y="285" width="900" height="50" fill="#1a9b9c" transform="rotate(62 310 310)" />
          <rect x="-216" y="325" width="900" height="50" fill="#1a9b9c" transform="rotate(62 234 350)" />
        </svg>
      </div>
      {/* Header */}
      <div style={{ height: 62, padding: '14px 38px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
        <img src="/assets/kamak-logo-light.png" style={{ height: 32, objectFit: 'contain', display: 'block' }} onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }} />
        <span style={{ display: 'none', fontWeight: 900, fontSize: 20, letterSpacing: 2 }}>KAMAK</span>
        <div style={{ fontSize: 7.5, color: '#aaa', textAlign: 'right', fontFamily: T.fontMono, lineHeight: 1.6 }}>
          7630 NECOCHEA<br />BUENOS AIRES · ARGENTINA<br />KAMAKDESARROLLOS@GMAIL.COM
        </div>
      </div>
      {/* Teal rule + diamond */}
      <div style={{ height: 5, background: '#1a9b9c', position: 'relative', zIndex: 1 }}>
        <div style={{ position: 'absolute', left: '50%', top: -8, marginLeft: -8, width: 16, height: 16, background: '#1a9b9c', transform: 'rotate(45deg)', boxShadow: '0 0 0 2px #1f2024' }} />
      </div>
      {/* Hero */}
      <div style={{ flex: 1, padding: '44px 50px 26px', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', zIndex: 1 }}>
        <div style={{ fontSize: 9, letterSpacing: 6, color: '#1a9b9c', fontWeight: 600 }}>CÓMPUTO Y PRESUPUESTO</div>
        <div style={{ marginTop: 18, width: '82%', position: 'relative', padding: '26px 22px' }}>
          <div style={{ position: 'absolute', top: -2, left: '50%', transform: 'translateX(-50%)', fontSize: 7.5, color: '#1a9b9c', letterSpacing: 3, fontFamily: T.fontMono, fontWeight: 700, background: '#1f2024', padding: '0 10px', whiteSpace: 'nowrap', zIndex: 2 }}>◆ NOMBRE DE LA OBRA ◆</div>
          {[{ top: 0, left: 0, borderTop: '2px solid #1a9b9c', borderLeft: '2px solid #1a9b9c' }, { top: 0, right: 0, borderTop: '2px solid #1a9b9c', borderRight: '2px solid #1a9b9c' }, { bottom: 0, left: 0, borderBottom: '2px solid #1a9b9c', borderLeft: '2px solid #1a9b9c' }, { bottom: 0, right: 0, borderBottom: '2px solid #1a9b9c', borderRight: '2px solid #1a9b9c' }].map((s, i) => (
            <div key={i} style={{ position: 'absolute', width: 22, height: 22, ...s }} />
          ))}
          <div style={{ fontWeight: 900, letterSpacing: 2, fontSize: 24, textAlign: 'center', lineHeight: 1.15, color: '#fff', textShadow: '0 2px 12px rgba(26,155,156,.25)' }}>
            {(obra?.nombre || 'OBRA').toUpperCase()}
          </div>
        </div>
        <div style={{ marginTop: 18, width: '65%', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, height: 1, background: '#3a3a3e' }} />
          <div style={{ fontWeight: 700, fontSize: 9, letterSpacing: 5, color: '#9a9892', whiteSpace: 'nowrap' }}>PRESUPUESTO DE OBRA</div>
          <div style={{ flex: 1, height: 1, background: '#3a3a3e' }} />
        </div>
        <div style={{ marginTop: 8, fontSize: 8.5, color: '#9a9892', fontFamily: T.fontMono, letterSpacing: 2 }}>
          PRES-{new Date().getFullYear()}-042 &nbsp;·&nbsp; {fecha}
        </div>
      </div>
      {/* Bottom band — 2×2 grid */}
      <div style={{ background: '#171818', padding: '13px 38px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'auto auto', gap: '14px 20px', position: 'relative', zIndex: 1 }}>
        {[
          { label: 'CLIENTE', val: obra?.cliente || '—' },
          { label: 'TIPO DE OBRA', val: obra?.tipo || '—' },
          { label: 'FECHA · VIGENCIA', val: fecha, sub: `Vigencia: ${vigencia}` },
          { label: 'MONTO TOTAL', val: fmtV(totalVenta), sub: '+ IVA', big: true },
        ].map((c, i) => (
          <div key={i}>
            <div style={{ fontSize: 7, color: '#1a9b9c', letterSpacing: 2, fontFamily: T.fontMono }}>{c.label}</div>
            <div style={{ fontSize: c.big ? 14 : 11, fontWeight: c.big ? 800 : 700, marginTop: 3, color: '#fff', lineHeight: 1.2 }}>{c.val}</div>
            {c.sub && <div style={{ fontSize: 8, color: '#9a9892', marginTop: 2 }}>{c.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Toggle checkbox ───────────────────────────────────────────────────────────
function ToggleCheck({ on, onClick }) {
  return (
    <div onClick={onClick} style={{ width: 16, height: 16, borderRadius: 3, border: `2px solid ${on ? T.accent : T.faint2}`, background: on ? T.accent : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {on && <span style={{ color: 'white', fontSize: 10, lineHeight: 1, fontWeight: 700 }}>✓</span>}
    </div>
  );
}

// ── Modal principal ───────────────────────────────────────────────────────────
const FORMA_PAGO_DEFAULT = `El presente presupuesto NO INCLUYE IVA.
Para reservar fecha de obra, se abona un 40% del total en concepto de anticipo.
El saldo restante se abona por certificación mensual de avance de obra, con un 5% de fondo de reparo retenido hasta la entrega final.`;

export default function ExportModal({ onClose, obra, detalle }) {
  const { dolarVenta } = useDolar();
  const [vigencia, setVigencia] = useState(30);
  const [nota, setNota] = useState('');
  const [condiciones, setCondiciones] = useState(true);
  const [formaPago, setFormaPago] = useState(() => {
    const cuotas = detalle?.cuotas || [];
    if (!cuotas.length) return FORMA_PAGO_DEFAULT;
    const tc = dolarVenta || 1;
    const cuotaMonto = c => (c._usd || obra?.moneda !== 'USD') ? c.monto : Math.round(c.monto / tc);
    const fmtDLocal = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
    const lines = cuotas.map(c => {
      const fecha = c.fecha ? ` (${fmtDLocal(c.fecha)})` : '';
      return `${c.descripcion}: U$S ${Math.round(cuotaMonto(c)).toLocaleString('es-AR')}${fecha}`;
    });
    const total = cuotas.reduce((s, c) => s + cuotaMonto(c), 0);
    if (total > 0) lines.push(`Total: U$S ${Math.round(total).toLocaleString('es-AR')}`);
    return lines.join('\n');
  });

  const rr = (detalle?.rubros || []).map(r => ({ ...r, ...calcRubroExport(r) }));
  const totalVenta = rr.reduce((s, r) => s + r.venta, 0);
  const totalTareas = rr.reduce((s, r) => s + (r.tareas?.length || 0), 0);
  const moneda = obra?.moneda || 'ARS';
  const tc = dolarVenta || 1;

  const [previewHTML, setPreviewHTML] = useState(null);

  const imprimir = async () => {
    try {
      const origin = window.location.origin;
      const logoLight = `${origin}/assets/kamak-logo-light.png`;
      const logoDark = `${origin}/assets/kamak-logo.png`;

      // Generar el QR del cliente (opcional — si falla no rompemos la
      // impresion: imprimimos sin QR).
      let qrDataUrl = null;
      try {
        if (obra?.cliente && obra?.nombre) {
          const link = buildWaMeLink(obra.cliente, obra.nombre);
          qrDataUrl = await generateQrDataUrl(link, 560);
        }
      } catch (e) {
        console.warn('[imprimir] no se pudo generar QR, se imprime sin el:', e);
        qrDataUrl = null;
      }

      const html = generarHTML({ obra, detalle, vigencia, nota, condiciones, formaPago, logoLight, logoDark, dolarVenta, qrDataUrl });
      setPreviewHTML(html);
    } catch (e) {
      console.error('[imprimir] error:', e);
      alert('Hubo un error al generar la propuesta:\n\n' + (e?.message || e));
    }
  };

  const PREVIEW_SCALE = 0.38;
  const PW = 560, PH = 792;

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 960, maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>Exportar presupuesto</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{obra?.nombre || 'Obra'}{obra?.cliente ? ` · ${obra.cliente}` : ''}</div>
          </div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Options panel */}
          <div style={{ width: 230, padding: 16, borderRight: `1.5px solid ${T.faint2}`, overflow: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <Label>Vigencia del presupuesto</Label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <input
                  type="number" min="1" max="365" value={vigencia}
                  onChange={e => setVigencia(Math.max(1, parseInt(e.target.value) || 1))}
                  style={{ width: 64, padding: '5px 8px', borderRadius: 4, border: `1.5px solid ${T.faint2}`, fontFamily: T.font, fontSize: 16, fontWeight: 700, textAlign: 'center', outline: 'none', background: T.paper }} />
                <span style={{ fontSize: 13, color: T.ink2 }}>días</span>
              </div>
            </div>

            <Divider />

            <div>
              <Label>Fecha de emisión</Label>
              <div style={{ marginTop: 6, fontSize: 12, color: T.ink2, fontWeight: 600 }}>{fmtFecha()}</div>
            </div>

            <Divider />

            <div>
              <Label>Forma de pago</Label>
              <textarea value={formaPago} onChange={e => setFormaPago(e.target.value)}
                style={{ marginTop: 6, width: '100%', height: 100, resize: 'vertical', padding: '6px 8px', borderRadius: 4, border: `1.5px solid ${T.faint2}`, fontFamily: T.font, fontSize: 11, outline: 'none', background: T.paper, lineHeight: 1.5 }} />
              <div style={{ fontSize: 10, color: T.ink3, marginTop: 3 }}>Cada línea es un párrafo en el PDF.</div>
            </div>

            <Divider />

            <div>
              <Label>Opciones</Label>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, cursor: 'pointer', lineHeight: 1.3, marginTop: 8 }}>
                <ToggleCheck on={condiciones} onClick={() => setCondiciones(v => !v)} />
                Página de condiciones de pago
              </label>
            </div>

            <Divider />

            <div>
              <Label>Nota al pie</Label>
              <textarea value={nota} onChange={e => setNota(e.target.value)}
                placeholder="Ej: No incluye demolición."
                style={{ marginTop: 6, width: '100%', height: 55, resize: 'vertical', padding: '6px 8px', borderRadius: 4, border: `1.5px solid ${T.faint2}`, fontFamily: T.font, fontSize: 11, outline: 'none', background: T.paper }} />
            </div>

            <Divider />

            <div style={{ background: T.faint, borderRadius: 4, padding: '10px 12px', fontSize: 11 }}>
              <div style={{ fontWeight: 700, marginBottom: 5 }}>Resumen del documento</div>
              <div style={{ color: T.ink2, lineHeight: 1.7 }}>
                <div>{rr.length} rubro{rr.length !== 1 ? 's' : ''} · {totalTareas} tareas</div>
                <div style={{ fontWeight: 700, color: T.accent }}>Total: U$S {fmtN(Math.round(totalVenta / tc))}</div>
                <div style={{ fontSize: 10, color: T.ink2 }}>TC BNA $ {fmtN(tc)} · $ {fmtN(totalVenta)}</div>
                <div style={{ color: T.ink3, fontSize: 10 }}>{condiciones ? 3 : 2} páginas · A4 vertical · vigencia {vigencia} días</div>
              </div>
            </div>
          </div>

          {/* Preview panel */}
          <div style={{ flex: 1, background: '#4a4740', padding: 20, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', alignSelf: 'flex-start' }}>Vista previa — Portada</div>

            {/* Scaled portada (portrait) */}
            <div style={{ width: PW * PREVIEW_SCALE, height: PH * PREVIEW_SCALE, overflow: 'hidden', position: 'relative', boxShadow: '0 4px 20px rgba(0,0,0,0.5)', flexShrink: 0, borderRadius: 2 }}>
              <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left' }}>
                <PortadaPreview obra={obra} vigencia={vigencia} totalVenta={totalVenta} dolarVenta={dolarVenta} />
              </div>
            </div>

            {/* Info cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 340 }}>
              {[
                { pag: 'Pág 1 · Portada', desc: `Nombre de obra, cliente, monto total, fecha` },
                { pag: `Pág 2${rr.length > 6 ? '–X' : ''} · Cómputo`, desc: `${rr.length} rubros, ${totalTareas} tareas con precios unitarios y subtotales` },
                ...(condiciones ? [{ pag: `Pág ${condiciones ? rr.length > 6 ? 'X' : 3 : 3} · Condiciones`, desc: 'Formas de pago, cláusulas, firmas' }] : []),
              ].map((p, i) => (
                <div key={i} style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 4, padding: '8px 12px', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={{ width: 6, height: 6, background: '#1a9b9c', transform: 'rotate(45deg)', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{p.pag}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{p.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0, background: T.paper }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm accent onClick={imprimir}>Imprimir / Guardar PDF</Btn>
        </div>
      </div>

      {previewHTML && (
        <PrintPreviewModal
          html={previewHTML}
          title={`Presupuesto · ${obra?.nombre || 'Obra'}`}
          onClose={() => setPreviewHTML(null)}
        />
      )}
    </div>
  );
}
