import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Installable app that works offline: a manifest (name, icons) and a service worker that keeps a copy
    // of the app's files. A new version waits until the player chooses to reload (see UpdateNotice), so a
    // quiz in progress is never cut off; otherwise it takes over the next time the app is opened.
    VitePWA({
      registerType: 'prompt',
      // Registered from the app (useRegisterSW in UpdateNotice), which also shows the update notice
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Map Memory',
        short_name: 'Map Memory',
        description: 'Learn the map: explore, quizzes and a daily challenge.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        theme_color: '#f6f5f1',
        background_color: '#f6f5f1',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Every file of the app, maps included, so it all works offline (the icons are added from
        // includeAssets and the manifest). Photos come from Wikimedia and aren't kept: they show only
        // with a connection.
        globPatterns: ['**/*.{js,css,html}'],
      },
    }),
  ],
})
