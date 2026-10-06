import { useCallback, useEffect, useRef, useState } from 'react'
import './common.css'

/** 상대 시각("5분 전")이 저절로 갱신되도록 주기적으로 현재 시각을 바꾼다 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

export type ToastTone = 'ok' | 'info' | 'err'
export interface ToastOptions {
  tone?: ToastTone
  /** 알림 안의 버튼 (예: 다시 시도) */
  action?: { label: string; run: () => void }
}
interface ToastItem extends ToastOptions {
  id: number
  text: string
}

/**
 * 화면 아래 알림 (인계 문서 "알림(토스트)"): 성공·안내는 어두운 배경으로 4초 뒤 사라지고,
 * 오류는 흰 배경 + 빨간 글자로 직접 닫을 때까지 남는다. 다시 시도 버튼을 붙일 수 있다
 */
export function useToast(durationMs = 4000) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const close = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
  }, [])

  const show = useCallback(
    (text: string, options: ToastOptions = {}) => {
      const id = ++seq.current
      const tone = options.tone ?? 'info'
      // 같은 문구가 이미 떠 있으면 새로 쌓지 않는다
      setItems((list) => [...list.filter((t) => t.text !== text), { id, text, ...options, tone }].slice(-3))
      if (tone !== 'err') timers.current.set(id, setTimeout(() => close(id), durationMs))
    },
    [close, durationMs],
  )

  useEffect(() => {
    const map = timers.current
    return () => map.forEach((timer) => clearTimeout(timer))
  }, [])

  const view =
    items.length > 0 ? (
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`} role={t.tone === 'err' ? 'alert' : 'status'}>
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  close(t.id)
                  t.action!.run()
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="toast__close" onClick={() => close(t.id)} aria-label="알림 닫기" title="닫기">
              ×
            </button>
          </div>
        ))}
      </div>
    ) : null

  return { show, view }
}
