import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vitest config integrada (item 5.1).
  test: {
    globals: true,
    environment: 'node',
    // src/ (front) + lib/ (módulos compartidos) + api/ (handlers serverless).
    include: ['src/**/*.{test,spec}.{js,jsx}', 'lib/**/*.{test,spec}.{js,jsx}', 'api/**/*.{test,spec}.{js,jsx}'],
  },
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
            if (id.includes('/xlsx/')) return 'xlsx';
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
