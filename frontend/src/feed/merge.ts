import type { FeedArticle } from './types'

/** 화면에 들고 있는 최대 기사 수 (오래 켜 둬도 메모리가 계속 늘지 않도록) */
export const MAX_FEED_ITEMS = 500

/** 최신순, 같은 시각이면 id 큰 순 (백엔드 compareFeed와 같은 순서) */
export function compareFeed(a: FeedArticle, b: FeedArticle): number {
  if (a.publishedAt !== b.publishedAt) return a.publishedAt < b.publishedAt ? 1 : -1
  return Number(b.id) - Number(a.id)
}

/**
 * 기존 목록에 새로 받은 기사를 합친다. 같은 id는 한 번만 남기고 최신순으로 정렬한다.
 * 실시간 이벤트와 재연결 후 REST 재조회가 같은 기사를 다시 보내도 중복되지 않는다.
 */
export function mergeArticles(
  current: FeedArticle[],
  incoming: FeedArticle[],
  max = MAX_FEED_ITEMS,
): FeedArticle[] {
  const byId = new Map(current.map((a) => [a.id, a]))
  for (const article of incoming) byId.set(article.id, article)
  return [...byId.values()].sort(compareFeed).slice(0, max)
}

/** "방금 전", "5분 전", "3시간 전", 그 이후는 날짜 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const diffMinutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000)
  if (diffMinutes < 1) return '방금 전'
  if (diffMinutes < 60) return `${diffMinutes}분 전`
  if (diffMinutes < 24 * 60) return `${Math.floor(diffMinutes / 60)}시간 전`
  const date = new Date(iso)
  return `${date.getMonth() + 1}월 ${date.getDate()}일`
}
