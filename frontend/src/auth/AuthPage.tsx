import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { ApiError, apiFetch } from '../api/client'
import { Icon } from '../ui/Icon'
import { Logo } from '../ui/Logo'
import { socialLoginUrl } from './loginUrl'
import { getRecentLogin } from './recentLogin'
import { useAuth } from './useAuth'
import './AuthPage.css'

/** 소셜 로그인에서 돌아왔을 때 주소의 ?error= 값 → 안내 문구 */
const SOCIAL_ERRORS: Record<string, string> = {
  kakao_cancelled: '카카오 로그인이 취소됐어요. 다시 시도하거나 다른 방법을 선택해 주세요.',
  kakao_invalid: '로그인 요청이 만료되었거나 올바르지 않아요. 다시 시도해 주세요.',
  kakao_failed: '카카오 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.',
  kakao_unavailable: '카카오 로그인을 아직 사용할 수 없어요.',
  naver_cancelled: '네이버 로그인이 취소됐어요. 다시 시도하거나 다른 방법을 선택해 주세요.',
  naver_invalid: '로그인 요청이 만료되었거나 올바르지 않아요. 다시 시도해 주세요.',
  naver_failed: '네이버 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.',
  naver_unavailable: '네이버 로그인을 아직 사용할 수 없어요.',
}

const RECENT_LABEL = '최근 사용'

type Field = 'email' | 'password' | 'nickname'
const FIELD_MESSAGES: Record<Field, string> = {
  email: '이메일 형식을 확인해 주세요.',
  password: '비밀번호는 8자 이상이어야 해요.',
  nickname: '닉네임은 1~20자로 입력해 주세요.',
}

/** 보내기 전에 화면에서 먼저 확인 (서버도 같은 규칙으로 다시 확인한다) */
function validate(isSignup: boolean, email: string, password: string, nickname: string) {
  const errors: Partial<Record<Field, string>> = {}
  if (!email.trim()) errors.email = '이메일을 입력해 주세요.'
  else if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = FIELD_MESSAGES.email
  if (!password) errors.password = '비밀번호를 입력해 주세요.'
  else if (isSignup && password.length < 8) errors.password = FIELD_MESSAGES.password
  if (isSignup && !nickname.trim()) errors.nickname = '닉네임을 입력해 주세요.'
  return errors
}

/**
 * 로그인·회원가입 화면 (F-07). 보라 테마 프로토타입 — 로그인은 왼쪽 폼 + 오른쪽 보드 그림, 회원가입은 가운데 카드.
 * 초대 링크에서 왔으면 로그인 뒤 그 초대 화면으로 돌아간다 (C-12)
 */
