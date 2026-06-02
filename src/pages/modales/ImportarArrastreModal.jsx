import { useState, useMemo } from 'react';
import { Btn } from '../../components/ui';
import { T } from '../../theme';
import { useObras } from '../../store/ObrasContext';
import { useMovimientos } from '../../store/MovimientosContext';
import { useClientes } from '../../store/ClientesContext';

// ── Importar "obra de arrastre" ──────────────────────────────────────────────
// Para cargar obras previas al sistema: crea la obra (total en US$, 0% margen,
// terminada) y todos los cobros viejos como MOVIMIENTOS DE ARRASTRE (ccPrevia):
//   - tipo ingreso, en US$ (montoDolar), SIN caja (cajaId null) → no afectan saldos.
//   - ccPrevia:true → no figuran en Movimientos / Dashboard / Resumen.
// Solo viven en la cuenta corriente de la obra. Cuando el cliente salde el resto,
// ese pago se carga normal (no arrastre) y ahí sí entra a una caja.

const inputSt = { padding: '7px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 13, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };
const fmtUSD = (n) => `U$S ${Math.round(n).toLocaleString('es-AR')}`;

// "58.422,59" → 58422.59 ; "U$S 341.780,04" → 341780.04
function parseUSD(s) {
  if (s == null) return NaN;
  let t = String(s).replace(/u\$s|usd/gi, '').replace(/\$/g, '').trim();
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return parseFloat(t.replace(/[^0-9.\-]/g, ''));
}

// "25/11/2024" | "19-3-2025" | "2025-03-19" → "2025-03-19"
function parseFecha(s) {
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!m) return '';
  let [, d, mo, y] = m;
  if (y.length === 2) y = '20' + y;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// Cada línea: fecha [tab/;/2+espacios] (concepto…) [sep] MONTO_USD (último valor).
function parseCobros(text) {
  return text.split('\n').map(raw => {
    const line = raw.trim();
    if (!line) return null;
    const cols = line.split(/\t|;|\s{2,}/).map(c => c.trim()).filter(Boolean);
    if (cols.length < 2) return { raw, error: 'faltan columnas (fecha y monto)' };
    const fecha = parseFecha(cols[0]);
    const monto = parseUSD(cols[cols.length - 1]);
    const concepto = cols.slice(1, -1).join(' · ');
    let error = '';
    if (!fecha) error = 'no entiendo la fecha';
    else if (!(monto > 0)) error = 'no entiendo el monto';
    return { raw, fecha, monto, concepto, error };
  }).filter(Boolean);
}

export default function ImportarArrastreModal({ onClose }) {
  const { addObra, patchDetalle, setEstado } = useObras();
  const { addMovimiento } = useMovimientos();
  const { clientes } = useClientes();

  const [cliente, setCliente] = useState('');
  const [nombre, setNombre]   = useState('');
  const [totalStr, setTotal]  = useState('');
  const [pegado, setPegado]   = useState('');
  const [importando, setImportando] = useState(false);
  const [hecho, setHecho]     = useState(null);

  const total   = parseUSD(totalStr) || 0;
  const cobros  = useMemo(() => parseCobros(pegado), [pegado]);
  const validos = cobros.filter(c => !c.error);
  const conError = cobros.filter(c => c.error);
  const sumado  = validos.reduce((s, c) => s + c.monto, 0);
  const saldo   = total - sumado;

  const puede = cliente.trim() && nombre.trim() && total > 0 && validos.length > 0 && conError.length === 0;

  const importar = () => {
    if (!puede || importando) return;
    setImportando(true);
    const cli = clientes.find(c => (c.nombre || '').trim().toLowerCase() === cliente.trim().toLowerCase());
    const obraId = addObra({
      nombre: nombre.trim(),
      cliente: cli?.nombre || cliente.trim(),
      clienteId: cli?.id || null,
      tipo: 'Obra',
      moneda: 'USD',
      presupuesto: Math.round(total),
    });
    // Fija el precio de venta en US$ (no se mueve con el dólar).
    patchDetalle(obraId, d => ({ ...d, precioVentaUSD: Math.round(total) }));
    // Cobros de arrastre.
    for (const c of validos) {
      addMovimiento({
        tipo: 'ingreso',
        descripcion: c.concepto || 'Cobro (arrastre)',
        monto: Math.round(c.monto),
        montoDolar: Math.round(c.monto),
        moneda: 'USD',
        fecha: c.fecha,
        obraId,
        obraNombre: nombre.trim(),
        cajaId: null,
        cajaDestinoId: null,
        proveedor: cli?.nombre || cliente.trim(),
        clienteId: cli?.id || null,
        categoria: 'cobro-cliente',
        medioPago: '',
        referencia: '',
        fondoReparo: false,
        ccPrevia: true,
      });
    }
    setEstado(obraId, 'finalizada');
    setHecho({ nombre: nombre.trim(), cobros: validos.length, saldo });
    setImportando(false);
  };

  if (hecho) {
    return (
      <div className="k-modal-overlay" onClick={onClose}>
        <div className="k-modal" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
          <div style={{ padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✓</div>
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>Obra importada</div>
            <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.6 }}>
              <b>{hecho.nombre}</b> · {hecho.cobros} cobros de arrastre cargados.<br />
              Saldo pendiente: <b>{fmtUSD(hecho.saldo)}</b>.<br />
              <span style={{ fontSize: 11, color: T.ink3 }}>No tocó ninguna caja. Cuando te salden, cargás el pago normal.</span>
            </div>
            <div style={{ marginTop: 16 }}><Btn fill onClick={onClose}>Listo</Btn></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 640, maxHeight: '92vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Importar obra de arrastre</div>
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>Obra previa al sistema · solo cuenta corriente (no toca cajas)</div>
          </div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>

        <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelSt}>Cliente</label>
              <input style={inputSt} value={cliente} onChange={e => setCliente(e.target.value)} placeholder="Ej: Elena" list="clientes-arrastre" />
              <datalist id="clientes-arrastre">{clientes.map(c => <option key={c.id} value={c.nombre} />)}</datalist>
            </div>
            <div>
              <label style={labelSt}>Nombre de la obra</label>
              <input style={inputSt} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Shop Elena" />
            </div>
          </div>

          <div>
            <label style={labelSt}>Precio de venta total (US$)</label>
            <input style={{ ...inputSt, fontFamily: T.fontMono, fontWeight: 700 }} value={totalStr} onChange={e => setTotal(e.target.value)} placeholder="509.480,56" />
          </div>

          <div>
            <label style={labelSt}>Pagos recibidos (arrastre)</label>
            <div style={{ fontSize: 11, color: T.ink3, marginBottom: 6, lineHeight: 1.5 }}>
              Pegá una fila por pago. Formato: <b>fecha</b> · (concepto opcional) · <b>monto en US$</b> (el monto va al final). Podés pegar directo desde Excel (columnas separadas por tab). Ej:<br />
              <code style={{ fontSize: 11 }}>25/11/2024&nbsp;&nbsp;Transferencia&nbsp;&nbsp;58.422,59</code>
            </div>
            <textarea style={{ ...inputSt, minHeight: 150, fontFamily: T.fontMono, fontSize: 12, resize: 'vertical' }}
              value={pegado} onChange={e => setPegado(e.target.value)}
              placeholder={'25/11/2024\tTransferencia\t58.422,59\n19/03/2025\tE-cheq\t9.180,63'} />
          </div>

          {cobros.length > 0 && (
            <div style={{ border: `1px solid ${T.faint2}`, borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', background: T.faint, display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
                <span>{validos.length} cobros OK{conError.length > 0 && <span style={{ color: T.warn }}> · {conError.length} con error</span>}</span>
                <span style={{ fontFamily: T.fontMono }}>Cobrado: {fmtUSD(sumado)}</span>
              </div>
              <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                {cobros.map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '5px 12px', borderTop: `1px solid ${T.faint2}`, fontSize: 11.5, background: c.error ? '#fff3f3' : 'transparent' }}>
                    {c.error
                      ? <span style={{ color: T.warn }}>⚠ {c.error}: <span style={{ color: T.ink3 }}>{c.raw}</span></span>
                      : <>
                          <span style={{ width: 80, fontFamily: T.fontMono, color: T.ink2 }}>{c.fecha}</span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.concepto || '—'}</span>
                          <span style={{ fontFamily: T.fontMono, fontWeight: 700, color: T.ok }}>{fmtUSD(c.monto)}</span>
                        </>}
                  </div>
                ))}
              </div>
              {total > 0 && (
                <div style={{ padding: '8px 12px', borderTop: `2px solid ${T.faint2}`, display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 800 }}>
                  <span>Saldo pendiente</span>
                  <span style={{ fontFamily: T.fontMono, color: saldo > 0 ? T.warn : T.ok }}>{fmtUSD(saldo)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn fill onClick={importar} style={{ opacity: puede ? 1 : 0.5 }}>
            {importando ? 'Importando…' : `Importar obra + ${validos.length} cobros`}
          </Btn>
        </div>
      </div>
    </div>
  );
}
