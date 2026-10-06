import { useSyncExternalStore } from 'react'

/**
 * 라이트·다크 테마 (디자인 인계 0-1, 제안 기능): html[data-theme]에 적용하고 이 기기에 기억한다.
 * 색은 CSS 변수로만 쓰고, 캔버스(Konva)처럼 CSS를 못 쓰는 곳은 readColors()로 현재 값을 읽는다
 */
export type Theme = 'light' | 'dark'
const KEY = 'moyobom-theme'
const listeners = new Set<() => void>()

function current(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function setTheme(theme: Theme) {
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark'
  else delete document.documentElement.dataset.theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // 저장을 못 해도 이번 화면에는 적용된다
  }
  for (const listener of listeners) listener()
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    current,
  )
}

/** CSS 변수 값 읽기 (예: readColor('--bg-surface')) */
export function readColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
