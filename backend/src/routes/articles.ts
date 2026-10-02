import { Router } from 'express';
import { z } from 'zod';
import { decodeCursor, type FeedPage, type FeedQuery } from '../news/feed.js';
import { CATEGORIES } from '../news/types.js';

const categoryCodes = CATEGORIES.map((c) => c.code) as [string, ...string[]];

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.string().optional(),
  category: z.enum(categoryCodes).optional(),
});

export interface ArticlesRouteDeps {
  listFeed: (query: FeedQuery) => Promise<FeedPage>;
}

/** GET /api/articles?limit=30&category=economy&before=<nextCursor> */
export function createArticlesRouter(deps: ArticlesRouteDeps): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: '잘못된 요청 파라미터', fields: parsed.error.issues.map((i) => i.path.join('.')) });
      return;
    }

    const { limit, before, category } = parsed.data;
    const cursor = before ? decodeCursor(before) : undefined;
    if (before && !cursor) {
      res.status(400).json({ error: '잘못된 요청 파라미터', fields: ['before'] });
      return;
    }

    const page = await deps.listFeed({
      limit,
      before: cursor ?? undefined,
      category: category as FeedQuery['category'],
    });
    res.json(page);
  });

  return router;
}
