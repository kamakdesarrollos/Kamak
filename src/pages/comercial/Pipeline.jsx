import { useState, useMemo } from 'react';
import PageLayout from '../../components/layout/PageLayout';
import PageHero from '../../components/ui/PageHero';
import { T } from '../../theme';
import { useObras } from '../../store/ObrasContext';
import { useMovimientos } from '../../store/MovimientosContext';
import { useDolar } from '../../store/DolarContext';
import { useUsuarios } from '../../store/UsuariosContext';
import { ccObra, cobradoObraUSD } from '../obra/helpers';
import { ETAPAS_VENTA } from '../../lib/constants';
import { ETAPA_META, etapaEfectiva, resumenEmbudo } from '../../lib/ventaEtapa';
import { fmtN } from '../../lib/format';
import PerdidaModal from './PerdidaModal';

export default function Pipeline() {
  const { obras, getDetalle, setVentaEtapa } = useObras();
  const { movimientos, cajas } = useMovimientos();
  const { dolarVenta } = useDolar();
  const { currentUser } = useUsuarios();
  const tc = dolarVenta || 1070;

  const [drag, setDrag] = useState(null);        // obraId arrastrándose
  const [perdida, setPerdida] = useState(null);  // { obraId, nombre } -> abre modal

  // Una oportunidad por obra, con su etapa efectiva y su monto USD.
  const oportunidades = useMemo(() => obras.map(o => {
    const det = getDetalle(o.id);
    const cobradoUSD = cobradoObraUSD(movimientos, cajas, o.id, tc);
    const etapa = etapaEfectiva(o, { cobradoUSD });
    const { totalUSD } = ccObra(o, det, movimientos, cajas, tc);
    return { obra: o, etapa, montoUSD: totalUSD };
  }), [obras, movimientos, cajas, tc, getDetalle]);

  const resumen = useMemo(() => resumenEmbudo(oportunidades.map(o => o.etapa)), [oportunidades]);
  const porEtapa = (etapa) => oportunidades.filter(o => o.etapa === etapa);

  const onDrop = (etapaDestino) => {
    const obraId = drag;
    setDrag(null);
    if (!obraId) return;
    const op = oportunidades.find(o => o.obra.id === obraId);
    if (!op || op.etapa === etapaDestino) return;
    if (etapaDestino === 'perdido') { setPerdida({ obraId, nombre: op.obra.nombre }); return; }
    setVentaEtapa(obraId, etapaDestino, { usuario: currentUser?.id || null });
  };

  return (
    <PageLayout breadcrumb={[{ label: 'Inicio', to: '/' }, 'Comercial']} active="Embudo">
      <PageHero
        label="COMERCIAL"
        title="Embudo de ventas"
        subtitle={`${resumen.abiertas} oportunidades abiertas · conversión ${resumen.conversion}%`}
        kpis={ETAPAS_VENTA.map(e => ({
          label: ETAPA_META[e].label,
          value: resumen.conteo[e],
          color: ETAPA_META[e].color,
        }))}
      />

      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '16px 0', alignItems: 'flex-start' }}>
        {ETAPAS_VENTA.map(etapa => {
          const items = porEtapa(etapa);
          const totalUSD = items.reduce((s, o) => s + o.montoUSD, 0);
          const meta = ETAPA_META[etapa];
          return (
            <div
              key={etapa}
              onDragOver={e => e.preventDefault()}
              onDrop={() => onDrop(etapa)}
              style={{ flex: '0 0 240px', background: T.faint, borderRadius: 8, padding: 10, minHeight: 220 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            marginBottom: 10, paddingLeft: 6, borderLeft: `3px solid ${meta.color}` }}>
                <span style={{ fontWeight: 800, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: T.ink }}>{meta.label}</span>
                <span style={{ fontFamily: T.fontMono, fontSize: 10.5, color: T.ink2 }}>{items.length} · U$S {fmtN(totalUSD)}</span>
              </div>

              {items.map(({ obra, montoUSD }) => (
                <div
                  key={obra.id}
                  draggable
                  onDragStart={() => setDrag(obra.id)}
                  onDragEnd={() => setDrag(null)}
                  style={{ background: '#fff', border: `1.5px solid ${T.faint2}`, borderRadius: 6,
                           padding: '8px 10px', marginBottom: 8, cursor: 'grab',
                           opacity: drag === obra.id ? 0.4 : 1, transition: 'opacity .15s' }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{obra.nombre}</div>
                  <div style={{ fontSize: 11, color: T.ink2, marginTop: 2 }}>{obra.cliente || '—'}</div>
                  <div style={{ fontFamily: T.fontMono, fontSize: 12, color: meta.color, fontWeight: 700, marginTop: 4 }}>U$S {fmtN(montoUSD)}</div>
                </div>
              ))}

              {items.length === 0 && (
                <div style={{ fontSize: 11, color: T.ink3, textAlign: 'center', padding: '24px 0' }}>—</div>
              )}
            </div>
          );
        })}
      </div>

      {perdida && (
        <PerdidaModal
          nombre={perdida.nombre}
          onClose={() => setPerdida(null)}
          onConfirm={(motivo) => {
            setVentaEtapa(perdida.obraId, 'perdido', { motivoPerdida: motivo, usuario: currentUser?.id || null });
            setPerdida(null);
          }}
        />
      )}
    </PageLayout>
  );
}
