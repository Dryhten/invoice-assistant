import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '')
  const webPort = Number(env.WEB_PORT || '5173')

  return {
    plugins: [vue()],
    server: {
      port: webPort,
      strictPort: false,
    },
    preview: {
      port: webPort,
      strictPort: false,
    },
    test: {
      environment: 'jsdom',
    },
  }
})
