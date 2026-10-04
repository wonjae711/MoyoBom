import type { FeedArticle, FeedPage } from './types'

/**
 * 재연결 시 누락분 보완 (C-10).
 * 서버의 수집 순서 커서는 "수집 시각(epoch 마이크로초)_id" 문자열이다 (backend/src/news/feed.ts).
 * 화면은 마지막으로 받은 수집 위치를 기억해 두고, 다시 연결되면 그 뒤에 수집된 기사를 수집 순서대로 끝까지 받는다.
 * 발행 시각이 오래됐지만 늦게 수집된 기사도 이 방법으로 빠지지 않는다.
 */

/** 한 번 보완할 때 받는 최대 페이지 수. 넘으면 이어 받지 않고 목록을 최신 페이지로 새로 시작한다 */
export const MAX_CATCH_UP_PAGES = 5
export const CATCH_UP_PAGE_SIZE = 100
/**
 * 시작 위치를 이만큼 앞당겨 겹치게 받는다. created_at은 트랜잭션 시작 시각이라
 * 동시에 저장한 다른 수집 작업의 기사가 "이미 받은 위치"보다 앞선 시각으로 늦게 보일 수 있기 때문 (중복은 id로 합쳐짐)
 */
export const CATCH_UP_OVERLAP_MS = 60_000

interface Position {
  micros: number
  id: number
}

function parse(cursor: string): Position | null {
  const match = /^(\d+)_(\d+)$/.exec(cursor)
  return match ? { micros: Number(match[1]), id: Number(match[2]) } : null
}

/** 실시간 이벤트로 받은 기사의 수집 위치 (collectedAt은 밀리초까지라 같은 밀리초 안의 뒤쪽 기사는 겹침 구간이 받아 준다) */
export function cursorOf(article: FeedArticle): string {
  return `${Date.parse(article.collectedAt) * 1000}_${article.id}`
}

/** 두 위치 중 더 뒤의 것 */
export function laterCursor(a: string | null, b: string | null): string | null {
  const pa = a ? parse(a) : null
  const pb = b ? parse(b) : null
  if (!pa) return pb ? b : null
  if (!pb) return a
  if (pa.micros !== pb.micros) return pa.micros > pb.micros ? a : b
  return pa.id >= pb.id ? a : b
}

/** 보완 조회 시작 위치: 기억한 위치에서 겹침 시간만큼 앞으로 (기억한 위치가 없으면 처음부터) */
export function catchUpStart(cursor: string | null, overlapMs = CATCH_UP_OVERLAP_MS): string {
  const position = cursor ? parse(cursor) : null
  if (!position) return '0_0'
  return `${Math.max(0, position.micros - overlapMs * 1000)}_0`
}

export type CatchUpResult =
  | { complete: true; articles: FeedArticle[]; reached: string }
  /** 놓친 기사가 너무 많아 끝까지 받지 않았다 — 호출한 쪽이 목록을 새로 시작한다 */
  | { complete: false }

/** start 뒤에 수집된 기사를 페이지 단위로 끝까지 받는다 (최대 maxPages) */
export async function catchUp(
  fetchAfter: (cursor: string) => Promise<FeedPage>,
  start: string,
  maxPages = MAX_CATCH_UP_PAGES,
): Promise<CatchUpResult> {
  const articles: FeedArticle[] = []
  let cursor = start
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchAfter(cursor)
    articles.push(...page.articles)
    if (!page.nextCursor) return { complete: true, articles, reached: page.collectedCursor ?? cursor }
    cursor = page.nextCursor
  }
  return { complete: false }
}
