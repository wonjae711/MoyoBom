import { createContext, useContext } from 'react'

export interface User {
  id: string
  email: string | null
  nickname: string
  /** 'local'은 2026-10-06에 없앤 이메일 가입의 예전 계정 */
  provider: 'local' | 'kakao' | 'naver'
}

export interface AuthContextValue {
  user: User | null
  /** 처음 로그인 상태를 확인하는 중 */
  loading: boolean
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth는 AuthProvider 안에서만 쓸 수 있습니다')
  return context
}
