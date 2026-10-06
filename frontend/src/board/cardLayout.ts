import { CATEGORY_LABELS } from '../feed/types'
import { formatRelativeTime } from '../feed/merge'
import type { BoardItem, BoardMember } from './types'

/**
 * 보드 카드 크기·좌표 계산 — 보라 테마 프로토타입 값.
 * 카드의 (x, y)는 카드 가운데 좌표다 (서버에 저장되는 값, 이전 화면과 같음).
 * 카드 높이는 내용에 따라 달라지므로 화면에서 잰 값(heights)을 쓰고, 아직 못 쟀으면 추정값을 쓴다
 */
export const CARD_WIDTH = { article: 280, memo: 240, photo: 240 } as const
export const CLUSTER_WIDTH = 280
const ESTIMATED_HEIGHT = { article: 170, memo: 150, photo: 300 } as const

/** 확대·축소 범위 (인계 문서: 커서 위치 기준 0.4~1.6) */
export const MIN_ZOOM = 0.4
export const MAX_ZOOM = 1.6
export const ZOOM_STEP = 1.2

export function cardWidth(item: Pick<BoardItem, 'type'>): number {
  return CARD_WIDTH[item.type]
}

export function cardHeight(item: Pick<BoardItem, 'id' | 'type'>, heights: Map<string, number>): number {
  return heights.get(item.id) ?? ESTIMATED_HEIGHT[item.type]
}

export function categoryLabel(item: BoardItem): string {
  const category = item.article?.category
  return category ? (CATEGORY_LABELS[category] ?? category) : '링크'
}

/** 기사 카드 아래줄의 시각: "5분 전" */
export function articleTime(item: BoardItem, now: Date): string {
  const at = item.article?.publishedAt
  return at ? formatRelativeTime(at, now) : '발행 시각 확인 불가'
}

/** 메모 작성자 이름 */
export function authorName(item: BoardItem, members: Map<string, BoardMember>): string {
  if (!item.createdBy) return '나'
  return members.get(item.createdBy)?.nickname ?? '나간 참여자'
}

/** 모든 카드를 감싸는 범위 (화면 맞춤용) */
export function boundsOf(items: BoardItem[], heights: Map<string, number>): { x0: number; y0: number; x1: number; y1: number } | null {
  if (items.length === 0) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const item of items) {
    const w = cardWidth(item)
    const h = cardHeight(item, heights)
    x0 = Math.min(x0, item.x - w / 2)
    x1 = Math.max(x1, item.x + w / 2)
    y0 = Math.min(y0, item.y - h / 2)
    y1 = Math.max(y1, item.y + h / 2)
  }
  return { x0, y0, x1, y1 }
}

export interface View {
  x: number
  y: number
  scale: number
}

export const clampZoom = (scale: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))

/** 카드가 모두 보이게 맞춘 화면 (위쪽 도구 막대 76, 아래 확대 도구 44 여백, 최대 100%) */
export function fitView(items: BoardItem[], heights: Map<string, number>, width: number, height: number): View {
  const bounds = boundsOf(items, heights)
  if (!bounds) return { x: width / 2, y: height / 2, scale: 1 }
  const bw = Math.max(1, bounds.x1 - bounds.x0)
  const bh = Math.max(1, bounds.y1 - bounds.y0)
  let scale = Math.min(1, (width - 96) / bw, (height - 160) / bh)
  if (!Number.isFinite(scale) || scale <= 0) scale = 1
  scale = clampZoom(scale)
  const x = (width - bw * scale) / 2 - bounds.x0 * scale
  const y = 76 + (height - 120 - bh * scale) / 2 - bounds.y0 * scale
  return { x, y, scale }
}

/** 화면 한 점을 고정한 채 배율만 바꾼다 (기본은 화면 가운데) */
export function zoomAt(view: View, scale: number, sx: number, sy: number): View {
  const next = clampZoom(scale)
  const bx = (sx - view.x) / view.scale
  const by = (sy - view.y) / view.scale
  return { scale: next, x: sx - bx * next, y: sy - by * next }
}

/** 화면 좌표 → 보드 좌표 */
export function toBoard(view: View, sx: number, sy: number) {
  return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale }
}

/** 보드의 한 점이 화면 가운데에 오도록 (배율은 그대로) */
export function centerOn(view: View, bx: number, by: number, width: number, height: number): View {
  return { ...view, x: width / 2 - bx * view.scale, y: height / 2 - by * view.scale }
}
