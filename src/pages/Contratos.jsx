import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '../hooks/useMediaQuery';
import PageLayout from '../components/layout/PageLayout';
import { Box, Chip } from '../components/ui';
import PageHero from '../components/ui/PageHero';
import { T } from '../theme';
import { useObras } from '../store/ObrasContext';
import { useUsuarios } from '../store/UsuariosContext';
import { resumenDocsEstado } from '../lib/contratistaDocs';

// Sección "Contratos" centralizada: lista TODOS los contratos de contratista
// (MO) de TODAS las obras (detalle.contratos[]). Solo Admin / Administración.
// Por cada contrato: obra, contratista, monto, estado, resumen del checklist
// (docs confeccionados/firmados) y estado de la póliza (de
// detalle.segurosPorContrato[contratoId]). Click en la fila → obra, pestaña
// Contratos MO (tab=6).

const fmtMonto = (n) => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const fmtD = (iso) => !iso ? '—' : iso.split('-').reverse().join('/');

// Monto del contrato: usa monto fijo o lo deriva de las tareas contratadas.
const montoContrato = (c) =>
  Number(c?.monto) ||
  (c?.tareas || []).reduce((s, t) => s + (Number(t.cantidadContratada) || 0) * (Number(t.precioUnit) || 0), 0);

// Estado de la póliza de un contrato (mismo criterio que TabSeguros):
// falta · vencida · próxima a vencer (<30d) · vigente.
function estadoPoliza(seg) {
  const polizaUrl = seg?.polizaUrl;
  const polizaVence = seg?.polizaVence;
  if (!polizaUrl) return { label: 'Falta póliza', color: T.warn, key: 'falta' };
  if (!polizaVence) return { label: 'Cargada', color: T.ok, key: 'ok' };
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const vence = new Date(polizaVence + 'T00:00:00');
  const dias = Math.ceil((vence - hoy) / 86400000);
  if (dias < 0) return { label: `Vencida ${fmtD(polizaVence)}`, color: T.warn, key: 'vencida' };
  if (dias <= 30) return { label: `Vence en ${dias}d`, color: T.warn, key: 'porvencer' };
  return { label: `Vigente`, color: T.ok, key: 'ok' };
}

// Estado del checklist de docs de un contrato (para el filtro):
// 'sin' (nada confeccionado) · 'parcial' · 'completo' (todo firmado).
function checklistKey(resumen) {
  if (resumen.total === 0) return 'sin';
  if (resumen.firma >= resumen.total) return 'completo';
  if (resumen.confeccion === 0) return 'sin';
  return 'parcial';
}

