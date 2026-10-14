-- Up Migration
-- refresh token 3시간 (2026-10-14, 사용자 요청 — 이전 14일): 이미 발급된 토큰도 남은 기간을 지금부터 3시간으로 줄인다.
-- 쿠키 Max-Age는 브라우저에 남아도 서버가 만료로 거절하므로 다시 로그인하게 된다.
UPDATE refresh_tokens SET expires_at = least(expires_at, now() + interval '3 hours');

-- Down Migration
-- 줄인 만료 시각은 되돌리지 않는다 (다시 로그인하면 된다)
