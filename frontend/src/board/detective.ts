/** 탐정 보드 모양 계산 (2026-10-10): 카드 기울기 범위, 압정 위치, 압정 사이 빨간 실 */

/** 카드의 위치·기울기 (보드 좌표, x·y는 카드 가운데) */
export interface Placed {
  id: string
  x: number
  y: number
  rotation: number
}

/** 회전 핸들로 돌릴 수 있는 범위(도) */
export const MAX_TILT = 45
export const clampTilt = (deg: number) => Math.max(-MAX_TILT, Math.min(MAX_TILT, Math.round(deg)))

/** 카드 압정 위치: 카드 위쪽 가운데에서 14px 아래 점을 카드 기울기만큼 돌린 곳 (빨간 실이 여기에 묶인다) */
export function pinOf(item: Placed, heights: Map<string, number>): { x: number; y: number } {
  const h = heights.get(item.id) ?? 150
  const oy = -(h / 2 - 14)
  const rad = (item.rotation * Math.PI) / 180
  return { x: item.x - oy * Math.sin(rad), y: item.y + oy * Math.cos(rad) }
}

/** 두 압정 사이에 살짝 처진 실 (2차 베지어). mid는 곡선의 가운데 점 (연결선 메뉴 위치) */
export function yarn(from: Placed, to: Placed, heights: Map<string, number>) {
  const a = pinOf(from, heights)
  const b = pinOf(to, heights)
  const sag = Math.min(70, Math.hypot(b.x - a.x, b.y - a.y) * 0.12)
  const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + sag }
  return { d: `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`, mid: { x: c.x, y: (a.y + b.y) / 2 + sag / 2 } }
}
