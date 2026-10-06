-- Up Migration
-- 이메일 가입·로그인 제거 (2026-10-06 사용자 결정 — 카카오·네이버 소셜 로그인만 남김).
-- 비밀번호 해시를 더 이상 보관하지 않는다. 예전 이메일 계정(provider='local') 행은 그 계정의 보드·카드를 지키기 위해 남기지만 로그인할 수는 없다.

ALTER TABLE users DROP CONSTRAINT users_credentials;
DROP INDEX IF EXISTS users_local_email_key;
ALTER TABLE users DROP COLUMN password_hash;
-- 소셜 계정은 소셜 계정 ID가 반드시 있다
ALTER TABLE users ADD CONSTRAINT users_credentials CHECK (provider = 'local' OR provider_id IS NOT NULL);

-- Down Migration
-- 비밀번호 해시는 되살릴 수 없다 (예전 이메일 계정은 비밀번호 없이 남는다)
ALTER TABLE users DROP CONSTRAINT users_credentials;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD CONSTRAINT users_credentials CHECK (provider = 'local' OR provider_id IS NOT NULL);
