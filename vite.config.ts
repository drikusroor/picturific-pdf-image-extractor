import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/picturific-pdf-image-extractor/',
  server: { port: 5173 },
  build: {
    rollupOptions: {},
    worker: {
      format: 'es'
    }
  }
})
