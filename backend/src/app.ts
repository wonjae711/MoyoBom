import express, { type ErrorRequestHandler, type Express } from 'express';
import { checkOrigin, requireAuth } from './auth/http.js';
import { createArticlesRouter, type ArticlesRouteDeps } from './routes/articles.js';
import { createAuthRouter, type AuthRouteDeps } from './routes/auth.js';
import { createBoardsRouter, createInvitesRouter, type BoardRouteDeps } from './routes/boards.js';
import { createDigestsRouter, type DigestRouteDeps } from './routes/digests.js';
import { createOAuthRouter, type OAuthRouteDeps } from './routes/oauth.js';

export interface AppDeps {
  /** DB 연결 상태 확인. 테스트에서는 가짜 함수를 주입한다. */
  checkDb: () => Promise<boolean>;
  articles: ArticlesRouteDeps;
  auth: AuthRouteDeps;
  oauth: OAuthRouteDeps;
  boards: BoardRouteDeps;
  /** 뉴스 다이제스트(F-09). 없으면 해당 API를 열지 않는다 */
  digests?: DigestRouteDeps;
  appOrigin: string;
  /** Express 'trust proxy' 값. 기본 loopback(개발: Vite 프록시), 배포(Docker)에서는 Caddy 컨테이너가 사설 IP라 uniquelocal */
  trustProxy?: string;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  // 우리 프록시(개발: Vite, 배포: Caddy)가 붙인 X-Forwarded-For만 믿는다 — req.ip가 실제 접속자 IP가 되도록 (AI 한도·로그인 제한)
  app.set('trust proxy', deps.trustProxy ?? 'loopback');
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', checkOrigin(deps.appOrigin));

  app.get('/api/health', async (_req, res) => {
    const db = await deps.checkDb();
    res.status(db ? 200 : 503).json({ status: db ? 'ok' : 'degraded', db });
  });

  app.use('/api/auth', createAuthRouter(deps.auth));
  app.use('/api/auth', createOAuthRouter(deps.oauth));
  const authed = requireAuth(deps.auth.jwtSecret);
  app.use('/api/articles', authed, createArticlesRouter(deps.articles));
  app.use('/api/boards', authed, createBoardsRouter(deps.boards));
  app.use('/api/invites', authed, createInvitesRouter(deps.boards));
  if (deps.digests) app.use('/api/digests', authed, createDigestsRouter(deps.digests));

  // 처리되지 않은 에러: 내부 메시지는 로그에만 남기고 응답에는 노출하지 않는다
  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    console.error('[api]', error instanceof Error ? error.message : error);
    res.status(500).json({ error: '서버 오류' });
  };
  app.use(onError);

  return app;
}
