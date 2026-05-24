import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useObras } from '../../store/ObrasContext';
import { Box, Btn, Chip, Stat, Bar } from '../../components/ui';
import { T } from '../../theme';

const fmtN = (n) => Math.round(n).toLocaleString('es-AR');
const fmtM = (n, moneda) => moneda === 'USD' ? `U$S ${fmtN(n)}` : `$ ${fmtN(n)}`;
const fmtD = (iso) => !iso ? '—' : iso.split('-').reverse().join('/');
const newId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const rubroAvance = (rubro) =>
  rubro.tareas.length > 0
    ? Math.round(rubro.tareas.reduce((s, t) => s + t.avance, 0) / rubro.tareas.length)
    : 0;

const calcVentaBase = (rubros) => {
  let v = 0;
  for (const r of rubros) {
    for (const t of (r.tareas || []).filter(x => x.tipo !== 'seccion')) {
      const costoUnit = (t.costoMat || 0) + (t.costoSub || 0);
      const ventaUnit = t.margenLinea != null
        ? costoUnit * (1 + t.margenLinea / 100)
        : (t.costoMat || 0) * (1 + (r.margenMat || 0) / 100) + (t.costoSub || 0) * (1 + (r.margenMO || 0) / 100);
      v += ventaUnit * (t.cantidad || 0);
    }
  }
  return Math.round(v);
};

