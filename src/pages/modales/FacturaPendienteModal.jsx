import { useState } from 'react';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { Btn, Divider } from '../../components/ui';
import { T } from '../../theme';
import { useProveedores } from '../../store/ProveedoresContext';
import { useObras } from '../../store/ObrasContext';
import { useUsuarios } from '../../store/UsuariosContext';
import { useNotificaciones } from '../../store/NotificacionesContext';
import { supabase } from '../../lib/supabase';
import { desglosarCompra } from '../../lib/afip';

// Alta MANUAL de una factura de proveedor pendiente de pago (cuentas por pagar).
// La factura lleva sus datos fiscales (comprobanteRecibido) → cuenta para Libro
// IVA desde su fecha, devengado, aunque todavía no esté paga. El PAGO se registra
// aparte (RegistrarPagoModal → movimiento de caja con facturaPendienteId), NO acá:
// así no se duplica el IVA.

const inputSt = { padding: '6px 10px', border: `1.2px solid ${T.faint2}`, borderRadius: 4, fontFamily: T.font, fontSize: 12, background: T.paper, boxSizing: 'border-box', outline: 'none', width: '100%' };
const labelSt = { fontSize: 10, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3, display: 'block' };
const fmtN = (n) => Math.round(n || 0).toLocaleString('es-AR');
const today = () => new Date().toISOString().split('T')[0];

