// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { socialLoginUrl } from './loginUrl'
import { getRecentLogin, setRecentLogin } from './recentLogin'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('소셜 로그인 시작 주소', () => {
  it('카카오·네이버 모두 우리 화면 경로만 next로 넘긴다 (C-12)', () => {
    expect(socialLoginUrl('naver', '/invite/abc')).toBe('/api/auth/naver?next=%2Finvite%2Fabc')
    expect(socialLoginUrl('kakao', '/')).toBe('/api/auth/kakao')
    expect(socialLoginUrl('naver', '//evil.example')).toBe('/api/auth/naver')
    expect(socialLoginUrl('kakao', 'https://evil.example')).toBe('/api/auth/kakao')
  })
})

describe('[결정 A] 최근 로그인 방식', () => {
  it('마지막으로 로그인한 방식을 기억한다', () => {
    expect(getRecentLogin()).toBeNull()
    setRecentLogin('naver')
    expect(getRecentLogin()).toBe('naver')
    setRecentLogin('kakao')
    expect(getRecentLogin()).toBe('kakao')
    // 없앤 이메일 로그인 값은 무시 (2026-10-06)
    window.localStorage.setItem('moyobom:last-login', 'local')
    expect(getRecentLogin()).toBeNull()
  })

  it('저장된 값이 이상하거나 저장소를 쓸 수 없어도 화면이 깨지지 않는다', () => {
    window.localStorage.setItem('moyobom:last-login', 'google')
    expect(getRecentLogin()).toBeNull()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('차단됨')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('차단됨')
    })
    expect(getRecentLogin()).toBeNull()
    expect(() => setRecentLogin('kakao')).not.toThrow()
  })
})