export default function PortalCliente() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { obras, getDetalle, patchDetalle } = useObras();

  const [tab, setTab] = useState(0);
  const [msg, setMsg] = useState('');

  const obra = obras.find(o => o.id === id);
  const detalle = getDetalle(id || '');

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

  const rubros    = detalle.rubros    || [];
  const cuotas    = detalle.cuotas    || [];
  const documentos = detalle.documentos || [];
  const fotos     = detalle.fotos     || [];
  const mensajes  = detalle.mensajes  || [];
  const fin       = detalle.financiacion || {};

  const totalCuotas   = cuotas.reduce((s, c) => s + c.monto, 0);
  const pagadoCuotas  = cuotas.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0);
  const countPagadas  = cuotas.filter(c => c.estado === 'pagado').length;

  const ventaBase = calcVentaBase(rubros);
  const adicionalCliente = (detalle.adicionales || [])
    .filter(a => a.estado === 'aprobado' && a.aplicaACliente !== false)
    .reduce((s, a) => s + (a.valorVentaTotal ?? a.costoTotal ?? a.monto ?? 0), 0);
  const interes = parseFloat(fin.interes) || 0;
  const totalCliente = Math.round((ventaBase + adicionalCliente) * (1 + interes / 100));

  const diasRestantes = obra.fechaFinEstim
    ? Math.max(0, Math.ceil((new Date(obra.fechaFinEstim) - new Date()) / 86400000))
    : null;

  const sendMsg = () => {
    const texto = msg.trim();
    if (!texto) return;
    patchDetalle(id, d => ({ ...d, mensajes: [...(d.mensajes || []), { id: newId(), autor: 'cliente', texto, fecha: new Date().toISOString() }] }));
    setMsg('');
  };

  const tabs = ['Resumen', 'Avance', 'Cuotas', 'Documentos', `Mensajes${mensajes.length > 0 ? ' · ' + mensajes.length : ''}`];

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
    <div style={{ fontFamily: T.font, background: T.paper, minHeight: '100vh' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ background: T.dark, padding: '14px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', overflow: 'hidden' }}>
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
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11 }}>{obra.cliente} · {obra.nombre} — {obra.tipo}</div>
          </div>
          <div style={{ marginLeft: 8, padding: '3px 10px', borderRadius: 20, background: estadoInfo.bg, color: estadoInfo.color, fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>
            {estadoInfo.label}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
          <button
            onClick={() => navigate(`/obras/${id}/presupuesto`)}
            style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 5, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontFamily: T.font, fontWeight: 600 }}
          >
            ← Volver a obra
          </button>
          <div style={{ width: 32, height: 32, borderRadius: 16, background: T.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: 14 }}>
            {(obra.cliente || '?')[0].toUpperCase()}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{obra.cliente}</div>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div style={{ background: 'white', borderBottom: `1.5px solid ${T.faint2}`, padding: '0 28px', display: 'flex', gap: 0 }}>
        {tabs.map((t, i) => (
          <span
            key={i}
            onClick={() => setTab(i)}
            style={{ padding: '13px 16px', fontSize: 13, fontWeight: tab === i ? 700 : 400, color: tab === i ? T.accent : T.ink2, borderBottom: `2.5px solid ${tab === i ? T.accent : 'transparent'}`, cursor: 'pointer', transition: 'color 0.15s', userSelect: 'none' }}
          >
            {t}
          </span>
        ))}
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div style={{ padding: '24px 28px', maxWidth: 1060, margin: '0 auto' }}>

        {/* TAB 0 — RESUMEN */}
        {tab === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, background: T.faint, borderRadius: 8, padding: '16px 20px' }}>
              <Stat label="Avance general"    value={`${obra.avance}%`} />
              <Stat label="Días restantes"    value={diasRestantes !== null ? `${diasRestantes}` : '—'} />
              <Stat label="Cuotas pagadas"    value={`${countPagadas} / ${cuotas.length}`} />
              <Stat label="Entrega estimada"  value={fmtD(obra.fechaFinEstim)} />
            </div>

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

            {/* Info de la obra */}
            <Box style={{ padding: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, color: T.ink }}>Datos de la obra</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 }}>
                {[
                  ['Tipo de obra',      obra.tipo],
                  ['Dirección',         obra.direccion || '—'],
                  ['Inicio de obra',    fmtD(obra.fechaInicio)],
                  ['Entrega estimada',  fmtD(obra.fechaFinEstim)],
                  ['Presupuesto total', fmtM(obra.presupuesto, obra.moneda)],
                  ['Moneda',            obra.moneda === 'USD' ? 'Dólares (USD)' : 'Pesos (ARS)'],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: 10, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700, marginBottom: 3 }}>{k}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{v}</div>
                  </div>
                ))}
              </div>
              {obra.notas && (
                <div style={{ marginTop: 14, padding: '10px 14px', background: T.faint, borderRadius: 6, fontSize: 12, color: T.ink2, borderLeft: `3px solid ${T.accent}` }}>
                  {obra.notas}
                </div>
              )}
              {fin.notaPortal && (
                <div style={{ marginTop: 14, padding: '10px 14px', background: '#fffbeb', borderRadius: 6, fontSize: 12, color: T.ink, borderLeft: `3px solid #f59e0b` }}>
                  📋 {fin.notaPortal}
                </div>
              )}
            </Box>
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
              <Stat label="Total presupuestado" value={fmtM(totalCuotas, obra.moneda)} />
              <Stat label="Cobrado"             value={fmtM(pagadoCuotas, obra.moneda)} />
              <Stat label="Saldo"               value={fmtM(totalCuotas - pagadoCuotas, obra.moneda)} />
              <Stat label="Cuotas pagadas"       value={`${countPagadas} / ${cuotas.length}`} />
            </div>

            <Box style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', background: T.faint, borderBottom: `1.5px solid ${T.faint2}` }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>Plan de cuotas</div>
              </div>
              {totalCliente > 0 && (
            <div style={{ padding: '10px 16px', background: T.faint, borderBottom: `1px solid ${T.faint2}`, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <div><span style={{ fontSize: 10, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total acordado</span><div style={{ fontWeight: 800, fontFamily: T.fontMono, color: T.ink }}>{fmtM(totalCliente, obra.moneda)}</div></div>
              {adicionalCliente > 0 && <div><span style={{ fontSize: 10, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Incluye adicionales</span><div style={{ fontWeight: 700, fontFamily: T.fontMono, color: T.accent }}>{fmtM(adicionalCliente, obra.moneda)}</div></div>}
              {interes > 0 && <div><span style={{ fontSize: 10, color: T.ink3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Interés aplicado</span><div style={{ fontWeight: 700, color: T.ink2 }}>{interes}%</div></div>}
            </div>
          )}
          {cuotas.length === 0 ? (
                <div style={{ color: T.ink3, fontSize: 13, textAlign: 'center', padding: '40px 0' }}>Sin cuotas registradas.</div>
              ) : (
                cuotas.map((c, i) => {
                  const isPagado = c.estado === 'pagado';
                  const isProximo = c.estado === 'proximo';
                  const dotBg = isPagado ? T.ok : isProximo ? T.accent : T.faint2;
                  const dotColor = (isPagado || isProximo) ? 'white' : T.ink3;
                  const etiqueta = isPagado ? 'pagado' : isProximo ? 'próximo' : 'pendiente';
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
                        {fmtM(c.monto, obra.moneda)}
                      </div>
                      <Chip ok={isPagado} accent={isProximo} style={{ fontSize: 10, flexShrink: 0 }}>{etiqueta}</Chip>
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

        {/* TAB 4 — MENSAJES */}
        {tab === 4 && (
          <Box style={{ padding: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, color: T.ink }}>Mensajes con Kamak Desarrollos</div>
            <div style={{ fontSize: 12, color: T.ink2, marginBottom: 16 }}>
              {obra.nombre} · {obra.tipo}
            </div>

            {/* Chat area */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 220, marginBottom: 18 }}>
              {mensajes.length === 0 ? (
                <div style={{ color: T.ink3, fontSize: 13, textAlign: 'center', padding: '56px 0', flex: 1 }}>
                  No hay mensajes aún. Escribí tu consulta a Kamak Desarrollos.
                </div>
              ) : (
                mensajes.map((m) => {
                  const mine = m.autor === 'cliente';
                  const d = new Date(m.fecha);
                  const ts = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
                  return (
                    <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
                      <div style={{ fontSize: 10, color: T.ink3, marginBottom: 4 }}>
                        {mine ? obra.cliente : 'Kamak Desarrollos'} · {ts}
                      </div>
                      <div style={{ background: mine ? T.accentSoft : 'white', border: `1.5px solid ${mine ? T.accent : T.faint2}`, borderRadius: mine ? '12px 12px 2px 12px' : '12px 12px 12px 2px', padding: '9px 14px', maxWidth: '72%', fontSize: 13, color: T.ink, lineHeight: 1.45 }}>
                        {m.texto}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Input */}
            <div style={{ display: 'flex', gap: 8, borderTop: `1.5px solid ${T.faint2}`, paddingTop: 14 }}>
              <input
                value={msg}
                onChange={e => setMsg(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } }}
                style={{ flex: 1, padding: '9px 13px', border: `1.5px solid ${T.faint2}`, borderRadius: 6, fontSize: 13, fontFamily: T.font, outline: 'none', color: T.ink, background: 'white' }}
                placeholder="Escribí tu mensaje… (Enter para enviar)"
              />
              <button
                onClick={sendMsg}
                style={{ background: T.accent, color: 'white', border: 'none', borderRadius: 6, padding: '0 18px', fontSize: 13, cursor: 'pointer', fontFamily: T.font, fontWeight: 700 }}
              >
                Enviar
              </button>
            </div>
          </Box>
        )}
      </div>
    </div>
  );
}
