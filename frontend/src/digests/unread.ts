import { useEffect, useSyncExternalStore } from 'react'
import { io } from 'socket.io-client'
import { listDigests, type Digest } from './api'

/**
 * 안 읽은 다이제스트 개수와 새 다이제스트 도착 알림 (F-09).
 * 머리글의 알림함 표시와 알림함 화면이 같은 값을 보도록 모듈 하나에 둔다.
 */
let unread: number | null = null
const countListeners = new Set<() => void>()
const arrivalListeners = new Set<(digest: Digest) => void>()

function emitCount() {
  for (const listener of countListeners) listener()
}

export function setUnread(value: number) {
  unread = Math.max(0, value)
  emitCount()
}

export function adjustUnread(delta: number) {
  if (unread !== null) setUnread(unread + delta)
}

export function useUnreadCount(): number | null {
  return useSyncExternalStore(
    (listener) => {
      countListeners.add(listener)
      return () => countListeners.delete(listener)
    },
    () => unread,
  )
}

/** 새 다이제스트가 도착하면 불린다 (알림함 화면이 목록 맨 위에 넣는 데 씀) */
export function onDigestArrived(listener: (digest: Digest) => void): () => void {
  arrivalListeners.add(listener)
  return () => arrivalListeners.delete(listener)
}

/** 끊겼다 다시 연결되면 불린다 — 끊긴 동안 도착한 다이제스트는 소켓으로 다시 오지 않으므로 목록을 새로 받는다 */
const resyncListeners = new Set<() => void>()
export function onDigestResync(listener: () => void): () => void {
  resyncListeners.add(listener)
  return () => resyncListeners.delete(listener)
}

let countRequest = 0
/** 안 읽은 개수를 서버 값으로 맞춘다. 늦게 온 이전 응답이 최신 값을 덮지 않게 마지막 요청만 반영 */
export function refreshUnread(): void {
  const request = ++countRequest
  listDigests({ limit: 1 })
    .then((page) => request === countRequest && setUnread(page.unread))
    .catch(() => {})
}

/**
 * 안 읽은 개수를 불러오고, 본인 방(user:{id})의 digest:new를 받는다.
 * 연결될 때마다(처음·재연결) 서버 개수를 다시 읽는다 — 서버는 연결 즉시 본인 방에 넣으므로
 * 연결 뒤에 읽으면 그 사이 도착분을 놓치지 않는다 (Codex 068152f 리뷰 1). 머리글이 한 화면에 하나뿐이라 연결도 하나다
 */
export function useDigestSubscription(): void {
  useEffect(() => {
    const socket = io({ transports: ['websocket'] })
    let connectedBefore = false
    socket.on('connect', () => {
      refreshUnread()
      if (connectedBefore) for (const listener of resyncListeners) listener()
      connectedBefore = true
    })
    socket.on('digest:new', ({ digest }: { digest: Digest }) => {
      refreshUnread()
      for (const listener of arrivalListeners) listener(digest)
    })
    return () => {
      socket.disconnect()
    }
  }, [])
}
