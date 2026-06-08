import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../../components/layout/PageLayout';
import PageHero from '../../components/ui/PageHero';
import { T } from '../../theme';
import { useObras } from '../../store/ObrasContext';
import { useMovimientos } from '../../store/MovimientosContext';
import { useDolar } from '../../store/DolarContext';
import { useUsuarios } from '../../store/UsuariosContext';
import { useComercial } from '../../store/ComercialContext';
import { useClientes } from '../../store/ClientesContext';
import { ccObra, cobradoObraUSD } from '../obra/helpers';
import { ETAPAS_VENTA } from '../../lib/constants';
import { ETAPA_META, etapaEfectiva, resumenEmbudo, visibleEnEmbudo, esArrastrableEnEmbudo } from '../../lib/ventaEtapa';
import { fmtN } from '../../lib/format';
import { Btn } from '../../components/ui';
import PerdidaModal from './PerdidaModal';
import PrimerContactoModal from './PrimerContactoModal';
import { useIsMobile } from '../../hooks/useMediaQuery';

// Convierte un hex (#rrggbb) a rgba con alpha — para tintes suaves de columna.
const tint = (hex, a) => {
  const h = (hex || '#000000').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

export default function Pipeline() {
  const { obras, getDetalle, setVentaEtapa, addObra } = useObras();
  const { movimientos, cajas } = useMovimientos();
  const { dolarVenta } = useDolar();
  const { currentUser } = useUsuarios();
  const { addActividad } = useComercial();
  const { clientes, addCliente } = useClientes();
  const navigate = useNavigate();
  const tc = dolarVenta || 1070;

  // Guard: el embudo es SOLO Admin (un no-admin no entra ni por URL).
  const isAdmin = currentUser?.rol === 'Admin';
  useEffect(() => { if (currentUser && !isAdmin) navigate('/', { replace: true }); }, [currentUser, isAdmin, navigate]);

  const isMobile = useIsMobile();

  const [drag, setDrag] = useState(null);          // obraId arrastrándose
  const [dragOver, setDragOver] = useState(null);  // etapa bajo el cursor
  const [perdida, setPerdida] = useState(null);    // { obraId, nombre } -> modal
  const [nuevoContacto, setNuevoContacto] = useState(false);  // modal "+ Primer contacto"

  // Una oportunidad por obra VISIBLE (las terminadas no van al board), con su
  // etapa efectiva y su monto USD.
  const oportunidades = useMemo(() => obras.filter(visibleEnEmbudo).map(o => {
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
    setDrag(null); setDragOver(null);
    if (!obraId) return;
    const op = oportunidades.find(o => o.obra.id === obraId);
    // Solo se mueven oportunidades abiertas: una obra confirmada/perdida no se
    // revierte desde el board (evita desconfirmar una obra real).
    if (!op || op.etapa === etapaDestino || !esArrastrableEnEmbudo(op.obra)) return;
    if (etapaDestino === 'perdido') { setPerdida({ obraId, nombre: op.obra.nombre, clienteId: op.obra.clienteId || null }); return; }
    setVentaEtapa(obraId, etapaDestino, { usuario: currentUser?.id || null });
    addActividad({
      clienteId: op.obra.clienteId || null,
      obraId,
      tipo: 'cambio_etapa',
      texto: `Movida de ${(ETAPA_META[op.etapa]?.label) || op.etapa} a ${(ETAPA_META[etapaDestino]?.label) || etapaDestino} — ${op.obra.nombre}`,
      usuario: currentUser?.id || null,
    });
  };

  // Carga un primer contacto: crea/vincula cliente + obra prospecto SIN presupuesto
  // + actividad inicial. Aparece en la columna Prospecto del embudo.
  const crearPrimerContacto = ({ clienteNombre, clienteId, telefono, fuente, nombreOportunidad, nota }) => {
    const cid = clienteId || addCliente({ nombre: clienteNombre, telefono: telefono || '', estado: 'prospecto' });
    const nombre = nombreOportunidad || `Consulta — ${clienteNombre}`;
    const hoy = new Date().toISOString().split('T')[0];
    // Se setea venta.etapa DENTRO de addObra (atómico). No usar setVentaEtapa acá:
    // la obra recién creada todavía no está en obrasRef y setVentaEtapa la ignora.
    const venta = { etapa: 'prospecto', fechaCambioEtapa: hoy, changelog: [{ etapa: 'prospecto', fecha: hoy, usuario: currentUser?.id || null }] };
    const obraId = addObra({ nombre, cliente: clienteNombre, clienteId: cid, tipo: 'Otro', presupuesto: 0, notas: nota || '', venta });
    addActividad({
      clienteId: cid,
      obraId,
      tipo: 'primer_contacto',
      texto: `Primer contacto${fuente ? ` (${fuente})` : ''}${nota ? `: ${nota}` : ''}`,
      usuario: currentUser?.id || null,
    });
    setNuevoContacto(false);
  };

  return (
    <PageLayout breadcrumb={[{ label: 'Inicio', to: '/' }, 'Comercial']} active="Embudo">
      <PageHero
        label="COMERCIAL"
        title="Embudo de ventas"
        subtitle={`${resumen.abiertas} oportunidades abiertas · ${resumen.conteo.ganado} ganadas · conversión ${resumen.conversion}%`}
        kpis={ETAPAS_VENTA.map(e => ({
          label: ETAPA_META[e].label,
          value: resumen.conteo[e],
          color: ETAPA_META[e].color,
        }))}
      />

      {/* Acción: cargar un primer contacto (prospecto sin presupuesto) */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '2px 0 12px' }}>
        <Btn sm accent onClick={() => setNuevoContacto(true)}>+ Primer contacto</Btn>
      </div>

      {/* Tablero Kanban — scroll horizontal, columnas por etapa */}
      <div style={{
        display: 'flex',
        gap: 12,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        padding: isMobile ? '4px 0 18px' : '4px 2px 18px',
        alignItems: 'flex-start',
      }}>
        {ETAPAS_VENTA.map(etapa => {
          const items = porEtapa(etapa);
          const totalUSD = items.reduce((s, o) => s + o.montoUSD, 0);
          const meta = ETAPA_META[etapa];
          const isOver = !!drag && dragOver === etapa;
          return (
            <div
              key={etapa}
              onDragOver={e => e.preventDefault()}
              onDragEnter={() => { if (drag) setDragOver(etapa); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(null); }}
              onDrop={() => onDrop(etapa)}
              style={{
                flex: isMobile ? '0 0 220px' : '0 0 246px',
                background: isOver ? tint(meta.color, 0.10) : '#fbf9f1',
                border: isOver ? `1.5px dashed ${meta.color}` : `1px solid ${T.faint2}`,
                borderRadius: 10,
                padding: isMobile ? 8 : 11,
                minHeight: 300,
                boxShadow: '0 1px 0 rgba(0,0,0,0.03)',
                transition: 'background .15s, border-color .15s',
              }}
            >
              {/* Header de columna: punto de color + label + badge de cantidad */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: totalUSD > 0 ? 3 : 13 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 800, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.4, color: T.ink, flex: 1, minWidth: 0 }}>{meta.label}</span>
                <span style={{ fontFamily: T.fontMono, fontSize: 11, fontWeight: 700, color: '#fff', background: meta.color, borderRadius: 10, padding: '1px 7px', minWidth: 20, textAlign: 'center' }}>{items.length}</span>
              </div>
              {totalUSD > 0 && (
                <div style={{ fontFamily: T.fontMono, fontSize: 10.5, color: T.ink2, margin: '0 0 13px 17px' }}>U$S {fmtN(totalUSD)}</div>
              )}

              {/* Cards de oportunidad */}
              {items.map(({ obra, montoUSD }) => {
                const isDragging = drag === obra.id;
                const arrastrable = esArrastrableEnEmbudo(obra);
                return (
                  <div
                    key={obra.id}
                    draggable={arrastrable}
                    onDragStart={() => { if (arrastrable) setDrag(obra.id); }}
                    onDragEnd={() => { setDrag(null); setDragOver(null); }}
                    title={arrastrable ? undefined : 'Obra confirmada — se gestiona desde Obras'}
                    style={{
                      background: '#fff',
                      border: `1px solid ${T.faint2}`,
                      borderLeft: `3px solid ${meta.color}`,
                      borderRadius: 7,
                      padding: '9px 11px 9px 12px',
                      marginBottom: 9,
                      minWidth: 0,
                      cursor: arrastrable ? 'grab' : 'default',
                      boxShadow: isDragging ? '0 10px 20px -6px rgba(20,18,15,0.38)' : '0 1px 2px rgba(20,18,15,0.06)',
                      opacity: isDragging ? 0.55 : 1,
                      transform: isDragging ? 'rotate(-1.5deg)' : 'none',
                      transition: 'box-shadow .15s, opacity .15s, transform .1s',
                    }}
                    onMouseEnter={e => { if (arrastrable && !drag) e.currentTarget.style.boxShadow = '0 4px 12px -4px rgba(20,18,15,0.20)'; }}
                    onMouseLeave={e => { if (arrastrable && !drag) e.currentTarget.style.boxShadow = '0 1px 2px rgba(20,18,15,0.06)'; }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, lineHeight: 1.25, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{obra.nombre}</div>
                    <div style={{ fontSize: 11, color: T.ink2, marginTop: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{obra.cliente || 'Sin cliente'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 7, gap: isMobile ? 4 : 6 }}>
                      <span style={{ fontFamily: T.fontMono, fontSize: isMobile ? 11 : 12.5, fontWeight: 700, color: meta.color, flexShrink: 0 }}>U$S {fmtN(montoUSD)}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                        {!arrastrable && <span style={{ fontSize: 9, color: T.ink3 }}>🔒</span>}
                        {obra.tipo && <span style={{ fontSize: 9, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: isMobile ? 'clamp(50px, 8vw, 65px)' : 100 }}>{obra.tipo}</span>}
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* Estado vacío */}
              {items.length === 0 && (
                <div style={{
                  border: `1.5px dashed ${T.faint2}`, borderRadius: 7,
                  color: T.ink3, fontSize: 11, textAlign: 'center', padding: '22px 8px',
                }}>
                  Sin oportunidades
                </div>
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
            addActividad({
              clienteId: perdida.clienteId || null,
              obraId: perdida.obraId,
              tipo: 'cambio_etapa',
              texto: `Perdida: ${motivo} — ${perdida.nombre}`,
              usuario: currentUser?.id || null,
            });
            setPerdida(null);
          }}
        />
      )}

      {nuevoContacto && (
        <PrimerContactoModal
          clientes={clientes}
          onClose={() => setNuevoContacto(false)}
          onCrear={crearPrimerContacto}
        />
      )}
    </PageLayout>
  );
}
