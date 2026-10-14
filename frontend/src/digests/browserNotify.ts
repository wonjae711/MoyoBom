import type { Digest } from './api'

/**
 * 다이제스트 도착 브라우저 알림 (F-09, 2026-10-14 사용자 요청).
 * 권한은 브라우저가 기억하고, 사이트에서 권한을 거둘 수는 없으므로 "끄기"는 이 브라우저에만 저장한다.
 * 여러 탭이 같은 이벤트를 받아도 tag(다이제스트 id)가 같아 알림은 하나로 합쳐진다.
 */
export type NotifyState = 'unsupported' | 'denied' | 'off' | 'on'

const MUTE_KEY = 'moyobom.digestNotify.off'

const supported = () => typeof window !== 'undefined' && 'Notification' in window

/** 저장소를 못 쓰는 브라우저(차단·사생활 모드)에서도 이번 화면에서는 끄기가 지켜지도록 메모리에도 둔다 (Codex N-03) */
let mutedInMemory: boolean | null = null

function muted(): boolean {
  if (mutedInMemory !== null) return mutedInMemory
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

function setMuted(value: boolean) {
  mutedInMemory = value
  try {
    if (value) window.localStorage.setItem(MUTE_KEY, '1')
    else window.localStorage.removeItem(MUTE_KEY)
  } catch {
    // 저장소를 못 쓰면 이번 화면에서만 반영된다
  }
}

/** 테스트용: 메모리 값을 비워 저장소에서 다시 읽게 한다 */
export function resetNotifyMemory() {
  mutedInMemory = null
}

export function notifyState(): NotifyState {
  if (!supported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  return Notification.permission === 'granted' && !muted() ? 'on' : 'off'
}

/** 버튼을 누른 순간에만 권한을 물을 수 있다 (브라우저 규칙) */
export async function enableNotify(): Promise<NotifyState> {
  if (!supported()) return 'unsupported'
  setMuted(false)
  if (Notification.permission === 'default') await Notification.requestPermission()
  return notifyState()
}

export function disableNotify(): NotifyState {
  setMuted(true)
  return notifyState()
}

function bodyOf(digest: Digest): string {
  if (digest.status === 'empty') return '새 소식이 없어요.'
  const text = digest.summary ?? `기사 ${digest.articles.length}건을 모았어요.`
  return text.length > 120 ? `${text.slice(0, 119)}…` : text
}

/** 예약 다이제스트가 도착하면 알린다. "지금 받아보기"는 누른 화면에서 바로 안내하므로 알리지 않는다 */
export function notifyDigest(digest: Digest, onOpen: () => void): void {
  if (digest.kind !== 'scheduled' || notifyState() !== 'on') return
  try {
    const notification = new Notification(`모여봄 · ${digest.title}`, { body: bodyOf(digest), tag: `digest-${digest.id}` })
    notification.onclick = () => {
      window.focus()
      onOpen()
      notification.close()
    }
  } catch {
    // 안드로이드 크롬 등 페이지에서 직접 만들 수 없는 브라우저 — 화면 안 알림만 쓴다
  }
}
