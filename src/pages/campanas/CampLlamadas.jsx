import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../../components/layout/PageLayout';
import PageHero from '../../components/ui/PageHero';
import { Btn, Label } from '../../components/ui';
import { T } from '../../theme';
import { useUsuarios } from '../../store/UsuariosContext';
import { useCampanas } from '../../store/CampanasContext';
import { useNotificaciones } from '../../store/NotificacionesContext';
import { supabase } from '../../lib/supabase';
import { ESTADOS_LLAMADA, ESTADO_LLAMADA_META } from '../../lib/campanas/constants.js';
import { statsLlamadasCaro } from '../../lib/campanas/kpis.js';

// Modo llamadas (mobile-first): la herramienta diaria de Carolina. Cola del día
// de estaciones pendientes → tarjeta grande con tel: → resultado en 2 taps →
// siguiente. P11: acá NO se muestra nada de obras ni montos.

// Orden de la cola: primero las que pidieron que las vuelvan a llamar, después
// las que no atendieron, al final las vírgenes.
const ESTADOS_COLA = ['VOLVER A LLAMAR', 'NO ATIENDE', 'SIN LLAMAR'];
// Estados que abren mini-form opcional (decisor nombre/mail + próximo paso).
const ESTADOS_CON_FORM = ['DECISOR IDENTIFICADO', 'LEAD CALIENTE', 'PASÓ MAIL'];
const PAGE_COLA = 50;
const FORM_VACIO = { decisorNombre: '', decisorEmail: '', proximoPaso: '' };

// camp_operadores.prioridad es text libre → ranking tolerante para ordenar
// dentro de cada grupo (sin prioridad va al final, desempata updated_at asc).
const RANK_PRIORIDAD = { alta: 0, alto: 0, 1: 0, media: 1, medio: 1, 2: 1, baja: 2, bajo: 2, 3: 2 };
const rankPrioridad = (p) => {
  const k = String(p ?? '').trim().toLowerCase();
  return k in RANK_PRIORIDAD ? RANK_PRIORIDAD[k] : 3;
};

// Fondo suave a partir del color del META (hex de 6 dígitos + canal alpha).
const suave = (hex) => `${hex}1f`;

const INPUT = {
  width: '100%', boxSizing: 'border-box', padding: '12px', fontSize: 15,
  border: `1.5px solid ${T.faint2}`, borderRadius: 8, background: 'white',
  fontFamily: T.font, color: T.ink, outline: 'none',
};

const BTN_BASE = {
  minHeight: 48, borderRadius: 10, fontSize: 15, fontWeight: 800,
  fontFamily: T.font, cursor: 'pointer', padding: '10px 12px', border: 'none',
};

const chipEstilo = (color) => ({
  display: 'inline-block', padding: '3px 10px', borderRadius: 999,
  fontSize: 11.5, fontWeight: 700, background: suave(color),
  border: `1.5px solid ${color}`, color: T.ink, whiteSpace: 'nowrap',
});

// ── Sub-componentes ──────────────────────────────────────────────────────────

function BarraProgreso({ hechasHoy, quedan }) {
  const total = hechasHoy + quedan;
  const pct = total > 0 ? Math.round((hechasHoy / total) * 100) : 100;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>
          Llamada {hechasHoy + 1} <span style={{ color: T.ink3, fontWeight: 600 }}>· quedan {quedan}</span>
        </div>
        <div style={{ fontSize: 11, color: T.ink3, fontFamily: T.fontMono, flexShrink: 0 }}>{hechasHoy} hoy</div>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: T.faint2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: T.accent, borderRadius: 3, transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
}

