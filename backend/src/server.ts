import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { AuthService } from './auth/service.js';
import { loadEnv } from './config/env.js';
import { createPool, pingDb } from './db/pool.js';
import { listFeed, listSources } from './news/feed.js';
import { NewsEvents, createNewsCollector, startNewsSchedule } from './news/index.js';
import { attachSocketAuth } from './realtime/auth.js';
import { attachNewsFeed } from './realtime/newsFeed.js';
import { attachBoardSync, type BoardNotifier } from './realtime/boardSync.js';
import { BoardService } from './boards/service.js';
import { AiQuota } from './ai/quota.js';
import { createOpenAiClusterSummarizer, createOpenAiSummarizer } from './ai/summarizer.js';
import { createOpenAiEmbedder } from './ai/embedder.js';
import { createOpenAiAnswerer } from './ai/answerer.js';
import { QaService } from './qa/service.js';
import { createOpenAiDigestWriter } from './ai/digestWriter.js';
import { DigestService, MAX_SUBSCRIPTIONS, type DigestNotifier } from './digests/service.js';
import { startDigestSchedule } from './digests/schedule.js';
import { attachUserRooms } from './realtime/userRoom.js';
import { ClusterService } from './clusters/service.js';
import { LinkService } from './links/service.js';
import { PhotoService } from './photos/service.js';
import { createS3Storage } from './photos/storage.js';
import { startPhotoSweep } from './photos/schedule.js';

const env = loadEnv();
const pool = createPool(env.DATABASE_URL);
const newsEvents = new NewsEvents();
const authService = new AuthService({ pool, jwtSecret: env.JWT_SECRET });
const cookies = { secure: env.NODE_ENV === 'production' };
const boards = new BoardService(pool);
// 소켓 서버가 만들어진 뒤 채워지는 알림 대리자 (REST 라우터와 소켓 서버가 서로를 참조하므로)
const notifier: BoardNotifier = {
  boardRenamed: (...args) => boardNotifier.boardRenamed(...args),
  boardDeleted: (...args) => boardNotifier.boardDeleted(...args),
  membersChanged: (...args) => boardNotifier.membersChanged(...args),
  memberRemoved: (...args) => boardNotifier.memberRemoved(...args),
  cardAdded: (...args) => boardNotifier.cardAdded(...args),
  cardsMoved: (...args) => boardNotifier.cardsMoved(...args),
  clustersChanged: (...args) => boardNotifier.clustersChanged(...args),
};
const embedder = createOpenAiEmbedder(env.OPENAI_API_KEY);
const clusters = new ClusterService({
  pool,
  boards,
  embedder,
  summarizer: createOpenAiClusterSummarizer({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_SUMMARY_MODEL }),
  quota: new AiQuota(pool, { user: env.AI_CLUSTER_LIMIT_USER, ip: env.AI_CLUSTER_LIMIT_IP, total: env.AI_CLUSTER_LIMIT_TOTAL }),
  threshold: env.CLUSTER_SIMILARITY_THRESHOLD,
});
const qa = new QaService({
  pool,
  boards,
  embedder,
  answerer: createOpenAiAnswerer({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_SUMMARY_MODEL }),
  quota: new AiQuota(pool, { user: env.AI_QA_LIMIT_USER, ip: env.AI_QA_LIMIT_IP, total: env.AI_QA_LIMIT_TOTAL }),
  minSimilarity: env.QA_MIN_SIMILARITY,
});
// 다이제스트 알림도 소켓 서버가 만들어진 뒤 채워진다
const digestNotifier: DigestNotifier = { digestCreated: (...args) => userNotifier.digestCreated(...args) };
const digests = new DigestService({
  pool,
  writer: createOpenAiDigestWriter({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_SUMMARY_MODEL }),
  // 예약 실행은 계정당 구독 수만큼이 하루 상한 (IP 한도는 쓰지 않음)
  scheduledQuota: new AiQuota(pool, { user: MAX_SUBSCRIPTIONS, ip: Number.MAX_SAFE_INTEGER, total: env.AI_DIGEST_LIMIT_TOTAL }),
  manualQuota: new AiQuota(pool, {
    user: env.AI_DIGEST_NOW_LIMIT_USER,
    ip: env.AI_DIGEST_NOW_LIMIT_IP,
    total: env.AI_DIGEST_NOW_LIMIT_TOTAL,
  }),
  notifier: digestNotifier,
});
const links = new LinkService({
  pool,
  boards,
  summarizer: createOpenAiSummarizer({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_SUMMARY_MODEL }),
  quota: new AiQuota(pool, {
    user: env.AI_SUMMARY_LIMIT_USER,
    ip: env.AI_SUMMARY_LIMIT_IP,
    total: env.AI_SUMMARY_LIMIT_TOTAL,
  }),
});
const photos = env.PHOTO_BUCKET
  ? new PhotoService({ pool, boards, storage: createS3Storage({ bucket: env.PHOTO_BUCKET, region: env.AWS_REGION }) })
  : undefined;
