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
    <div style={{ maxWidth: 390, margin: '0 auto', background: T.paper, minHeight: '100vh', display: 'flex', flexDirection: 'column', fontFamily: T.font }}>
      <div style={{ background: T.dark, padding: '14px 16px 10px' }}>
        {onBack && <span style={{ color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 13 }} onClick={onBack}>← Volver</span>}
        <div style={{ color: T.paper, fontWeight: 800, fontSize: 17, marginTop: onBack ? 4 : 0 }}>{title}</div>
        {sub && <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, marginTop: 2 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function ObraHomeScreen({ onAvance, onFotos }) {
  return (
    <Screen title="Baradero · Director" sub="Estación Shell · Electricidad">
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Resumen */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { label: 'Avance general', value: '63%', color: T.ok },
            { label: 'Días restantes', value: '28', color: T.ink },
            { label: 'Tareas completadas', value: '4 / 12', color: T.accent },
            { label: 'En ejecución', value: '3', color: T.warn },
          ].map((s, i) => (
            <div key={i} style={{ background: 'white', borderRadius: 8, padding: '10px 12px', border: `1.5px solid ${T.faint2}` }}>
              <div style={{ fontSize: 10, color: T.ink2 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color, fontFamily: T.fontMono }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Quick actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, background: T.accent, borderRadius: 10, padding: '14px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }} onClick={onAvance}>
            <div style={{ fontSize: 28 }}>📊</div>
            <div style={{ color: 'white', fontWeight: 700, fontSize: 12 }}>Cargar avance</div>
          </div>
          <div style={{ flex: 1, background: '#3d7a4a', borderRadius: 10, padding: '14px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }} onClick={onFotos}>
            <div style={{ fontSize: 28 }}>📷</div>
            <div style={{ color: 'white', fontWeight: 700, fontSize: 12 }}>Agregar fotos</div>
          </div>
        </div>

        {/* Tareas recientes */}
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Tareas activas</div>
          {TAREAS.filter(t => t.estado === 'en curso').map((t, i) => (
            <div key={i} style={{ background: 'white', border: `1.5px solid ${T.faint2}`, borderRadius: 8, padding: '10px 12px', marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{t.name}</span>
                <span style={{ fontSize: 11, fontFamily: T.fontMono, color: T.ink2 }}>{t.pct}%</span>
              </div>
              <Bar pct={t.pct} ok={t.pct === 100} />
            </div>
          ))}
        </div>

        {/* Alertas */}
        <div style={{ background: '#fff7e6', border: `1.5px solid ${T.warn}`, borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: T.warn, marginBottom: 4 }}>⚠ Alerta</div>
          <div style={{ fontSize: 11 }}>Tablero principal al 80% — pendiente aprobación de inspector. Estimado: 3/6/26.</div>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{t.name}</span>
              <span style={{ fontSize: 13, fontFamily: T.fontMono, fontWeight: 700, color: values[i] === 100 ? T.ok : T.accent }}>{values[i]}%</span>
            </div>
            <input
              type="range" min={0} max={100} step={5}
              value={values[i]}
              onChange={e => setValues(v => v.map((x, j) => j === i ? +e.target.value : x))}
              style={{ width: '100%', accentColor: T.accent }}
            />
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
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
