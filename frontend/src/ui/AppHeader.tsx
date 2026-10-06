import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { DigestLink } from '../digests/DigestLink'
import { Logo } from './Logo'
import { setTheme, useTheme } from './theme'
import './AppHeader.css'

/** 내 보드·뉴스·알림함 공통 머리글 (보라 테마 프로토타입 머리글). 사용자 메뉴에 다크 모드·로그아웃 */
export function AppHeader() {
  const { user, logout } = useAuth()
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handleLogout = async () => {
    setPending(true)
    setError(false)
    try {
      await logout()
    } catch {
      // 로그아웃이 서버에서 끝나지 않았으면 로그인 상태를 그대로 두고 알린다 (L-04)
      setError(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <header className="app-header">
      <Link to="/" className="app-header__brand" aria-label="모여봄 내 보드로">
        <Logo />
      </Link>
      <nav className="app-header__nav" aria-label="주요 메뉴">
        <NavLink to="/" end>
          내 보드
        </NavLink>
        <NavLink to="/feed">뉴스</NavLink>
        <DigestLink />
      </nav>
      <div className="app-header__spacer" />
      {user && (
        <div className="app-header__user" ref={menuRef}>
          <button
            type="button"
            className="app-header__me"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <span className="app-header__initial" aria-hidden="true">
              {Array.from(user.nickname)[0] ?? '?'}
            </span>
            {user.nickname}
          </button>
          {open && (
            <div className="menu app-header__menu" role="menu">
              <div className="app-header__menu-name">
                <b>{user.nickname}</b>님
              </div>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={theme === 'dark'}
                className="menu__item"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                <span>다크 모드</span>
                <span className="app-header__menu-state">{theme === 'dark' ? '켜짐' : '꺼짐'}</span>
              </button>
              <div className="menu__sep" aria-hidden="true" />
              {error && (
                <div className="notice notice--err app-header__menu-error" role="alert">
                  로그아웃하지 못했어요. 다시 시도해 주세요.
                </div>
              )}
              <button type="button" role="menuitem" className="menu__item" onClick={() => void handleLogout()} disabled={pending}>
                {pending ? '로그아웃 중…' : error ? '다시 시도' : '로그아웃'}
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  )
}
