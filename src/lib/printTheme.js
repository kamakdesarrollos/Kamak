// Identidad visual compartida para los documentos imprimibles/PDF de Kamak
// (presupuesto, adicionales, resumen y FACTURA electrónica). Mantener UN solo
// CSS asegura que la factura tenga la misma imagen que el presupuesto.
//
// Lo usa src/pages/obra/ObraPresupuesto.jsx y src/lib/facturaHTML.js.
// Paleta: teal #1a9b9c (acento), dark #1f2024 (tablas/encabezados), Montserrat
// + JetBrains Mono. A4.

export const PRINT_BASE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&family=JetBrains+Mono:wght@400;700&display=swap');
@page{size:A4;margin:18mm 16mm}
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
body{font-family:'Montserrat',sans-serif;font-size:11px;color:#1f2024;background:#fff}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:10px;border-bottom:3px solid #1a9b9c;margin-bottom:18px}
.logo{font-weight:900;font-size:20px;letter-spacing:2px;color:#1f2024}
.hdr-r{text-align:right;font-family:'JetBrains Mono',monospace;font-size:8px;color:#9a9892;line-height:1.7}
.title{font-weight:900;font-size:16px;letter-spacing:1px;color:#1a9b9c;margin-bottom:2px}
.obra-info{font-size:10px;color:#5a5a58;margin-bottom:16px}
table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:14px}
th{background:#1f2024;color:#fff;padding:5px 8px;text-align:left;font-size:8.5px;letter-spacing:.8px;font-family:'JetBrains Mono',monospace;font-weight:700}
th.r{text-align:right}
td{padding:5px 8px;border-bottom:1px solid #e8e4d8}
td.r{text-align:right;font-family:'JetBrains Mono',monospace}
td.b{font-weight:700}
tr.alt td{background:#f9f7f2}
tr.rubro td{background:#1a9b9c18;font-weight:800;font-size:10.5px;color:#1a9b9c}
tr.subtot td{background:#d6efef;font-weight:800}
tr.total td{background:#1f2024;color:#fff;font-weight:900;font-family:'JetBrains Mono',monospace;font-size:12px}
.pill{display:inline-block;padding:1px 7px;border-radius:8px;font-size:8px;font-weight:700;font-family:'JetBrains Mono',monospace}
.ok{background:#d1fae5;color:#065f46}
.warn{background:#fef3c7;color:#92400e}
.accent{background:#fee2e2;color:#991b1b}
.ftr{margin-top:20px;padding-top:8px;border-top:1px solid #e8e4d8;display:flex;justify-content:space-between;font-size:8px;color:#9a9892;font-family:'JetBrains Mono',monospace}
@media screen{body{max-width:794px;margin:0 auto;padding:16px}}`;

// Compat: el nombre histórico usado en ObraPresupuesto.jsx.
export const BASE_CSS = PRINT_BASE_CSS;