export default function FacturaPendienteModal({ onClose }) {
  const { proveedores, addFacturaPendiente, updateProveedor } = useProveedores();
  const { obras } = useObras();
  const { currentUser } = useUsuarios();
  const { crearNotificacion } = useNotificaciones() ?? {};
  const isMobile = useIsMobile();
  // CBU/alias para transferir: dato sensible que solo cargan/ven Admin/Administración.
  const esAdmin = currentUser?.rol === 'Admin' || currentUser?.rol === 'Administración';

  const obrasActivas = obras.filter(o => o.estado === 'activa' || o.estado === 'en-presupuesto');
  const provsOrden = [...proveedores].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

  const [proveedorId, setProveedorId] = useState('');
  const [monto, setMonto]       = useState('');
  const [fecha, setFecha]       = useState(today);
  // Fecha de pago programada / vencimiento (opcional). Si se carga, el cron diario
  // avisa a Administración cuando se acerca (cuenta_por_vencer). Caso típico: echeq
  // o pagos mensuales fijos con fecha conocida.
  const [fechaVencimiento, setFechaVencimiento] = useState('');
  const [numero, setNumero]     = useState('');
  const [tipoLetra, setTipoLetra] = useState('A');
  const [cuit, setCuit]         = useState('');
  const [cbu, setCbu]           = useState('');
  const [alias, setAlias]       = useState('');
  const [concepto, setConcepto] = useState('');
  const [obraId, setObraId]     = useState('');
  const [rubroId, setRubroId]   = useState('');
  const [calcIVA, setCalcIVA]   = useState(false);
  // Solo registrar = factura solo fiscal (cuenta para Libro IVA pero NO es deuda ni
  // mueve caja). Caso: factura personal a nombre de la empresa sin gasto a pagar.
  const [soloRegistrar, setSoloRegistrar] = useState(false);
  const [percepcionIIBB, setPercepcionIIBB] = useState('');
  const [percepcionIVA, setPercepcionIVA]   = useState('');
  const [file, setFile]         = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError]       = useState('');

  const prov = proveedores.find(p => p.id === proveedorId) || null;
  const montoNum = Math.round(parseFloat((monto || '').replace(/[^0-9.]/g, '')) || 0);
  const canSave = montoNum > 0 && !!proveedorId;

  // Autocompletar CUIT desde el proveedor al seleccionarlo (sin pisar lo tipeado a mano).
  const onSelectProveedor = (id) => {
    setProveedorId(id);
    const p = proveedores.find(x => x.id === id);
    if (p && !cuit) setCuit(p.cuit || '');
    if (p && !cbu) setCbu(p.cbu || '');
    if (p && !alias) setAlias(p.alias || '');
  };

  const guardar = async () => {
    if (!canSave || subiendo) return;
    setError('');

    // Subir comprobante (PDF/foto) a Storage si hay archivo — mismo patrón que
    // el resto de la app (bucket kamak-fotos + getPublicUrl).
    let comprobanteUrl = null;
    if (file) {
      setSubiendo(true);
      const ext = file.name.split('.').pop();
      const path = `facturas-pendientes/${proveedorId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('kamak-fotos').upload(path, file, { upsert: true });
      setSubiendo(false);
      if (upErr) { setError('No se pudo subir el comprobante: ' + upErr.message); return; }
      comprobanteUrl = supabase.storage.from('kamak-fotos').getPublicUrl(path).data.publicUrl;
    }

    const obra = obras.find(o => o.id === obraId) || null;
    const pIIBB = Math.round(parseFloat((percepcionIIBB || '').replace(/[^0-9.]/g, '')) || 0);
    const pIVA  = Math.round(parseFloat((percepcionIVA || '').replace(/[^0-9.]/g, '')) || 0);

    const data = {
      proveedorId,
      proveedor: prov?.nombre || '',
      fecha: fecha || today(),
      numero: numero.trim(),
      tipoLetra,
      cuit: (cuit || prov?.cuit || '').trim(),
      monto: montoNum,
      concepto: concepto.trim(),
      obraId: obraId || null,
      obraNombre: obra?.nombre || null,
      rubroId: rubroId.trim() || null,
      comprobanteUrl,
      createdBy: currentUser?.id || currentUser?.email || null,
    };
    if (pIIBB > 0) data.percepcionIIBB = pIIBB;
    if (pIVA > 0)  data.percepcionIVA = pIVA;
    if (fechaVencimiento) data.fechaVencimiento = fechaVencimiento;

    // Solo registrar → estado 'registrada': cuenta para Libro IVA (si se calculó)
    // pero no figura como deuda en Cuentas por Pagar ni mueve caja.
    if (soloRegistrar) data.estado = 'registrada';

    // Si se pidió calcular IVA, armamos el comprobante fiscal (Libro IVA) con
    // el desglose central de afip.js: total → neto + IVA, descontando percepciones.
    if (calcIVA) {
      const d = desglosarCompra({ total: montoNum, tipoLetra, percepcionIIBB: pIIBB, percepcionIVA: pIVA });
      data.comprobanteRecibido = {
        tipo: tipoLetra,
        numero: numero.trim(),
        cuit: data.cuit,
        fecha: data.fecha,
        neto: d.neto,
        iva: d.iva,
        alicuota: d.alicuota,
        total: d.total,
      };
    }

    // CBU/alias para transferir viven en el PROVEEDOR (se reusan en próximas
    // órdenes). Solo Admin/Administración los cargan. Si cambian, se actualizan.
    if (esAdmin && proveedorId && (cbu.trim() || alias.trim())) {
      const ch = {};
      if (cbu.trim()   && cbu.trim()   !== (prov?.cbu   || '')) ch.cbu   = cbu.trim();
      if (alias.trim() && alias.trim() !== (prov?.alias || '')) ch.alias = alias.trim();
      if (Object.keys(ch).length) updateProveedor(proveedorId, ch);
    }

    addFacturaPendiente(data);
    // Aviso a Administración + Admin de la nueva orden de pago (feed + push). No
    // avisamos si es "solo registrar" (factura fiscal sin deuda → no es una orden).
    if (!soloRegistrar) {
      const det = `${prov?.nombre || 'Proveedor'} · $${fmtN(montoNum)}${numero.trim() ? ` · N° ${numero.trim()}` : ''}`;
      crearNotificacion?.('orden_pago_creada', { detalle: det });
    }
    onClose();
  };

  return (
    <div className="k-modal-overlay" onClick={onClose}>
      <div className="k-modal" style={{ width: 520 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: T.font, fontWeight: 800, fontSize: 17 }}>Nueva orden de pago</div>
            <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>Factura de proveedor pendiente · {prov?.nombre || 'Proveedor'}</div>
          </div>
          <span style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7 }} onClick={onClose}>✕</span>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={labelSt}>Proveedor *</label>
            <select style={{ ...inputSt, cursor: 'pointer' }} value={proveedorId} onChange={e => onSelectProveedor(e.target.value)}>
              <option value="">— Seleccionar proveedor —</option>
              {provsOrden.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>Monto total $ *</label>
              <input style={{ ...inputSt, fontFamily: T.fontMono, fontWeight: 700, fontSize: 14 }}
                type="number" min="0" placeholder="0"
                value={monto} onChange={e => setMonto(e.target.value)} />
            </div>
            <div>
              <label style={labelSt}>Fecha</label>
              <input type="date" style={inputSt} value={fecha} onChange={e => setFecha(e.target.value)} />
            </div>
          </div>

          <div>
            <label style={labelSt}>Fecha de pago / vencimiento (opcional)</label>
            <input type="date" style={inputSt} value={fechaVencimiento} onChange={e => setFechaVencimiento(e.target.value)} />
            <div style={{ fontSize: 10, color: T.ink3, marginTop: 3 }}>Si la cargás, te avisamos 3 días antes (echeq, pagos fijos mensuales…).</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.6fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>N° factura</label>
              <input style={inputSt} value={numero} onChange={e => setNumero(e.target.value)} placeholder="0001-00012345" />
            </div>
            <div>
              <label style={labelSt}>Letra</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={tipoLetra} onChange={e => setTipoLetra(e.target.value)}>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
              </select>
            </div>
            <div>
              <label style={labelSt}>CUIT</label>
              <input style={inputSt} value={cuit} onChange={e => setCuit(e.target.value)} placeholder="20-12345678-9" />
            </div>
          </div>

          {esAdmin && (
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 10 }}>
              <div>
                <label style={labelSt}>CBU (para transferir)</label>
                <input style={{ ...inputSt, fontFamily: T.fontMono }} value={cbu} onChange={e => setCbu(e.target.value)} placeholder="22 dígitos" />
              </div>
              <div>
                <label style={labelSt}>Alias</label>
                <input style={inputSt} value={alias} onChange={e => setAlias(e.target.value)} placeholder="alias.del.proveedor" />
              </div>
            </div>
          )}

          <div>
            <label style={labelSt}>Concepto</label>
            <input style={inputSt} value={concepto} onChange={e => setConcepto(e.target.value)} placeholder="Detalle de la factura" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>Obra (opcional)</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={obraId} onChange={e => setObraId(e.target.value)}>
                <option value="">— Sin obra —</option>
                {obrasActivas.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelSt}>Rubro (opcional)</label>
              <input style={inputSt} value={rubroId} onChange={e => setRubroId(e.target.value)} placeholder="Ej: Materiales, MO…" />
            </div>
          </div>

          <div>
            <label style={labelSt}>Comprobante (PDF / foto)</label>
            <input type="file" accept="image/*,application/pdf" capture={isMobile ? 'environment' : undefined} style={{ ...inputSt, padding: '5px 8px' }}
              onChange={e => setFile(e.target.files?.[0] || null)} />
            {file && <div style={{ fontSize: 10, color: T.ink3, marginTop: 3 }}>{file.name}</div>}
          </div>

          <Divider />

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, cursor: 'pointer', padding: '7px 10px', borderRadius: 4, border: `1.5px solid ${calcIVA ? T.accent : T.faint2}`, background: calcIVA ? T.accentSoft : 'transparent' }}>
            <input type="checkbox" checked={calcIVA} onChange={e => setCalcIVA(e.target.checked)} style={{ accentColor: T.accent, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 700 }}>Calcular IVA (factura {tipoLetra})</div>
              <div style={{ fontSize: 10, color: T.ink2 }}>Desglosa neto + IVA para el Libro IVA (comprobante recibido).</div>
            </div>
          </label>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, cursor: 'pointer', padding: '7px 10px', borderRadius: 4, border: `1.5px solid ${soloRegistrar ? '#4f5bd5' : T.faint2}`, background: soloRegistrar ? '#eef0ff' : 'transparent' }}>
            <input type="checkbox" checked={soloRegistrar}
              onChange={e => { setSoloRegistrar(e.target.checked); if (e.target.checked) setCalcIVA(true); }}
              style={{ accentColor: '#4f5bd5', marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 700 }}>Solo registrar — no es deuda ni mueve caja</div>
              <div style={{ fontSize: 10, color: T.ink2 }}>Cuenta para el Libro IVA pero no figura como orden de pago pendiente. Para facturas personales a nombre de la empresa que no son un gasto a pagar.</div>
            </div>
          </label>

          {calcIVA && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelSt}>Percepción IIBB $</label>
                  <input style={{ ...inputSt, fontFamily: T.fontMono }} type="number" min="0" placeholder="0"
                    value={percepcionIIBB} onChange={e => setPercepcionIIBB(e.target.value)} />
                </div>
                <div>
                  <label style={labelSt}>Percepción IVA $</label>
                  <input style={{ ...inputSt, fontFamily: T.fontMono }} type="number" min="0" placeholder="0"
                    value={percepcionIVA} onChange={e => setPercepcionIVA(e.target.value)} />
                </div>
              </div>
              {montoNum > 0 && (() => {
                const pIIBB = Math.round(parseFloat((percepcionIIBB || '').replace(/[^0-9.]/g, '')) || 0);
                const pIVA  = Math.round(parseFloat((percepcionIVA || '').replace(/[^0-9.]/g, '')) || 0);
                const d = desglosarCompra({ total: montoNum, tipoLetra, percepcionIIBB: pIIBB, percepcionIVA: pIVA });
                return (
                  <div style={{ fontSize: 11, color: T.ink2, background: T.faint, borderRadius: 4, padding: '8px 10px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <span>Neto <b style={{ fontFamily: T.fontMono }}>$ {fmtN(d.neto)}</b></span>
                    <span>IVA ({d.alicuota}%) <b style={{ fontFamily: T.fontMono }}>$ {fmtN(d.iva)}</b></span>
                    <span>Total <b style={{ fontFamily: T.fontMono }}>$ {fmtN(d.total)}</b></span>
                  </div>
                );
              })()}
            </>
          )}

          {error && <div style={{ fontSize: 11, color: '#dc2626', background: '#fde8e8', borderRadius: 4, padding: '7px 10px' }}>{error}</div>}
        </div>

        <div style={{ padding: '10px 18px', borderTop: `1.5px solid ${T.faint2}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn sm onClick={onClose}>Cancelar</Btn>
          <Btn sm fill onClick={guardar} style={{ opacity: canSave && !subiendo ? 1 : 0.5 }}>
            {subiendo ? 'Subiendo…' : soloRegistrar ? 'Registrar factura' : 'Crear orden de pago'}
          </Btn>
        </div>
      </div>
    </div>
  );
}
