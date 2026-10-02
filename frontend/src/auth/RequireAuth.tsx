import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from './useAuth'

/** 로그인한 사용자만 볼 수 있는 화면. 아니면 로그인 화면으로 보내고, 로그인 후 원래 화면으로 돌아온다 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <p style={{ padding: 32, color: 'var(--color-gray-dark)' }}>로그인 상태 확인 중…</p>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <>{children}</>
}
