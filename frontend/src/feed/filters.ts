import type { CategoryCode, FeedArticle } from './types'

/** 피드 검색·필터 조건 (F-04). 서버 GET /api/articles의 q·category·source(여러 개)·from·to와 같다 */
export interface FeedFilters {
  q?: string
  category?: CategoryCode
  /** 언론사 여러 곳 중 하나 (B4) */
  sources?: string[]
  /** 발행일 시작 (YYYY-MM-DD, 한국 시간) */
  from?: string
}

export type Period = 'all' | 'today' | '7d' | '30d'

export const PERIOD_LABELS: Record<Period, string> = {
  all: '전체 기간',
  today: '오늘',
  '7d': '최근 7일',
  '30d': '최근 30일',
}

/** 기간 선택 → 시작 날짜 (오늘 포함, 브라우저 날짜 기준) */
export function periodStart(period: Period, now = new Date()): string | undefined {
  const days = period === 'today' ? 0 : period === '7d' ? 6 : period === '30d' ? 29 : null
  if (days === null) return undefined
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 서버와 같은 규칙으로 검색어를 낱말로 나눈다 (backend/src/news/feed.ts searchTerms) */
export function searchTerms(q: string | undefined): string[] {
  if (!q) return []
  return q
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 5)
}

export function hasFilters(filters: FeedFilters): boolean {
  return Boolean(searchTerms(filters.q).length || filters.category || filters.sources?.length || filters.from)
}

/** 요청 주소에 붙일 조건 — 언론사는 source=를 여러 번 붙인다 */
export function filterParams(filters: FeedFilters): [string, string][] {
  const params: [string, string][] = []
  const q = searchTerms(filters.q).join(' ')
  if (q) params.push(['q', q])
  if (filters.category) params.push(['category', filters.category])
  for (const source of filters.sources ?? []) params.push(['source', source])
  if (filters.from) params.push(['from', filters.from])
  return params
}

/**
 * 실시간으로 들어온 기사가 지금 조건에 맞는지 (서버 조회와 같은 규칙).
 * 영문은 대소문자를 가리지 않는다. 기간은 시작 날짜 0시(한국 시간) 이후 발행
 */
export function matchesFilters(article: FeedArticle, filters: FeedFilters): boolean {
  if (filters.category && article.category !== filters.category) return false
  if (filters.sources?.length && !filters.sources.includes(article.source)) return false
  if (filters.from && Date.parse(article.publishedAt) < Date.parse(`${filters.from}T00:00:00+09:00`)) return false
  const text = `${article.title} ${article.description}`.toLowerCase()
  return searchTerms(filters.q).every((term) => text.includes(term.toLowerCase()))
}

/** 화면에서 고른 검색·필터 상태 */
export interface FilterState {
  q: string
  category?: CategoryCode
  sources: string[]
  period: Period
}

export const emptyFilterState = (): FilterState => ({ q: '', sources: [], period: 'all' })

/** 화면의 선택 상태 → 조회 조건 */
export function toFeedFilters(state: FilterState): FeedFilters {
  return {
    ...(state.q.trim() ? { q: state.q.trim() } : {}),
    ...(state.category ? { category: state.category } : {}),
    ...(state.sources.length ? { sources: [...state.sources].sort() } : {}),
    ...(periodStart(state.period) ? { from: periodStart(state.period) } : {}),
  }
}

