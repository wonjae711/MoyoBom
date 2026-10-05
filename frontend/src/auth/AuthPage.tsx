import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { ApiError, apiFetch } from '../api/client'
import { socialLoginUrl } from './loginUrl'
import { getRecentLogin } from './recentLogin'
import { useAuth } from './useAuth'
import './AuthPage.css'

/** 소셜 로그인에서 돌아왔을 때 주소의 ?error= 값 → 안내 문구 */
const SOCIAL_ERRORS: Record<string, string> = {
  kakao_cancelled: '카카오 로그인을 취소했습니다',
  kakao_invalid: '로그인 요청이 만료되었거나 올바르지 않습니다. 다시 시도해 주세요',
  kakao_failed: '카카오 로그인 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요',
  kakao_unavailable: '카카오 로그인을 아직 사용할 수 없습니다',
  naver_cancelled: '네이버 로그인을 취소했습니다',
  naver_invalid: '로그인 요청이 만료되었거나 올바르지 않습니다. 다시 시도해 주세요',
  naver_failed: '네이버 로그인 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요',
  naver_unavailable: '네이버 로그인을 아직 사용할 수 없습니다',
}

const RECENT_LABEL = '최근 사용'

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
  const [searchParams] = useSearchParams()
  const [error, setError] = useState<string | null>(() => SOCIAL_ERRORS[searchParams.get('error') ?? ''] ?? null)
  const [submitting, setSubmitting] = useState(false)
  const [providers, setProviders] = useState({ kakao: false, naver: false })
  const [recent] = useState(getRecentLogin)

  useEffect(() => {
    apiFetch<{ kakao: boolean; naver: boolean }>('/api/auth/providers')
      .then(setProviders)
      .catch(() => {})
  }, [])

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
          <h2 className="auth__title">
            {isSignup ? '회원가입' : '로그인'}
            {!isSignup && recent === 'local' && <span className="auth__recent">{RECENT_LABEL} · 이메일</span>}
          </h2>

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
          {/* 소셜 로그인은 서버 주소로 직접 이동한다 (카카오 인가 페이지 → 콜백 → 로그인 쿠키 발급 후 화면으로 복귀) */}
          <button
            className="auth__social auth__social--kakao"
            type="button"
            disabled={!providers.kakao}
            onClick={() => window.location.assign(socialLoginUrl('kakao', from))}
          >
            {providers.kakao ? '카카오로 계속하기' : '카카오로 계속하기 (준비 중)'}
            {recent === 'kakao' && <span className="auth__recent">{RECENT_LABEL}</span>}
          </button>
          <button
            className="auth__social auth__social--naver"
            type="button"
            disabled={!providers.naver}
            onClick={() => window.location.assign(socialLoginUrl('naver', from))}
          >
            {providers.naver ? '네이버로 계속하기' : '네이버로 계속하기 (준비 중)'}
            {recent === 'naver' && <span className="auth__recent">{RECENT_LABEL}</span>}
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
