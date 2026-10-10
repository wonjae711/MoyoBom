import { describe, expect, it } from 'vitest'
import { pinOf, wrapTilt, yarn } from './detective'

const card = (id: string, x: number, y: number, rotation = 0) => ({ id, x, y, rotation })

describe('탐정 보드 모양 계산', () => {
  it('기울기는 정수로 반올림하고 -180° 이상 180° 미만으로 감는다 (한 바퀴 돌아 이어짐)', () => {
    expect(wrapTilt(3.4)).toBe(3)
    expect(wrapTilt(179)).toBe(179)
    expect(wrapTilt(180)).toBe(-180)
    expect(wrapTilt(185)).toBe(-175)
    expect(wrapTilt(-190)).toBe(170)
    expect(wrapTilt(725)).toBe(5)
  })

  it('압정은 카드 위쪽 가운데(위에서 12px — CSS 압정 가운데)이고, 카드가 기울면 함께 돈다', () => {
    const heights = new Map([['a', 200]])
    expect(pinOf(card('a', 100, 100), heights)).toEqual({ x: 100, y: 12 })
    const tilted = pinOf(card('a', 100, 100, 90), heights)
    expect(tilted.x).toBeCloseTo(188)
    expect(tilted.y).toBeCloseTo(100)
    const upsideDown = pinOf(card('a', 100, 100, 180), heights)
    expect(upsideDown.x).toBeCloseTo(100)
    expect(upsideDown.y).toBeCloseTo(188)
  })

  it('실은 두 압정을 잇고 가운데가 아래로 처진다 (거리의 12%, 최대 70)', () => {
    const heights = new Map([
      ['a', 100],
      ['b', 100],
    ])
    const line = yarn(card('a', 0, 100), card('b', 500, 100), heights)
    expect(line.d).toBe('M 0 62 Q 250 122 500 62')
    expect(line.mid).toEqual({ x: 250, y: 92 })
    expect(line.from).toEqual({ x: 0, y: 62 })
    expect(line.to).toEqual({ x: 500, y: 62 })
    expect(yarn(card('a', 0, 100), card('b', 5000, 100), heights).mid.y).toBe(62 + 35)
  })
})
