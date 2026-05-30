import { useState } from 'react';
import { Btn } from '../../components/ui';
import { T } from '../../theme';
import { useMovimientos } from '../../store/MovimientosContext';
import { useObras } from '../../store/ObrasContext';
import { useProveedores } from '../../store/ProveedoresContext';
import { calcDesdeTotal, ALICUOTAS_IVA, buscarDuplicadoRecibido } from '../../lib/afip';

// Modal de revisión y aprobación de una factura recibida por WhatsApp.
// Extraido del antiguo WhatsappBuzon.jsx — la logica es la misma.
//
// El bot manda una propuesta (proveedor, monto, fecha, etc. detectados de
// la foto/PDF). El admin revisa, ajusta si hace falta, y confirma:
// se crea el movimiento gasto y se marca el item como confirmado.

const inputSt  = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt  = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };
const fmtN     = (n) => n != null ? Math.round(n).toLocaleString('es-AR') : '—';
const fmtFecha = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const newAdicId = () => `adic-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;

export default function AprobarFacturaModal({ item, onConfirm, onClose }) {
  const { cajas, addMovimiento, movimientos } = useMovimientos();
  const { obras, patchDetalle }  = useObras();
  const { proveedores }          = useProveedores();

  const cajasARS   = cajas.filter(c => c.activa && c.moneda === 'ARS');
  const obrasActivas = obras.filter(o => o.estado === 'activa' || o.estado === 'en-presupuesto');

  const [proveedor,  setProveedor]  = useState(() => {
    if (item.proveedor) return item.proveedor;
    if (item.cuit) {
      const clean = (item.cuit || '').replace(/[-\s]/g, '');
      const match = proveedores.find(p => (p.cuit || '').replace(/[-\s]/g, '') === clean);
      if (match) return match.nombre;
    }
    return '';
  });
  const [monto,      setMonto]      = useState(item.montoTotal != null ? String(item.montoTotal) : item.monto != null ? String(item.monto) : '');
  const [fecha,      setFecha]      = useState(item.fecha      || new Date().toISOString().split('T')[0]);
  const [concepto,   setConcepto]   = useState(item.concepto   || '');
  const [obraId,      setObraId]     = useState('');
  const [cajaId,      setCajaId]     = useState(cajasARS[0]?.id || '');
  const [esAdicional, setEsAdicional] = useState(false);

  // Datos fiscales para Libro IVA Compras. Se persisten en el movimiento como
  // `comprobanteRecibido` para que el Resumen IVA pueda calcular el crédito fiscal.
  // Tipo: A/B/C (default desde lo que extrajo el bot, sino B). Normaliza a mayúscula.
  const [tipoLetra, setTipoLetra] = useState(String(item.tipoFactura || 'B').toUpperCase().charAt(0) || 'B');
  // Alícuota: si la factura es C (monotributo) no tiene IVA. Default 21.
  const [alicuota, setAlicuota] = useState(21);
  // Categoría fiscal: si el admin reconoce que es un recibo de sueldo/cargas
  // (que pasó a buzón por error), lo marca acá y NO se genera IVA crédito.
  const [categoriaFiscal, setCategoriaFiscal] = useState('');
  const SIN_IVA_CREDITO = new Set(['sueldo', 'cs-soc', 'sind', 'iibb']);
  const esNoIvaCredito = SIN_IVA_CREDITO.has(categoriaFiscal);
  // Percepción IIBB sufrida: si el bot la leyó del ticket, viene en item.percepcionIIBB.
  // El admin puede ajustarla. Se descuenta del IIBB del mes en el panel Financiero.
  const [percepcionIIBB, setPercepcionIIBB] = useState(
    item.percepcionIIBB != null ? String(item.percepcionIIBB) : ''
  );

  const montoNum = Math.round(parseFloat(String(monto).replace(/[^0-9.]/g, '')) || 0);
  // Si la factura es C (emisor monotributo), no hay IVA discriminado para tomar
  // crédito → neto = total, iva = 0.
  const fiscal = tipoLetra === 'C'
    ? { neto: montoNum, iva: 0, total: montoNum, alicuota: 0 }
    : (() => { const r = calcDesdeTotal(montoNum, alicuota); return { ...r, alicuota }; })();
  const canSave  = montoNum > 0 && proveedor.trim() && cajaId;

  const guardar = () => {
    if (!canSave) return;
    // Defensa anti-duplicado: si ya hay un movimiento con la misma huella
    // (mismo CUIT + N° factura + total, o sin N° → mismo proveedor+fecha+total),
    // no aprobamos para evitar doble crédito IVA.
    const dup = buscarDuplicadoRecibido({
      tipo: tipoLetra, numero: item.numeroFactura, cuit: item.cuit,
      total: montoNum, proveedor: proveedor.trim(), fecha,
    }, { movimientos });
    if (dup?.en === 'movimiento') {
      const ref = dup.ref;
      alert(`⚠️ Ya hay un gasto con esta misma factura cargado el ${ref.fecha} ($${Math.round(ref.monto || ref.comprobanteRecibido?.total || 0).toLocaleString('es-AR')}). No la cargo dos veces.`);
      return;
    }
    const obra    = obrasActivas.find(o => o.id === obraId);
    const descripcion = concepto.trim() || `Factura ${item.tipoFactura || ''} ${item.numeroFactura || ''} · ${proveedor}`.trim();
    addMovimiento({
      tipo:           'gasto',
      descripcion,
      monto:          montoNum,
      fecha,
      obraId:         obraId || null,
      obraNombre:     obra?.nombre || 'General',
      cajaId,
      cajaDestinoId:  null,
      proveedor:      proveedor.trim(),
      categoria:      esNoIvaCredito ? 'general' : 'factura-proveedor',
      categoriaFiscal: categoriaFiscal || undefined,
      percepcionIIBB: (() => {
        const n = Math.round(parseFloat(String(percepcionIIBB).replace(',', '.')) || 0);
        return n > 0 ? n : undefined;
      })(),
      medioPago:      'Transferencia',
      referencia:     item.numeroFactura || '',
      comprobante:    esNoIvaCredito ? 'negro' : 'blanco',
      comprobanteUrl: item.mediaUrl || null,
      fondoReparo:    false,
      // Datos fiscales del comprobante recibido (para Libro IVA Compras).
      // Si es un recibo NO comercial (sueldo/cargas/sind/iibb), NO se genera
      // comprobanteRecibido para no inflar el crédito IVA.
      ...(esNoIvaCredito ? {} : {
        comprobanteRecibido: {
          tipo:      tipoLetra,                  // 'A' | 'B' | 'C'
          numero:    item.numeroFactura || '',
          cuit:      item.cuit || '',
          fecha:     fecha,
          neto:      fiscal.neto,
          iva:       fiscal.iva,
          alicuota:  fiscal.alicuota,
          total:     fiscal.total,
        },
      }),
    });
    if (esAdicional && obraId) {
      patchDetalle(obraId, d => ({
        ...d,
        adicionales: [...(d.adicionales || []), {
          id: newAdicId(),
          descripcion,
          tarea: '', cantidad: null, unidad: '',
          costoUnit: null, costoTotal: montoNum,
          valorVentaUnit: null, valorVentaTotal: null,
          montoProveedor: montoNum, cantidadProveedor: null, costoUnitProveedor: null,
          aplicadoAContrato: false,
          monto: montoNum, fecha, estado: 'pendiente',
          aplicaACliente: true, aplicaAProveedor: false,
        }],
      }));
    }
    onConfirm();
  };

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 500 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: '#25803a', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, fontFamily: T.font }}>Confirmar factura</div>
            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>Revisá los datos antes de guardar el gasto</div>
          </div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>

        <div style={{ padding: '10px 18px', background: T.faint, borderBottom: `1px solid ${T.faint2}`, fontSize: 11, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {item.tipoFactura && <span><b>Factura {item.tipoFactura}</b> {item.numeroFactura}</span>}
          {item.cuit        && <span>CUIT: {item.cuit}</span>}
          {item.fecha       && <span>Emitida: {fmtFecha(item.fecha)}</span>}
          {item.monto != null && item.montoTotal != null && item.monto !== item.montoTotal && (
            <span style={{ color: T.ink3 }}>Neto: $ {fmtN(item.monto)} · IVA incluido: $ {fmtN(item.montoTotal)}</span>
          )}
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={labelSt}>Proveedor *</label>
            <input list="prov-list" style={inputSt} value={proveedor} onChange={e => setProveedor(e.target.value)} autoFocus />
            <datalist id="prov-list">
              {proveedores.map(p => <option key={p.id} value={p.nombre} />)}
            </datalist>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>Monto total $ *</label>
              <input style={{ ...inputSt, fontFamily: T.fontMono, fontWeight: 700 }}
                type="number" min="0" value={monto} onChange={e => setMonto(e.target.value)} />
            </div>
            <div>
              <label style={labelSt}>Fecha</label>
              <input type="date" style={inputSt} value={fecha} onChange={e => setFecha(e.target.value)} />
            </div>
          </div>

          <div>
            <label style={labelSt}>Concepto</label>
            <input style={inputSt} value={concepto} onChange={e => setConcepto(e.target.value)}
              placeholder={`Factura ${item.tipoFactura || ''} · ${proveedor || 'proveedor'}`} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>Obra (opcional)</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={obraId} onChange={e => setObraId(e.target.value)}>
                <option value="">— General —</option>
                {obrasActivas.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelSt}>Caja de egreso *</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={cajaId} onChange={e => setCajaId(e.target.value)}>
                {cajasARS.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
          </div>

          {obraId && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer', color: T.ink2, userSelect: 'none', marginTop: 2 }}>
              <input type="checkbox" checked={esAdicional} onChange={e => setEsAdicional(e.target.checked)} />
              Registrar también como <b style={{ color: T.accent }}>adicional pendiente</b> de {obrasActivas.find(o => o.id === obraId)?.nombre || 'la obra'}
            </label>
          )}

          {/* ── Datos fiscales (para Libro IVA Compras) ─────────────────────── */}
          <div style={{ borderTop: `1px dashed ${T.faint2}`, paddingTop: 10, marginTop: 4 }}>
            <div style={{ fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 }}>
              Datos fiscales (Libro IVA Compras)
            </div>
            {/* Categoría fiscal: si es recibo de sueldo/cargas/sind/iibb, marcalo
                acá y NO se genera IVA crédito (no es una factura comercial). */}
            <div style={{ marginBottom: 8 }}>
              <label style={labelSt}>¿Es un comprobante NO comercial?</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={categoriaFiscal} onChange={e => setCategoriaFiscal(e.target.value)}>
                <option value="">— Es una factura comercial (genera IVA crédito) —</option>
                <option value="sueldo">Recibo de sueldo</option>
                <option value="cs-soc">Cargas sociales (F.931)</option>
                <option value="sind">Sindicato (UOCRA)</option>
                <option value="iibb">IIBB (pago/boleta)</option>
              </select>
            </div>
            {esNoIvaCredito && (
              <div style={{ background: '#fffbeb', border: `1px solid #fde68a`, borderRadius: 3, padding: '6px 10px', fontSize: 10.5, color: '#92400e', marginBottom: 8 }}>
                ⓘ Este comprobante NO genera IVA crédito. Se carga como gasto y suma al Financiero en la columna correspondiente.
              </div>
            )}
            {!esNoIvaCredito && (<>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={labelSt}>Tipo</label>
                <select style={{ ...inputSt, cursor: 'pointer' }} value={tipoLetra} onChange={e => setTipoLetra(e.target.value)}>
                  <option value="A">Factura A (con IVA discriminado)</option>
                  <option value="B">Factura B</option>
                  <option value="C">Factura C (sin IVA)</option>
                </select>
              </div>
              <div>
                <label style={labelSt}>Alícuota IVA</label>
                <select
                  style={{ ...inputSt, cursor: tipoLetra === 'C' ? 'not-allowed' : 'pointer', opacity: tipoLetra === 'C' ? 0.5 : 1 }}
                  disabled={tipoLetra === 'C'}
                  value={alicuota}
                  onChange={e => setAlicuota(Number(e.target.value))}
                >
                  {ALICUOTAS_IVA.map(a => <option key={a.pct} value={a.pct}>{a.pct}%</option>)}
                </select>
              </div>
            </div>
            {tipoLetra !== 'C' && montoNum > 0 && (
              <div style={{ marginTop: 6, fontSize: 11, color: T.ink2, background: T.faint, padding: '6px 10px', borderRadius: 3, display: 'flex', gap: 14, flexWrap: 'wrap', fontFamily: T.fontMono }}>
                <span>Neto: <b style={{ color: T.ink }}>$ {fmtN(fiscal.neto)}</b></span>
                <span>IVA {alicuota}%: <b style={{ color: T.accent }}>$ {fmtN(fiscal.iva)}</b></span>
                <span>Total: <b style={{ color: T.ink }}>$ {fmtN(fiscal.total)}</b></span>
              </div>
            )}
            {alicuota === 10.5 && tipoLetra !== 'C' && (
              <div style={{ marginTop: 5, fontSize: 10.5, color: '#92400e', background: '#fffbeb', border: `1px solid #fde68a`, borderRadius: 3, padding: '5px 8px' }}>
                ⓘ 10,5% aplica solo a <b>obras destinadas a vivienda</b> (Ley 23905). NO aplica a materiales de terminación.
              </div>
            )}
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${T.faint2}` }}>
              <label style={labelSt}>Percepción IIBB sufrida $ (opcional)</label>
              <input
                type="text" inputMode="decimal" placeholder="0"
                style={{ ...inputSt, fontFamily: T.fontMono, textAlign: 'right' }}
                value={percepcionIIBB}
                onChange={e => setPercepcionIIBB(e.target.value)}
              />
              <div style={{ fontSize: 10, color: T.ink3, marginTop: 4 }}>
                Típica en estaciones de servicio. {item.percepcionIIBB != null
                  ? <b style={{ color: '#25803a' }}>El bot la leyó del ticket.</b>
                  : 'Si el ticket la discrimina, cargala — se descuenta del IIBB del mes.'}
              </div>
            </div>
            </>)}
          </div>
        </div>

        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill onClick={guardar}
            style={{ background: canSave ? '#25803a' : T.faint2, color: canSave ? '#fff' : T.ink3, opacity: 1 }}>
            Guardar como gasto
          </Btn>
        </div>
      </div>
    </div>
  );
}
