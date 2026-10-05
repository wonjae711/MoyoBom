import { NavLink } from 'react-router'
import { useDigestSubscription, useUnreadCount } from './unread'

/** 머리글의 "알림함" 링크 + 안 읽은 다이제스트 개수 (F-09). 새 다이제스트가 오면 바로 늘어난다 */
export function DigestLink({ className }: { className?: string }) {
  useDigestSubscription()
  const unread = useUnreadCount()
  return (
    <NavLink to="/digests" className={className} aria-label={unread ? `알림함, 안 읽은 다이제스트 ${unread}개` : '알림함'}>
      알림함
      {!!unread && <span className="digest-badge">{unread > 99 ? '99+' : unread}</span>}
    </NavLink>
  )
}
