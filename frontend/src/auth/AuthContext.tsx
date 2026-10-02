import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { UnauthorizedError, apiFetch, onUnauthorized } from '../api/client'
import { AuthContext, type User } from './useAuth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

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

  const logout = useCallback(async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    setUser(null)
  }, [])

  const value = useMemo(() => ({ user, loading, login, signup, logout }), [user, loading, login, signup, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
