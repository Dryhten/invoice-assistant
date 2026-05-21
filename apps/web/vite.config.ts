import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { config as loadDotenv } from 'dotenv'
import { resolve } from 'node:path'

loadDotenv({ path: resolve(__dirname, '../../.env') })

const apiPort = process.env.PORT || '3001'
const webPort = Number(process.env.WEB_PORT || '5173')

export default defineConfig({
  plugins: [vue()],
  server: {
    port: webPort,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
  },
})
