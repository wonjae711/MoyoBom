// 백엔드 backend/src/boards/types.ts, backend/src/realtime/boardSync.ts와 같은 형태
import type { CategoryCode } from '../feed/types'

export type BoardRole = 'owner' | 'editor'
export type ItemType = 'article' | 'memo' | 'photo'

export interface BoardSummary {
  id: string
  title: string
  role: BoardRole
  memberCount: number
  itemCount: number
  updatedAt: string
  /** 목록 미리보기용 카드 배치 (위에 있는 카드부터 최대 10장) */
  thumb: { x: number; y: number; type: ItemType }[]
}

export interface BoardMember {
  userId: string
  nickname: string
  role: BoardRole
}

export interface ItemArticle {
  title: string
  description: string
  source: string
  category: CategoryCode | null
  originalLink: string
  publishedAt: string | null
  /** 저장(수집)된 시각 */
  collectedAt: string
  /** 사용자가 링크로 추가한 기사 ("링크 요약" 표시) */
  submitted: boolean
}

export interface BoardItem {
  id: string
  type: ItemType
  articleId: string | null
  article: ItemArticle | null
  content: string | null
  imageKey: string | null
  x: number
  y: number
  rotation: number
  zIndex: number
  createdBy: string | null
  updatedAt: string
  /** 마지막으로 바뀐 때의 보드 변경 순번 — 순서 비교는 updatedAt이 아니라 이 값으로 한다 */
  version: number
  /** AI 자동 정렬로 옮겨져 "원래대로" 되돌릴 수 있는 상태 (F-08) */
  arranged: boolean
}

/** 카드 간 수동 연결선 (F-10). 두 카드 id는 항상 작은 쪽이 fromId */
export interface BoardConnection {
  id: string
  fromId: string
  toId: string
  createdBy: string | null
  version: number
}

/** AI 이슈 클러스터 (F-08) */
export interface BoardCluster {
  id: string
  title: string
  summary: string
  x: number
  y: number
  itemIds: string[]
}

export interface BoardSnapshot {
  board: { id: string; title: string; ownerId: string; updatedAt: string; seq: number }
  role: BoardRole
  members: BoardMember[]
  items: BoardItem[]
  clusters: BoardCluster[]
  connections: BoardConnection[]
}
