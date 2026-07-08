import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  // Load environment variables from the project root directory
  const env = loadEnv(mode, path.resolve(__dirname, '../../'), '')
  const veronaPort = env.VERONA_PORT || '8080'
  const backendUrl = `http://localhost:${veronaPort}`

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(__dirname, './src') } },
    server: {
      proxy: {
        '/api': backendUrl,
        '/hub': { target: backendUrl, ws: true }
      }
    }
  }
})
