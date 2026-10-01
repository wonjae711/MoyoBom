import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createPool, pingDb } from './db/pool.js';

const env = loadEnv();
const pool = createPool(env.DATABASE_URL);
const app = createApp({ checkDb: () => pingDb(pool) });
const server = createServer(app);

server.listen(env.PORT, () => {
  console.log(`[server] http://localhost:${env.PORT} 에서 실행 중`);
});

function shutdown(signal: string): void {
  console.log(`[server] ${signal} 수신, 종료합니다`);
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
