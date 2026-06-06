import { useState, useMemo } from 'react';
import Modal from '../../components/ui/Modal';
import { Btn, Chip } from '../../components/ui';
import { T } from '../../theme';
import { useObras } from '../../store/ObrasContext';
import { useMovimientos } from '../../store/MovimientosContext';
import { useDolar } from '../../store/DolarContext';
import { useUsuarios } from '../../store/UsuariosContext';
import { useClientes } from '../../store/ClientesContext';
import { useComercial } from '../../store/ComercialContext';
import { ccObra, cobradoObraUSD } from '../obra/helpers';
import { ETAPA_META, etapaEfectiva, esArrastrableEnEmbudo } from '../../lib/ventaEtapa';
import { derivaClienteEstado } from '../../lib/derivaClienteEstado';
import { fmtN, fmtFecha } from '../../lib/format';

const TIPO_ICON = {
  llamada: '📞', mail: '✉️', reunion: '🤝', whatsapp: '💬', nota: '📝',
  propuesta_enviada: '📤', cambio_etapa: '↔️', portal_abierto: '👁️', firma: '✍️',
};
const ESTADO_CHIP = {
  cliente: { label: 'Cliente', color: T.ok }, prospecto: { label: 'Prospecto', color: T.accent }, inactivo: { label: 'Inactivo', color: T.ink3 },
};

