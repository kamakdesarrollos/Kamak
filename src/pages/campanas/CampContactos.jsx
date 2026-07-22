import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import PageLayout from '../../components/layout/PageLayout';
import PageHero from '../../components/ui/PageHero';
import { Box, Btn } from '../../components/ui';
import { T } from '../../theme';
import { useUsuarios } from '../../store/UsuariosContext';
import { useCampanas } from '../../store/CampanasContext';
import { useClientes } from '../../store/ClientesContext';
import { useObras } from '../../store/ObrasContext';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { fmtN } from '../../lib/format';
import {
  ESTADOS_LLAMADA, ESTADO_LLAMADA_META,
  ETAPAS_PROSPECCION, ETAPA_PROSPECCION_META,
  BANDERAS, CANALES,
} from '../../lib/campanas/constants';

// Base de contactos de la campaña: tabla paginada de OPERADORES (unidad de
// contacto y anti-colisión) con filtros server-side + drawer "ficha del
// operador" (estaciones, decisores, timeline, tomar/liberar, promover).
// P11: esta página JAMÁS muestra montos de obras.

const PAGE_SIZE = 50;

const FILTROS_VACIOS = { busqueda: '', bandera: '', etapa: '', estadoLlamada: '', confianza: '' };

// ── Helpers puros ─────────────────────────────────────────────────────────────

// "hace 5 min / hace 3 h / hace 12 d" para updated_at y el timeline.
const tiempoRelativo = (iso) => {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '—';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d} d`;
  const mes = Math.floor(d / 30);
  if (mes < 12) return `hace ${mes} mes${mes > 1 ? 'es' : ''}`;
  const a = Math.floor(mes / 12);
  return `hace ${a} año${a > 1 ? 's' : ''}`;
};

const urlAbs = (u) => (/^https?:\/\//i.test(u || '') ? u : `https://${u}`);

const CONFIANZA_META = {
  alta:  { label: 'Alta',  color: T.ok },
  media: { label: 'Media', color: T.warn },
  baja:  { label: 'Baja',  color: T.ink3 },
};

// Tipos de actividad manual (canal: reunión/nota → 'otro'; el resto = el tipo).
const TIPOS_ACTIVIDAD = [
  ['llamada', '📞 Llamada'],
  ['email', '✉️ Email'],
  ['linkedin', '💼 LinkedIn'],
  ['whatsapp', '💬 WhatsApp'],
  ['reunion', '🤝 Reunión'],
  ['nota', '📝 Nota'],
];

const ICONO_TIPO = {
  llamada: '📞', email: '✉️', linkedin: '💼', whatsapp: '💬', reunion: '🤝',
  nota: '📝', cambio_etapa: '↔️', tomado: '🔒', liberado: '🔓', promovido: '▶️', import: '📥',
};
const ICONO_CANAL = { llamada: '📞', email: '✉️', linkedin: '💼', whatsapp: '💬', presencial: '🤝', otro: '📝' };
const iconoActividad = (a) => ICONO_TIPO[a.tipo] || ICONO_CANAL[a.canal] || '•';

// ── Estilos compartidos (patrón filtros/inputs del repo) ─────────────────────
const selSt = {
  padding: '6px 8px', border: `1px solid ${T.faint2}`, borderRadius: 5,
  fontSize: 12, fontFamily: T.font, background: '#fff', color: T.ink, outline: 'none',
};
const inputSt = {
  padding: '6px 10px', border: `1px solid ${T.faint2}`, borderRadius: 5,
  fontSize: 13, fontFamily: T.font, outline: 'none', background: '#fff', color: T.ink,
};

// ── Sub-componentes chicos ───────────────────────────────────────────────────

