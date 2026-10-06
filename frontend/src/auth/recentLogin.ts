/**
 * 최근 로그인 방식 (2026-10-04 확정 A): 한 사람이 카카오·네이버로 계정을 따로 만드는 혼동을 줄이려고,
 * 이 브라우저에서 마지막으로 로그인한 방식을 로그인 화면에 표시한다. 브라우저에만 저장(서버로 보내지 않음).
 * 저장소를 쓸 수 없는 환경(시크릿 창 제한 등)에서는 조용히 넘어간다.
 */
export type LoginMethod = 'kakao' | 'naver'

const KEY = 'moyobom:last-login'

export function getRecentLogin(): LoginMethod | null {
  try {
    const value = window.localStorage.getItem(KEY)
    return value === 'kakao' || value === 'naver' ? value : null
  } catch {
    return null
  }
}

export function setRecentLogin(method: LoginMethod): void {
  try {
    window.localStorage.setItem(KEY, method)
  } catch {
    // 저장할 수 없으면 표시만 안 될 뿐
  }
}
