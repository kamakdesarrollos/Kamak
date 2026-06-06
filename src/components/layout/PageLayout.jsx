import { useState } from 'react';
import Topbar from './Topbar';
import Sidebar from './Sidebar';
import { useIsMobile } from '../../hooks/useMediaQuery';

export default function PageLayout({ breadcrumb = [], children, active }) {
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Desktop: render IDÉNTICO al original (sidebar en flujo, .k-content sin
  // overrides). Mobile: el Sidebar sale del flujo y se muestra como drawer
  // fijo con backdrop; el contenido ocupa todo el ancho.
  return (
    <div className="k-page" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Topbar breadcrumb={breadcrumb} isMobile={isMobile} onHamburger={() => setDrawerOpen(v => !v)} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: isMobile ? 'relative' : undefined }}>
        {!isMobile && <Sidebar active={active} />}
        {isMobile && drawerOpen && (
          <>
            <div
              onClick={() => setDrawerOpen(false)}
              style={{ position: 'fixed', inset: 0, top: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1400 }}
            />
            <div style={{ position: 'fixed', left: 0, top: 0, bottom: 0, width: 'min(82vw, 300px)', zIndex: 1401, boxShadow: '4px 0 24px rgba(0,0,0,0.3)', overflowY: 'auto' }}>
              <Sidebar active={active} onNavigate={() => setDrawerOpen(false)} />
            </div>
          </>
        )}
        <div className="k-content" style={isMobile
          ? { padding: 12, background: '#fbf8ef', position: 'relative', flex: 1, overflow: 'auto' }
          : { padding: 18, background: '#fbf8ef', position: 'relative' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
