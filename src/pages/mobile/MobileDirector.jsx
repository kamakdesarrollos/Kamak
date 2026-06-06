import { useState } from 'react';
import { Btn, Chip, Bar } from '../../components/ui';
import { T } from '../../theme';

const TAREAS = [
  { name: 'Cañería embutida piso', pct: 100, estado: 'completo' },
  { name: 'Tablero principal', pct: 80, estado: 'en curso' },
  { name: 'Bocas de luz planta baja', pct: 60, estado: 'en curso' },
  { name: 'Tomas 220V', pct: 40, estado: 'en curso' },
  { name: 'Iluminación exterior', pct: 0, estado: 'pendiente' },
  { name: 'Prueba y habilitación', pct: 0, estado: 'pendiente' },
];

function Screen({ title, sub, children, onBack }) {
  return (
    // FIX alto: maxWidth 390 → min(390px,100vw) para que no fuerce scroll en <390px
    <div style={{ maxWidth: 'min(390px, 100vw)', margin: '0 auto', background: T.paper, minHeight: '100vh', display: 'flex', flexDirection: 'column', fontFamily: T.font }}>
      <div style={{ background: '#fff7ed', color: '#b45309', padding: '7px 14px', fontSize: 11, fontWeight: 600, textAlign: 'center' }}>
        🚧 Maqueta — no persiste datos reales
      </div>
      <div style={{ background: T.dark, padding: '14px 16px 10px' }}>
        {onBack && <span style={{ color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 13 }} onClick={onBack}>← Volver</span>}
        {/* FIX alto: fontSize 17 fijo → clamp(14px,4vw,17px); permitir wrap */}
        <div style={{ color: T.paper, fontWeight: 800, fontSize: 'clamp(14px, 4vw, 17px)', marginTop: onBack ? 4 : 0, whiteSpace: 'normal', wordBreak: 'break-word' }}>{title}</div>
        {/* FIX medio: subtitle → wrap explícito */}
        {sub && <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, marginTop: 2, whiteSpace: 'normal', wordBreak: 'break-word' }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function ObraHomeScreen({ onAvance, onFotos }) {
  return (
    <Screen title="Baradero · Director" sub="Estación Shell · Electricidad">
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Resumen 2-col — ok hasta 360px; en <320px colapsa a 1 col */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { label: 'Avance general', value: '63%', color: T.ok },
            { label: 'Días restantes', value: '28', color: T.ink },
            { label: 'Tareas completadas', value: '4 / 12', color: T.accent },
            { label: 'En ejecución', value: '3', color: T.warn },
          ].map((s, i) => (
            <div key={i} style={{ background: 'white', borderRadius: 8, padding: '10px 12px', border: `1.5px solid ${T.faint2}`, minWidth: 0 }}>
              {/* FIX medio: label con ellipsis para evitar overflow */}
              <div style={{ fontSize: 10, color: T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color, fontFamily: T.fontMono }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Quick actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          {/* FIX bajo: minWidth:0 defensivo en botones flex:1 */}
          <div style={{ flex: 1, minWidth: 0, background: T.accent, borderRadius: 10, padding: '14px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }} onClick={onAvance}>
            <div style={{ fontSize: 28 }}>📊</div>
            <div style={{ color: 'white', fontWeight: 700, fontSize: 12 }}>Cargar avance</div>
          </div>
          <div style={{ flex: 1, minWidth: 0, background: '#3d7a4a', borderRadius: 10, padding: '14px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }} onClick={onFotos}>
            <div style={{ fontSize: 28 }}>📷</div>
            <div style={{ color: 'white', fontWeight: 700, fontSize: 12 }}>Agregar fotos</div>
          </div>
        </div>

        {/* Tareas recientes */}
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Tareas activas</div>
          {TAREAS.filter(t => t.estado === 'en curso').map((t, i) => (
            <div key={i} style={{ background: 'white', border: `1.5px solid ${T.faint2}`, borderRadius: 8, padding: '10px 12px', marginBottom: 6 }}>
              {/* FIX alto: fila flex → hijos con minWidth:0 para que nombres largos no desborden */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                <span style={{ fontSize: 11, fontFamily: T.fontMono, color: T.ink2, flexShrink: 0 }}>{t.pct}%</span>
              </div>
              <Bar pct={t.pct} ok={t.pct === 100} />
            </div>
          ))}
        </div>

        {/* Alertas */}
        <div style={{ background: '#fff7e6', border: `1.5px solid ${T.warn}`, borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: T.warn, marginBottom: 4 }}>⚠ Alerta</div>
          {/* FIX medio: texto alerta → wrap explícito */}
          <div style={{ fontSize: 11, whiteSpace: 'normal', wordBreak: 'break-word' }}>Tablero principal al 80% — pendiente aprobación de inspector. Estimado: 3/6/26.</div>
        </div>
      </div>
    </Screen>
  );
}

function AvanceScreen({ onBack }) {
  const [values, setValues] = useState(TAREAS.map(t => t.pct));

  return (
    <Screen title="Cargar avance" sub="Baradero · Electricidad" onBack={onBack}>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: T.ink2 }}>Arrastrá el slider para actualizar el % de avance de cada tarea.</div>
        {TAREAS.map((t, i) => (
          <div key={i} style={{ background: 'white', border: `1.5px solid ${t.estado === 'completo' ? T.ok : T.faint2}`, borderRadius: 8, padding: '10px 12px' }}>
            {/* FIX alto: nombre tarea en flex row → minWidth:0 + ellipsis */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
              <span style={{ fontSize: 13, fontFamily: T.fontMono, fontWeight: 700, color: values[i] === 100 ? T.ok : T.accent, flexShrink: 0 }}>{values[i]}%</span>
            </div>
            {/* FIX bajo: padding vertical en wrapper de range para tap target más grande */}
            <div style={{ paddingTop: 4, paddingBottom: 4 }}>
              <input
                type="range" min={0} max={100} step={5}
                value={values[i]}
                onChange={e => setValues(v => v.map((x, j) => j === i ? +e.target.value : x))}
                style={{ width: '100%', accentColor: T.accent, minHeight: 40, cursor: 'pointer' }}
              />
            </div>
            {t.estado === 'pendiente' && values[i] > 0 && (
              <div style={{ fontSize: 10, color: T.warn, marginTop: 4 }}>Tarea marcada como iniciada</div>
            )}
          </div>
        ))}
        <Btn sm accent style={{ marginTop: 8 }}>Guardar avances</Btn>
      </div>
    </Screen>
  );
}

function FotosScreen({ onBack }) {
  return (
    <Screen title="Fotos de obra" sub="Baradero · Electricidad" onBack={onBack}>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn sm accent style={{ flex: 1 }}>📷 Tomar foto</Btn>
          <Btn sm style={{ flex: 1 }}>🖼️ Galería</Btn>
        </div>

        {/* FIX medio: grilla fotos 3-col → colapsa a 2-col en <320px via CSS var trick */}
        {/* En 360px: 3 col = ~112px cada una, ok. En <320px: repeat(auto-fill,minmax(90px,1fr)) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 6 }}>
          {[
            { label: 'Tablero', tag: 'hoy' },
            { label: 'Cañería', tag: 'ayer' },
            { label: 'Bocas PB', tag: '14/5' },
            { label: 'Exterior', tag: '12/5' },
            { label: 'Tablero 2', tag: '10/5' },
            { label: 'Zanjeo', tag: '08/5' },
          ].map((f, i) => (
            <div key={i} style={{ background: T.faint2, borderRadius: 6, aspectRatio: '1', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden', cursor: 'pointer' }}>
              <div style={{ background: 'rgba(0,0,0,0.45)', color: 'white', padding: '4px 6px', fontSize: 9 }}>
                <div style={{ fontWeight: 700 }}>{f.label}</div>
                <div style={{ opacity: 0.8 }}>{f.tag}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Screen>
  );
}

export default function MobileDirector() {
  const [screen, setScreen] = useState('home');

  if (screen === 'avance') return <AvanceScreen onBack={() => setScreen('home')} />;
  if (screen === 'fotos') return <FotosScreen onBack={() => setScreen('home')} />;
  return <ObraHomeScreen onAvance={() => setScreen('avance')} onFotos={() => setScreen('fotos')} />;
}
