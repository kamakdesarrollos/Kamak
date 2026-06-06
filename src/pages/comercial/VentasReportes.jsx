import { useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../../components/layout/PageLayout';
import PageHero from '../../components/ui/PageHero';
import { Box } from '../../components/ui';
import { T } from '../../theme';
import { useObras } from '../../store/ObrasContext';
import { useMovimientos } from '../../store/MovimientosContext';
import { useDolar } from '../../store/DolarContext';
import { useUsuarios } from '../../store/UsuariosContext';
import { useClientes } from '../../store/ClientesContext';
import { useComercial } from '../../store/ComercialContext';
import { ccObra, cobradoObraUSD } from '../obra/helpers';
import { etapaEfectiva, resumenEmbudo, visibleEnEmbudo, ETAPA_META } from '../../lib/ventaEtapa';
import { ETAPAS_VENTA } from '../../lib/constants';
import { pipelinePonderado, agingDias, motivosPerdida, winRatePorResponsable } from '../../lib/ventaKpis';
import { derivaClienteEstado } from '../../lib/derivaClienteEstado';
import { fmtN } from '../../lib/format';

const fmtU = (n) => `U$S ${fmtN(n)}`;
const Kpi = ({ label, value, sub, color }) => (
  <Box style={{ padding: '12px 16px' }}>
    <div style={{ fontSize: 9.5, color: T.ink3, fontFamily: T.fontMono, letterSpacing: 1, fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
    <div style={{ fontFamily: T.fontMono, fontWeight: 800, fontSize: 22, color: color || T.ink, lineHeight: 1.1, marginTop: 2 }}>{value}</div>
    {sub && <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 2 }}>{sub}</div>}
  </Box>
);

export default function VentasReportes() {
  const navigate = useNavigate();
  const { obras, getDetalle } = useObras();
  const { movimientos, cajas } = useMovimientos();
  const { dolarVenta } = useDolar();
  const { currentUser, usuarios } = useUsuarios();
  const { clientes } = useClientes();
  const { actividades } = useComercial();
  const tc = dolarVenta || 1070;

  const isAdmin = currentUser?.rol === 'Admin' || currentUser?.rol === 'Administración';
  useEffect(() => { if (currentUser && !isAdmin) navigate('/', { replace: true }); }, [currentUser, isAdmin, navigate]);

  const oportunidades = useMemo(() => obras.filter(visibleEnEmbudo).map(o => {
    const det = getDetalle(o.id);
    const cobradoUSD = cobradoObraUSD(movimientos, cajas, o.id, tc);
    const etapa = etapaEfectiva(o, { cobradoUSD });
    const { totalUSD, saldoUSD } = ccObra(o, det, movimientos, cajas, tc);
    return { obra: o, etapa, montoUSD: totalUSD, saldoUSD, responsable: o.venta?.responsable || null };
  }), [obras, movimientos, cajas, tc, getDetalle]);

  const resumen = useMemo(() => resumenEmbudo(oportunidades.map(o => o.etapa)), [oportunidades]);
  const abiertas = useMemo(() => oportunidades.filter(o => ['prospecto', 'cotizado', 'negociacion'].includes(o.etapa)), [oportunidades]);
  const pondUSD = useMemo(() => pipelinePonderado(abiertas), [abiertas]);
  const valorAbierto = useMemo(() => abiertas.reduce((s, o) => s + o.montoUSD, 0), [abiertas]);
  const ganadasUSD = useMemo(() => oportunidades.filter(o => o.etapa === 'ganado').reduce((s, o) => s + o.montoUSD, 0), [oportunidades]);
  const ticket = resumen.conteo.ganado > 0 ? Math.round(ganadasUSD / resumen.conteo.ganado) : 0;
  // Motivos de pérdida sobre la MISMA fuente que el resto de KPIs: oportunidades
  // con etapa EFECTIVA 'perdido' (no la cruda), para que no se contradiga con la
  // conversión (una 'perdido' que cobró cuenta como ganada en ambos lados).
  const motivos = useMemo(() => motivosPerdida(oportunidades.filter(o => o.etapa === 'perdido').map(o => o.obra)), [oportunidades]);
  const winResp = useMemo(() => winRatePorResponsable(oportunidades), [oportunidades]);
  const agingTop = useMemo(() => abiertas.map(o => ({ nombre: o.obra.nombre, dias: agingDias(o.obra) })).filter(x => x.dias != null).sort((a, b) => b.dias - a.dias).slice(0, 6), [abiertas]);

  const estadosCliente = useMemo(() => {
    const c = { prospecto: 0, cliente: 0, inactivo: 0 };
    for (const cl of clientes) {
      const obrasCl = obras.filter(o => o.clienteId === cl.id || o.cliente === cl.nombre);
      const ult = (actividades || []).filter(a => a.clienteId === cl.id).map(a => a.fecha || a.creadoAt).sort().slice(-1)[0] || null;
      c[derivaClienteEstado(cl, obrasCl, ult)]++;
    }
    return c;
  }, [clientes, obras, actividades]);

  const nombreResp = (id) => (usuarios || []).find(u => u.id === id)?.nombre || id;

  return (
    <PageLayout breadcrumb={[{ label: 'Inicio', to: '/' }, { label: 'Comercial', to: '/comercial' }, 'KPIs Ventas']} active="KPIs Ventas">
      <PageHero label="COMERCIAL" title="KPIs de ventas"
        subtitle={`${abiertas.length} oportunidades abiertas · conversión ${resumen.conversion}% · pipeline U$S ${fmtN(valorAbierto)}`} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
        <Kpi label="Conversión" value={`${resumen.conversion}%`} sub={`${resumen.conteo.ganado} ganadas / ${resumen.cerradas} cerradas`} color={T.ok} />
        <Kpi label="Tasa de pérdida" value={`${resumen.cerradas > 0 ? Math.round(resumen.conteo.perdido / resumen.cerradas * 100) : 0}%`} sub={`${resumen.conteo.perdido} perdidas`} color="#b91c1c" />
        <Kpi label="Pipeline abierto" value={fmtU(valorAbierto)} sub={`${abiertas.length} oportunidades`} color={T.accent} />
        <Kpi label="Pipeline ponderado" value={fmtU(pondUSD)} sub="por probabilidad de etapa" color={T.accent2} />
        <Kpi label="Ganado" value={fmtU(ganadasUSD)} sub={`ticket prom. ${fmtU(ticket)}`} color={T.ok} />
        <Kpi label="Clientes" value={`${estadosCliente.cliente}`} sub={`${estadosCliente.prospecto} prospectos · ${estadosCliente.inactivo} inactivos`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {/* Embudo por etapa */}
        <Box style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Embudo por etapa</div>
          {ETAPAS_VENTA.map(e => (
            <div key={e} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: ETAPA_META[e].color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, color: T.ink }}>{ETAPA_META[e].label}</span>
              <span style={{ fontFamily: T.fontMono, fontWeight: 700, fontSize: 13, color: ETAPA_META[e].color }}>{resumen.conteo[e]}</span>
            </div>
          ))}
        </Box>

        {/* Aging — oportunidades estancadas */}
        <Box style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Más estancadas (días en etapa)</div>
          {agingTop.length === 0 && <div style={{ fontSize: 12, color: T.ink3 }}>—</div>}
          {agingTop.map(x => (
            <div key={x.nombre} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
              <span style={{ color: T.ink }}>{x.nombre}</span>
              <span style={{ fontFamily: T.fontMono, fontWeight: 700, color: x.dias > 14 ? '#b91c1c' : T.ink2 }}>{x.dias}d</span>
            </div>
          ))}
        </Box>

        {/* Motivos de pérdida */}
        <Box style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Motivos de pérdida</div>
          {motivos.length === 0 && <div style={{ fontSize: 12, color: T.ink3 }}>Sin pérdidas registradas.</div>}
          {motivos.map(m => (
            <div key={m.motivo} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
              <span style={{ color: T.ink }}>{m.motivo}</span>
              <span style={{ fontFamily: T.fontMono, fontWeight: 700, color: T.ink2 }}>{m.count}</span>
            </div>
          ))}
        </Box>

        {/* Por responsable */}
        <Box style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Win rate por responsable</div>
          {Object.entries(winResp).map(([id, r]) => (
            <div key={id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
              <span style={{ color: T.ink }}>{nombreResp(id)}</span>
              <span style={{ fontFamily: T.fontMono, fontWeight: 700, color: T.ok }}>{r.winRate}% <span style={{ color: T.ink3, fontWeight: 400 }}>({r.ganadas}/{r.ganadas + r.perdidas})</span></span>
            </div>
          ))}
        </Box>
      </div>
    </PageLayout>
  );
}