function PillEtapa({ etapa }) {
  const m = ETAPA_PROSPECCION_META[etapa] || { label: etapa || '—', color: T.ink3 };
  return (
    <span style={{ background: m.color, color: '#fff', borderRadius: 12, padding: '2px 9px', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {m.label}
    </span>
  );
}

function PillEstado({ estado }) {
  const m = ESTADO_LLAMADA_META[estado] || { label: estado || '—', color: T.ink3 };
  return (
    <span style={{ background: m.color, color: '#fff', borderRadius: 12, padding: '1.5px 8px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {m.label}
    </span>
  );
}

function PillConfianza({ confianza, verificado }) {
  const m = CONFIANZA_META[String(confianza || '').toLowerCase()];
  if (!m && !verificado) return null;
  return (
    <span style={{
      border: `1px solid ${m?.color || T.ok}`, color: m?.color || T.ok,
      borderRadius: 12, padding: '1.5px 8px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
    }}>
      {m ? m.label : 'Verificado'}{verificado ? ' ✓' : ''}
    </span>
  );
}

function TagBandera({ children }) {
  return (
    <span style={{
      fontSize: 9.5, fontWeight: 700, border: `1px solid ${T.faint2}`, borderRadius: 3,
      padding: '1px 5px', background: T.faint, color: T.ink2, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

// Candado de anti-colisión visible desde la tabla (tooltip con owner + canal).
function Candado({ ownerNombre, canal }) {
  return (
    <span
      title={`En tratativas con ${ownerNombre} por ${canal}`}
      style={{ fontSize: 13, cursor: 'help', flexShrink: 0 }}
    >🔒</span>
  );
}

// Banner warn de anti-colisión (P6): se muestra en la ficha si el operador está
// tomado por OTRO usuario (o si una mutación rebotó con {error:{colision}}).
function BannerColision({ ownerNombre, canal }) {
  return (
    <div style={{
      background: '#fdf3e4', border: `1.5px solid ${T.warn}`, borderRadius: 7,
      padding: '9px 12px', fontSize: 12.5, color: T.ink,
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span style={{ fontSize: 15, flexShrink: 0 }}>🔒</span>
      <span>En tratativas con <b>{ownerNombre}</b> por <b>{canal}</b> — coordiná antes de tocar este operador.</span>
    </div>
  );
}

// Skeleton simple para la carga de la tabla.
function Esqueleto({ filas = 6 }) {
  return (
    <div>
      {Array.from({ length: filas }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, padding: '12px 14px', borderBottom: `1px solid ${T.faint2}`, opacity: Math.max(0.25, 1 - i * 0.13) }}>
          <div style={{ height: 11, borderRadius: 3, background: T.faint2, flex: 2 }} />
          <div style={{ height: 11, borderRadius: 3, background: T.faint, flex: 1.2 }} />
          <div style={{ height: 11, borderRadius: 3, background: T.faint, flex: 1 }} />
          <div style={{ height: 11, borderRadius: 3, background: T.faint, flex: 0.8 }} />
        </div>
      ))}
    </div>
  );
}

const tituloSeccionSt = { fontWeight: 700, fontSize: 13, marginBottom: 6, color: T.ink };
const vacioSt = { fontSize: 12, color: T.ink3 };

// ── Drawer: ficha del operador ───────────────────────────────────────────────
// Datos + anti-colisión + estaciones + decisores + timeline + acciones.
function FichaOperador({ operador, onClose, onPatch, nombreUsuario }) {
  const {
    fetchEstaciones, fetchDecisores, fetchActividades,
    registrarActividad, setEtapaProspeccion,
    tomarOperador, liberarOperador, promoverAEmbudo,
  } = useCampanas();
  const { currentUser } = useUsuarios();
  const { addCliente } = useClientes();
  const { addObra } = useObras();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const myId = currentUser?.id || null;
  const esAdmin = currentUser?.rol === 'Admin';

  // ficha = null mientras carga (el componente se monta con key={operador.id},
  // así que TODO el estado interno arranca de cero al cambiar de operador).
  const [ficha, setFicha] = useState(null);   // { estaciones, decisores, acts }
  const [colision, setColision] = useState(null);       // {ownerId, canal} devuelto por el context
  const [errorFicha, setErrorFicha] = useState(null);
  const [nuevaAct, setNuevaAct] = useState({ tipo: 'llamada', texto: '' });
  const [guardando, setGuardando] = useState(false);
  const [canalToma, setCanalToma] = useState('llamada');
  const [promoviendo, setPromoviendo] = useState(false);
  const [promovidoOk, setPromovidoOk] = useState(false);

  // Carga de la ficha (estaciones + decisores + timeline) al abrir.
  useEffect(() => {
    let vivo = true;
    Promise.all([
      fetchEstaciones({ operadorId: operador.id, page: 1, pageSize: 100 }),
      fetchDecisores({ operadorId: operador.id, page: 1, pageSize: 100 }),
      fetchActividades({ operadorId: operador.id, limit: 100 }),
    ]).then(([est, dec, act]) => {
      if (!vivo) return;
      setFicha({ estaciones: est.rows || [], decisores: dec.rows || [], acts: act.rows || [] });
    });
    return () => { vivo = false; };
  }, [operador.id, fetchEstaciones, fetchDecisores, fetchActividades]);

  const cargando = !ficha;
  const estaciones = ficha?.estaciones || [];
  const decisores = ficha?.decisores || [];
  const acts = ficha?.acts || [];

  // Cerrar con Escape (patrón Modal).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const recargarActividades = useCallback(() => {
    fetchActividades({ operadorId: operador.id, limit: 100 })
      .then(({ rows }) => setFicha(f => (f ? { ...f, acts: rows || [] } : f)));
  }, [fetchActividades, operador.id]);

  const soyOwner = !!operador.en_tratativas && operador.owner_user_id === myId;
  const tomadoPorOtro = !!operador.en_tratativas && !!operador.owner_user_id && operador.owner_user_id !== myId;
  const ownerNombre = nombreUsuario(colision?.ownerId || operador.owner_user_id);
  const canalTratativas = colision?.canal || operador.canal_activo || 'otro canal';

  // Todas las mutaciones pasan por acá: si el context rebota con {error:{colision}}
  // mostramos el banner y NO aplicamos nada (regla dura del contrato).
  const manejarError = (error) => {
    if (error?.colision) { setColision(error.colision); return true; }
    if (error) { setErrorFicha(error.message || 'No se pudo completar la acción'); return true; }
    setErrorFicha(null);
    return false;
  };

  const tomar = async (force) => {
    if (force && !window.confirm(`Está en tratativas con ${ownerNombre}. ¿Forzar la toma igual?`)) return;
    const { error } = await tomarOperador(operador.id, { usuario: myId, canal: canalToma, force });
    if (manejarError(error)) return;
    setColision(null);
    onPatch(operador.id, { en_tratativas: true, owner_user_id: myId, canal_activo: canalToma });
    recargarActividades();
  };

  const liberar = async () => {
    const { error } = await liberarOperador(operador.id, { usuario: myId });
    if (manejarError(error)) return;
    setColision(null);
    onPatch(operador.id, { en_tratativas: false, owner_user_id: null, canal_activo: null });
    recargarActividades();
  };

  const moverEtapa = async (nueva) => {
    if (!nueva || nueva === operador.etapa_prospeccion) return;
    const { error } = await setEtapaProspeccion(operador.id, nueva, { usuario: myId });
    if (manejarError(error)) return;
    onPatch(operador.id, { etapa_prospeccion: nueva });
    recargarActividades();
  };

  const guardarActividad = async () => {
    const texto = nuevaAct.texto.trim();
    if (!texto || guardando) return;
    setGuardando(true);
    const canal = (nuevaAct.tipo === 'reunion' || nuevaAct.tipo === 'nota') ? 'otro' : nuevaAct.tipo;
    const { error } = await registrarActividad({
      operadorId: operador.id, tipo: nuevaAct.tipo, canal, texto, usuario: myId,
    });
    setGuardando(false);
    if (manejarError(error)) return;   // colisión → banner y NO se guarda (el texto queda)
    setNuevaAct(a => ({ ...a, texto: '' }));
    recargarActividades();
  };

  const promover = async () => {
    if (promoviendo) return;
    if (!window.confirm('Crea cliente + oportunidad en el embudo comercial. ¿Dale?')) return;
    setPromoviendo(true);
    const r = await promoverAEmbudo(operador.id, { usuario: myId, addCliente, addObra });
    setPromoviendo(false);
    if (manejarError(r.error)) return;
    onPatch(operador.id, { etapa_prospeccion: 'promovido', cliente_id: r.clienteId || null, obra_id: r.obraId || null });
    setPromovidoOk(true);
    recargarActividades();
  };

  const razones = (operador.razones_sociales || []).join(' · ');
  const emails = operador.emails || [];
  const puedePromover = operador.etapa_prospeccion !== 'promovido' && operador.etapa_prospeccion !== 'descartado';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300 }}>
      {/* overlay */}
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(20,18,15,0.45)' }} />

      {/* panel lateral (mobile: fullscreen) */}
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0,
        width: isMobile ? '100%' : 'min(520px, 92vw)',
        background: T.paper,
        borderLeft: isMobile ? 'none' : `1.5px solid ${T.ink}`,
        boxShadow: '-8px 0 24px rgba(20,18,15,0.25)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header oscuro (patrón Modal) */}
        <div style={{ padding: '13px 16px', background: T.dark, color: T.paper, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 8.5, color: T.accent, fontFamily: T.fontMono, letterSpacing: 1.5, fontWeight: 700, marginBottom: 1 }}>FICHA DEL OPERADOR</div>
            <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1.2, overflowWrap: 'anywhere' }}>{operador.nombre || 'Operador'}</div>
            {razones && <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{razones}</div>}
          </div>
          <button
            type="button" aria-label="Cerrar" onClick={onClose}
            style={{ cursor: 'pointer', fontSize: 20, opacity: 0.7, background: 'transparent', border: 'none', color: 'inherit', padding: 0, lineHeight: 1 }}
          >✕</button>
        </div>

        {/* Body scrolleable */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Chips: etapa + banderas + confianza */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <PillEtapa etapa={operador.etapa_prospeccion} />
            {(operador.banderas || []).map(b => <TagBandera key={b}>{b}</TagBandera>)}
            <PillConfianza confianza={operador.confianza} verificado={operador.verificado} />
            {operador.n_estaciones != null && (
              <span style={{ fontSize: 10.5, color: T.ink3, fontFamily: T.fontMono }}>{operador.n_estaciones} {operador.n_estaciones === 1 ? 'estación' : 'estaciones'}</span>
            )}
          </div>

          {/* Anti-colisión: banner si está tomado por otro (o rebotó una mutación) */}
          {(tomadoPorOtro || colision) && <BannerColision ownerNombre={ownerNombre} canal={canalTratativas} />}

          {/* Tratativas: tomar / liberar / forzar */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {!operador.en_tratativas && (
              <>
                <select value={canalToma} onChange={e => setCanalToma(e.target.value)} style={selSt}>
                  {CANALES.map(c => <option key={c} value={c}>{ICONO_CANAL[c] || ''} {c}</option>)}
                </select>
                <Btn sm accent onClick={() => tomar(false)}>🔒 Tomar</Btn>
              </>
            )}
            {soyOwner && (
              <>
                <span style={{ fontSize: 12, color: T.ink2 }}>Lo tenés tomado vía <b>{operador.canal_activo || '—'}</b></span>
                <Btn sm onClick={liberar}>🔓 Liberar</Btn>
              </>
            )}
            {tomadoPorOtro && esAdmin && (
              <>
                <select value={canalToma} onChange={e => setCanalToma(e.target.value)} style={selSt}>
                  {CANALES.map(c => <option key={c} value={c}>{ICONO_CANAL[c] || ''} {c}</option>)}
                </select>
                <Btn sm style={{ color: T.warn, borderColor: T.warn }} onClick={() => tomar(true)}>⚠ Forzar toma</Btn>
              </>
            )}
          </div>

          {errorFicha && <div style={{ fontSize: 12, color: '#b91c1c' }}>{errorFicha}</div>}

          {/* Datos del operador */}
          <div style={{ background: T.faint, borderRadius: 7, padding: '9px 12px', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {operador.web && (
              <div>
                <span style={{ color: T.ink3 }}>Web: </span>
                <a href={urlAbs(operador.web)} target="_blank" rel="noreferrer" style={{ color: T.accent, fontWeight: 600 }}>{operador.web} ↗</a>
              </div>
            )}
            {emails.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <span style={{ color: T.ink3 }}>Emails:</span>
                {emails.map(e => (
                  <a key={e} href={`mailto:${e}`} style={{ color: T.accent, fontFamily: T.fontMono, fontSize: 11.5 }}>{e}</a>
                ))}
              </div>
            )}
            {operador.notas && <div style={{ color: T.ink2, fontStyle: 'italic' }}>“{operador.notas}”</div>}
            {!operador.web && emails.length === 0 && !operador.notas && <div style={vacioSt}>Sin datos de contacto cargados.</div>}
          </div>

          {/* Mover de etapa + promover al embudo */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: T.ink3, textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.5 }}>Etapa</span>
            <select
              value={operador.etapa_prospeccion || 'sin_contactar'}
              onChange={e => moverEtapa(e.target.value)}
              style={selSt}
            >
              {ETAPAS_PROSPECCION.map(et => <option key={et} value={et}>{ETAPA_PROSPECCION_META[et].label}</option>)}
            </select>
            {puedePromover && (
              <Btn sm fill onClick={promover} disabled={promoviendo} style={{ opacity: promoviendo ? 0.5 : 1 }}>
                ▶ Promover al embudo
              </Btn>
            )}
            {/* El embudo es solo-Admin: el link solo se le muestra a Admin */}
            {!puedePromover && operador.etapa_prospeccion === 'promovido' && esAdmin && !promovidoOk && (
              <span onClick={() => navigate('/comercial')} style={{ fontSize: 12, color: T.accent, fontWeight: 700, cursor: 'pointer' }}>
                Ver en el embudo →
              </span>
            )}
          </div>

          {promovidoOk && (
            <div style={{
              background: '#e8f2ea', border: `1.5px solid ${T.ok}`, borderRadius: 7,
              padding: '8px 12px', fontSize: 12.5, color: T.ok, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            }}>
              ✓ Cliente y oportunidad creados en el embudo comercial.
              {esAdmin && (
                <span onClick={() => navigate('/comercial')} style={{ color: T.accent, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>
                  Ver en el embudo →
                </span>
              )}
            </div>
          )}

          {cargando && <div style={{ ...vacioSt, padding: '10px 0' }}>Cargando ficha…</div>}

          {/* Estaciones del operador */}
          {!cargando && (
            <div>
              <div style={tituloSeccionSt}>Estaciones ({estaciones.length})</div>
              {estaciones.length === 0 && <div style={vacioSt}>Sin estaciones cargadas.</div>}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                {estaciones.map(est => (
                  <div key={est.id} style={{ background: '#fff', border: `1px solid ${T.faint2}`, borderRadius: 7, padding: '9px 11px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: T.ink, minWidth: 0 }}>{est.nombre || 'Estación'}</div>
                      {est.bandera && <TagBandera>{est.bandera}</TagBandera>}
                    </div>
                    <div style={{ fontSize: 11, color: T.ink2, marginTop: 1 }}>
                      {[est.localidad, est.provincia].filter(Boolean).join(', ') || '—'}
                    </div>
                    {est.telefono && (
                      <div style={{ fontFamily: T.fontMono, fontSize: 11.5, color: T.ink, marginTop: 3 }}>📞 {est.telefono}</div>
                    )}
                    <div style={{ marginTop: 6 }}><PillEstado estado={est.estado_llamada} /></div>
                    {est.estado_original && (
                      <div style={{ fontSize: 10.5, color: T.ink3, fontStyle: 'italic', marginTop: 4 }}>
                        Caro anotó: “{est.estado_original}”
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Decisores */}
          {!cargando && (
            <div>
              <div style={tituloSeccionSt}>Decisores ({decisores.length})</div>
              {decisores.length === 0 && <div style={vacioSt}>Sin decisores identificados.</div>}
              {decisores.map(d => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 4px', borderBottom: `1px solid ${T.faint2}`, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{d.nombre || '—'}</span>
                    {d.cargo && <span style={{ fontSize: 11, color: T.ink2 }}> · {d.cargo}</span>}
                    <div style={{ fontSize: 11, display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
                      {d.linkedin_url && (
                        <a href={urlAbs(d.linkedin_url)} target="_blank" rel="noreferrer" style={{ color: '#41698c', fontWeight: 700, textDecoration: 'none' }}>
                          💼 LinkedIn ↗
                        </a>
                      )}
                      {d.email && (
                        <a href={`mailto:${d.email}`} style={{ color: T.accent, fontFamily: T.fontMono, fontSize: 10.5 }}>{d.email}</a>
                      )}
                    </div>
                  </div>
                  <PillConfianza confianza={d.confianza} verificado={d.verificado} />
                </div>
              ))}
            </div>
          )}

          {/* Registrar actividad manual (patrón ClienteFicha360Modal) */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select value={nuevaAct.tipo} onChange={e => setNuevaAct(a => ({ ...a, tipo: e.target.value }))} style={selSt}>
              {TIPOS_ACTIVIDAD.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input
              value={nuevaAct.texto}
              onChange={e => setNuevaAct(a => ({ ...a, texto: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') guardarActividad(); }}
              placeholder="Registrar actividad…"
              style={{ ...inputSt, flex: 1, minWidth: 0 }}
            />
            <Btn sm accent onClick={guardarActividad} disabled={guardando} style={{ opacity: guardando ? 0.5 : 1 }}>Guardar</Btn>
          </div>

          {/* Timeline de actividades (últimas 100) */}
          {!cargando && (
            <div>
              <div style={tituloSeccionSt}>Actividad ({acts.length})</div>
              {acts.length === 0 && <div style={vacioSt}>Sin actividad registrada.</div>}
              {acts.map(a => (
                <div key={a.id} style={{ display: 'flex', gap: 10, padding: '7px 4px', borderBottom: `1px solid ${T.faint2}` }}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>{iconoActividad(a)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: T.ink, overflowWrap: 'anywhere' }}>{a.texto || a.resultado || a.tipo}</div>
                    <div style={{ fontSize: 10.5, color: T.ink3, fontFamily: T.fontMono }}>
                      {tiempoRelativo(a.fecha)} · {nombreUsuario(a.usuario)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Página principal ─────────────────────────────────────────────────────────

export default function CampContactos() {
  const { currentUser, usuarios } = useUsuarios();
  const { fetchOperadores, fetchEstaciones, contarPorEtapa } = useCampanas();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // Guard: solo Admin o usuarios con el permiso `campanas` (patrón Pipeline.jsx).
  const puede = currentUser?.rol === 'Admin' || !!currentUser?.permisos?.campanas;
  useEffect(() => { if (currentUser && !puede) navigate('/', { replace: true }); }, [currentUser, puede, navigate]);

  // page + filtros en un solo estado: cualquier cambio de filtro resetea a
  // página 1 y dispara UN solo fetch (evita el doble fetch page-vieja/page-1).
  const [query, setQuery] = useState({ page: 1, filtros: FILTROS_VACIOS });
  const [busquedaInput, setBusquedaInput] = useState('');
  // resultado guarda la query que lo produjo: "cargando" se DERIVA del
  // mismatch resultado.query !== query (sin setState síncrono en el effect).
  const [resultado, setResultado] = useState(null);   // { query, rows, total, error }
  const [heroKpis, setHeroKpis] = useState(null);
  const [sel, setSel] = useState(null);   // operador abierto en el drawer

  // Búsqueda con debounce 300ms → filtros.busqueda + página 1.
  useEffect(() => {
    const t = setTimeout(() => {
      const b = busquedaInput.trim();
      setQuery(q => (q.filtros.busqueda === b ? q : { page: 1, filtros: { ...q.filtros, busqueda: b } }));
    }, 300);
    return () => clearTimeout(t);
  }, [busquedaInput]);

  // Fetch paginado server-side (50/página), ordenado por último cambio.
  useEffect(() => {
    if (!puede) return;
    let vivo = true;
    fetchOperadores({ page: query.page, pageSize: PAGE_SIZE, filtros: query.filtros, orden: '-updated_at' })
      .then(({ rows, total, error }) => {
        if (!vivo) return;
        setResultado({ query, rows: rows || [], total: total || 0, error: error || null });
      });
    return () => { vivo = false; };
  }, [puede, query, fetchOperadores]);

  // KPIs del hero: counts baratos (contarPorEtapa = head:true por etapa; leads
  // calientes = count de estaciones con ese estado). Nada de tablas enteras.
  useEffect(() => {
    if (!puede) return;
    let vivo = true;
    Promise.all([
      contarPorEtapa({}),
      fetchEstaciones({ filtros: { estadoLlamada: 'LEAD CALIENTE' }, page: 1, pageSize: 1 }),
    ]).then(([porEtapa, calientes]) => {
      if (!vivo) return;
      setHeroKpis({ porEtapa, leads: calientes.total || 0 });
    });
    return () => { vivo = false; };
  }, [puede, contarPorEtapa, fetchEstaciones]);

  const nombreUsuario = useCallback((id) => {
    if (!id) return '—';
    return (usuarios || []).find(u => u.id === id)?.nombre
      || (id === 'bot' ? 'Bot' : id === 'sistema' ? 'Sistema' : id);
  }, [usuarios]);

  // Sincroniza una mutación del drawer con la fila de la tabla (sin refetch).
  const patchOperador = useCallback((id, cambios) => {
    setSel(s => (s && s.id === id ? { ...s, ...cambios } : s));
    setResultado(r => (r ? { ...r, rows: r.rows.map(x => (x.id === id ? { ...x, ...cambios } : x)) } : r));
  }, []);

  const cambiarFiltro = (key, value) => {
    setQuery(q => ({ page: 1, filtros: { ...q.filtros, [key]: value } }));
  };

  const limpiarFiltros = () => {
    setBusquedaInput('');
    setQuery({ page: 1, filtros: FILTROS_VACIOS });
  };

  const cargando = !resultado || resultado.query !== query;
  const rows = (!cargando && resultado?.rows) || [];
  const total = (!cargando && resultado?.total) || 0;
  const errorLista = (!cargando && resultado?.error) || null;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const f = query.filtros;
  const hayFiltros = !!(f.busqueda || f.bandera || f.etapa || f.estadoLlamada || f.confianza);

  const totalOperadores = heroKpis
    ? Object.values(heroKpis.porEtapa).reduce((s, n) => s + n, 0)
    : null;

  const kpisHero = [
    { label: 'Operadores', value: totalOperadores == null ? '…' : fmtN(totalOperadores) },
    { label: 'Sin contactar', value: heroKpis ? fmtN(heroKpis.porEtapa.sin_contactar || 0) : '…', color: ETAPA_PROSPECCION_META.sin_contactar.color },
    { label: 'En conversación', value: heroKpis ? fmtN(heroKpis.porEtapa.en_conversacion || 0) : '…', color: ETAPA_PROSPECCION_META.en_conversacion.color },
    { label: 'Reuniones', value: heroKpis ? fmtN(heroKpis.porEtapa.reunion || 0) : '…', color: ETAPA_PROSPECCION_META.reunion.color },
    { label: 'Promovidos', value: heroKpis ? fmtN(heroKpis.porEtapa.promovido || 0) : '…', color: ETAPA_PROSPECCION_META.promovido.color },
    { label: 'Leads calientes', value: heroKpis ? fmtN(heroKpis.leads) : '…', color: ESTADO_LLAMADA_META['LEAD CALIENTE'].color },
  ];

  // Celda de operador (nombre + razones sociales) compartida por fila y card.
  const renderNombre = (op) => (
    <>
      <div style={{ fontWeight: 700, fontSize: 13, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {op.nombre || '—'}
      </div>
      {(op.razones_sociales || []).length > 0 && (
        <div style={{ fontSize: 10.5, color: T.ink3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {op.razones_sociales.join(' · ')}
        </div>
      )}
    </>
  );

  const renderBanderas = (op) => {
    const bs = op.banderas || [];
    return (
      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {bs.slice(0, 3).map(b => <TagBandera key={b}>{b}</TagBandera>)}
        {bs.length > 3 && <span style={{ fontSize: 9.5, color: T.ink3, fontWeight: 700 }}>+{bs.length - 3}</span>}
        {bs.length === 0 && <span style={{ fontSize: 11, color: T.ink3 }}>—</span>}
      </span>
    );
  };

  const confianzaTxt = (op) => {
    const m = CONFIANZA_META[String(op.confianza || '').toLowerCase()];
    return m
      ? <span style={{ fontSize: 11, fontWeight: 700, color: m.color }}>{m.label}{op.verificado ? ' ✓' : ''}</span>
      : <span style={{ fontSize: 11, color: T.ink3 }}>{op.verificado ? '✓' : '—'}</span>;
  };

  return (
    <PageLayout breadcrumb={[{ label: 'Inicio', to: '/' }, { label: 'Campañas', to: '/campanas' }, 'Contactos']} active="Campañas">
      <PageHero
        label="CAMPAÑAS"
        title="Contactos"
        subtitle="Operadores, estaciones y decisores de la campaña"
        kpis={kpisHero}
      />

      {/* Filtros (server-side: cada cambio resetea a página 1 y refetchea) */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input
          value={busquedaInput}
          onChange={e => setBusquedaInput(e.target.value)}
          placeholder="⌕ Buscar operador…"
          style={{ ...inputSt, flex: isMobile ? '1 1 100%' : '0 1 220px', minWidth: 150 }}
        />
        <select value={f.bandera} onChange={e => cambiarFiltro('bandera', e.target.value)} style={selSt}>
          <option value="">Bandera: todas</option>
          {BANDERAS.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={f.etapa} onChange={e => cambiarFiltro('etapa', e.target.value)} style={selSt}>
          <option value="">Etapa: todas</option>
          {ETAPAS_PROSPECCION.map(et => <option key={et} value={et}>{ETAPA_PROSPECCION_META[et].label}</option>)}
        </select>
        <select value={f.estadoLlamada} onChange={e => cambiarFiltro('estadoLlamada', e.target.value)} style={selSt}>
          <option value="">Llamada: todas</option>
          {ESTADOS_LLAMADA.map(es => <option key={es} value={es}>{ESTADO_LLAMADA_META[es].label}</option>)}
        </select>
        <select value={f.confianza} onChange={e => cambiarFiltro('confianza', e.target.value)} style={selSt}>
          <option value="">Confianza: todas</option>
          <option value="alta">Alta</option>
          <option value="media">Media</option>
          <option value="baja">Baja</option>
        </select>
        {hayFiltros && (
          <span onClick={limpiarFiltros} style={{ fontSize: 11.5, color: T.accent, fontWeight: 700, cursor: 'pointer' }}>
            ✕ Limpiar
          </span>
        )}
      </div>

      {errorLista && (
        <div style={{ background: '#fdecec', border: '1.5px solid #b91c1c', borderRadius: 7, padding: '9px 12px', fontSize: 12.5, color: '#b91c1c', marginBottom: 12 }}>
          No se pudo cargar la base de contactos{errorLista.message ? ` (${errorLista.message})` : ''}. ¿Está aplicada la migración de campañas?
        </div>
      )}

      {/* Tabla (desktop) / cards apiladas (mobile) */}
      {isMobile ? (
        <div>
          {cargando && <Box style={{ padding: 0, overflow: 'hidden' }}><Esqueleto filas={5} /></Box>}
          {!cargando && rows.map(op => (
            <div
              key={op.id}
              onClick={() => setSel(op)}
              style={{ background: '#fff', border: `1px solid ${T.faint2}`, borderRadius: 8, padding: '11px 12px', marginBottom: 8, cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>{renderNombre(op)}</div>
                {op.en_tratativas && (
                  <Candado ownerNombre={nombreUsuario(op.owner_user_id)} canal={op.canal_activo || 'otro canal'} />
                )}
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginTop: 7 }}>
                <PillEtapa etapa={op.etapa_prospeccion} />
                {renderBanderas(op)}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 7, fontSize: 10.5, color: T.ink3, fontFamily: T.fontMono }}>
                <span>{op.n_estaciones ?? '—'} estac. · {confianzaTxt(op)}</span>
                <span>{tiempoRelativo(op.updated_at)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Box style={{ padding: 0, overflow: 'hidden' }}>
          {/* header de tabla */}
          <div style={{ display: 'flex', gap: 10, padding: '7px 14px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}`, fontSize: 11, fontWeight: 700, color: T.ink2 }}>
            <span style={{ flex: 2.2 }}>Operador</span>
            <span style={{ flex: 1.4 }}>Banderas</span>
            <span style={{ flex: 0.5, textAlign: 'center' }}>Estac.</span>
            <span style={{ flex: 1.1 }}>Etapa</span>
            <span style={{ flex: 0.8 }}>Confianza</span>
            <span style={{ flex: 0.9 }}>Últ. cambio</span>
            <span style={{ width: 22 }} />
          </div>
          {cargando && <Esqueleto />}
          {!cargando && rows.map(op => (
            <div
              key={op.id}
              onClick={() => setSel(op)}
              style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 14px', borderBottom: `1px solid ${T.faint2}`, cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.background = T.faint; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ flex: 2.2, minWidth: 0 }}>{renderNombre(op)}</div>
              <div style={{ flex: 1.4, minWidth: 0 }}>{renderBanderas(op)}</div>
              <div style={{ flex: 0.5, textAlign: 'center', fontFamily: T.fontMono, fontSize: 12, color: T.ink }}>{op.n_estaciones ?? '—'}</div>
              <div style={{ flex: 1.1, minWidth: 0 }}><PillEtapa etapa={op.etapa_prospeccion} /></div>
              <div style={{ flex: 0.8, minWidth: 0 }}>{confianzaTxt(op)}</div>
              <div style={{ flex: 0.9, minWidth: 0, fontSize: 11, color: T.ink2, fontFamily: T.fontMono }}>{tiempoRelativo(op.updated_at)}</div>
              <div style={{ width: 22, textAlign: 'center' }}>
                {op.en_tratativas && (
                  <Candado ownerNombre={nombreUsuario(op.owner_user_id)} canal={op.canal_activo || 'otro canal'} />
                )}
              </div>
            </div>
          ))}
        </Box>
      )}

      {/* Vacío */}
      {!cargando && !errorLista && rows.length === 0 && (
        <div style={{ textAlign: 'center', color: T.ink3, padding: '44px 20px' }}>
          {hayFiltros ? (
            <>
              <div style={{ fontSize: 30, marginBottom: 6 }}>🔍</div>
              <div style={{ fontSize: 14, color: T.ink2 }}>Sin resultados con estos filtros.</div>
              <div onClick={limpiarFiltros} style={{ fontSize: 12.5, color: T.accent, fontWeight: 700, cursor: 'pointer', marginTop: 6 }}>✕ Limpiar filtros</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 30, marginBottom: 6 }}>📇</div>
              <div style={{ fontSize: 14, color: T.ink2 }}>
                Sin contactos todavía — importá la planilla desde{' '}
                <Link to="/campanas/importar" style={{ color: T.accent, fontWeight: 700 }}>Campañas → Importar</Link>.
              </div>
            </>
          )}
        </div>
      )}

      {/* Paginador */}
      {!cargando && total > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '12px 2px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: T.ink3, fontFamily: T.fontMono }}>
            {fmtN(total)} operador{total === 1 ? '' : 'es'} · página {query.page} de {totalPages}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn
              sm
              disabled={query.page <= 1}
              style={{ opacity: query.page <= 1 ? 0.4 : 1 }}
              onClick={() => setQuery(q => ({ ...q, page: Math.max(1, q.page - 1) }))}
            >‹ Anterior</Btn>
            <Btn
              sm
              disabled={query.page >= totalPages}
              style={{ opacity: query.page >= totalPages ? 0.4 : 1 }}
              onClick={() => setQuery(q => ({ ...q, page: Math.min(totalPages, q.page + 1) }))}
            >Siguiente ›</Btn>
          </div>
        </div>
      )}

      {/* Drawer ficha del operador */}
      {sel && (
        <FichaOperador
          key={sel.id}
          operador={sel}
          onClose={() => setSel(null)}
          onPatch={patchOperador}
          nombreUsuario={nombreUsuario}
        />
      )}
    </PageLayout>
  );
}
