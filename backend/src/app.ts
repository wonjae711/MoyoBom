import express, { type Express } from 'express';

export interface AppDeps {
  /** DB 연결 상태 확인. 테스트에서는 가짜 함수를 주입한다. */
  checkDb: () => Promise<boolean>;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', async (_req, res) => {
    const db = await deps.checkDb();
    res.status(db ? 200 : 503).json({ status: db ? 'ok' : 'degraded', db });
  });

  return app;
}
