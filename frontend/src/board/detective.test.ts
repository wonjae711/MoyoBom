import { describe, expect, it } from 'vitest'
import { MAX_TILT, clampTilt, pinOf, yarn } from './detective'

const card = (id: string, x: number, y: number, rotation = 0) => ({ id, x, y, rotation })

describe('탐정 보드 모양 계산', () => {
  it('기울기는 정수로 반올림하고 ±45° 안으로 자른다', () => {
    expect(clampTilt(3.4)).toBe(3)
    expect(clampTilt(-80)).toBe(-MAX_TILT)
    expect(clampTilt(90)).toBe(MAX_TILT)
  })

  it('압정은 카드 위쪽 가운데(위에서 14px)이고, 카드가 기울면 함께 돈다', () => {
    const heights = new Map([['a', 200]])
    expect(pinOf(card('a', 100, 100), heights)).toEqual({ x: 100, y: 14 })
    const tilted = pinOf(card('a', 100, 100, 90), heights)
    expect(tilted.x).toBeCloseTo(186)
    expect(tilted.y).toBeCloseTo(100)
  })

  it('실은 두 압정을 잇고 가운데가 아래로 처진다 (거리의 12%, 최대 70)', () => {
    const heights = new Map([
      ['a', 100],
      ['b', 100],
    ])
    const { d, mid } = yarn(card('a', 0, 100), card('b', 500, 100), heights)
    expect(d).toBe('M 0 64 Q 250 124 500 64')
    expect(mid).toEqual({ x: 250, y: 94 })
    expect(yarn(card('a', 0, 100), card('b', 5000, 100), heights).mid.y).toBe(64 + 35)
  })
})
