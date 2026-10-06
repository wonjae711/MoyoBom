/**
 * 모여봄 마크 — 파란 카드와 보라 카드가 겹쳐 모이고(모여), 겹친 곳의 렌즈가 맥락을 들여다본다(봄).
 * 파란색은 마크에만 쓰고 UI 액션 색은 보라 하나로 유지한다 (인계 문서 0-2)
 */
export function Logo({ size = 28, withName = true }: { size?: number; withName?: boolean }) {
  return (
    <span className="logo">
      <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="모여봄" style={{ flex: 'none', display: 'block' }}>
        <rect x="2" y="9" width="19" height="19" rx="5" fill="#2F6BEA" />
        <rect x="11" y="3" width="19" height="19" rx="5" fill="#7C3AED" />
        <path d="M16 9h5v8a5 5 0 0 1-5 5h-5v-8a5 5 0 0 1 5-5z" fill="#4B3FD8" />
        <circle cx="16" cy="15.5" r="3.3" fill="none" stroke="#FFFFFF" strokeWidth="1.9" />
        <circle cx="16" cy="15.5" r="1.1" fill="#FFFFFF" />
      </svg>
      {withName && (
        <span className="logo__name" aria-hidden="true">
          모여봄
        </span>
      )}
    </span>
  )
}
