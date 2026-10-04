import Konva from 'konva'
import { CATEGORY_LABELS } from '../feed/types'
import { formatRelativeTime } from '../feed/merge'
import type { BoardItem, BoardMember } from './types'

/**
 * 보드 카드 모양 — 디자인 목업(Claude Design "모여봄 UI 목업") 캔버스 variant A(여유) 값.
 * 카드의 (x, y)는 카드 가운데 좌표다 (목업과 같음).
 */
export const FONT_SANS = "'IBM Plex Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif"
export const FONT_HAND = "'Gaegu', cursive"

export const COLORS = {
  black: '#212121',
  grayDark: '#5C6670',
  grayMid: '#8A939B',
  grayLight: '#E4E6E8',
  white: '#FFFFFF',
}

export const ARTICLE = { width: 206, padX: 13, padTop: 12, padBottom: 11, chipGap: 8, metaGap: 9 }
export const MEMO = { width: 164, height: 124, padX: 14, padY: 13 }
export const PHOTO = { width: 176, height: 200 }

export const TITLE_FONT = { size: 12.5, lineHeight: 1.42, style: '600' }
export const CHIP_FONT = { size: 9, padX: 5, padY: 2 }
export const META_FONT = { size: 9.5 }
export const MEMO_FONT = { size: 17, lineHeight: 1.35 }

const measureCache = new Map<string, number>()

/** 줄바꿈한 글자 높이. 글꼴이 늦게 로드되면 clearMeasureCache()로 다시 잰다 */
export function measureTextHeight(text: string, width: number, font: { size: number; lineHeight?: number; style?: string; family?: string }) {
  const key = `${font.family ?? FONT_SANS}|${font.size}|${font.style ?? ''}|${font.lineHeight ?? 1}|${width}|${text}`
  const cached = measureCache.get(key)
  if (cached !== undefined) return cached
  const node = new Konva.Text({
    text,
    width,
    fontSize: font.size,
    fontFamily: font.family ?? FONT_SANS,
    fontStyle: font.style ?? 'normal',
    lineHeight: font.lineHeight ?? 1,
    wrap: 'char',
  })
  const height = node.height()
  node.destroy()
  measureCache.set(key, height)
  return height
}

export function clearMeasureCache() {
  measureCache.clear()
}

export const chipHeight = () => CHIP_FONT.size * 1.2 + CHIP_FONT.padY * 2 + 2

/** 기사 카드 높이 (제목 줄 수에 따라 달라짐) */
export function articleHeight(title: string): number {
  const titleH = measureTextHeight(title, ARTICLE.width - ARTICLE.padX * 2, {
    size: TITLE_FONT.size,
    lineHeight: TITLE_FONT.lineHeight,
    style: TITLE_FONT.style,
  })
  return ARTICLE.padTop + chipHeight() + ARTICLE.chipGap + titleH + ARTICLE.metaGap + META_FONT.size * 1.2 + ARTICLE.padBottom
}

export function cardSize(item: BoardItem): { width: number; height: number } {
  if (item.type === 'memo') return { width: MEMO.width, height: MEMO.height }
  if (item.type === 'photo') return { width: PHOTO.width, height: PHOTO.height }
  return { width: ARTICLE.width, height: articleHeight(item.article?.title ?? '삭제된 기사') }
}

/**
 * 화면에 보이는 기울기. 저장된 회전값이 0이면 카드 id로 정한 -3~3도를 써서 목업처럼 손으로 붙인 느낌을 낸다.
 * id로만 정하므로 모든 참여자 화면에서 같다.
 */
export function displayRotation(item: BoardItem): number {
  if (item.rotation) return item.rotation
  let hash = 0
  for (const ch of item.id) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return ((Math.abs(hash) % 61) - 30) / 10
}

export function categoryLabel(item: BoardItem): string {
  const category = item.article?.category
  return category ? (CATEGORY_LABELS[category] ?? category) : '링크'
}