export default function Contratos() {
  const navigate = useNavigate();
  const { currentUser } = useUsuarios();
  const isMobile = useIsMobile();
  // Gate: solo Admin / Administración (contratos = info administrativa sensible).
  const puedeVer = currentUser?.rol === 'Admin' || currentUser?.rol === 'Administración';
  useEffect(() => {
    if (currentUser && !puedeVer) navigate('/', { replace: true });
  }, [currentUser, puedeVer, navigate]);

  const { obras, detalles } = useObras();

  const [fObra, setFObra] = useState('');       // '' = todas
  const [fEstado, setFEstado] = useState('');   // '' = todos (estado del checklist)

  // Aplanar: una fila por contrato de cada obra.
  const filas = useMemo(() => {
    const out = [];
    obras.forEach(obra => {
      const det = detalles[obra.id];
      const contratos = det?.contratos || [];
      const segPorContrato = det?.segurosPorContrato || {};
      contratos.forEach(contrato => {
        const resumen = resumenDocsEstado(contrato);
        const poliza = estadoPoliza(segPorContrato[contrato.id]);
        out.push({
          obra,
          contrato,
          monto: montoContrato(contrato),
          resumen,
          poliza,
          checklist: checklistKey(resumen),
        });
      });
    });
    return out;
  }, [obras, detalles]);

  // Obras que tienen al menos un contrato (para el selector de filtro).
  const obrasConContrato = useMemo(() => {
    const ids = new Set(filas.map(f => f.obra.id));
    return obras.filter(o => ids.has(o.id));
  }, [filas, obras]);

  const filasFiltradas = useMemo(() =>
    filas.filter(f =>
      (!fObra || f.obra.id === fObra) &&
      (!fEstado || f.checklist === fEstado)
    ).sort((a, b) =>
      (a.obra.nombre || '').localeCompare(b.obra.nombre || '') ||
      (a.contrato.proveedor || '').localeCompare(b.contrato.proveedor || '')
    ),
    [filas, fObra, fEstado]);

  // KPIs.
  const totalActivos = filas.filter(f => f.contrato.estado !== 'cerrado').length;
  const montoTotal = filas.reduce((s, f) => s + f.monto, 0);
  const polizasFaltan = filas.filter(f => f.poliza.key === 'falta' || f.poliza.key === 'vencida' || f.poliza.key === 'porvencer').length;
  const docsPendientes = filas.filter(f => f.checklist !== 'completo').length;

  const selStyle = {
    padding: '6px 10px', borderRadius: 4, border: `1.5px solid ${T.faint2}`,
    fontSize: 12, fontFamily: T.font, background: T.paper,
    width: isMobile ? '100%' : 'auto', maxWidth: '100%',
  };

  return (
    <PageLayout breadcrumb={['Contratos']} active="Contratos">
      <PageHero
        label="CONTRATISTAS · RÉGIMEN PADIC"
        title="Contratos"
        subtitle="Contratos de mano de obra (subcontratistas) de todas las obras"
        kpis={[
          { label: 'Contratos activos', value: totalActivos, sub: `${filas.length} en total`, color: T.ok },
          { label: 'Monto total',       value: fmtMonto(montoTotal),               color: T.accent },
          { label: 'Pólizas a revisar', value: polizasFaltan,  sub: 'falta / vence', color: polizasFaltan > 0 ? T.warn : T.ok },
          { label: 'Docs pendientes',   value: docsPendientes, sub: 'checklist incompleto', color: docsPendientes > 0 ? T.warn : T.ok },
        ]}
      />

      {/* Filtros */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12, alignItems: isMobile ? 'stretch' : 'center' }}>
        <select value={fObra} onChange={e => setFObra(e.target.value)} style={selStyle}>
          <option value="">Todas las obras</option>
          {obrasConContrato.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        </select>
        <select value={fEstado} onChange={e => setFEstado(e.target.value)} style={selStyle}>
          <option value="">Checklist: todos</option>
          <option value="sin">Sin iniciar</option>
          <option value="parcial">En proceso</option>
          <option value="completo">Completo (firmado)</option>
        </select>
        <div style={{ fontSize: 11, color: T.ink3, marginLeft: isMobile ? 0 : 'auto' }}>
          {filasFiltradas.length} {filasFiltradas.length === 1 ? 'contrato' : 'contratos'}
        </div>
      </div>

      {filasFiltradas.length === 0 ? (
        <Box style={{ padding: 24, textAlign: 'center', color: T.ink3, fontSize: 13 }}>
          {filas.length === 0
            ? 'No hay contratos de contratista cargados todavía. Se cargan en la pestaña Contratos MO de cada obra.'
            : 'No hay contratos que coincidan con los filtros.'}
        </Box>
      ) : (
        <Box style={{ padding: 0, overflow: 'hidden' }}>
          {/* Encabezado (solo desktop) */}
          {!isMobile && (
            <div style={{
              display: 'grid', gridTemplateColumns: '1.4fr 1.2fr 0.9fr 0.7fr 1fr 1.1fr',
              gap: 12, padding: '8px 14px', background: T.faint,
              fontSize: 10, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5,
            }}>
              <span>Obra</span>
              <span>Contratista</span>
              <span style={{ textAlign: 'right' }}>Monto</span>
              <span>Estado</span>
              <span>Checklist docs</span>
              <span>Póliza</span>
            </div>
          )}

          {filasFiltradas.map(({ obra, contrato, monto, resumen, poliza }) => {
            const irAObra = () => navigate(`/obras/${obra.id}/presupuesto?tab=6`);
            const cerrado = contrato.estado === 'cerrado';
            if (isMobile) {
              return (
                <div key={`${obra.id}:${contrato.id}`} onClick={irAObra}
                  style={{ padding: '10px 14px', borderTop: `1px solid ${T.faint2}`, cursor: 'pointer', opacity: cerrado ? 0.7 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {contrato.proveedor || '(sin nombre)'}
                      </div>
                      <div style={{ fontSize: 11, color: T.ink3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{obra.nombre}</div>
                    </div>
                    <span style={{ fontFamily: T.fontMono, fontSize: 12, fontWeight: 800, color: T.accent, flexShrink: 0 }}>{fmtMonto(monto)}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, alignItems: 'center' }}>
                    <Chip ok={!cerrado} style={{ fontSize: 9 }}>{cerrado ? 'cerrado' : 'activo'}</Chip>
                    <span style={{ fontSize: 11, color: T.ink2 }}>
                      Docs {resumen.firma}/{resumen.total} firmados · {resumen.confeccion}/{resumen.total} confecc.
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: poliza.color, padding: '1px 8px', borderRadius: 10 }}>{poliza.label}</span>
                  </div>
                </div>
              );
            }
            return (
              <div key={`${obra.id}:${contrato.id}`} onClick={irAObra}
                style={{
                  display: 'grid', gridTemplateColumns: '1.4fr 1.2fr 0.9fr 0.7fr 1fr 1.1fr',
                  gap: 12, padding: '10px 14px', borderTop: `1px solid ${T.faint2}`,
                  cursor: 'pointer', alignItems: 'center', opacity: cerrado ? 0.7 : 1,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = T.faint; }}
                onMouseLeave={e => { e.currentTarget.style.background = ''; }}>
                <span style={{ fontSize: 12, color: T.accent, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{obra.nombre}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contrato.proveedor || '(sin nombre)'}</div>
                  {contrato.gremio && <div style={{ fontSize: 10, color: T.ink3 }}>{contrato.gremio}</div>}
                </div>
                <span style={{ fontFamily: T.fontMono, fontSize: 12, fontWeight: 800, color: T.accent, textAlign: 'right' }}>{fmtMonto(monto)}</span>
                <span><Chip ok={!cerrado} style={{ fontSize: 9 }}>{cerrado ? 'cerrado' : 'activo'}</Chip></span>
                <div style={{ fontSize: 11, color: T.ink2 }}>
                  <div><b style={{ color: resumen.firma >= resumen.total && resumen.total > 0 ? T.ok : T.ink }}>{resumen.firma}/{resumen.total}</b> firmados</div>
                  <div style={{ fontSize: 10, color: T.ink3 }}>{resumen.confeccion}/{resumen.total} confeccionados</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: poliza.color, padding: '2px 9px', borderRadius: 10, justifySelf: 'start', whiteSpace: 'nowrap' }}>{poliza.label}</span>
              </div>
            );
          })}
        </Box>
      )}
    </PageLayout>
  );
}
