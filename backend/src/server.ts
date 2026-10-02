import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createPool, pingDb } from './db/pool.js';
import { listFeed } from './news/feed.js';
import { NewsEvents, createNewsCollector, startNewsSchedule } from './news/index.js';
import { attachNewsFeed } from './realtime/newsFeed.js';

const env = loadEnv();
const pool = createPool(env.DATABASE_URL);
const newsEvents = new NewsEvents();
const app = createApp({
  checkDb: () => pingDb(pool),
  articles: { listFeed: (query) => listFeed(pool, query) },
});
const server = createServer(app);

// 개발 중에는 Vite 프록시, 배포에서는 nginx가 같은 출처로 연결하므로 CORS를 열지 않는다.
// TODO(F-07): 보드 room 도입 시 연결 단계에서 JWT 검증 (설계 원칙 5)
const io = new Server(server, { serveClient: false });
attachNewsFeed(io, newsEvents);

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
    // io.close()가 HTTP 서버도 함께 닫는다
    void io.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
