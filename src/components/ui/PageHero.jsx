import { Box } from './index';
import { T } from '../../theme';
import { useIsMobile } from '../../hooks/useMediaQuery';

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
  const isMobile = useIsMobile();
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
        // En mobile apilamos titulo y acciones para que NUNCA se superpongan
        // ni se aprieten en ~360px; en desktop quedan lado a lado como siempre.
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'stretch' : 'center',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
        gap: isMobile ? 8 : 12,
      }}>
        <div style={{ position: 'relative', minWidth: 0, flex: 1, width: isMobile ? '100%' : 'auto' }}>
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
          <div className="k-h" style={{
            fontSize: 'clamp(15px, 4.5vw, 17px)',
            lineHeight: 1.15,
            letterSpacing: -0.2,
            // El titulo puede envolver y romper palabras largas para no
            // desbordar el banner en pantallas angostas (~360px).
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
            minWidth: 0,
          }}>{title}</div>
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
            // En mobile las acciones ocupan el ancho completo bajo el titulo y
            // se alinean a la izquierda (en vez de apretarse contra el borde
            // derecho); en desktop quedan a la derecha como siempre.
            width: isMobile ? '100%' : 'auto',
            justifyContent: isMobile ? 'flex-start' : 'flex-end',
            maxWidth: '100%',
          }}>
            {actions}
          </div>
        )}
      </div>

      {/* KPIs — compactos, dividers casi imperceptibles, leve halo en hover. */}
      {kpis.length > 0 && (
        <div style={{
          display: 'grid',
          // En mobile bajamos el minmax para que entren 2 columnas en ~360px
          // sin apretar; en desktop el layout queda igual.
          gridTemplateColumns: isMobile
            ? `repeat(auto-fit, minmax(100px, 1fr))`
            : `repeat(auto-fit, minmax(120px, 1fr))`,
          background: '#fbf9f1',
        }}>
          {kpis.map((k, i) => (
            <div
              key={i}
              onClick={k.onClick}
              style={{
                padding: isMobile ? '6px 10px' : '8px 14px',
                borderRight: i < kpis.length - 1 ? `1px solid rgba(212, 207, 191, 0.5)` : 'none',
                minWidth: 0,
                cursor: k.onClick ? 'pointer' : 'default',
                background: k.active ? '#f3eedf' : '',
                borderBottom: k.active ? `2px solid ${T.accent}` : '2px solid transparent',
                transition: 'background 0.18s ease, border-bottom 0.18s ease',
              }}
              onMouseEnter={e => { if (k.onClick && !k.active) e.currentTarget.style.background = '#f3eedf'; }}
              onMouseLeave={e => { if (!k.active) e.currentTarget.style.background = ''; }}
            >
              <div style={{
                fontSize: 8.5,
                color: T.ink3,
                fontFamily: `'JetBrains Mono', monospace`,
                letterSpacing: 1.2,
                fontWeight: 700,
                marginBottom: 2,
                textTransform: 'uppercase',
                // En mobile dejamos envolver el label (en vez de recortarlo con
                // ellipsis) para que no se pierda texto en celdas angostas.
                whiteSpace: isMobile ? 'normal' : 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                overflowWrap: isMobile ? 'anywhere' : 'normal',
                lineHeight: 1.2,
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
