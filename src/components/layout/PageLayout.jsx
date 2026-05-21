import Topbar from './Topbar';
import Sidebar from './Sidebar';

export default function PageLayout({ breadcrumb = [], children, active }) {
  return (
    <div className="k-page" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Topbar breadcrumb={breadcrumb} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar active={active} />
        <div className="k-content" style={{ padding: 18, background: '#fbf8ef', position: 'relative' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
