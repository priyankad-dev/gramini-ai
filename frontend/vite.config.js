import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Lets the phone on the same wifi open the app for a real-device demo.
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      // Pre-recorded speech, served by the backend as static WAV files.
      // Without this rule Vite answers /audio/* with its SPA fallback, so the
      // offline voice fallback silently receives index.html instead of audio.
      '/audio': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
