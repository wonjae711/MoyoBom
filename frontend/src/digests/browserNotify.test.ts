// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Digest } from './api'
import { disableNotify, enableNotify, notifyDigest, notifyState, resetNotifyMemory } from './browserNotify'

const digest = (over: Partial<Digest> = {}): Digest => ({
  id: '7',
  subscriptionId: '1',
  kind: 'scheduled',
  slot: '2026-10-14T00:00:00.000Z',
  status: 'ok',
  title: '경제 브리핑',
  summary: '금리가 동결됐습니다.',
  articles: [],
  windowStart: '2026-10-13T00:00:00.000Z',
  windowEnd: '2026-10-14T00:00:00.000Z',
  readAt: null,
  createdAt: '2026-10-14T00:00:01.000Z',
  ...over,
})

class FakeNotification {
  static permission: NotificationPermission = 'default'
  static requestPermission = vi.fn(async () => {
    FakeNotification.permission = 'granted'
    return 'granted' as NotificationPermission
  })
  static made: FakeNotification[] = []
  onclick: (() => void) | null = null
  close = vi.fn()
  readonly title: string
  readonly options: NotificationOptions
  constructor(title: string, options: NotificationOptions) {
    this.title = title
    this.options = options
    FakeNotification.made.push(this)
  }
}

describe('[F-09] 다이제스트 브라우저 알림', () => {
  beforeEach(() => {
    FakeNotification.permission = 'default'
    FakeNotification.made = []
    vi.stubGlobal('Notification', FakeNotification)
    localStorage.clear()
    resetNotifyMemory()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('켜기는 권한을 묻고, 끄기는 이 브라우저에만 기억한다', async () => {
    expect(notifyState()).toBe('off')
    expect(await enableNotify()).toBe('on')
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1)
    expect(disableNotify()).toBe('off')
    expect(await enableNotify()).toBe('on')
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1)
  })

  it('[예외] 저장소가 막힌 브라우저에서도 끄기는 이번 화면에서 지켜진다 (Codex N-03)', async () => {
    await enableNotify()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(notifyState()).toBe('on')
    expect(disableNotify()).toBe('off')
    notifyDigest(digest(), () => {})
    expect(FakeNotification.made).toHaveLength(0)
    vi.restoreAllMocks()
  })

  it('차단했거나 지원하지 않는 브라우저는 그 상태를 알려 준다', () => {
    FakeNotification.permission = 'denied'
    expect(notifyState()).toBe('denied')
    vi.stubGlobal('Notification', undefined)
    Reflect.deleteProperty(window, 'Notification')
    expect(notifyState()).toBe('unsupported')
  })

  it('켜져 있으면 예약 다이제스트만 알리고, 누르면 알림함을 연다', async () => {
    await enableNotify()
    vi.spyOn(window, 'focus').mockImplementation(() => {})
    const open = vi.fn()
    notifyDigest(digest({ kind: 'manual' }), open)
    notifyDigest(digest({ status: 'empty', summary: null }), open)
    expect(FakeNotification.made).toHaveLength(1)
    const [made] = FakeNotification.made
    expect(made!.title).toBe('모여봄 · 경제 브리핑')
    expect(made!.options).toMatchObject({ body: '새 소식이 없어요.', tag: 'digest-7' })
    made!.onclick?.()
    expect(open).toHaveBeenCalledTimes(1)

    disableNotify()
    notifyDigest(digest(), open)
    expect(FakeNotification.made).toHaveLength(1)
  })
})
