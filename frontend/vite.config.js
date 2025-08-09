// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    host: true,            // listen on 0.0.0.0 inside the container
    port: 5173,
    strictPort: true,
    allowedHosts: [
      '.',
    ],
    proxy: {
      '/clientid': 'http://localhost:8080',
      '/orders': 'http://localhost:8080',
      '^/capture/.*': 'http://localhost:8080',
    },
  },
})
