-- Up Migration
-- F-09 뉴스 다이제스트 (docs/erd.md ver.1.11, C-08 설계). 받는 시각은 한국 시간 매시 정각.
-- DIGESTS.UNIQUE(subscription_id, slot): 같은 구독·같은 받는 시각에는 한 번만 만든다 — 먼저 pending 행을 넣은 실행만 진행.
-- 포함 기사는 jsonb로 복사해 원본 기사가 30일 정리로 지워져도 알림은 남는다.

CREATE TABLE digest_subscriptions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  categories  TEXT[]      NOT NULL DEFAULT '{}',
  keywords    TEXT[]      NOT NULL DEFAULT '{}',
  send_hour   SMALLINT    NOT NULL,
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT digest_subscriptions_hour CHECK (send_hour BETWEEN 0 AND 23),
  CONSTRAINT digest_subscriptions_not_empty CHECK (cardinality(categories) > 0 OR cardinality(keywords) > 0),
  CONSTRAINT digest_subscriptions_keywords CHECK (cardinality(keywords) <= 5)
);
CREATE INDEX digest_subscriptions_user_idx ON digest_subscriptions (user_id);
CREATE INDEX digest_subscriptions_hour_idx ON digest_subscriptions (send_hour) WHERE active;

CREATE TABLE digests (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id  BIGINT      REFERENCES digest_subscriptions(id) ON DELETE SET NULL,
  kind             TEXT        NOT NULL,
  slot             TIMESTAMPTZ,
  status           TEXT        NOT NULL DEFAULT 'pending',
  title            TEXT        NOT NULL DEFAULT '',
  summary          TEXT,
  articles         JSONB       NOT NULL DEFAULT '[]',
  window_start     TIMESTAMPTZ NOT NULL,
  window_end       TIMESTAMPTZ NOT NULL,
  read_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT digests_kind CHECK (kind IN ('scheduled', 'manual')),
  CONSTRAINT digests_status CHECK (status IN ('pending', 'ok', 'empty', 'failed')),
  CONSTRAINT digests_slot CHECK ((kind = 'scheduled') = (slot IS NOT NULL)),
  CONSTRAINT digests_subscription_slot_key UNIQUE (subscription_id, slot)
);
CREATE INDEX digests_user_idx ON digests (user_id, created_at DESC);
CREATE INDEX digests_unread_idx ON digests (user_id) WHERE read_at IS NULL;

-- Down Migration
DROP TABLE IF EXISTS digests;
DROP TABLE IF EXISTS digest_subscriptions;
