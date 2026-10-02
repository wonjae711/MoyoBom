import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthContext'
import { useAuth } from './auth/useAuth'
import { AuthPage } from './auth/AuthPage'
import { RequireAuth } from './auth/RequireAuth'
import { NewsFeed } from './feed/NewsFeed'
import './App.css'

function AppHeader() {
  const { user, logout } = useAuth()
  return (
    <header className="app-header">
      <span className="app-header__brand">모여봄</span>
      {user && (
        <span className="app-header__user">
          {user.nickname}님
          <button type="button" onClick={() => void logout()}>
            로그아웃
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
