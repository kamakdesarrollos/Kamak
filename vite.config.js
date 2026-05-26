import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Source maps ocultos: se generan pero no se sirven al cliente
    // (utiles para debugging / Sentry; no aumentan el bundle visible).
    sourcemap: 'hidden',
    // Code splitting: separar deps grandes en chunks propios para que
    // se cacheen aparte y el bundle inicial baje.
    // Nota: Vite 8 / rolldown exige manualChunks como funcion (no objeto).
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@supabase')) return 'supabase';
            if (id.includes('jszip')) return 'jszip';
            if (id.includes('react-router')) return 'router';
            if (id.includes('react-dom') || (/\/react\//.test(id) && !id.includes('react-router'))) return 'react';
          }
        },
      },
    },
  },
  esbuild: {
    // En prod, eliminar debugger statements y console.log/info/debug.
    // Mantenemos console.error y console.warn (utiles para diagnosticar).
    drop: ['debugger'],
    pure: ['console.log', 'console.info', 'console.debug'],
  },
})
