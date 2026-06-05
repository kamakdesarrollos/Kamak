import { Component } from 'react';
import { isChunkError, tryReloadForChunk } from '../lib/chunkReload';

// ErrorBoundary: captura cualquier error de render que pase debajo de el
// y muestra un mensaje util en lugar de la pantalla en blanco (default
// behavior de React cuando un componente lanza una exception).
//
// Tambien loguea el error en consola para que aparezca en DevTools y
// podamos diagnosticar despues.

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error, isChunk: isChunkError(error) };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Error capturado:', error);
    console.error('[ErrorBoundary] Stack:', info?.componentStack);

    // Chunk/módulo que ya no existe (típico tras un deploy: el index apunta a JS
    // con otro hash). React lo atrapa acá y NO llega al window.onerror de
    // main.jsx. Recargamos (reintentos acotados, lib/chunkReload) — el usuario ve
    // la pantalla amable "Actualizando…", nunca el cartel de error técnico.
    if (isChunkError(error)) { tryReloadForChunk(); return; }

    this.setState({ info });
  }

  reset = () => {
    this.setState({ error: null, info: null });
  };

  reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    // Chunk faltante tras un deploy: pantalla amable de "actualizando" (se está
    // recargando solo). NUNCA el cartel de error técnico — no es un error real.
    if (this.state.isChunk) {
      return (
        <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Montserrat, system-ui, sans-serif', textAlign: 'center', gap: 12 }}>
          <div style={{ fontSize: 40 }}>🔄</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#2d2d2d' }}>Actualizando Kamak…</div>
          <div style={{ fontSize: 13, color: '#5a5a58', maxWidth: 420 }}>
            Salió una versión nueva. La estamos cargando, esperá un segundo.
          </div>
          <button onClick={this.reload}
            style={{ padding: '8px 16px', border: 'none', background: '#1a9b9c', color: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 700, marginTop: 6 }}>
            Recargar ahora
          </button>
          <div style={{ fontSize: 11, color: '#9a9892', maxWidth: 420 }}>
            Si no carga en unos segundos, recargá con Ctrl+Shift+R o borrá los datos del sitio.
          </div>
        </div>
      );
    }

    return (
      <div style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: 'Montserrat, system-ui, sans-serif',
        textAlign: 'center',
        gap: 14,
      }}>
        <div style={{ fontSize: 48 }}>⚠️</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#2d2d2d' }}>
          Hubo un error en esta pantalla
        </div>
        <div style={{ fontSize: 13, color: '#5a5a58', maxWidth: 440 }}>
          {this.state.error.message || 'Error desconocido.'}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <button
            onClick={this.reset}
            style={{ padding: '8px 16px', border: '1.5px solid #d4cfbf', background: 'transparent', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#2d2d2d' }}
          >
            Intentar de nuevo
          </button>
          <button
            onClick={this.reload}
            style={{ padding: '8px 16px', border: 'none', background: '#1a9b9c', color: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
          >
            Recargar la app
          </button>
        </div>
        <details style={{ marginTop: 20, fontSize: 11, color: '#9a9892', maxWidth: 600, textAlign: 'left' }}>
          <summary style={{ cursor: 'pointer', fontFamily: 'monospace' }}>Detalle técnico (para diagnóstico)</summary>
          <pre style={{
            background: '#1e1e22',
            color: '#fff',
            padding: 12,
            borderRadius: 4,
            fontSize: 10,
            overflow: 'auto',
            marginTop: 8,
            maxHeight: 300,
          }}>
{this.state.error.stack || this.state.error.message}
{this.state.info?.componentStack}
          </pre>
        </details>
      </div>
    );
  }
}
