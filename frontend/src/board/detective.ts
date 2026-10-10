/** 탐정 보드 모양 계산 (2026-10-10): 카드 기울기 범위, 압정 위치, 압정 사이 빨간 실 */

/** 카드의 위치·기울기 (보드 좌표, x·y는 카드 가운데) */
export interface Placed {
  id: string
  x: number
  y: number
  rotation: number
  /** 카드 배율 (없으면 1) */
  scale?: number
}

/** 카드 배율 범위 (서버·DB와 같음) */
export const MIN_SCALE = 0.6
export const MAX_SCALE = 2.5
/** 배율을 5% 단위로 반올림해 범위 안으로 */
export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(scale * 20) / 20))
}

/** 기울기를 정수 도로 반올림해 -180° 이상 180° 미만으로 감는다 — 핸들을 계속 돌리면 한 바퀴 돌아 이어진다 */
export function wrapTilt(deg: number): number {
  const rounded = Math.round(deg)
  return ((((rounded + 180) % 360) + 360) % 360) - 180
}

/** 압정 가운데: 카드 위쪽 끝에서 이만큼 아래 (BoardPage.css .pin — top 5px + 반지름 7px) */
export const PIN_OFFSET = 12

/** 카드 압정 위치: 카드 위쪽 가운데에서 PIN_OFFSET 아래 점을 카드 기울기만큼 돌린 곳 (연결선이 여기에 묶인다) */
export function pinOf(item: Placed, heights: Map<string, number>): { x: number; y: number } {
  const h = heights.get(item.id) ?? 150
  const oy = -(h / 2 - PIN_OFFSET) * (item.scale ?? 1)
  const rad = (item.rotation * Math.PI) / 180
  return { x: item.x - oy * Math.sin(rad), y: item.y + oy * Math.cos(rad) }
}

/** 두 압정 사이에 살짝 처진 실 (2차 베지어). from·to는 양 끝 압정, mid는 곡선의 가운데 점 (연결선 메뉴 위치) */
export function yarn(from: Placed, to: Placed, heights: Map<string, number>) {
  const a = pinOf(from, heights)
  const b = pinOf(to, heights)
  const sag = Math.min(70, Math.hypot(b.x - a.x, b.y - a.y) * 0.12)
  const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + sag }
  return { d: `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`, mid: { x: c.x, y: (a.y + b.y) / 2 + sag / 2 }, from: a, to: b }
}
