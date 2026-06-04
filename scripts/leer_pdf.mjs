// Lector de PDF reutilizable: extrae el texto de un PDF a stdout.
// Uso: node scripts/leer_pdf.mjs "C:/ruta/al/archivo.pdf"
import { PDFParse } from 'pdf-parse';
import { readFileSync } from 'fs';
const f = process.argv[2];
if (!f) { console.error('Uso: node scripts/leer_pdf.mjs "<ruta.pdf>"'); process.exit(1); }
const parser = new PDFParse({ data: new Uint8Array(readFileSync(f)) });
const r = await parser.getText();
console.log(typeof r === 'string' ? r : (r.text || ''));
try { await parser.destroy(); } catch {}
