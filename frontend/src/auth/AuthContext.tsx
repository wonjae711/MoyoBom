import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { UnauthorizedError, apiFetch, logoutSession, onUnauthorized } from '../api/client'
import { setRecentLogin } from './recentLogin'
import { AuthContext, type User } from './useAuth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // 로그인된 방식을 기억해 다음에 로그인 화면에 "최근 사용"으로 보여 준다 (소셜 로그인은 돌아온 뒤 /me로 확인)
  useEffect(() => {
    if (user) setRecentLogin(user.provider)
  }, [user])

  useEffect(() => {
    // 쿠키가 남아 있으면 로그인 상태를 복원한다 (access token이 만료됐으면 apiFetch가 갱신을 시도)
    apiFetch<{ user: User }>('/api/auth/me')
      .then(({ user }) => setUser(user))
      .catch((error: unknown) => {
        if (!(error instanceof UnauthorizedError)) console.error(error)
        setUser(null)
      })
      .finally(() => setLoading(false))
    return onUnauthorized(() => setUser(null))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await apiFetch<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    setUser(user)
  }, [])

  const signup = useCallback(async (input: { email: string; password: string; nickname: string }) => {
    const { user } = await apiFetch<{ user: User }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    setUser(user)
  }, [])

  // 서버에서 로그아웃이 끝난 뒤에만 화면을 로그아웃 상태로 바꾼다. 실패하면 에러를 던진다 (L-04)
  const logout = useCallback(async () => {
    await logoutSession()
    setUser(null)
  }, [])

  const value = useMemo(() => ({ user, loading, login, signup, logout }), [user, loading, login, signup, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
