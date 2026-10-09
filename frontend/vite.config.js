import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const api = process.env.VITE_API_PROXY || 'http://localhost:4000'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: api, changeOrigin: true } } },
  preview: { port: 5173, proxy: { '/api': { target: api, changeOrigin: true } } },
})
