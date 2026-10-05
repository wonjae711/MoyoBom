import { Router } from 'express';
import { z } from 'zod';
import { decodeCollectedCursor, decodeCursor, type FeedPage, type FeedQuery, type SourceCount } from '../news/feed.js';
import { CATEGORIES } from '../news/types.js';

const categoryCodes = CATEGORIES.map((c) => c.code) as [string, ...string[]];

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.string().optional(),
  collectedAfter: z.string().optional(),
  category: z.enum(categoryCodes).optional(),
  // F-04 검색·필터
  q: z.string().trim().max(100).optional(),
  source: z.string().trim().min(1).max(100).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

/** 날짜(YYYY-MM-DD)를 한국 시간 그날 0시로 바꾼다. to는 그다음 날 0시(그날 하루 전체 포함) */
const kstDayStart = (date: string, plusDays = 0) => new Date(new Date(`${date}T00:00:00+09:00`).getTime() + plusDays * 86_400_000);

export interface ArticlesRouteDeps {
  listFeed: (query: FeedQuery) => Promise<FeedPage>;
  /** 언론사 필터 목록 (없으면 빈 목록) */
  listSources?: () => Promise<SourceCount[]>;
}

/**
 * GET /api/articles?limit=30&category=economy&before=<nextCursor>   — 발행 최신순 (처음 화면, 더 보기)
 * GET /api/articles?limit=100&collectedAfter=<collectedCursor>      — 그 뒤에 수집된 기사, 수집 순 (재연결 시 누락분 보완)
 * 두 방식 모두 검색·필터를 함께 쓸 수 있다 (F-04): q(검색어), category, source(언론사), from·to(발행일, 한국 시간 날짜)
 * GET /api/articles/sources                                         — 언론사 필터 목록
 */
export function createArticlesRouter(deps: ArticlesRouteDeps): Router {
  const router = Router();

  router.get('/sources', async (_req, res) => {
    res.json({ sources: deps.listSources ? await deps.listSources() : [] });
  });

  router.get('/', async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: '잘못된 요청 파라미터', fields: parsed.error.issues.map((i) => i.path.join('.')) });
      return;
    }

    const { limit, before, collectedAfter, category, q, source, from, to } = parsed.data;
    if (from && to && from > to) {
      res.status(400).json({ error: '기간의 시작이 끝보다 늦습니다', fields: ['from'] });
      return;
    }
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
      ...(q ? { q } : {}),
      ...(source ? { source } : {}),
      ...(from ? { from: kstDayStart(from) } : {}),
      ...(to ? { to: kstDayStart(to, 1) } : {}),
    });
    res.json(page);
  });

  return router;
}
