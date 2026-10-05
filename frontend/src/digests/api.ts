import { apiFetch } from '../api/client'
import { CATEGORY_LABELS, type CategoryCode } from '../feed/types'

// 백엔드 backend/src/routes/digests.ts, backend/src/digests/service.ts (F-09)

export interface Subscription {
  id: string
  categories: CategoryCode[]
  keywords: string[]
  /** 한국 시간 0~23시 정각 */
  sendHour: number
  active: boolean
  createdAt: string
}

export interface SubscriptionInput {
  categories: CategoryCode[]
  keywords: string[]
  sendHour: number
}

export interface DigestArticle {
  id: string
  title: string
  source: string
  link: string
}

export interface Digest {
  id: string
  subscriptionId: string | null
  kind: 'scheduled' | 'manual'
  /** 예약 실행의 받는 시각 ("지금 받아보기"는 null) */
  slot: string | null
  /** ok: AI 요약 / empty: 새 소식 없음 / failed: 요약 실패 — 기사 목록만 */
  status: 'ok' | 'empty' | 'failed'
  title: string
  summary: string | null
  articles: DigestArticle[]
  windowStart: string
  windowEnd: string
  readAt: string | null
  createdAt: string
}

export interface DigestPage {
  digests: Digest[]
  unread: number
  nextBefore: string | null
}

export const MAX_SUBSCRIPTIONS = 3

export function listSubscriptions(): Promise<Subscription[]> {
  return apiFetch<{ subscriptions: Subscription[] }>('/api/digests/subscriptions').then((r) => r.subscriptions)
}

export function createSubscription(input: SubscriptionInput): Promise<Subscription> {
  return apiFetch<{ subscription: Subscription }>('/api/digests/subscriptions', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((r) => r.subscription)
}

export function updateSubscription(id: string, patch: Partial<SubscriptionInput> & { active?: boolean }): Promise<Subscription> {
  return apiFetch<{ subscription: Subscription }>(`/api/digests/subscriptions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }).then((r) => r.subscription)
}

export function deleteSubscription(id: string): Promise<void> {
  return apiFetch(`/api/digests/subscriptions/${id}`, { method: 'DELETE' })
}

/** "지금 받아보기" (발표 시연용, 하루 횟수 제한) */
export function runNow(id: string): Promise<Digest> {
  return apiFetch<{ digest: Digest }>(`/api/digests/subscriptions/${id}/run`, { method: 'POST' }).then((r) => r.digest)
}

export function listDigests(options: { before?: string; limit?: number } = {}): Promise<DigestPage> {
  const params = new URLSearchParams()
  if (options.before) params.set('before', options.before)
  if (options.limit) params.set('limit', String(options.limit))
  const query = params.toString()
  return apiFetch<DigestPage>(`/api/digests${query ? `?${query}` : ''}`)
}

export function markRead(id: string): Promise<void> {
  return apiFetch(`/api/digests/${id}/read`, { method: 'POST' })
}

export function markAllRead(): Promise<void> {
  return apiFetch('/api/digests/read-all', { method: 'POST' })
}

/** 구독 주제 이름: "경제·IT·과학 + 반도체" (백엔드 topicName과 같게) */
export function topicName(sub: Pick<Subscription, 'categories' | 'keywords'>): string {
  const categories = sub.categories.map((c) => CATEGORY_LABELS[c] ?? c).join('·')
  return [categories, sub.keywords.join(', ')].filter(Boolean).join(' + ')
}

/** 0 → "오전 0시", 13 → "오후 1시" */
export function hourLabel(hour: number): string {
  if (hour === 0) return '오전 0시'
  if (hour < 12) return `오전 ${hour}시`
  if (hour === 12) return '낮 12시'
  return `오후 ${hour - 12}시`
}
