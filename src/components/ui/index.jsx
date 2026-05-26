import { T } from '../../theme';

export function Box({ children, style, dashed, dbl, className = '', ...rest }) {
  const cls = dbl ? 'k-box-dbl' : dashed ? 'k-box-dashed' : 'k-box';
  return <div className={`${cls} ${className}`} style={style} {...rest}>{children}</div>;
}

export function Btn({ children, fill, accent, sm, style, onClick, className = '' }) {
  const cls = ['k-btn', fill && 'k-btn-fill', accent && 'k-btn-accent', sm && 'k-btn-sm'].filter(Boolean).join(' ');
  return <button className={`${cls} ${className}`} style={style} onClick={onClick}>{children}</button>;
}

export function Chip({ children, fill, accent, warn, ok, style, className = '' }) {
  const cls = ['k-chip', fill && 'k-chip-fill', accent && 'k-chip-accent', warn && 'k-chip-warn', ok && 'k-chip-ok'].filter(Boolean).join(' ');
  return <span className={`${cls} ${className}`} style={style}>{children}</span>;
}

export function Field({ label, value, placeholder, w = 160, dropdown, style }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, ...style }}>
      {label && <div style={{ fontSize: 11, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>}
      <div className="k-field" style={{ width: w, justifyContent: 'space-between' }}>
        <span style={{ color: value ? T.ink : T.ink3 }}>{value || placeholder || ''}</span>
        {dropdown && <span style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: `5px solid ${T.ink}`, display: 'inline-block', marginLeft: 4 }} />}
      </div>
    </div>
  );
}

export function ImgPh({ w = 80, h = 60, label = 'foto', style }) {
  return (
    <div className="k-img-ph" style={{ width: w, height: h, ...style }}>
      <span className="k-img-label">{label}</span>
    </div>
  );
}

export function Check({ on, label, style }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, ...style }}>
      <span className={`k-check${on ? ' k-check-on' : ''}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {on && <span style={{ color: T.paper, fontSize: 10, lineHeight: 1 }}>✓</span>}
      </span>
      {label && <span>{label}</span>}
    </span>
  );
}

export function Radio({ on, label, style }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, ...style }}>
      <span className={`k-radio${on ? ' k-radio-on' : ''}`} />
      {label && <span>{label}</span>}
    </span>
  );
}

export function Bar({ pct = 50, h = 7, accent, ok, warn, w = '100%', style }) {
  const color = accent ? T.accent : ok ? T.ok : warn ? T.warn : T.ink2;
  return (
    <div className="k-bar-track" style={{ width: w, height: h, ...style }}>
      <div className="k-bar-fill" style={{ width: `${pct}%`, height: '100%', background: color }} />
    </div>
  );
}

export function Stat({ value, label, sub, accent, style }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, ...style }}>
      {label && <Label>{label}</Label>}
      <div className="k-stat" style={{ color: accent ? T.accent : T.ink }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: T.ink3 }}>{sub}</div>}
    </div>
  );
}

export function Label({ children, style }) {
  return <div style={{ fontSize: 11, color: T.ink2, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, ...style }}>{children}</div>;
}

export function Note({ children, style }) {
  return <div className="k-note" style={style}>{children}</div>;
}

export function Tag({ children, style }) {
  return <span className="k-tag" style={style}>{children}</span>;
}

export function Divider({ style }) {
  return <div className="k-divider" style={style} />;
}

export function Table({ cols, rows, style }) {
  return (
    <div className="k-box" style={{ padding: 0, overflow: 'hidden', ...style }}>
      <div className="k-tr" style={{ background: T.faint, borderBottom: `1.5px solid ${T.rule}` }}>
        {cols.map((c, i) => (
          <div key={i} className="k-cell k-th" style={{ flex: c.flex || 1, textAlign: c.align || 'left', borderLeft: i ? `1px dashed ${T.faint2}` : 0 }}>
            {c.label}
          </div>
        ))}
      </div>
      {rows.map((r, i) => (
        <div key={i} className="k-tr">
          {cols.map((c, j) => {
            const cell = r[j];
            const val = typeof cell === 'object' && cell !== null && 'v' in cell ? cell.v : cell;
            const bold = typeof cell === 'object' && cell !== null && cell.bold;
            const dim = typeof cell === 'object' && cell !== null && cell.dim;
            return (
              <div key={j} className="k-cell" style={{
                flex: c.flex || 1,
                textAlign: c.align || 'left',
                borderLeft: j ? `1px dashed ${T.faint2}` : 0,
                fontFamily: c.mono ? `'JetBrains Mono', monospace` : 'inherit',
                fontSize: c.mono ? 12 : 13,
                color: dim ? T.ink3 : T.ink,
                fontWeight: bold ? 700 : 400,
              }}>
                {val}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Componentes BarChart, StackedBars, Toggle y GanttBar eliminados — no se
// usaban en ningun lado. Si en el futuro hace falta un grafico/toggle/gantt,
// reimplementar como componente focal en su pagina (eran genericos sin
// configuracion suficiente para reuso real).

export function Logo({ h = 30, dark, style }) {
  const src = dark ? '/assets/kamak-logo-light.png' : '/assets/kamak-logo.png';
  return <img src={src} alt="Kamak Desarrollos" style={{ height: h, width: 'auto', display: 'block', ...style }} />;
}

export function Stripes({ style }) {
  return (
    <div style={{ position: 'absolute', top: -80, right: -80, opacity: 0.12, pointerEvents: 'none', ...style }}>
      <svg viewBox="0 0 200 200" width="200" height="200">
        <g transform="rotate(62 100 100)">
          <rect x="-50" y="20" width="300" height="14" fill={T.accent} />
          <rect x="-50" y="50" width="300" height="14" fill={T.accent} />
          <rect x="-50" y="80" width="300" height="14" fill={T.accent} />
          <rect x="-50" y="110" width="300" height="14" fill={T.accent} />
          <rect x="-50" y="140" width="300" height="14" fill={T.accent} />
        </g>
      </svg>
    </div>
  );
}

export function Diamond({ size = 6, color = T.accent, style }) {
  return (
    <div style={{ width: size, height: size, background: color, transform: 'rotate(45deg)', flexShrink: 0, ...style }} />
  );
}
