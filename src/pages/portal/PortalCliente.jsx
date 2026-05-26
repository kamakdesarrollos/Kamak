import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useObras } from '../../store/ObrasContext';
import { useAuth } from '../../store/AuthContext';
import { useUsuarios } from '../../store/UsuariosContext';
import { useDolar } from '../../store/DolarContext';
import { useClientes } from '../../store/ClientesContext';
import { Box, Btn, Chip, Stat, Bar } from '../../components/ui';
import { T } from '../../theme';
import { fmtN, fmtFecha } from '../../lib/format';
import { cuotaEstadoCalc, calcObra } from '../obra/helpers';

const fmtD = fmtFecha;

const rubroAvance = (rubro) =>
  rubro.tareas.length > 0
    ? Math.round(rubro.tareas.reduce((s, t) => s + t.avance, 0) / rubro.tareas.length)
    : 0;

export default function PortalCliente() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { obras, getDetalle, refetch } = useObras();

  const { user } = useAuth();
  const { currentUser } = useUsuarios();
  const { dolarVenta } = useDolar();
  const { clientes } = useClientes();
  const [tab, setTab] = useState(0);

  // GATE de acceso al portal:
  // - Admin interno (logueado) -> acceso libre para preview.
  // - Cliente externo -> requiere token validado guardado en sessionStorage
  //   por PortalAcceso. Re-validamos contra el backend en cada carga por si
  //   expiro o fue revocado.
  // Estados: 'checking' | 'allowed' | 'no-token' | 'invalid' | 'expired'
  const isAdminInternal = currentUser?.rol === 'Admin';
  const [accessStatus, setAccessStatus] = useState(isAdminInternal ? 'allowed' : 'checking');

  useEffect(() => {
    if (isAdminInternal) { setAccessStatus('allowed'); return; }
    if (!id) { setAccessStatus('invalid'); return; }
    let token = null;
    try { token = sessionStorage.getItem(`kamak_portal_${id}`); } catch { /* sin sessionStorage */ }
    if (!token) { setAccessStatus('no-token'); return; }
    let cancelled = false;
    fetch(`/api/portal/validate-token?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data.error === 'expired') {
          try { sessionStorage.removeItem(`kamak_portal_${id}`); } catch {}
          setAccessStatus('expired');
          return;
        }
        if (data.error || data.obraId !== id) {
          try { sessionStorage.removeItem(`kamak_portal_${id}`); } catch {}
          setAccessStatus('invalid');
          return;
        }
        setAccessStatus('allowed');
      })
      .catch(() => { if (!cancelled) setAccessStatus('invalid'); });
    return () => { cancelled = true; };
  }, [id, isAdminInternal]);

  // ── Carga de datos ──────────────────────────────────────────────────────
  // El portal tiene dos modos:
  // - ADMIN (con sesion): lee de los contexts globales (obras, clientes,
  //   dolar, etc.) que ya tienen los datos sincronizados.
  // - CLIENTE (sin sesion): no puede leer Supabase directo por RLS, asi que
  //   llama al endpoint serverless /api/portal/data que usa service key del
  //   lado backend y devuelve solo los datos de esa obra.
  const [serverData, setServerData] = useState(null);

  useEffect(() => {
    if (isAdminInternal || accessStatus !== 'allowed' || !id) return;
    let cancelled = false;
    let interval = null;
    let token = null;
    try { token = sessionStorage.getItem(`kamak_portal_${id}`); } catch {}
    if (!token) return;

    const fetchData = () => fetch(`/api/portal/data?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(data => { if (!cancelled && data && !data.error) setServerData(data); })
      .catch(e => console.error('[portal/data] fetch error:', e));

    fetchData();
    const start = () => { if (!interval) interval = setInterval(fetchData, 30000); };
    const stop  = () => { if (interval) { clearInterval(interval); interval = null; } };
    const onVis = () => { if (document.hidden) stop(); else { fetchData(); start(); } };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', fetchData);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', fetchData);
    };
  }, [id, isAdminInternal, accessStatus]);

  // Modo admin: usar refetch del context (sincroniza con admin en tiempo real).
  useEffect(() => {
    if (!isAdminInternal || accessStatus !== 'allowed') return;
    let interval = null;
    const start = () => { if (!interval) interval = setInterval(refetch, 30000); };
    const stop  = () => { if (interval) { clearInterval(interval); interval = null; } };
    const onVis = () => { if (document.hidden) stop(); else { refetch(); start(); } };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', refetch);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', refetch);
    };
  }, [accessStatus, refetch, isAdminInternal]);

  // Resolver fuentes de datos: del context (admin) o del endpoint (cliente).
  const obra = isAdminInternal
    ? obras.find(o => o.id === id)
    : serverData?.obra;
  const detalle = isAdminInternal
    ? getDetalle(id || '')
    : (serverData?.detalle || { rubros: [], adicionales: [], cuotas: [], documentos: [], fotos: [], financiacion: {} });
  const effectiveDolarVenta = isAdminInternal
    ? dolarVenta
    : (serverData?.dolarVenta || 1070);

  // Pantalla de bloqueo: cuando el cliente no tiene acceso valido,
  // mostramos un mensaje claro sin revelar info de la obra.
  if (accessStatus !== 'allowed') {
    const msgs = {
      checking:   { icon: '⏳', title: 'Validando acceso…', sub: 'Un momento por favor.' },
      'no-token': { icon: '🔒', title: 'Acceso restringido',  sub: 'Este portal es privado. Solicitá el enlace de acceso al equipo de Kamak.' },
      invalid:    { icon: '🚫', title: 'Acceso inválido',     sub: 'El enlace que estás usando no es válido. Solicitá uno nuevo al equipo de Kamak.' },
      expired:    { icon: '⏰', title: 'Acceso expirado',     sub: 'El enlace caducó. Solicitá uno nuevo al equipo de Kamak.' },
    };
    const { icon, title, sub } = msgs[accessStatus] || msgs.invalid;
    return (
      <div style={{ fontFamily: T.font, background: T.dark, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div style={{ fontSize: 56 }}>{icon}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>{title}</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', textAlign: 'center', maxWidth: 360 }}>{sub}</div>
        <img src="/assets/kamak-logo-light.png" alt="Kamak" style={{ height: 28, opacity: 0.4, marginTop: 32 }} />
      </div>
    );
  }

  // Modo cliente: si todavia no llego la data del endpoint, mostramos loader
  // (sino se veria "Obra no encontrada" incorrectamente mientras carga).
  if (!isAdminInternal && !serverData) {
    return (
      <div style={{ fontFamily: T.font, background: T.dark, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div style={{ fontSize: 56 }}>⏳</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Cargando tu obra…</div>
      </div>
    );
  }

  if (!id || !obra) {
    return (
      <div style={{ fontFamily: T.font, background: T.paper, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div style={{ fontSize: 48 }}>🏗</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: T.ink }}>Obra no encontrada</div>
        <div style={{ fontSize: 13, color: T.ink2 }}>El enlace puede ser incorrecto o la obra fue eliminada.</div>
        <Btn onClick={() => navigate('/')}>← Volver al inicio</Btn>
      </div>
    );
  }

  // Resolver el nombre del cliente:
  // - Modo admin: matching del contexto (clienteId -> nombre actual o fallback).
  // - Modo cliente: viene resuelto del endpoint serverless.
  const clienteActual = isAdminInternal
    ? ((obra.clienteId && clientes.find(c => c.id === obra.clienteId))
       || clientes.find(c => (c.nombre || '').toLowerCase().trim() === (obra.cliente || '').toLowerCase().trim())
       || null)
    : null;
  const clienteNombre = isAdminInternal
    ? (clienteActual?.nombre || obra.cliente || '')
    : (serverData?.clienteNombre || obra.cliente || '');

  const rubros    = detalle.rubros    || [];
  const cuotas    = detalle.cuotas    || [];
  const documentos = detalle.documentos || [];
  const fotos     = detalle.fotos     || [];
  const fin       = detalle.financiacion || {};

  const tc = effectiveDolarVenta || 1070;
  const obraM = obra.moneda || 'ARS';
  const obraEsUSD = obraM === 'USD';

  // ── Modelo de moneda del portal ─────────────────────────────────────────
  // - Costos del presupuesto (tareas): SIEMPRE en pesos (ARS), sin importar
  //   la moneda de la obra. La obra USD es solo para mostrar el total
  //   convertido.
  // - Cuotas: en la moneda de la obra (USD si obra es USD, ARS si ARS) o
  //   con flag c._usd si fueron cargadas explicitamente en USD.
  // - Portal: muestra TODO en USD para el cliente. Cualquier valor ARS se
  //   convierte usando la cotizacion actual del dolar.

  // Convierte un monto a USD para display. yaUSD = true si el monto ya
  // esta en USD (no hace falta convertir).
  const toUSD = (n, yaUSD) => Math.round(yaUSD ? n : n / tc);
  const fmt = (n) => `U$S ${fmtN(n)}`;

  // Cuotas en USD (cada una segun su moneda real).
  const cuotaEnUSD = c => toUSD(c.monto || 0, obraEsUSD || !!c._usd);
  const totalCuotasUSD  = cuotas.reduce((s, c) => s + cuotaEnUSD(c), 0);
  const pagadoCuotasUSD = cuotas.filter(c => cuotaEstadoCalc(c, obraM, tc) === 'pagado').reduce((s, c) => s + cuotaEnUSD(c), 0);
  const countPagadas    = cuotas.filter(c => cuotaEstadoCalc(c, obraM, tc) === 'pagado').length;

  // Total acordado al cliente: venta del presupuesto (costos *en ARS* +
  // margen) + adicionales (en ARS) + interes de financiacion. Convertido a
  // USD para el display.
  const { venta: ventaBaseARS } = calcObra(rubros);
  const adicionalClienteARS = (detalle.adicionales || [])
    .filter(a => a.estado === 'aprobado' && a.aplicaACliente !== false)
    .reduce((s, a) => s + (a.valorVentaTotal ?? a.costoTotal ?? a.monto ?? 0), 0);
  const interes = parseFloat(fin.interes) || 0;
  const totalClienteARS = Math.round((ventaBaseARS + adicionalClienteARS) * (1 + interes / 100));
  const totalClienteUSD = toUSD(totalClienteARS, false);
  const adicionalClienteUSD = toUSD(adicionalClienteARS, false);

  const diasRestantes = obra.fechaFinEstim
    ? Math.max(0, Math.ceil((new Date(obra.fechaFinEstim) - new Date()) / 86400000))
    : null;

  const tabs = ['Resumen', 'Avance', 'Plan de pagos', 'Documentos'];

  // Estado chip colors
  const estadoChip = {
    activa:            { bg: T.ok,     color: 'white', label: 'En ejecución' },
    'en-presupuesto':  { bg: T.ink2,   color: 'white', label: 'En presupuesto' },
    pausada:           { bg: T.warn,   color: 'white', label: 'Pausada' },
    finalizada:        { bg: T.accent, color: 'white', label: 'Finalizada' },
    archivada:         { bg: T.ink3,   color: 'white', label: 'Archivada' },
  };
  const estadoInfo = estadoChip[obra.estado] || estadoChip.activa;

  return (
    <div className="portal-page" style={{ fontFamily: T.font, background: T.paper, minHeight: '100vh', overflowX: 'hidden' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="portal-header" style={{ background: T.dark, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', overflow: 'hidden', gap: 8, flexWrap: 'wrap' }}>
        {/* decorative stripe */}
        <div style={{ position: 'absolute', top: -60, right: -60, opacity: 0.06, pointerEvents: 'none' }}>
          <svg viewBox="0 0 200 200" width="200" height="200"><g transform="rotate(62 100 100)"><rect x="-50" y="20" width="300" height="14" fill={T.accent} /><rect x="-50" y="60" width="300" height="14" fill={T.accent} /><rect x="-50" y="100" width="300" height="14" fill={T.accent} /></g></svg>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, position: 'relative' }}>
          <Link to="/" style={{ display: 'block', lineHeight: 0 }}>
            <img src="/assets/kamak-logo-light.png" alt="Kamak Desarrollos" style={{ height: 30, opacity: 0.9, display: 'block' }} />
          </Link>
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 18 }}>|</div>
          <div>
            <div style={{ color: 'white', fontWeight: 800, fontSize: 15, lineHeight: 1.2 }}>Portal cliente</div>
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11 }}>{clienteNombre} · {obra.nombre} — {obra.tipo}</div>
          </div>
          <div style={{ marginLeft: 8, padding: '3px 10px', borderRadius: 20, background: estadoInfo.bg, color: estadoInfo.color, fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>
            {estadoInfo.label}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
          {user && (
            <button
              onClick={() => navigate(`/obras/${id}/presupuesto`)}
              style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 5, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontFamily: T.font, fontWeight: 600 }}
            >
              ← Volver a obra
            </button>
          )}
          <div style={{ width: 32, height: 32, borderRadius: 16, background: T.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: 14 }}>
            {(clienteNombre || '?')[0].toUpperCase()}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{clienteNombre}</div>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="portal-tabs" style={{ background: 'white', borderBottom: `1.5px solid ${T.faint2}`, display: 'flex', gap: 0, overflowX: 'auto' }}>
        {tabs.map((t, i) => (
          <span
            key={i}
            onClick={() => setTab(i)}
            style={{ padding: '13px 16px', fontSize: 13, fontWeight: tab === i ? 700 : 400, color: tab === i ? T.accent : T.ink2, borderBottom: `2.5px solid ${tab === i ? T.accent : 'transparent'}`, cursor: 'pointer', transition: 'color 0.15s', userSelect: 'none', whiteSpace: 'nowrap' }}
          >
            {t}
          </span>
        ))}
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="portal-content" style={{ maxWidth: 1060, margin: '0 auto' }}>



        {/* TAB 0 — RESUMEN */}
        {tab === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* KPIs visuales (numericos grandes) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, background: T.faint, borderRadius: 8, padding: '16px 18px' }}>
              <Stat label="Avance general"     value={`${obra.avance}%`} />
              <Stat label="Días restantes"     value={diasRestantes !== null ? `${diasRestantes}` : '—'} />
              <Stat label="Cuotas pagadas"     value={`${countPagadas} / ${cuotas.length}`} />
              <Stat label="Entrega estimada"   value={fmtD(obra.fechaFinEstim)} />
            </div>

            {/* Datos de la obra (formato compacto key-value, font normal) */}
            <Box style={{ padding: '14px 18px' }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: T.ink, textTransform: 'uppercase', letterSpacing: 0.5 }}>Datos de la obra</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '12px 18px' }}>
                {[
                  ['Tipo de obra',      obra.tipo || '—'],
                  ['Dirección',         obra.direccion || '—'],
                  ['Inicio de obra',    fmtD(obra.fechaInicio)],
                  ['Presupuesto total', fmt(totalClienteUSD || toUSD(obra.presupuesto, obraEsUSD))],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: 10, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 3 }}>{k}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.ink, lineHeight: 1.3 }}>{v}</div>
                  </div>
                ))}
              </div>
              {obra.notas && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: T.faint, borderRadius: 6, fontSize: 12, color: T.ink2, borderLeft: `3px solid ${T.accent}` }}>
                  {obra.notas}
                </div>
              )}
              {fin.notaPortal && (
                <div style={{ marginTop: 10, padding: '10px 14px', background: '#fffbeb', borderRadius: 6, fontSize: 12, color: T.ink, borderLeft: `3px solid #f59e0b` }}>
                  📋 {fin.notaPortal}
                </div>
              )}
            </Box>

            {/* Avance por rubro */}
            {rubros.length > 0 && (
              <Box style={{ padding: 18 }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, color: T.ink }}>Avance por rubro</div>
                {rubros.map(r => {
                  const av = rubroAvance(r);
                  return (
                    <div key={r.id} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: T.ink, textTransform: 'capitalize' }}>{r.nombre.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}</span>
                        <span style={{ fontFamily: T.fontMono, fontWeight: 700, color: av === 100 ? T.ok : av > 0 ? T.accent : T.ink3 }}>{av}%</span>
                      </div>
                      <Bar pct={av} ok={av === 100} />
                    </div>
                  );
                })}
              </Box>
            )}

            {/* Hitos (one per rubro) */}
            {rubros.length > 0 && (
              <Box style={{ padding: 18 }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, color: T.ink }}>Estado de ejecución por gremio</div>
                {rubros.map((r, i) => {
                  const av = rubroAvance(r);
                  const done = av === 100;
                  const inProg = av > 0 && !done;
                  return (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '9px 0', borderBottom: i < rubros.length - 1 ? `1px solid ${T.faint2}` : 'none' }}>
                      <div style={{ width: 30, height: 30, borderRadius: 15, background: done ? T.ok : inProg ? T.accent : T.faint2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0, color: (done || inProg) ? 'white' : T.ink3, fontWeight: 800, transition: 'background 0.2s' }}>
                        {done ? '✓' : inProg ? '◉' : String(i + 1)}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: done ? 400 : 600, color: done ? T.ink2 : T.ink, textTransform: 'capitalize' }}>
                          {r.nombre.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
                        </div>
                        {r.proveedor && <div style={{ fontSize: 11, color: T.ink3 }}>{r.proveedor}</div>}
                      </div>
                      {inProg && (
                        <Chip accent style={{ fontSize: 10 }}>{av}% avanzado</Chip>
                      )}
                      {done && (
                        <Chip ok style={{ fontSize: 10 }}>✓ Completado</Chip>
                      )}
                      {!done && !inProg && (
                        <Chip style={{ fontSize: 10, background: T.faint2, color: T.ink3 }}>Pendiente</Chip>
                      )}
                    </div>
                  );
                })}
              </Box>
            )}

          </div>
        )}

        {/* TAB 1 — AVANCE / FOTOS */}
        {tab === 1 && (
          <Box style={{ padding: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: T.ink }}>Registro fotográfico de obra</div>
            <div style={{ fontSize: 12, color: T.ink2, marginBottom: 16 }}>{fotos.length} {fotos.length === 1 ? 'foto' : 'fotos'} disponibles</div>
            {fotos.length === 0 ? (
              <div style={{ color: T.ink3, fontSize: 13, textAlign: 'center', padding: '48px 0' }}>
                Sin fotos disponibles por el momento.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {fotos.map((f) => (
                  <a key={f.id} href={f.url || undefined} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', background: T.faint, borderRadius: 8, overflow: 'hidden', border: `1.5px solid ${T.faint2}`, cursor: 'pointer', transition: 'box-shadow 0.15s', display: 'block' }}>
                    <div style={{ background: T.faint2, aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 42, color: T.ink3, overflow: 'hidden' }}>
                      {f.url ? (
                        <img src={f.url} alt={f.label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      ) : '🏗'}
                    </div>
                    <div style={{ padding: '10px 12px' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: T.ink }}>{f.label}</div>
                      <div style={{ fontSize: 10, color: T.ink3, marginTop: 3 }}>
                        {f.rubro && <span style={{ background: T.faint2, padding: '1px 6px', borderRadius: 3, marginRight: 6 }}>{f.rubro}</span>}
                        {fmtD(f.fecha)}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </Box>
        )}

        {/* TAB 2 — CUOTAS */}
        {tab === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Summary bar */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, background: T.faint, borderRadius: 8, padding: '16px 20px' }}>
              <Stat label="Total presupuestado" value={fmt(totalCuotasUSD)} />
              <Stat label="Cobrado"             value={fmt(pagadoCuotasUSD)} />
              <Stat label="Saldo"               value={fmt(totalCuotasUSD - pagadoCuotasUSD)} />
              <Stat label="Cuotas pagadas"       value={`${countPagadas} / ${cuotas.length}`} />
            </div>

            <Box style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}` }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>Plan de pagos</div>
              </div>
              {totalClienteUSD > 0 && (
            <div style={{ padding: '10px 16px', background: T.faint, borderBottom: `1px solid ${T.faint2}`, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <div><span style={{ fontSize: 10, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total acordado</span><div style={{ fontWeight: 800, fontFamily: T.fontMono, color: T.ink }}>{fmt(totalClienteUSD)}</div></div>
              {adicionalClienteUSD > 0 && <div><span style={{ fontSize: 10, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Incluye adicionales</span><div style={{ fontWeight: 700, fontFamily: T.fontMono, color: T.accent }}>{fmt(adicionalClienteUSD)}</div></div>}
              {interes > 0 && <div><span style={{ fontSize: 10, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Interés aplicado</span><div style={{ fontWeight: 700, color: T.ink2 }}>{interes}%</div></div>}
            </div>
          )}
          {cuotas.length === 0 ? (
                <div style={{ color: T.ink3, fontSize: 13, textAlign: 'center', padding: '40px 0' }}>Sin cuotas registradas.</div>
              ) : (
                cuotas.map((c, i) => {
                  const estadoCuota = cuotaEstadoCalc(c, obraM, tc);
                  const isPagado = estadoCuota === 'pagado';
                  const isParcial = estadoCuota === 'parcial';
                  const isProximo = !isPagado && c.estado === 'proximo';
                  const dotBg = isPagado ? T.ok : (isParcial || isProximo) ? T.accent : T.faint2;
                  const dotColor = (isPagado || isParcial || isProximo) ? 'white' : T.ink3;
                  const etiqueta = isPagado ? 'pagado' : isParcial ? 'parcial' : isProximo ? 'próximo' : 'pendiente';
                  return (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', padding: '13px 16px', borderBottom: i < cuotas.length - 1 ? `1px solid ${T.faint2}` : 'none', gap: 14 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 16, background: dotBg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: dotColor, fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
                        {isPagado ? '✓' : c.n}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{c.descripcion}</div>
                        <div style={{ fontSize: 11, color: T.ink2 }}>{fmtD(c.fecha)}</div>
                      </div>
                      <div style={{ fontFamily: T.fontMono, fontWeight: 700, fontSize: 14, flexShrink: 0, color: isPagado ? T.ok : T.ink }}>
                        {fmt(cuotaEnUSD(c))}
                      </div>
                      <Chip ok={isPagado} accent={isParcial || isProximo} style={{ fontSize: 10, flexShrink: 0 }}>{etiqueta}</Chip>
                    </div>
                  );
                })
              )}
            </Box>
          </div>
        )}

        {/* TAB 3 — DOCUMENTOS */}
        {tab === 3 && (
          <Box style={{ padding: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: T.ink }}>Documentos de la obra</div>
            <div style={{ fontSize: 12, color: T.ink2, marginBottom: 16 }}>{documentos.length} {documentos.length === 1 ? 'archivo' : 'archivos'} disponibles</div>
            {documentos.length === 0 ? (
              <div style={{ color: T.ink3, fontSize: 13, textAlign: 'center', padding: '48px 0' }}>
                Sin documentos disponibles en este momento.
              </div>
            ) : (
              documentos.map((doc, i) => (
                <div key={doc.id} style={{ display: 'flex', alignItems: 'center', padding: '11px 0', borderBottom: i < documentos.length - 1 ? `1px solid ${T.faint2}` : 'none', gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 8, background: T.faint2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
                    📄
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{doc.nombre}</div>
                    <div style={{ fontSize: 11, color: T.ink2, marginTop: 2 }}>
                      <span style={{ background: T.faint2, padding: '1px 6px', borderRadius: 3, marginRight: 6, fontWeight: 700 }}>{doc.tipo}</span>
                      {fmtD(doc.fecha)}
                    </div>
                  </div>
                  <button style={{ background: T.faint, border: `1.5px solid ${T.faint2}`, borderRadius: 5, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontFamily: T.font, color: T.ink, fontWeight: 600 }}>
                    ↓ Descargar
                  </button>
                </div>
              ))
            )}
          </Box>
        )}
      </div>
    </div>
  );
}
