import { useEffect, useState } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router'
import { apiFetch } from '../api/client'
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

/**
 * 로그인 화면 (F-07). 보라 테마 프로토타입 — 왼쪽 로그인 카드 + 오른쪽 보드 그림.
 * 카카오·네이버 소셜 로그인만 쓴다 (이메일 가입·로그인은 2026-10-06 사용자 결정으로 제거 — 비밀번호를 보관하지 않음).
 * 처음 로그인하면 그 계정으로 바로 가입된다. 초대 링크에서 왔으면 로그인 뒤 그 초대 화면으로 돌아간다 (C-12)
 */
export function AuthPage() {
  const { user } = useAuth()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const inviteWaiting = from.startsWith('/invite/')
  const [searchParams] = useSearchParams()
  const [error] = useState<string | null>(() => SOCIAL_ERRORS[searchParams.get('error') ?? ''] ?? null)
  const [providers, setProviders] = useState<{ kakao: boolean; naver: boolean } | null>(null)
  const [recent] = useState(getRecentLogin)

  useEffect(() => {
    apiFetch<{ kakao: boolean; naver: boolean }>('/api/auth/providers')
      .then(setProviders)
      .catch(() => setProviders({ kakao: false, naver: false }))
  }, [])

  if (user) return <Navigate to={from} replace />

  const none = providers !== null && !providers.kakao && !providers.naver

  return (
    <div className="auth auth--login">
      <div className="auth__left">
        <Logo size={32} />
        <div className="auth__center">
          <div className="auth__card">
            <div className="auth__heading">
              <h1>
                뉴스를 모으고,
                <br />
                함께 맥락을 찾으세요.
              </h1>
              <p>흩어진 기사와 생각을 하나의 보드로.</p>
            </div>

            {inviteWaiting && (
              <div className="notice notice--info" role="status">
                <Icon name="link" />
                <span>로그인하면 초대받은 보드로 돌아가요.</span>
              </div>
            )}
            {error && (
              <div className="notice notice--err" role="alert">
                <Icon name="alert" />
                <span>{error}</span>
              </div>
            )}
            {none && (
              <div className="notice notice--warn" role="alert">
                <Icon name="alert" />
                <span>지금은 로그인할 수 없어요. 잠시 후 다시 시도해 주세요.</span>
              </div>
            )}

            {/* 소셜 로그인은 서버 주소로 직접 이동한다 (인가 페이지 → 콜백 → 로그인 쿠키 발급 후 화면으로 복귀) */}
            <div className="auth__social-list">
              <button
                className="auth__social auth__social--kakao"
                type="button"
                disabled={!providers?.kakao}
                onClick={() => window.location.assign(socialLoginUrl('kakao', from))}
              >
                <span className="auth__kakao-mark" aria-hidden="true" />
                {providers && !providers.kakao ? '카카오 로그인 준비 중' : '카카오로 계속하기'}
                {recent === 'kakao' && <span className="auth__recent auth__recent--kakao">{RECENT_LABEL}</span>}
              </button>
              <button
                className="auth__social auth__social--naver"
                type="button"
                disabled={!providers?.naver}
                onClick={() => window.location.assign(socialLoginUrl('naver', from))}
              >
                <span className="auth__naver-mark" aria-hidden="true">
                  N
                </span>
                {providers && !providers.naver ? '네이버 로그인 준비 중' : '네이버로 계속하기'}
                {recent === 'naver' && <span className="auth__recent auth__recent--naver">{RECENT_LABEL}</span>}
              </button>
            </div>
            <p className="auth__note">처음 로그인하면 그 계정으로 바로 가입돼요. 닉네임 외의 정보는 받지 않아요.</p>
          </div>
        </div>
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
