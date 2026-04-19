import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'Rodinné úkoly',
          short_name: 'Úkoly',
          description: 'Sdílený úkolovník pro rodinu',
          theme_color: '#0c1017',
          background_color: '#0c1017',
          display: 'standalone',
          orientation: 'portrait',
          lang: 'cs',
          icons: [
            {
              src: 'icon-192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'icon-512.png',
              sizes: '512x512',
              type: 'image/png'
            },
            {
              src: 'icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        }
      }),
      // Plugin to inject env vars into sw-polling.js
      {
        name: 'inject-sw-env',
        writeBundle() {
          const swPath = resolve('dist', 'sw-polling.js')
          try {
            let content = readFileSync(swPath, 'utf-8')
            content = content.replace('__SUPABASE_URL__', env.VITE_SUPABASE_URL || '')
            content = content.replace('__SUPABASE_KEY__', env.VITE_SUPABASE_ANON_KEY || '')
            writeFileSync(swPath, content)
            console.log('✅ SW env vars injected')
          } catch (e) {
            console.warn('⚠️ Could not inject SW env vars:', e.message)
          }
        }
      }
    ]
  }
})
