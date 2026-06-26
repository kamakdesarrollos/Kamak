import { useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabase';
import { detectarColumnas, indiceHeader, matchProveedor, matchProveedorFlexible, detectarMoneda } from '../../lib/presupuestoImport';

const toBase64 = file => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.onerror = rej;
  r.readAsDataURL(file);
});

export default function AdjuntarPresupuestoModal({ proveedores, onAddProveedor, onReady, onClose }) {
  const [file, setFile] = useState(null);
  const [estado, setEstado] = useState('');
  const [provNombre, setProvNombre] = useState('');

  const leer = async () => {
    if (!file) return;
    setEstado('Leyendo…');
    try {
      const esExcel = /\.(xlsx|xls|csv)$/i.test(file.name);
      if (esExcel) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
        // Saltear filas de título/logo: tomar como header la primera fila que
        // parezca encabezado (con columna de costo), no siempre la 0 (#12).
        const hIdx = indiceHeader(aoa);
        const header = aoa[hIdx] || [];
        const columnas = detectarColumnas(header);
        // Si el nombre tipeado matchea un proveedor existente, linkearlo (Excel no
        // trae proveedor detectado). No se crea uno nuevo sin CUIT (evita duplicados).
        const match = matchProveedor(provNombre, null, proveedores);
        onReady({ filas: aoa.slice(hIdx + 1), columnas, header, proveedorNombre: provNombre, proveedorId: match?.id || null, file, moneda: detectarMoneda(aoa) });
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        const fileBase64 = await toBase64(file);
        const r = await fetch('/api/presupuesto/extraer', {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ fileBase64, mediaType: file.type || 'application/pdf' }),
        });
        if (!r.ok) throw new Error('No se pudo leer el PDF');
        const { proveedor: pd, items, moneda } = await r.json();
        const detectado = pd || {};
        // Match flexible: CUIT exacto = auto-link; nombre = sugerencia editable.
        const m = matchProveedorFlexible(detectado.razonSocial, detectado.cuit, proveedores);
        const nombreSugerido = provNombre || m?.proveedor?.nombre || detectado.razonSocial || '';
        onReady({
          items, columnas: null, file, moneda: moneda || null,
          proveedorNombre: nombreSugerido,
          proveedorId: m?.exacto ? m.proveedor.id : null, // solo auto-link por CUIT
          proveedorData: detectado, // razonSocial, cuit, domicilio, tel, email, condIVA, rubro
        });
      }
    } catch (e) {
      setEstado('Error: ' + e.message + '. Podés cargar a mano.');
    }
  };

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 'min(92vw, 440px)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Adjuntar presupuesto</div>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv" onChange={e => setFile(e.target.files[0])} />
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280' }}>Proveedor (lo detecta del archivo si puede)</div>
            <input list="provs" value={provNombre} onChange={e => setProvNombre(e.target.value)} placeholder="Buscar o escribir…" style={{ width: '100%' }} />
            <datalist id="provs">{(proveedores || []).map(p => <option key={p.id} value={p.nombre} />)}</datalist>
          </div>
          {estado && <div style={{ fontSize: 12, color: '#b45309' }}>{estado}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={onClose}>Cancelar</button>
            <button disabled={!file} onClick={leer}>Leer presupuesto →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
