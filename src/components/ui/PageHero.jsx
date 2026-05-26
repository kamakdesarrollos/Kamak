import { Box, Stripes } from './index';
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
    <Box style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
      {/* Banner oscuro */}
      <div style={{
        background: T.dark,
        color: '#fff',
        padding: '16px 18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
        gap: 16,
      }}>
        <Stripes style={{ top: -50, right: -30, opacity: 0.10 }} />

        <div style={{ position: 'relative', minWidth: 0, flex: 1 }}>
          {label && (
            <div style={{
              fontSize: 9,
              color: T.accent,
              fontFamily: `'JetBrains Mono', monospace`,
              letterSpacing: 1.8,
              fontWeight: 700,
              marginBottom: 4,
            }}>
              {label}
            </div>
          )}
          <div className="k-h" style={{ fontSize: 26, lineHeight: 1.1 }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 12, color: '#9a9892', marginTop: 4 }}>{subtitle}</div>
          )}
        </div>

        {actions && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            position: 'relative',
            flexShrink: 0,
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
          }}>
            {actions}
          </div>
        )}
      </div>

      {/* KPIs (opcionales) */}
      {kpis.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${kpis.length}, 1fr)`,
          background: T.faint,
        }}>
          {kpis.map((k, i) => (
            <div key={i} style={{
              padding: '12px 16px',
              borderRight: i < kpis.length - 1 ? `1px solid ${T.faint2}` : 'none',
              minWidth: 0,
            }}>
              <div style={{
                fontSize: 9,
                color: T.ink3,
                fontFamily: `'JetBrains Mono', monospace`,
                letterSpacing: 1.4,
                fontWeight: 700,
                marginBottom: 4,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {k.label}
              </div>
              <div style={{
                fontFamily: `'Montserrat', sans-serif`,
                fontSize: 20,
                fontWeight: 800,
                color: k.color || T.ink,
                lineHeight: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {k.value}
              </div>
              {k.sub && (
                <div style={{ fontSize: 10, color: T.ink3, marginTop: 3 }}>{k.sub}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </Box>
  );
}
