import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const BACKEND = 'http://localhost:4000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 파일을 쓰는 도중(비어 있는 순간)을 읽어 기억하지 않도록, 크기가 멈출 때까지 기다렸다가 읽는다
    // (Windows에서 반쯤 쓴 파일이 남아 화면이 꺼졌던 일 — 2026-10-06)
    watch: { awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 } },
    // 개발 중 /api 요청과 Socket.io(WebSocket) 연결을 백엔드(4000)로 전달
    proxy: {
      '/api': BACKEND,
      '/socket.io': { target: BACKEND, ws: true },
    },
  },
})
