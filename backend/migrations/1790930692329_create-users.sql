-- Up Migration
-- docs/erd.md USERS, REFRESH_TOKENS (ver.1.2) — F-07
CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT,
  password_hash TEXT,
  provider      TEXT        NOT NULL CHECK (provider IN ('local', 'kakao', 'naver')),
  provider_id   TEXT,
  nickname      TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 이메일 가입자는 이메일·비밀번호 필수, 소셜 가입자는 소셜 계정 ID 필수 (카카오는 이메일 제공이 선택 동의라 email이 없을 수 있음)
  CONSTRAINT users_credentials CHECK (
    (provider = 'local' AND email IS NOT NULL AND password_hash IS NOT NULL AND provider_id IS NULL)
    OR (provider <> 'local' AND provider_id IS NOT NULL AND password_hash IS NULL)
  )
);

-- 이메일 가입자끼리 이메일 중복 금지 (대소문자 구분 없이)
CREATE UNIQUE INDEX users_local_email_key ON users (lower(email)) WHERE provider = 'local';
-- 같은 소셜 계정으로 두 번 가입 금지
CREATE UNIQUE INDEX users_provider_id_key ON users (provider, provider_id) WHERE provider_id IS NOT NULL;

CREATE TABLE refresh_tokens (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL UNIQUE, -- 원문 대신 SHA-256 해시만 저장
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);

-- F-01에서 미뤄둔 FK: 사용자가 링크로 추가한 기사의 제출자
ALTER TABLE articles
  ADD CONSTRAINT articles_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES users (id) ON DELETE SET NULL;

-- Down Migration
ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_submitted_by_fkey;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;
