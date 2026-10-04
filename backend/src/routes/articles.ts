import { Router } from 'express';
import { z } from 'zod';
import { decodeCollectedCursor, decodeCursor, type FeedPage, type FeedQuery } from '../news/feed.js';
import { CATEGORIES } from '../news/types.js';

const categoryCodes = CATEGORIES.map((c) => c.code) as [string, ...string[]];

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.string().optional(),
  collectedAfter: z.string().optional(),
  category: z.enum(categoryCodes).optional(),
});

export interface ArticlesRouteDeps {
  listFeed: (query: FeedQuery) => Promise<FeedPage>;
}

/**
 * GET /api/articles?limit=30&category=economy&before=<nextCursor>   — 발행 최신순 (처음 화면, 더 보기)
 * GET /api/articles?limit=100&collectedAfter=<collectedCursor>      — 그 뒤에 수집된 기사, 수집 순 (재연결 시 누락분 보완)
 */
export function createArticlesRouter(deps: ArticlesRouteDeps): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: '잘못된 요청 파라미터', fields: parsed.error.issues.map((i) => i.path.join('.')) });
      return;
    }

    const { limit, before, collectedAfter, category } = parsed.data;
    const cursor = before ? decodeCursor(before) : undefined;
    const after = collectedAfter ? decodeCollectedCursor(collectedAfter) : undefined;
    // before와 collectedAfter는 정렬 기준이 달라 같이 쓸 수 없다
    const invalidField = before && !cursor ? 'before' : collectedAfter && (!after || before) ? 'collectedAfter' : null;
    if (invalidField) {
      res.status(400).json({ error: '잘못된 요청 파라미터', fields: [invalidField] });
      return;
    }

    const page = await deps.listFeed({
      limit,
      before: cursor ?? undefined,
      collectedAfter: after ?? undefined,
      category: category as FeedQuery['category'],
    });
    res.json(page);
  });

  return router;
}
