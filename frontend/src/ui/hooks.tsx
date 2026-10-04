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

/** 화면 아래 잠깐 뜨는 안내 (목업의 toast) */
export function useToast(durationMs = 2200) {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = useCallback(
    (text: string) => {
      setMessage(text)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setMessage(null), durationMs)
    },
    [durationMs],
  )
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  const view = message ? (
    <div className="toast" role="status">
      {message}
    </div>
  ) : null
  return { show, view }
}
