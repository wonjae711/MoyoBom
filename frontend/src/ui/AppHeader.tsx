import { useState } from 'react'
import { Link, NavLink } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { DigestLink } from '../digests/DigestLink'
import { Avatars } from './Avatars'
import './AppHeader.css'

/** 보드 목록·뉴스 피드·초대 화면 공통 머리글 (디자인 목업 "보드 목록" 머리글) */
export function AppHeader() {
  const { user, logout } = useAuth()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogout = async () => {
    setPending(true)
    setError(null)
    try {
      await logout()
    } catch (e) {
      // 로그아웃이 서버에서 끝나지 않았으면 로그인 상태를 그대로 두고 알린다 (L-04)
      setError(e instanceof Error ? e.message : '로그아웃하지 못했습니다')
    } finally {
      setPending(false)
    }
  }

  return (
    <header className="app-header">
      <Link to="/" className="app-header__brand serif">
        모여봄
      </Link>
      <nav className="app-header__nav">
        <NavLink to="/" end>
          보드
        </NavLink>
        <NavLink to="/feed">뉴스 탐색</NavLink>
        <DigestLink />
      </nav>
      <div className="app-header__spacer" />
      {user && (
        <div className="app-header__user">
          {error && (
            <span className="app-header__error" role="alert">
              {error}
            </span>
          )}
          <Avatars names={[user.nickname]} />
          <span className="app-header__name">{user.nickname}님</span>
          <button type="button" className="btn btn--ghost" onClick={() => void handleLogout()} disabled={pending}>
            {pending ? '로그아웃 중…' : '로그아웃'}
          </button>
        </div>
      )}
    </header>
  )
}