function TarjetaEstacion({ est, op, opAjeno }) {
  const meta = ESTADO_LLAMADA_META[est.estado_llamada];
  // telefono_norm es E.164 SIN el "+" (ver normalizar.js) → se lo agregamos
  // para que el discado internacional funcione; sin norm, discamos el crudo.
  const telHref = est.telefono_norm ? `tel:+${est.telefono_norm}` : (est.telefono ? `tel:${est.telefono}` : '');
  const telVisible = est.telefono || (est.telefono_norm ? `+${est.telefono_norm}` : '');
  return (
    <div style={{
      background: 'white', border: `1.5px solid ${T.rule}`, borderRadius: 12, padding: 16,
      display: 'flex', flexDirection: 'column', gap: 10,
      boxShadow: '0 1px 0 rgba(0,0,0,0.04), 0 8px 18px -10px rgba(20,18,15,0.25)',
    }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {est.bandera && (
          <span style={{ ...chipEstilo(T.rule), background: T.faint }}>{est.bandera}</span>
        )}
        {meta && <span style={chipEstilo(meta.color)}>{meta.label}</span>}
        {opAjeno && <span style={chipEstilo(T.warn)}>🔒 en tratativas</span>}
      </div>

      <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.15, color: T.ink, overflowWrap: 'anywhere' }}>
        {est.nombre || 'Estación sin nombre'}
      </div>

      {op?.nombre && (
        <div style={{ fontSize: 13, color: T.ink2 }}>Operador: <b style={{ color: T.ink }}>{op.nombre}</b></div>
      )}
      {(est.localidad || est.provincia) && (
        <div style={{ fontSize: 12.5, color: T.ink2 }}>📍 {[est.localidad, est.provincia].filter(Boolean).join(', ')}</div>
      )}
      {est.estado_original && (
        <div style={{ fontFamily: T.fontNote, fontStyle: 'italic', fontSize: 17, color: T.ink2, lineHeight: 1.2 }}>
          Caro anotó: “{est.estado_original}”
        </div>
      )}
      {(est.decisor_nombre || est.decisor_email) && (
        <div style={{ fontSize: 12.5, color: T.ink2, overflowWrap: 'anywhere' }}>
          👤 Decisor: <b style={{ color: T.ink }}>{est.decisor_nombre || '—'}</b>
          {est.decisor_email ? ` · ${est.decisor_email}` : ''}
        </div>
      )}
      {est.proximo_paso && (
        <div style={{ fontSize: 12.5, color: T.accent2, fontWeight: 600 }}>Próximo paso: {est.proximo_paso}</div>
      )}

      {telVisible ? (
        <>
          <div style={{
            fontFamily: T.fontMono, fontSize: 'clamp(20px, 7vw, 26px)', fontWeight: 700,
            letterSpacing: 0.5, color: T.ink, textAlign: 'center', marginTop: 4, overflowWrap: 'anywhere',
          }}>
            {telVisible}
          </div>
          <a href={telHref} style={{
            display: 'block', width: '100%', boxSizing: 'border-box', background: T.ok, color: 'white',
            textAlign: 'center', padding: '16px 12px', borderRadius: 10, fontSize: 19, fontWeight: 800,
            textDecoration: 'none', letterSpacing: 0.5,
          }}>
            📞 LLAMAR
          </a>
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: '14px 12px', background: T.faint, borderRadius: 10, color: T.ink3, fontSize: 13, fontWeight: 600 }}>
          Sin teléfono cargado
        </div>
      )}
    </div>
  );
}

function GridEstados({ deshabilitado, onElegir }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Label>Resultado de la llamada</Label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {ESTADOS_LLAMADA.map((e) => {
          const meta = ESTADO_LLAMADA_META[e] || {};
          const color = meta.color || T.ink3;
          return (
            <button
              key={e}
              onClick={() => onElegir(e)}
              disabled={deshabilitado}
              style={{
                minHeight: 56, borderRadius: 10, border: `1.5px solid ${color}`,
                background: suave(color), color: T.ink, fontSize: 13.5, fontWeight: 700,
                fontFamily: T.font, cursor: deshabilitado ? 'default' : 'pointer',
                padding: '8px 10px', opacity: deshabilitado ? 0.5 : 1, lineHeight: 1.2,
              }}
            >
              {meta.label || e}
            </button>
          );
        })}
      </div>
      {deshabilitado && <div style={{ fontSize: 12, color: T.ink3, textAlign: 'center' }}>Guardando…</div>}
    </div>
  );
}