export default function ClienteFicha360Modal({ cliente, onClose }) {
  const { obras, getDetalle, setVentaEtapa } = useObras();
  const { movimientos, cajas } = useMovimientos();
  const { dolarVenta } = useDolar();
  const { usuarios, currentUser } = useUsuarios();
  const { updateCliente } = useClientes();
  const { actividades, addActividad } = useComercial();
  const tc = dolarVenta || 1070;

  const [nuevaAct, setNuevaAct] = useState({ tipo: 'llamada', texto: '' });

  // Obras del cliente (por clienteId con fallback a nombre, como obrasCount).
  const obrasCliente = useMemo(
    () => obras.filter(o => o.clienteId === cliente.id || o.cliente === cliente.nombre),
    [obras, cliente]
  );

  // Actividades del cliente, más nuevas primero.
  const acts = useMemo(
    () => (actividades || []).filter(a => a.clienteId === cliente.id)
      .sort((a, b) => String(b.fecha || b.creadoAt).localeCompare(String(a.fecha || a.creadoAt))),
    [actividades, cliente.id]
  );

  // Cuenta corriente real (USD) sumando todas las obras del cliente.
  const cc = useMemo(() => obrasCliente.reduce((acc, o) => {
    const det = getDetalle(o.id);
    const r = ccObra(o, det, movimientos, cajas, tc);
    return { totalUSD: acc.totalUSD + r.totalUSD, cobradoUSD: acc.cobradoUSD + r.cobradoUSD, saldoUSD: acc.saldoUSD + r.saldoUSD };
  }, { totalUSD: 0, cobradoUSD: 0, saldoUSD: 0 }), [obrasCliente, movimientos, cajas, tc, getDetalle]);

  const estado = derivaClienteEstado(cliente, obrasCliente, acts[0]?.fecha || acts[0]?.creadoAt || null);
  const ec = ESTADO_CHIP[estado] || ESTADO_CHIP.prospecto;
  const respNombre = (usuarios || []).find(u => u.id === cliente.responsableComercial)?.nombre;
  const nombreUsuario = (id) => (usuarios || []).find(u => u.id === id)?.nombre || (id === 'bot' ? 'Bot' : id === 'sistema' ? 'Sistema' : '—');

  const registrarActividad = () => {
    if (!nuevaAct.texto.trim()) return;
    addActividad({ clienteId: cliente.id, tipo: nuevaAct.tipo, texto: nuevaAct.texto.trim(), usuario: currentUser?.id || null });
    setNuevaAct({ tipo: 'llamada', texto: '' });
  };

  const fmtU = (n) => `U$S ${fmtN(n)}`;

  return (
    <Modal title={cliente.nombre} subtitle={cliente.empresa || cliente.email || ''} onClose={onClose} width={680} maxHeight="88vh">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Cabecera: estado + responsable + tags + próximo contacto */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={{ background: ec.color, color: '#fff', borderRadius: 12, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>{ec.label}</span>
          {respNombre && <span style={{ fontSize: 12, color: T.ink2 }}>· Resp: <b>{respNombre}</b></span>}
          {(cliente.tags || []).map(t => <Chip key={t} accent style={{ fontSize: 10 }}>{t}</Chip>)}
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: T.ink3 }}>Próx. contacto</span>
            <input type="date" value={cliente.fechaProximoContacto || ''}
              onChange={e => updateCliente(cliente.id, { fechaProximoContacto: e.target.value || null })}
              style={{ padding: '3px 6px', border: `1px solid ${T.faint2}`, borderRadius: 4, fontSize: 12, fontFamily: T.font }} />
          </div>
        </div>

        {/* Cuenta corriente */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {[['Total', cc.totalUSD, T.accent], ['Cobrado', cc.cobradoUSD, T.ok], ['Saldo', cc.saldoUSD, cc.saldoUSD > 0 ? T.warn : T.ok]].map(([l, v, c]) => (
            <div key={l} style={{ background: T.faint, borderRadius: 8, padding: '10px 14px', border: `1px solid ${T.faint2}` }}>
              <div style={{ fontSize: 9.5, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 1, fontWeight: 700, textTransform: 'uppercase' }}>{l}</div>
              <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 18, color: c }}>{fmtU(v)}</div>
            </div>
          ))}
        </div>

        {/* Oportunidades (obras del cliente) */}
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: T.ink }}>Oportunidades ({obrasCliente.length})</div>
          {obrasCliente.length === 0 && <div style={{ fontSize: 12, color: T.ink3 }}>Sin obras.</div>}
          {obrasCliente.map(o => {
            const det = getDetalle(o.id);
            const cobr = cobradoObraUSD(movimientos, cajas, o.id, tc);
            const et = etapaEfectiva(o, { cobradoUSD: cobr });
            const meta = ETAPA_META[et] || {};
            const { totalUSD } = ccObra(o, det, movimientos, cajas, tc);
            return (
              <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderBottom: `1px solid ${T.faint2}` }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color || T.ink3, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: T.ink, flex: 1 }}>{o.nombre}</span>
                {esArrastrableEnEmbudo(o) ? (
                  <select value={et}
                    onChange={e => {
                      const nueva = e.target.value;
                      if (nueva === et) return;
                      setVentaEtapa(o.id, nueva, { usuario: currentUser?.id || null });
                      addActividad({ clienteId: cliente.id, obraId: o.id, tipo: 'cambio_etapa', texto: `Movida de ${ETAPA_META[et]?.label || et} a ${ETAPA_META[nueva]?.label || nueva} — ${o.nombre}`, usuario: currentUser?.id || null });
                    }}
                    style={{ fontSize: 10, padding: '2px 4px', border: `1px solid ${T.faint2}`, borderRadius: 4, color: T.ink2, background: '#fff', fontFamily: T.font }}>
                    {['prospecto', 'cotizado', 'negociacion', 'ganado'].map(x => <option key={x} value={x}>{ETAPA_META[x]?.label || x}</option>)}
                  </select>
                ) : (
                  <span style={{ fontSize: 10.5, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.4 }}>{meta.label || et}</span>
                )}
                <span style={{ fontFamily: T.fontMono, fontSize: 12.5, fontWeight: 700, color: meta.color || T.ink }}>{fmtU(totalUSD)}</span>
              </div>
            );
          })}
        </div>

        {/* Registrar actividad */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select value={nuevaAct.tipo} onChange={e => setNuevaAct(a => ({ ...a, tipo: e.target.value }))}
            style={{ padding: '6px 8px', border: `1px solid ${T.faint2}`, borderRadius: 5, fontSize: 12, fontFamily: T.font }}>
            {['llamada', 'mail', 'reunion', 'whatsapp', 'nota'].map(t => <option key={t} value={t}>{TIPO_ICON[t]} {t}</option>)}
          </select>
          <input value={nuevaAct.texto} onChange={e => setNuevaAct(a => ({ ...a, texto: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') registrarActividad(); }}
            placeholder="Registrar actividad…" style={{ flex: 1, padding: '6px 10px', border: `1px solid ${T.faint2}`, borderRadius: 5, fontSize: 13, fontFamily: T.font, outline: 'none' }} />
          <Btn sm accent onClick={registrarActividad}>+ Registrar</Btn>
        </div>

        {/* Timeline */}
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: T.ink }}>Actividad ({acts.length})</div>
          {acts.length === 0 && <div style={{ fontSize: 12, color: T.ink3 }}>Sin actividad registrada.</div>}
          {acts.map(a => (
            <div key={a.id} style={{ display: 'flex', gap: 10, padding: '7px 4px', borderBottom: `1px solid ${T.faint2}` }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>{TIPO_ICON[a.tipo] || '•'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: T.ink }}>{a.texto}</div>
                <div style={{ fontSize: 10.5, color: T.ink3, fontFamily: T.fontMono }}>
                  {fmtFecha((a.fecha || a.creadoAt || '').slice(0, 10))} · {nombreUsuario(a.usuario)}{a.obraId ? ` · ${(obras.find(o => o.id === a.obraId)?.nombre) || ''}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
