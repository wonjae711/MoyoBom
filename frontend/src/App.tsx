import { useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthContext'
import { useAuth } from './auth/useAuth'
import { AuthPage } from './auth/AuthPage'
import { RequireAuth } from './auth/RequireAuth'
import { NewsFeed } from './feed/NewsFeed'
import './App.css'

function AppHeader() {
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
      <span className="app-header__brand">모여봄</span>
      {user && (
        <span className="app-header__user">
          {error && (
            <span className="app-header__error" role="alert">
              {error}
            </span>
          )}
          {user.nickname}님
          <button type="button" onClick={() => void handleLogout()} disabled={pending}>
            {pending ? '로그아웃 중…' : '로그아웃'}
          </button>
        </span>
      )}
    </header>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/signup" element={<AuthPage mode="signup" />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <AppHeader />
                <main>
                  <NewsFeed />
                </main>
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
