import { Box } from './index';
import { T } from '../../theme';

// Hero unificado para los encabezados de pagina (Cajas, Cheques, Plantillas,
// etc.). Imita el diseño del banner "Posicion consolidada" del Dashboard:
// - Banner oscuro con rayas decorativas a la derecha.
// - Etiqueta accent en mono uppercase.
// - Titulo grande blanco.
// - Subtitle gris.
// - Espacio para acciones (buscar, + nuevo, etc.) a la derecha.
// - KPIs en una grilla clara abajo dentro del mismo Box.
//
// Uso:
//   <PageHero
//     title="Cheques"
//     subtitle="Gestion de cheques recibidos y emitidos"
//     actions={<><input ... /> <Btn>+ Nuevo</Btn></>}
//     kpis={[
//       { label: 'En cartera', value: 12 },
//       { label: 'Total ARS', value: '$ 1.5M', color: T.ok },
//       ...
//     ]}
//   />

export default function PageHero({ title, subtitle, kpis = [], actions, label }) {
  return (
    <Box style={{
      padding: 0,
      overflow: 'hidden',
      marginBottom: 14,
      // Sombra delicada multi-capa: contornos sutiles + un leve halo abajo
      // que da sensacion de "elevacion" sin ser invasivo.
      boxShadow: '0 1px 0 rgba(0,0,0,0.04), 0 6px 14px -8px rgba(20,18,15,0.18)',
    }}>
      {/* Banner oscuro — usa la clase k-stripes-bg para mostrar las MISMAS
          rayas que el Topbar (background fixed al viewport). Asi cuando el
          usuario ve Topbar arriba y banner abajo, parece que las rayas son
          una sola "tela" que se interrumpe en el area clara intermedia y
          reaparece alineada. */}
      <div className="k-stripes-bg" style={{
        backgroundColor: T.dark,
        color: '#fff',
        padding: '8px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
        gap: 12,
      }}>
        <div style={{ position: 'relative', minWidth: 0, flex: 1 }}>
          {label && (
            <div style={{
              fontSize: 8.5,
              color: T.accent,
              fontFamily: `'JetBrains Mono', monospace`,
              letterSpacing: 1.5,
              fontWeight: 700,
              marginBottom: 1,
              opacity: 0.9,
            }}>
              {label}
            </div>
          )}
          <div className="k-h" style={{ fontSize: 17, lineHeight: 1.15, letterSpacing: -0.2 }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 10.5, color: '#a3a09a', marginTop: 2, fontWeight: 400 }}>{subtitle}</div>
          )}
        </div>

        {actions && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            position: 'relative',
            flexShrink: 0,
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
          }}>
            {actions}
          </div>
        )}
      </div>

      {/* KPIs — compactos, dividers casi imperceptibles, leve halo en hover. */}
      {kpis.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${kpis.length}, 1fr)`,
          background: '#fbf9f1',
        }}>
          {kpis.map((k, i) => (
            <div
              key={i}
              style={{
                padding: '8px 14px',
                borderRight: i < kpis.length - 1 ? `1px solid rgba(212, 207, 191, 0.5)` : 'none',
                minWidth: 0,
                transition: 'background 0.18s ease',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f3eedf'}
              onMouseLeave={e => e.currentTarget.style.background = ''}
            >
              <div style={{
                fontSize: 8.5,
                color: T.ink3,
                fontFamily: `'JetBrains Mono', monospace`,
                letterSpacing: 1.2,
                fontWeight: 700,
                marginBottom: 2,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {k.label}
              </div>
              <div style={{
                fontFamily: `'Montserrat', sans-serif`,
                fontSize: 16,
                fontWeight: 800,
                color: k.color || T.ink,
                lineHeight: 1.1,
                letterSpacing: -0.2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {k.value}
              </div>
              {k.sub && (
                <div style={{ fontSize: 9.5, color: T.ink3, marginTop: 1 }}>{k.sub}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </Box>
  );
}
