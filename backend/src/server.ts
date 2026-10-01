import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createPool, pingDb } from './db/pool.js';
import { NewsEvents, createNewsCollector, startNewsSchedule } from './news/index.js';

const env = loadEnv();
const pool = createPool(env.DATABASE_URL);
const newsEvents = new NewsEvents();
const app = createApp({ checkDb: () => pingDb(pool) });
const server = createServer(app);

const newsSchedule = env.NEWS_COLLECTOR_ENABLED
  ? startNewsSchedule(createNewsCollector(env, pool, newsEvents))
  : null;
if (!newsSchedule) console.log('[news] 자동 수집 꺼짐 (NEWS_COLLECTOR_ENABLED=false)');

server.listen(env.PORT, () => {
  console.log(`[server] http://localhost:${env.PORT} 에서 실행 중`);
});

function shutdown(signal: string): void {
  console.log(`[server] ${signal} 수신, 종료합니다`);
  void (newsSchedule?.stop() ?? Promise.resolve()).finally(() => {
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