if (!photos) console.log('[photos] 사진 카드 꺼짐 (PHOTO_BUCKET 없음)');
const app = createApp({
  checkDb: () => pingDb(pool),
  articles: { listFeed: (query) => listFeed(pool, query), listSources: () => listSources(pool) },
  auth: { auth: authService, jwtSecret: env.JWT_SECRET, cookies },
  oauth: {
    auth: authService,
    cookies,
    appOrigin: env.APP_ORIGIN,
    kakao:
      env.KAKAO_REST_API_KEY && env.KAKAO_CLIENT_SECRET
        ? {
            restApiKey: env.KAKAO_REST_API_KEY,
            clientSecret: env.KAKAO_CLIENT_SECRET,
            // 카카오 콘솔에 등록한 리다이렉트 URI와 정확히 같아야 한다 (KOE006)
            redirectUri: `${env.APP_ORIGIN}/api/auth/kakao/callback`,
          }
        : null,
    naver:
      env.NAVER_LOGIN_CLIENT_ID && env.NAVER_LOGIN_CLIENT_SECRET
        ? {
            clientId: env.NAVER_LOGIN_CLIENT_ID,
            clientSecret: env.NAVER_LOGIN_CLIENT_SECRET,
            // 네이버 개발자센터에 등록한 Callback URL과 같아야 한다
            redirectUri: `${env.APP_ORIGIN}/api/auth/naver/callback`,
          }
        : null,
  },
  boards: { boards, notifier, links, clusters, qa, photos },
  digests: { digests },
  appOrigin: env.APP_ORIGIN,
  trustProxy: env.TRUST_PROXY,
});
const server = createServer(app);

// 개발 중에는 Vite 프록시, 배포에서는 Caddy가 같은 출처로 연결하므로 CORS를 열지 않는다.
const io = new Server(server, { serveClient: false });
attachSocketAuth(io, { jwtSecret: env.JWT_SECRET, appOrigin: env.APP_ORIGIN });
attachNewsFeed(io, newsEvents);
const boardNotifier = attachBoardSync(io, boards, photos);
const userNotifier = attachUserRooms(io);
const digestSchedule = startDigestSchedule(digests);
const photoSweep = photos ? startPhotoSweep(photos) : null;

const newsSchedule = env.NEWS_COLLECTOR_ENABLED
  ? startNewsSchedule(createNewsCollector(env, pool, newsEvents), pool)
  : null;
if (!newsSchedule) console.log('[news] 자동 수집 꺼짐 (NEWS_COLLECTOR_ENABLED=false)');

server.listen(env.PORT, () => {
  console.log(`[server] http://localhost:${env.PORT} 에서 실행 중`);
});

function shutdown(signal: string): void {
  console.log(`[server] ${signal} 수신, 종료합니다`);
  void Promise.all([newsSchedule?.stop(), digestSchedule.stop(), photoSweep?.stop()]).finally(() => {
    // io.close()가 HTTP 서버도 함께 닫는다
    void io.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
