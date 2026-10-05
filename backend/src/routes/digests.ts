import { Router, type Response } from 'express';
import { z } from 'zod';
import { DigestError, type DigestService } from '../digests/service.js';
import { QuotaError } from '../links/service.js';
import { CATEGORIES } from '../news/types.js';

export interface DigestRouteDeps {
  digests: DigestService;
}

const isId = (value: string) => /^\d+$/.test(value);
const categoryCodes = CATEGORIES.map((c) => c.code) as [string, ...string[]];

const categories = z.array(z.enum(categoryCodes)).max(categoryCodes.length).transform((list) => [...new Set(list)]);
const keywords = z
  .array(z.string().trim().min(1, '빈 키워드는 넣을 수 없습니다').max(20, '키워드는 20자 이내로 입력해 주세요'))
  .max(5, '키워드는 5개까지 넣을 수 있습니다')
  .transform((list) => [...new Set(list)]);
const sendHour = z.number().int().min(0).max(23);

const createSchema = z
  .object({ categories: categories.default([]), keywords: keywords.default([]), sendHour })
  .refine((s) => s.categories.length > 0 || s.keywords.length > 0, { message: '카테고리나 키워드를 하나 이상 골라 주세요' });
const updateSchema = z
  .object({ categories: categories.optional(), keywords: keywords.optional(), sendHour: sendHour.optional(), active: z.boolean().optional() })
  .refine((s) => !(s.categories?.length === 0 && s.keywords?.length === 0), { message: '카테고리나 키워드를 하나 이상 골라 주세요' });

function sendError(res: Response, error: unknown): void {
  if (!(error instanceof DigestError)) throw error;
  res.status(error.code === 'not_found' ? 404 : 400).json({ error: error.message, code: error.code });
}

/** /api/digests — 뉴스 다이제스트 구독·알림함 (F-09). 모두 로그인 필요, 본인 것만 */
export function createDigestsRouter({ digests }: DigestRouteDeps): Router {
  const router = Router();
  router.param('id', (_req, res, next, value: string) => {
    if (isId(value)) next();
    else res.status(404).json({ error: '찾을 수 없습니다', code: 'not_found' });
  });

  router.get('/subscriptions', async (_req, res) => {
    res.json({ subscriptions: await digests.listSubscriptions(res.locals.userId!) });
  });

  router.post('/subscriptions', async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message ?? '입력값을 확인해 주세요' });
    try {
      res.status(201).json({ subscription: await digests.createSubscription(res.locals.userId!, parsed.data) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.patch('/subscriptions/:id', async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message ?? '입력값을 확인해 주세요' });
    try {
      res.json({ subscription: await digests.updateSubscription(res.locals.userId!, req.params.id, parsed.data) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete('/subscriptions/:id', async (req, res) => {
    try {
      await digests.deleteSubscription(res.locals.userId!, req.params.id);
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  });

  /** "지금 받아보기" (발표 시연용) */
  router.post('/subscriptions/:id/run', async (req, res) => {
    try {
      res.status(201).json({ digest: await digests.runNow(res.locals.userId!, req.params.id, req.ip ?? 'unknown') });
    } catch (error) {
      if (error instanceof QuotaError) return void res.status(429).json({ error: error.message, code: 'quota', scope: error.scope });
      sendError(res, error);
    }
  });

  router.get('/', async (req, res) => {
    const before = typeof req.query.before === 'string' && isId(req.query.before) ? req.query.before : undefined;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    res.json(await digests.listDigests(res.locals.userId!, { before, limit }));
  });

  router.post('/read-all', async (_req, res) => {
    await digests.markAllRead(res.locals.userId!);
    res.status(204).end();
  });

  router.post('/:id/read', async (req, res) => {
    try {
      await digests.markRead(res.locals.userId!, req.params.id);
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