/** 기사 카드 아래줄: "언론사 · 5분 전" */
export function articleMeta(item: BoardItem, now: Date): string {
  const article = item.article
  if (!article) return ''
  return article.publishedAt ? `${article.source} · ${formatRelativeTime(article.publishedAt, now)}` : article.source
}

/** 메모 카드 아래줄: "작성자 · 방금 전" */
export function memoMeta(item: BoardItem, members: Map<string, BoardMember>, now: Date): string {
  const author = item.createdBy ? (members.get(item.createdBy)?.nickname ?? '나간 멤버') : '나'
  return `${author} · ${formatRelativeTime(item.updatedAt, now)}`
}

/** 모든 카드를 감싸는 범위 (화면 맞춤용) */
export function boundsOf(items: BoardItem[]): { x0: number; y0: number; x1: number; y1: number } | null {
  if (items.length === 0) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const item of items) {
    const { width, height } = cardSize(item)
    x0 = Math.min(x0, item.x - width / 2)
    x1 = Math.max(x1, item.x + width / 2)
    y0 = Math.min(y0, item.y - height / 2)
    y1 = Math.max(y1, item.y + height / 2)
  }
  return { x0, y0, x1, y1 }
}

export interface View {
  x: number
  y: number
  scale: number
}

/** 카드가 모두 보이게 맞춘 화면 (목업의 view(): 여백 46, 위쪽 도구 막대 58, 최대 100%, 최소 28%) */
export function fitView(items: BoardItem[], width: number, height: number): View {
  const bounds = boundsOf(items)
  if (!bounds) return { x: width / 2, y: height / 2, scale: 1 }
  const pad = 46
  const topPad = 58
  const bw = Math.max(1, bounds.x1 - bounds.x0)
  const bh = Math.max(1, bounds.y1 - bounds.y0)
  let scale = Math.min(1, (width - pad) / bw, (height - pad - topPad) / bh)
  if (!Number.isFinite(scale) || scale <= 0) scale = 1
  scale = Math.max(0.28, scale)
  // 가로는 가운데, 세로는 도구 막대 아래부터
  const x = (width - bw * scale) / 2 - bounds.x0 * scale
  const y = topPad - bounds.y0 * scale
  return { x, y, scale }
}

/** 화면 가운데를 유지한 채 배율만 바꾼다 */
export function zoomAtCenter(view: View, scale: number, width: number, height: number): View {
  const cx = (width / 2 - view.x) / view.scale
  const cy = (height / 2 - view.y) / view.scale
  return { scale, x: width / 2 - cx * scale, y: height / 2 - cy * scale }
}

/** 화면 좌표 → 보드 좌표 */
export function toBoard(view: View, sx: number, sy: number) {
  return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale }
}

/** AI 클러스터 카드 (목업의 "AI 클러스터" 카드 — 검은 바탕, 흰 글자, 명조 제목) */
export const FONT_SERIF = "'Nanum Myeongjo', serif"
export const CLUSTER = { width: 252, padX: 15, padTop: 13, padBottom: 12, chipGap: 9, titleGap: 8, buttonGap: 11, buttonH: 22 }
export const CLUSTER_TITLE_FONT = { size: 14, lineHeight: 1.4, style: 'bold', family: FONT_SERIF }
export const CLUSTER_TEXT_FONT = { size: 11, lineHeight: 1.5 }

export function clusterLayout(title: string, summary: string) {
  const width = CLUSTER.width - CLUSTER.padX * 2
  const titleY = CLUSTER.padTop + chipHeight() + CLUSTER.chipGap
  const titleH = measureTextHeight(title, width, CLUSTER_TITLE_FONT)
  const summaryY = titleY + titleH + CLUSTER.titleGap
  const summaryH = summary ? measureTextHeight(summary, width, CLUSTER_TEXT_FONT) : 0
  const buttonY = summaryY + summaryH + (summary ? CLUSTER.buttonGap : 2)
  return { width, titleY, titleH, summaryY, summaryH, buttonY, height: buttonY + CLUSTER.buttonH + CLUSTER.padBottom }
}
