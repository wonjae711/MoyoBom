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
}

export interface BoardSnapshot {
  board: { id: string; title: string; ownerId: string; updatedAt: string; seq: number }
  role: BoardRole
  members: BoardMember[]
  items: BoardItem[]
}
