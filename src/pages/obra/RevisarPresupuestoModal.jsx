import { useState, useMemo } from 'react';
import { mapearColumnas, normalizarItems, subtotalFila, clasificarTipoItem } from '../../lib/presupuestoImport';
import { useDolar } from '../../store/DolarContext';

// Segundo paso del adjuntar-presupuesto: tabla editable de ítems.
// - Excel: el input trae `{ filas, columnas, header }`; mostramos selectores de
//   columna por campo (mapeo) y derivamos los ítems con mapearColumnas.
// - PDF: el input trae `{ items }` ya estructurados (los devolvió Claude).
// - input.moneda: 'USD' | 'ARS' | null detectada del archivo (editable acá).
// Al confirmar emite la lista final ya normalizada (normalizarItems), con su
// `tipo` (material/M.O) y, si la moneda es USD, los costos convertidos a pesos
// (los costos internos del presupuesto están en pesos).
export default function RevisarPresupuestoModal({ input, onConfirm, onClose }) {
  const { dolarVenta } = useDolar();
  const tc = dolarVenta || 1;
  const esExcel = !!input.filas;
  const [mapping, setMapping] = useState(input.columnas || { nombre: 0, costo: 1, cantidad: -1, unidad: -1 });
  const [moneda, setMoneda] = useState(input.moneda === 'USD' ? 'USD' : 'ARS');
  // baseItems: lo que sale del mapeo (Excel) o lo que ya vino (PDF). Cada ítem
  // arranca con un `tipo` inferido del nombre (default inteligente; el usuario lo
  // corrige con el toggle). Para Excel se re-deriva al cambiar el mapping; en PDF
  // normalizamos las claves a string para que los <input> nunca arranquen como
  // no-controlados (#15).
  const baseItems = useMemo(
    () => (esExcel
      ? mapearColumnas(input.filas, mapping)
      : (input.items || []).map(it => ({
          nombre: it?.nombre ?? '', costo: it?.costo ?? '', cantidad: it?.cantidad ?? '', unidad: it?.unidad ?? '',
        }))
    ).map(it => ({ ...it, tipo: clasificarTipoItem(it.nombre) })),
    [esExcel, input, mapping]
  );
  const [items, setItems] = useState(baseItems);
  // Resync de la tabla editable cuando cambia el mapeo (Excel): patrón oficial
  // de React para "ajustar estado durante el render" — se compara el baseItems
  // anterior y, si cambió, se reinicia `items` ahí mismo (sin useEffect, sin
  // side-effect en fase de render). Las ediciones del usuario sobre baseItems
  // estable se conservan; al cambiar el mapeo se vuelve a derivar desde cero.
  const [prevBase, setPrevBase] = useState(baseItems);
  if (prevBase !== baseItems) {
    setPrevBase(baseItems);
    setItems(baseItems);
  }

  // Estado de envío: bloquea el botón mientras la importación está en vuelo (sube
  // el archivo + patch) para que un segundo click no duplique contrato/tareas/
  // archivo (#4/#6). `error` muestra el fallo al usuario en vez de tragárselo (#1/#13).
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  const setCell = (i, k, v) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it));
  const quitar = i => setItems(prev => prev.filter((_, idx) => idx !== i));
  const finales = normalizarItems(items);
  // Filas con nombre que NO entran (costo ≤ 0 / inválido): se avisa en vez de
  // descartarlas en silencio (#11). Las filas sin nombre (subtotales, en blanco)
  // no se cuentan: son ruido esperado.
  const conNombre = items.filter(it => String(it?.nombre || '').trim()).length;
  const omitidas = Math.max(0, conNombre - finales.length);

  const confirmar = async () => {
    setEnviando(true);
    setError('');
    try {
      // Los costos internos están en pesos: si el presupuesto vino en USD,
      // convertir cada costo ×TC antes de importar.
      const finalesConv = moneda === 'USD' ? finales.map(it => ({ ...it, costo: it.costo * tc })) : finales;
      await onConfirm(finalesConv);
      // En éxito el padre desmonta este modal (setAdjReady(null)).
    } catch (e) {
      setError(e?.message || 'No se pudo importar el presupuesto. Probá de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  const cols = ['nombre', 'costo', 'cantidad', 'unidad'];
  const header = input.header || [];
  const simb = moneda === 'USD' ? 'U$S' : '$';

  return (
    <div className="k-modal-overlay" onClick={enviando ? undefined : onClose}>
      <div className="k-modal" style={{ width: 'min(96vw, 820px)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>Revisar presupuesto</div>

          {/* Moneda: detectada del archivo, editable. Si es USD se convierte a pesos al importar. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap', fontSize: 12 }}>
            <span style={{ fontWeight: 700 }}>Moneda del presupuesto:</span>
            {['ARS', 'USD'].map(m => (
              <label key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input type="radio" name="moneda" checked={moneda === m} onChange={() => setMoneda(m)} />
                {m === 'ARS' ? 'Pesos (ARS)' : 'Dólares (USD)'}
              </label>
            ))}
            {input.moneda && <span style={{ color: '#6b7280', fontSize: 11 }}>· detectada: {input.moneda}</span>}
            {moneda === 'USD' && <span style={{ color: '#b45309', fontSize: 11 }}>· se convierte a pesos al TC ${Math.round(tc).toLocaleString('es-AR')}</span>}
          </div>

          {esExcel && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              {cols.map(k => (
                <label key={k} style={{ fontSize: 11 }}>{k}:&nbsp;
                  <select value={mapping[k]} onChange={e => setMapping(m => ({ ...m, [k]: +e.target.value }))}>
                    <option value={-1}>—</option>
                    {header.map((h, i) => <option key={i} value={i}>{h || `col ${i}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
          <div style={{ maxHeight: '50vh', overflow: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12 }}>
              <thead><tr><th align="left">Nombre</th><th>Tipo</th><th>Costo ({simb})</th><th>Cant.</th><th>Unid.</th><th>Subtotal</th><th></th></tr></thead>
              <tbody>
                {items.map((it, i) => {
                  const esMat = it.tipo !== 'mo';
                  return (
                    <tr key={i}>
                      <td><input value={it.nombre} onChange={e => setCell(i, 'nombre', e.target.value)} style={{ width: '100%' }} /></td>
                      <td align="center">
                        {/* Toggle Material / M.O: un botón por ítem (un toque alterna). */}
                        <button
                          type="button"
                          onClick={() => setCell(i, 'tipo', esMat ? 'mo' : 'material')}
                          title="Alternar Material / Mano de obra"
                          style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, cursor: 'pointer',
                            border: '1px solid', whiteSpace: 'nowrap',
                            borderColor: esMat ? '#2563eb' : '#a85648',
                            color: esMat ? '#2563eb' : '#a85648',
                            background: esMat ? '#eff6ff' : '#fdf2ee',
                          }}>
                          {esMat ? 'Material' : 'M.O'}
                        </button>
                      </td>
                      <td><input value={it.costo} onChange={e => setCell(i, 'costo', e.target.value)} style={{ width: 90 }} /></td>
                      <td><input value={it.cantidad} onChange={e => setCell(i, 'cantidad', e.target.value)} style={{ width: 50 }} /></td>
                      <td><input value={it.unidad} onChange={e => setCell(i, 'unidad', e.target.value)} style={{ width: 50 }} /></td>
                      <td align="right">{simb} {subtotalFila(it).toLocaleString('es-AR')}</td>
                      <td><button onClick={() => quitar(i)}>✗</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {omitidas > 0 && (
            <div style={{ fontSize: 11, color: '#b45309', marginTop: 8 }}>
              ⚠ {omitidas} fila{omitidas > 1 ? 's' : ''} con nombre no se importará{omitidas > 1 ? 'n' : ''} (costo en 0 o inválido). Revisá el costo si debería{omitidas > 1 ? 'n' : ''} entrar.
            </div>
          )}
          {error && <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 8, fontWeight: 600 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button onClick={onClose} disabled={enviando}>Cancelar</button>
            <button disabled={enviando || !finales.length} onClick={confirmar}>
              {enviando ? 'Importando…' : `Agregar ${finales.length} tareas`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
