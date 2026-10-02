import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { LoginRateLimiter } from './auth/rateLimit.js';
import { AuthService } from './auth/service.js';
import { loadEnv } from './config/env.js';
import { createPool, pingDb } from './db/pool.js';
import { listFeed } from './news/feed.js';
import { NewsEvents, createNewsCollector, startNewsSchedule } from './news/index.js';
import { attachSocketAuth } from './realtime/auth.js';
import { attachNewsFeed } from './realtime/newsFeed.js';

const env = loadEnv();
const pool = createPool(env.DATABASE_URL);
const newsEvents = new NewsEvents();
const app = createApp({
  checkDb: () => pingDb(pool),
  articles: { listFeed: (query) => listFeed(pool, query) },
  auth: {
    auth: new AuthService({ pool, jwtSecret: env.JWT_SECRET }),
    loginLimiter: new LoginRateLimiter(),
    jwtSecret: env.JWT_SECRET,
    cookies: { secure: env.NODE_ENV === 'production' },
  },
  appOrigin: env.APP_ORIGIN,
});
const server = createServer(app);

// 개발 중에는 Vite 프록시, 배포에서는 nginx가 같은 출처로 연결하므로 CORS를 열지 않는다.
const io = new Server(server, { serveClient: false });
attachSocketAuth(io, { jwtSecret: env.JWT_SECRET, appOrigin: env.APP_ORIGIN });
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
