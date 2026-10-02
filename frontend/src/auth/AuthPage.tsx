import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { ApiError } from '../api/client'
import { useAuth } from './useAuth'
import './AuthPage.css'

const FIELD_MESSAGES: Record<string, string> = {
  email: '올바른 이메일 주소를 입력해 주세요',
  password: '비밀번호는 8자 이상이어야 합니다',
  nickname: '닉네임은 1~20자로 입력해 주세요',
}

/** 로그인·회원가입 화면 (F-07). mode로 두 화면을 함께 그린다 */
export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { user, login, signup } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (user) return <Navigate to={from} replace />

  const isSignup = mode === 'signup'

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      if (isSignup) await signup({ email, password, nickname })
      else await login(email, password)
      navigate(from, { replace: true })
    } catch (e) {
      if (e instanceof ApiError) {
        const fieldMessage = e.fields.map((f) => FIELD_MESSAGES[f]).find(Boolean)
        setError(fieldMessage ?? e.message)
      } else {
        setError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth__panel">
        <h1 className="auth__brand">모여봄</h1>
        <p className="auth__tagline">흩어진 뉴스를, 팀이 함께 모으고 정리하는 공동 리서치 브리핑 툴</p>

        <form className="auth__form" onSubmit={onSubmit} noValidate>
          <h2 className="auth__title">{isSignup ? '회원가입' : '로그인'}</h2>

          <label className="auth__field">
            <span>이메일</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>

          {isSignup && (
            <label className="auth__field">
              <span>닉네임</span>
              <input
                autoComplete="nickname"
                maxLength={20}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                required
              />
            </label>
          )}

          <label className="auth__field">
            <span>비밀번호{isSignup && <small> (8자 이상)</small>}</span>
            <input
              type="password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error && (
            <p className="auth__error" role="alert">
              {error}
            </p>
          )}

          <button className="auth__submit" type="submit" disabled={submitting}>
            {submitting ? '처리 중…' : isSignup ? '가입하기' : '로그인'}
          </button>

          <div className="auth__divider">또는</div>
          {/* 소셜 로그인은 카카오·네이버 키 발급 후 연결 (F-07 2단계) */}
          <button className="auth__social auth__social--kakao" type="button" disabled title="준비 중">
            카카오로 계속하기 (준비 중)
          </button>
          <button className="auth__social auth__social--naver" type="button" disabled title="준비 중">
            네이버로 계속하기 (준비 중)
          </button>

          <p className="auth__switch">
            {isSignup ? (
              <>
                이미 계정이 있나요? <Link to="/login" state={location.state}>로그인</Link>
              </>
            ) : (
              <>
                처음이신가요? <Link to="/signup" state={location.state}>회원가입</Link>
              </>
            )}
          </p>
        </form>
      </div>
    </div>
  )
}