function PanelDetalle({ estado, form, setForm, guardando, onGuardar, onVolver }) {
  const meta = ESTADO_LLAMADA_META[estado] || {};
  const esVolver = estado === 'VOLVER A LLAMAR';
  const set = (campo) => (ev) => setForm((f) => ({ ...f, [campo]: ev.target.value }));
  return (
    <div style={{
      background: 'white', border: `1.5px solid ${meta.color || T.faint2}`, borderRadius: 12,
      padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={chipEstilo(meta.color || T.ink3)}>{meta.label || estado}</span>
        <span style={{ fontSize: 11.5, color: T.ink3 }}>todos los campos son opcionales</span>
      </div>
      {esVolver ? (
        <input
          style={INPUT}
          placeholder="¿Cuándo / nota? (ej: mañana 10hs, pedir por Juan)"
          value={form.proximoPaso}
          onChange={set('proximoPaso')}
        />
      ) : (
        <>
          <input style={INPUT} placeholder="Nombre del decisor" value={form.decisorNombre} onChange={set('decisorNombre')} />
          <input style={INPUT} type="email" placeholder="Email del decisor" value={form.decisorEmail} onChange={set('decisorEmail')} />
          <input style={INPUT} placeholder="Próximo paso (ej: mandar carpeta)" value={form.proximoPaso} onChange={set('proximoPaso')} />
        </>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onVolver} disabled={guardando} style={{ ...BTN_BASE, flex: 1, background: T.faint, color: T.ink2 }}>
          ← Volver
        </button>
        <button onClick={onGuardar} disabled={guardando} style={{ ...BTN_BASE, flex: 2, background: T.accent, color: 'white', opacity: guardando ? 0.6 : 1 }}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}

function AvisoColision({ nombre, canal, onSaltear }) {
  return (
    <div style={{ background: '#fdf3e3', border: `1.5px solid ${T.warn}`, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, lineHeight: 1.35 }}>
        ⚠️ Este operador está en tratativas con {nombre} — no lo llames.
      </div>
      {canal && <div style={{ fontSize: 12, color: T.ink2 }}>Canal activo: {canal}</div>}
      <button onClick={onSaltear} style={{ ...BTN_BASE, background: T.warn, color: 'white' }}>Saltear →</button>
    </div>
  );
}

function PantallaCentrada({ icono, titulo, sub, children }) {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '48px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
      <div style={{ fontSize: 52 }}>{icono}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: T.ink }}>{titulo}</div>
      {sub && <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.4 }}>{sub}</div>}
      {children}
    </div>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────

export default function CampLlamadas() {
  const { currentUser, usuarios } = useUsuarios();
  const navigate = useNavigate();
  const { fetchEstaciones, fetchActividades, registrarLlamada } = useCampanas();
  const { crearNotificacion } = useNotificaciones() || {};

  // Guard: solo Admin o usuarios con el permiso `campanas` (patrón Pipeline.jsx).
  const puede = currentUser?.rol === 'Admin' || !!currentUser?.permisos?.campanas;
  useEffect(() => { if (currentUser && !puede) navigate('/', { replace: true }); }, [currentUser, puede, navigate]);

  const usuarioId = currentUser?.id;
  const listo = !!currentUser && puede;

  // ── Estado de la cola ──────────────────────────────────────────────────────
  const [faseCola, setFaseCola] = useState('cargando'); // cargando | lista | fin | error
  const [errorCola, setErrorCola] = useState('');
  const [cola, setCola] = useState([]);           // estaciones ordenadas
  const [operadores, setOperadores] = useState({}); // operador_id → {nombre, prioridad, ...}
  const [idx, setIdx] = useState(0);
  const [quedan, setQuedan] = useState(0);
  const [hechasHoy, setHechasHoy] = useState(0);
  const [salteadasN, setSalteadasN] = useState(0);

  // ── Estado de la tarjeta actual ────────────────────────────────────────────
  const [estadoSel, setEstadoSel] = useState(null); // estado elegido que espera mini-form
  const [form, setForm] = useState(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [colision, setColision] = useState(null);   // { nombre, canal }
  const [errGuardar, setErrGuardar] = useState('');
  const [exito, setExito] = useState(false);

  // Estaciones ya vistas en esta sesión (registradas o salteadas): las
  // filtramos de las recargas para no ciclar sobre lo mismo (ej: una que quedó
  // en VOLVER A LLAMAR sigue matcheando el filtro del día).
  const vistasRef = useRef(new Set());
  const timerRef = useRef(null);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  // ── Carga de la cola: fetchEstaciones filtra de a UN estado_llamada →
  //    3 fetch en paralelo y unimos en el orden de prioridad de ESTADOS_COLA.
  //    Traemos de a 50 por estado ORDENADOS por updated_at asc: registrarLlamada
  //    setea updated_at=now, así las recién tocadas van al final y la página 1
  //    trae naturalmente lo no trabajado (la cola no se agota en falso a escala).
  //    Al agotar el lote local se recarga y, como las procesadas quedan al
  //    fondo del orden (o ya no matchean el filtro), entra el lote siguiente solo.
  //    OJO: los setState van SOLO dentro de .then/.catch (regla react-hooks/
  //    set-state-in-effect — patrón CampKanban); el "cargando" visual sale del
  //    estado inicial, de los handlers o de `agotada`.
  const cargandoRef = useRef(false);
  const cargarCola = useCallback(() => {
    if (cargandoRef.current) return;
    cargandoRef.current = true;

    const trabajo = async () => {
      const res = await Promise.all(ESTADOS_COLA.map((estadoLlamada) =>
        fetchEstaciones({ filtros: { estadoLlamada }, page: 1, pageSize: PAGE_COLA, orden: 'updated_at' })));
      const conError = res.find((r) => r.error);
      if (conError) throw new Error(conError.error.message || 'No se pudo traer la cola.');

      const vistas = vistasRef.current;
      const grupos = res.map((r) => r.rows.filter((e) => !vistas.has(e.id)));

      // Nombre + prioridad del operador de cada estación (el contrato de
      // CampanasContext no tiene fetch de operadores por ids → lectura directa
      // mínima de solo las columnas que necesita la tarjeta y el orden).
      const ids = [...new Set(grupos.flat().map((e) => e.operador_id).filter(Boolean))];
      let ops = {};
      if (ids.length) {
        const { data } = await supabase
          .from('camp_operadores')
          .select('id, nombre, prioridad, en_tratativas, owner_user_id')
          .in('id', ids);
        ops = Object.fromEntries((data || []).map((o) => [o.id, o]));
      }

      const ordenar = (arr) => [...arr].sort((a, b) => {
        const ra = rankPrioridad(ops[a.operador_id]?.prioridad);
        const rb = rankPrioridad(ops[b.operador_id]?.prioridad);
        if (ra !== rb) return ra - rb;
        return String(a.updated_at || '').localeCompare(String(b.updated_at || ''));
      });
      const lista = grupos.map(ordenar).flat();

      // "quedan": total real en DB menos las vistas de esta sesión que siguen
      // matcheando el filtro (aproximación honesta: solo vemos la 1ª página).
      const traidas = res.reduce((s, r) => s + r.rows.length, 0);
      const filtradas = traidas - grupos.reduce((s, g) => s + g.length, 0);
      const total = res.reduce((s, r) => s + (r.total || 0), 0);

      return { ops, lista, quedan: Math.max(0, total - filtradas) };
    };

    trabajo()
      .then(({ ops, lista, quedan: q }) => {
        setOperadores(ops);
        setCola(lista);
        setIdx(0);
        setQuedan(q);
        setFaseCola(lista.length ? 'lista' : 'fin');
        setErrorCola('');
      })
      .catch((e) => {
        setFaseCola('error');
        setErrorCola(e?.message || 'Error inesperado.');
      })
      .finally(() => { cargandoRef.current = false; });
  }, [fetchEstaciones]);

  useEffect(() => { if (listo) cargarCola(); }, [listo, cargarCola]);

  // Llamadas registradas HOY por este usuario (statsLlamadasCaro sobre las
  // últimas actividades — suficiente para el arranque; después suma en local).
  useEffect(() => {
    if (!listo || !usuarioId) return;
    let off = false;
    fetchActividades({ limit: 200 }).then(({ rows }) => {
      if (!off) setHechasHoy(statsLlamadasCaro({ actividades: rows, usuarioId }).hoy);
    });
    return () => { off = true; };
  }, [listo, usuarioId, fetchActividades]);

  // Al agotar el lote local, recargar (si no queda nada nuevo → pantalla fin).
  useEffect(() => {
    if (faseCola === 'lista' && cola.length > 0 && idx >= cola.length) cargarCola();
  }, [faseCola, idx, cola.length, cargarCola]);

  // ── Acciones ───────────────────────────────────────────────────────────────
  const resetTarjeta = useCallback(() => {
    setEstadoSel(null);
    setForm(FORM_VACIO);
    setColision(null);
    setErrGuardar('');
  }, []);

  const avanzar = useCallback(() => {
    resetTarjeta();
    setQuedan((q) => Math.max(0, q - 1));
    setIdx((i) => i + 1);
  }, [resetTarjeta]);

  const saltear = useCallback(() => {
    const est = cola[idx];
    if (est) vistasRef.current.add(est.id);
    setSalteadasN((n) => n + 1);
    avanzar();
  }, [cola, idx, avanzar]);

  const guardar = useCallback(async (estadoLlamada, extra = {}) => {
    const est = cola[idx];
    if (!est || guardando) return;
    setGuardando(true);
    setColision(null);
    setErrGuardar('');

    // Solo mandamos los campos con contenido: registrarLlamada pisa la columna
    // solo cuando el campo viene definido (no borra lo que ya había).
    const payload = { estadoLlamada, usuario: usuarioId };
    const nom = (extra.decisorNombre || '').trim();
    const mail = (extra.decisorEmail || '').trim();
    const paso = (extra.proximoPaso || '').trim();
    if (nom) payload.decisorNombre = nom;
    if (mail) payload.decisorEmail = mail;
    if (paso) payload.proximoPaso = paso;

    let resp;
    try {
      resp = await registrarLlamada(est.id, payload);
    } catch (e) {
      resp = { error: { message: e?.message || 'Error de red.' } };
    }
    setGuardando(false);

    const error = resp?.error;
    if (error?.colision) {
      const owner = (usuarios || []).find((u) => u.id === error.colision.ownerId);
      setColision({ nombre: owner?.nombre || 'otro usuario', canal: error.colision.canal });
      return;
    }
    if (error) {
      setErrGuardar(error.message || 'No se pudo guardar. Revisá la conexión y probá de nuevo.');
      return;
    }

    // LEAD CALIENTE = el único evento que amerita aviso inmediato → campanita +
    // push a los Admin (excluye al actor). Best-effort: un fallo de la notif
    // JAMÁS rompe el guardado ya hecho.
    if (estadoLlamada === 'LEAD CALIENTE' && crearNotificacion) {
      try {
        crearNotificacion('camp_lead_caliente', {
          estacion: est.nombre || 'Estación sin nombre',
          operador: operadores[est.operador_id]?.nombre || '',
        });
      } catch (e) { console.warn('[llamadas] notif lead caliente falló (no crítico)', e?.message); }
    }

    vistasRef.current.add(est.id);
    setHechasHoy((h) => h + 1);
    setExito(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setExito(false);
      avanzar();
    }, 700);
  }, [cola, idx, guardando, usuarioId, usuarios, registrarLlamada, avanzar, crearNotificacion, operadores]);

  const elegirEstado = useCallback((estado) => {
    if (guardando) return;
    if (ESTADOS_CON_FORM.includes(estado) || estado === 'VOLVER A LLAMAR') {
      setErrGuardar('');
      setEstadoSel(estado);
      return;
    }
    guardar(estado);
  }, [guardando, guardar]);

  const verFicha = useCallback(() => {
    const est = cola[idx];
    navigate(est?.operador_id ? `/campanas/contactos?op=${est.operador_id}` : '/campanas/contactos');
  }, [cola, idx, navigate]);

  // Recargas disparadas por el usuario: acá SÍ mostramos "cargando" al toque
  // (setState en handler, permitido).
  const reintentar = useCallback(() => {
    setFaseCola('cargando');
    setErrorCola('');
    cargarCola();
  }, [cargarCola]);

  const recargarTodo = useCallback(() => {
    vistasRef.current = new Set();
    setSalteadasN(0);
    setFaseCola('cargando');
    setErrorCola('');
    cargarCola();
  }, [cargarCola]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const est = faseCola === 'lista' ? cola[idx] : null;
  const op = est?.operador_id ? operadores[est.operador_id] : null;
  const opAjeno = !!(op?.en_tratativas && op?.owner_user_id && op.owner_user_id !== usuarioId);
  // Lote local agotado → el efecto de arriba está recargando: mostramos loading.
  const agotada = faseCola === 'lista' && cola.length > 0 && idx >= cola.length;

  let cuerpo;
  if (!listo || faseCola === 'cargando' || agotada) {
    cuerpo = <PantallaCentrada icono="📞" titulo="Cargando la cola del día…" />;
  } else if (faseCola === 'error') {
    cuerpo = (
      <PantallaCentrada icono="🤦" titulo="Algo salió mal cargando la cola" sub={errorCola}>
        <Btn sm accent onClick={reintentar}>Reintentar</Btn>
      </PantallaCentrada>
    );
  } else if (faseCola === 'fin' || !est) {
    cuerpo = (
      <PantallaCentrada
        icono="🎉"
        titulo={hechasHoy > 0
          ? `Cola terminada — ${hechasHoy} ${hechasHoy === 1 ? 'llamada' : 'llamadas'} hoy`
          : 'No hay estaciones pendientes de llamar'}
        sub={salteadasN > 0
          ? `Salteaste ${salteadasN} en esta sesión — al recargar vuelven a la cola.`
          : 'Cuando entren estaciones nuevas van a aparecer acá.'}
      >
        <Btn sm accent onClick={recargarTodo}>↻ Recargar cola</Btn>
      </PantallaCentrada>
    );
  } else {
    cuerpo = (
      <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 24 }}>
        <BarraProgreso hechasHoy={hechasHoy} quedan={quedan} />
        <TarjetaEstacion est={est} op={op} opAjeno={opAjeno} />
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn sm style={{ flex: 1 }} onClick={saltear}>Saltear →</Btn>
          <Btn sm style={{ flex: 1 }} onClick={verFicha}>Ver ficha</Btn>
        </div>
        {colision ? (
          <AvisoColision nombre={colision.nombre} canal={colision.canal} onSaltear={saltear} />
        ) : estadoSel ? (
          <PanelDetalle
            estado={estadoSel}
            form={form}
            setForm={setForm}
            guardando={guardando}
            onGuardar={() => guardar(estadoSel, form)}
            onVolver={() => { setEstadoSel(null); setForm(FORM_VACIO); }}
          />
        ) : (
          <GridEstados deshabilitado={guardando} onElegir={elegirEstado} />
        )}
        {errGuardar && (
          <div style={{ color: '#b91c1c', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>⚠️ {errGuardar}</div>
        )}
      </div>
    );
  }

  return (
    <PageLayout breadcrumb={[{ label: 'Inicio', to: '/' }, { label: 'Campañas', to: '/campanas' }, 'Llamadas']} active="Campañas">
      <PageHero
        label="CAMPAÑAS"
        title="Modo llamadas"
        subtitle="Cola de llamadas del día, registro de resultado en 2 taps"
      />
      {cuerpo}
      {exito && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 8, background: 'rgba(247,244,236,0.88)',
        }}>
          <div style={{ fontSize: 84, fontWeight: 900, color: T.ok, lineHeight: 1, animation: 'campLlamadaPop 0.45s cubic-bezier(0.2, 1.4, 0.4, 1)' }}>✓</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: T.ok }}>¡Guardada!</div>
        </div>
      )}
      <style>{'@keyframes campLlamadaPop { 0% { transform: scale(0.3); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }'}</style>
    </PageLayout>
  );
}
