import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: ['@earendil-works/pi-agent-core', '@earendil-works/pi-ai']
      }
    }
  },
  preload: {},
  renderer: {
    plugins: [react()]
  }
})
