// Representación imprimible/PDF de la factura electrónica (lo que recibe el
// cliente). MISMA identidad visual que el presupuesto (printTheme.js): logo
// KAMAK, acento teal, Montserrat + JetBrains Mono, A4. Incluye los datos fiscales
// obligatorios + el CAE y el QR de AFIP (RG 4892).
//
// FUNCIÓN PURA: recibe el comprobante ya emitido, los datos de empresa y el QR
// ya generado (data URL, vía src/lib/clienteAcceso.js → generateQrDataUrl sobre
// src/lib/afipQr.js). No hace red ni genera imágenes.

import { getTipoComprobante, getCondicionIVA, getConceptoAfip, formatCUIT } from './afip.js';
import { esc } from './html.js';
import { BASE_CSS } from './printTheme.js';

const fmtPesos = (n) => `$ ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Formatea fechas en dd/mm/yyyy desde ISO 'YYYY-MM-DD', datetime ISO o el
// 'YYYYMMDD' que devuelve AFIP (CAEFchVto).
function fmtFecha(v) {
  if (!v) return '—';
  const s = String(v);
  let y, m, d;
  if (/^\d{8}$/.test(s)) { y = s.slice(0, 4); m = s.slice(4, 6); d = s.slice(6, 8); }
  else { const p = s.slice(0, 10).split('-'); if (p.length !== 3) return s; [y, m, d] = p; }
  return `${d}/${m}/${y}`;
}

// Doc del receptor formateado (CUIT con guiones / DNI / Consumidor Final).
function docReceptorLabel(cuit) {
  const dig = String(cuit || '').replace(/\D/g, '');
  if (dig.length === 11) return { etiqueta: 'CUIT', valor: formatCUIT(dig) };
  if (dig.length >= 7 && dig.length <= 8) return { etiqueta: 'DNI', valor: dig };
  return { etiqueta: 'Doc', valor: 'Consumidor Final' };
}

// Estilos propios de la factura, encima de BASE_CSS (sin pisar la identidad).
const FACTURA_CSS = `
.fz-top{display:flex;align-items:stretch;border-bottom:3px solid #1a9b9c;margin-bottom:14px;padding-bottom:10px}
.fz-emisor{flex:1.2;padding-right:14px}
.fz-logo{height:42px;object-fit:contain;display:block;margin-bottom:8px}
.fz-emisor .razon{font-weight:800;font-size:13px;color:#1f2024;margin-top:6px}
.fz-emisor .dato{font-size:9.5px;color:#5a5a58;margin-top:2px}
.fz-letra{width:64px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;border-left:1px solid #e8e4d8;border-right:1px solid #e8e4d8;padding:0 8px}
.fz-letra .L{font-weight:900;font-size:40px;line-height:1;color:#1f2024}
.fz-letra .cod{font-family:'JetBrains Mono',monospace;font-size:8px;color:#9a9892;margin-top:4px}
.fz-meta{flex:1;text-align:right;padding-left:14px}
.fz-meta .tipo{font-weight:900;font-size:15px;letter-spacing:1px;color:#1a9b9c}
.fz-meta .m{font-family:'JetBrains Mono',monospace;font-size:10px;color:#1f2024;margin-top:3px}
.fz-parties{display:flex;gap:12px;margin-bottom:14px}
.fz-card{flex:1;border:1px solid #e8e4d8;border-radius:5px;padding:8px 10px}
.fz-card .lbl{font-family:'JetBrains Mono',monospace;font-size:7.5px;letter-spacing:.8px;color:#9a9892;text-transform:uppercase}
.fz-card .v{font-size:10.5px;color:#1f2024;margin-top:2px}
.fz-tot{width:46%;margin-left:auto;font-size:10.5px}
.fz-tot div{display:flex;justify-content:space-between;padding:3px 0}
.fz-tot .grand{border-top:2px solid #1f2024;margin-top:4px;padding-top:6px;font-weight:900;font-size:13px}
.fz-cae{display:flex;align-items:center;gap:14px;margin-top:18px;border:1px solid #1a9b9c;border-radius:6px;padding:10px 12px;background:#1a9b9c0d}
.fz-cae img{width:96px;height:96px;display:block}
.fz-cae .num{font-family:'JetBrains Mono',monospace;font-size:11px;color:#1f2024;line-height:1.7}
.fz-cae .num b{font-size:13px}`;

// Genera el HTML A4 de la factura. `opts.empresa` = config.empresa (emisor),
// `opts.qrDataUrl` = imagen del QR (data URL) ya generada.
export function generarFacturaHTML(c, { empresa = {}, qrDataUrl = '', logoUrl = '/assets/kamak-logo.png' } = {}) {
  const tipo = getTipoComprobante(c.tipoId);
  const letra = tipo?.letra || 'X';
  const cod = String(tipo?.codAfip ?? 0).padStart(2, '0');
  const nombreCmp = (tipo?.nombre || 'Comprobante').toUpperCase();
  const numero = String(c.numero || 0).padStart(8, '0');
  const ptoVta = String(c.puntoVenta || 0).padStart(4, '0');

  const rec = docReceptorLabel(c.receptorCuit);
  const condRec = getCondicionIVA(c.receptorCondicion)?.nombre || '—';
  const concepto = getConceptoAfip?.(c.conceptoAfip)?.nombre || '';
  const exento = !(Number(c.iva) > 0);
  const detalle = esc(c.concepto || tipo?.nombre || 'Servicios');

  const filaItem = `<tr>
    <td class="b">${detalle}</td>
    <td class="r">1,00</td>
    <td class="r">${fmtPesos(c.neto)}</td>
    <td class="r b">${fmtPesos(c.neto)}</td>
  </tr>`;

  const totales = exento
    ? `<div><span>Importe Op. Exentas</span><span>${fmtPesos(c.neto)}</span></div>`
    : `<div><span>Importe Neto Gravado</span><span>${fmtPesos(c.neto)}</span></div>
       <div><span>IVA ${esc(c.alicuota)}%</span><span>${fmtPesos(c.iva)}</span></div>`;

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>${nombreCmp} ${letra} ${ptoVta}-${numero}</title>
<style>${BASE_CSS}${FACTURA_CSS}</style></head><body>

<div class="fz-top">
  <div class="fz-emisor">
    <img class="fz-logo" src="${logoUrl}" alt="KAMAK Desarrollos" />
    <div class="razon">${esc(empresa.razonSocial || 'KAMAK')}</div>
    <div class="dato">CUIT ${formatCUIT(empresa.cuit)} · IVA Responsable Inscripto</div>
    ${empresa.direccion ? `<div class="dato">${esc(empresa.direccion)}</div>` : ''}
    ${empresa.iibbAlicuota != null ? `<div class="dato">IIBB ${esc(empresa.iibbAlicuota)}%</div>` : ''}
    <div class="dato">KAMAKDESARROLLOS@GMAIL.COM</div>
  </div>
  <div class="fz-letra">
    <div class="L">${esc(letra)}</div>
    <div class="cod">COD ${cod}</div>
  </div>
  <div class="fz-meta">
    <div class="tipo">${nombreCmp}</div>
    <div class="m">Punto de Venta: ${ptoVta}</div>
    <div class="m">Comp. Nro: ${numero}</div>
    <div class="m">Fecha: ${fmtFecha(c.fecha)}</div>
  </div>
</div>

<div class="fz-parties">
  <div class="fz-card">
    <div class="lbl">Cliente</div>
    <div class="v" style="font-weight:700">${esc(c.receptorNombre || '—')}</div>
    <div class="v">${rec.etiqueta} ${esc(rec.valor)}</div>
    <div class="v">${esc(condRec)}</div>
  </div>
  <div class="fz-card">
    <div class="lbl">Comprobante</div>
    <div class="v">${nombreCmp} ${esc(letra)}</div>
    ${concepto ? `<div class="v">Concepto: ${esc(concepto)}</div>` : ''}
    <div class="v">Moneda: Pesos (PES)</div>
  </div>
</div>

<table>
  <thead><tr>
    <th>Detalle</th><th class="r">Cantidad</th><th class="r">P. Unitario</th><th class="r">Importe</th>
  </tr></thead>
  <tbody>${filaItem}</tbody>
</table>

<div class="fz-tot">
  ${totales}
  <div class="grand"><span>TOTAL</span><span>${fmtPesos(c.total)}</span></div>
</div>

<div class="fz-cae">
  ${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR AFIP" />` : ''}
  <div class="num">
    <div>CAE N°: <b>${esc(c.cae || '—')}</b></div>
    <div>Vto. CAE: <b>${fmtFecha(c.caeVto)}</b></div>
    <div style="color:#9a9892;font-size:8px;margin-top:4px">Comprobante autorizado · AFIP</div>
  </div>
</div>

<div class="ftr"><span>KAMAK DESARROLLOS</span><span>${nombreCmp} ${esc(letra)} ${ptoVta}-${numero}</span><span>${fmtFecha(c.fecha)}</span></div>
</body></html>`;
}
