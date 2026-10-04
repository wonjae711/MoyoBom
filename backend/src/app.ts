import express, { type ErrorRequestHandler, type Express } from 'express';
import { checkOrigin, requireAuth } from './auth/http.js';
import { createArticlesRouter, type ArticlesRouteDeps } from './routes/articles.js';
import { createAuthRouter, type AuthRouteDeps } from './routes/auth.js';
import { createOAuthRouter, type OAuthRouteDeps } from './routes/oauth.js';

export interface AppDeps {
  /** DB 연결 상태 확인. 테스트에서는 가짜 함수를 주입한다. */
  checkDb: () => Promise<boolean>;
  articles: ArticlesRouteDeps;
  auth: AuthRouteDeps;
  oauth: OAuthRouteDeps;
  appOrigin: string;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', checkOrigin(deps.appOrigin));

  app.get('/api/health', async (_req, res) => {
    const db = await deps.checkDb();
    res.status(db ? 200 : 503).json({ status: db ? 'ok' : 'degraded', db });
  });

  app.use('/api/auth', createAuthRouter(deps.auth));
  app.use('/api/auth', createOAuthRouter(deps.oauth));
  app.use('/api/articles', requireAuth(deps.auth.jwtSecret), createArticlesRouter(deps.articles));

  // 처리되지 않은 에러: 내부 메시지는 로그에만 남기고 응답에는 노출하지 않는다
  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    console.error('[api]', error instanceof Error ? error.message : error);
    res.status(500).json({ error: '서버 오류' });
  };
  app.use(onError);

  return app;
}