export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { user, login, signup } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const inviteWaiting = from.startsWith('/invite/')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [searchParams] = useSearchParams()
  const [error, setError] = useState<string | null>(() => SOCIAL_ERRORS[searchParams.get('error') ?? ''] ?? null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({})
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
    const errors = validate(isSignup, email, password, nickname)
    setFieldErrors(errors)
    setError(null)
    if (Object.keys(errors).length) return
    setSubmitting(true)
    try {
      if (isSignup) await signup({ email, password, nickname })
      else await login(email, password)
      navigate(from, { replace: true })
    } catch (e) {
      if (e instanceof ApiError) {
        const fields = e.fields.filter((f): f is Field => f in FIELD_MESSAGES)
        if (fields.length) setFieldErrors(Object.fromEntries(fields.map((f) => [f, FIELD_MESSAGES[f]])))
        else setError(e.message)
      } else {
        setError('서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const field = (name: Field, label: string, input: ReactNode) => (
    <div className="field">
      <label className="field__label" htmlFor={`auth-${name}`}>
        {label}
      </label>
      {input}
      {fieldErrors[name] && <span className="field__error">{fieldErrors[name]}</span>}
    </div>
  )
  const inputClass = (name: Field) => `input${fieldErrors[name] ? ' input--error' : ''}`

  const card = (
    <div className="auth__card">
      {isSignup && <Logo size={32} />}
      <div className="auth__heading">
        {isSignup ? (
          <>
            <h1>회원가입</h1>
            <p>팀원에게 보일 닉네임과 로그인 정보를 입력해 주세요.</p>
          </>
        ) : (
          <>
            <h1>
              뉴스를 모으고,
              <br />
              함께 맥락을 찾으세요.
            </h1>
            <p>흩어진 기사와 생각을 하나의 보드로.</p>
          </>
        )}
      </div>

      {inviteWaiting && (
        <div className="notice notice--info" role="status">
          <Icon name="link" />
          <span>{isSignup ? '가입하면' : '로그인하면'} 초대받은 보드로 돌아가요.</span>
        </div>
      )}
      {error && (
        <div className="notice notice--err" role="alert">
          <Icon name="alert" />
          <span>{error}</span>
        </div>
      )}

      <form className="auth__form" onSubmit={onSubmit} noValidate>
        {isSignup &&
          field(
            'nickname',
            '닉네임',
            <input
              id="auth-nickname"
              className={inputClass('nickname')}
              autoComplete="nickname"
              maxLength={20}
              placeholder="20자 이내"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />,
          )}
        {field(
          'email',
          '이메일',
          <input
            id="auth-email"
            className={inputClass('email')}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />,
        )}
        {field(
          'password',
          '비밀번호',
          <input
            id="auth-password"
            className={inputClass('password')}
            type="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            placeholder={isSignup ? '8자 이상' : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />,
        )}
        <div className="auth__submit">
          <button className="btn btn--block auth__submit-btn" type="submit" disabled={submitting}>
            {submitting ? (isSignup ? '가입하는 중…' : '로그인 중…') : isSignup ? '가입하기' : '로그인'}
          </button>
          {!isSignup && recent === 'local' && <span className="auth__recent-note">최근 사용한 로그인 방법</span>}
        </div>
      </form>

      {!isSignup && (
        <>
          <div className="auth__divider">또는</div>
          {/* 소셜 로그인은 서버 주소로 직접 이동한다 (인가 페이지 → 콜백 → 로그인 쿠키 발급 후 화면으로 복귀) */}
          <div className="auth__social-list">
            <button
              className="auth__social auth__social--kakao"
              type="button"
              disabled={!providers.kakao}
              onClick={() => window.location.assign(socialLoginUrl('kakao', from))}
            >
              <span className="auth__kakao-mark" aria-hidden="true" />
              {providers.kakao ? '카카오로 계속하기' : '카카오 로그인 준비 중'}
              {recent === 'kakao' && <span className="auth__recent auth__recent--kakao">{RECENT_LABEL}</span>}
            </button>
            <button
              className="auth__social auth__social--naver"
              type="button"
              disabled={!providers.naver}
              onClick={() => window.location.assign(socialLoginUrl('naver', from))}
            >
              <span className="auth__naver-mark" aria-hidden="true">
                N
              </span>
              {providers.naver ? '네이버로 계속하기' : '네이버 로그인 준비 중'}
              {recent === 'naver' && <span className="auth__recent auth__recent--naver">{RECENT_LABEL}</span>}
            </button>
          </div>
        </>
      )}

      <div className="auth__switch">
        <span>{isSignup ? '이미 계정이 있나요?' : '아직 계정이 없나요?'}</span>
        <Link to={isSignup ? '/login' : '/signup'} state={location.state}>
          {isSignup ? '로그인' : '회원가입'}
        </Link>
      </div>
    </div>
  )

  if (isSignup) return <div className="auth auth--signup">{card}</div>

  return (
    <div className="auth auth--login">
      <div className="auth__left">
        <Logo size={32} />
        <div className="auth__center">{card}</div>
      </div>
      <BoardIllustration />
    </div>
  )
}

/** 로그인 화면 오른쪽의 보드 그림 (장식) */
function BoardIllustration() {
  return (
    <div className="auth__art" aria-hidden="true">
      <div className="auth__art-board">
        <div className="auth__art-title">
          <b>AI 산업과 규제</b>
          <span>참여자 3명</span>
        </div>
        <div className="auth__art-card" style={{ left: 0, top: 48 }}>
          <span className="auth__art-kind">기사 · IT·과학</span>
          <span className="auth__art-head">국회 과방위, 고위험 AI 사업자 책임 범위 담은 시행령 초안 공개</span>
          <span className="auth__art-meta">누리일보 · 10월 4일 09:12</span>
        </div>
        <div className="auth__art-card auth__art-card--selected" style={{ left: 290, top: 72 }}>
          <span className="auth__art-kind">기사 · 국제</span>
          <span className="auth__art-head">EU AI Act enforcement begins: what changes for general-purpose models</span>
          <span className="auth__art-meta">The Guardian · 10월 3일 22:40</span>
        </div>
        <div className="auth__art-card auth__art-card--memo" style={{ left: 40, top: 230, width: 230 }}>
          <span className="auth__art-kind">메모 · 김서윤</span>
          <span>공통 쟁점: 기업의 책임 범위와 규제 적용 시점</span>
        </div>
        <div className="auth__art-card" style={{ left: 300, top: 260 }}>
          <span className="auth__art-kind">기사 · 경제</span>
          <span className="auth__art-head">국내 AI 반도체 스타트업, 2천억 원 규모 투자 유치</span>
          <span className="auth__art-meta">바른경제 · 10월 4일 08:05</span>
        </div>
      </div>
    </div>
  )
}
