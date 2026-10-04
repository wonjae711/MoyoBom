/**
 * 카카오 로그인 시작 주소. 로그인 후 돌아갈 화면(예: 초대 페이지)을 next로 넘긴다 (C-12).
 * 서버도 내부 경로만 받지만, 여기서도 "/"로 시작하는 우리 화면 경로만 넘긴다.
 */
export function kakaoLoginUrl(from: string): string {
  const internal = from.startsWith('/') && !from.startsWith('//') && from !== '/'
  return internal ? `/api/auth/kakao?next=${encodeURIComponent(from)}` : '/api/auth/kakao'
}
