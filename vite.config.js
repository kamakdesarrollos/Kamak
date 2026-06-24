import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // PWA Fase 1: instalable + app shell. NO offline de datos (app en vivo).
    VitePWA({
      // ⚠️ SELF-DESTROYING: el service worker rompía la app en iOS Safari (pantalla
      // en blanco post-login). Este SW se DESREGISTRA solo y limpia los caches en
      // todos los dispositivos que lo carguen → restaura mobile. La PWA se vuelve a
      // introducir después, probada en mobile antes de prod.
      selfDestroying: true,
      registerType: 'autoUpdate',          // SW se actualiza solo (skipWaiting+claim)
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Kamak · Software de Gestión de Obras',
        short_name: 'Kamak',
        description: 'Gestión de obras — presupuestos, contratos, caja y obra.',
        lang: 'es',
        theme_color: '#1a9b9c',
        background_color: '#171818',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache de assets HASHEADOS (inmutables) → carga rápida. index.html NO
        // se precachea: las navegaciones van NetworkFirst para servir siempre el
        // HTML fresco online (no rompe el auto-reload tras deploy) y caer al último
        // shell cacheado solo si no hay red.
        globPatterns: ['**/*.{js,css,svg,png,woff2}'],
        // Desactivar el navigateFallback por defecto del plugin ('index.html'
        // cache-first): no precacheamos index.html y queremos que las navegaciones
        // las maneje SOLO el NetworkFirst de abajo (HTML fresco online).
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) => request.mode === 'navigate' && !url.pathname.startsWith('/api'),
            handler: 'NetworkFirst',
            options: { cacheName: 'kamak-shell', networkTimeoutSeconds: 3, expiration: { maxEntries: 8 } },
          },
        ],
        // /api/* y Supabase no tienen runtimeCaching → siempre pasan a la red.
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: { enabled: false },       // SW solo en build/prod, no en dev
    }),
  ],
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
