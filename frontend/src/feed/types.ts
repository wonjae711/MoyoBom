// 백엔드 backend/src/news/feed.ts, backend/src/realtime/newsFeed.ts와 같은 형태

export type CategoryCode =
  | 'politics'
  | 'economy'
  | 'society'
  | 'world'
  | 'tech'
  | 'culture'
  | 'sports'
  | 'entertainment'

/** 화면 표시 이름 (backend/src/news/types.ts CATEGORIES와 같게 유지) */
export const CATEGORY_LABELS: Record<CategoryCode, string> = {
  politics: '정치',
  economy: '경제',
  society: '사회',
  world: '국제',
  tech: 'IT·과학',
  culture: '생활·문화',
  sports: '스포츠',
  entertainment: '연예',
}

export interface FeedArticle {
  id: string
  title: string
  description: string
  source: string
  category: CategoryCode
  originalLink: string
  publishedAt: string
  /** 수집된 시각 — 재연결 시 누락분 보완 기준 (C-10) */
  collectedAt: string
}

export interface FeedPage {
  articles: FeedArticle[]
  nextCursor: string | null
  /** 여기까지 수집된 기사는 받은 셈이라는 위치 (collectedAfter 조회의 시작점) */
  collectedCursor: string | null
}

export interface NewArticlesPayload {
  articles: FeedArticle[]
  total: number
  truncated: boolean
}

export const NEW_ARTICLES_EVENT = 'feed:new-articles'
