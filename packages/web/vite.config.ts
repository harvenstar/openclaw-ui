import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API_PORT = process.env.AGENTCLICK_PORT || process.env.PORT || '38173'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${API_PORT}`,
    },
  }
})
