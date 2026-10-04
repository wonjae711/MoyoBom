-- Up Migration
-- docs/erd.md BOARDS, BOARD_MEMBERS, BOARD_INVITES, BOARD_ITEMS, BOARD_EVENTS — F-05·F-06·F-07(초대)
-- BOARD_CONNECTIONS(F-10), CLUSTERS·CLUSTER_ITEMS(F-08)는 해당 기능을 만들 때 추가한다.

CREATE TABLE boards (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id   BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title      TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 카드가 바뀔 때도 갱신한다 (보드 목록의 "마지막 수정 시각", F-06)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE board_members (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id  BIGINT      NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  user_id   BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role      TEXT        NOT NULL CHECK (role IN ('owner', 'editor')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (board_id, user_id)
);
-- 내가 속한 보드 목록 (F-06)
CREATE INDEX board_members_user_id_idx ON board_members (user_id);

CREATE TABLE board_invites (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- 보드당 유효한 초대 링크는 하나 (재발급하면 기존 링크를 지우고 새로 만든다)
  board_id   BIGINT      NOT NULL UNIQUE REFERENCES boards (id) ON DELETE CASCADE,
  token      TEXT        NOT NULL UNIQUE,
  created_by BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE board_items (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id        BIGINT           NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  item_type       TEXT             NOT NULL CHECK (item_type IN ('article', 'memo', 'photo')),
  -- 보드에 올라간 기사는 30일 정리 대상에서 빠지므로 기사가 먼저 지워질 일은 없다
  article_id      BIGINT           REFERENCES articles (id),
  content         TEXT             CHECK (content IS NULL OR char_length(content) <= 2000),
  image_key       TEXT,
  position_x      DOUBLE PRECISION NOT NULL,
  position_y      DOUBLE PRECISION NOT NULL,
  prev_position_x DOUBLE PRECISION,
  prev_position_y DOUBLE PRECISION,
  rotation        DOUBLE PRECISION NOT NULL DEFAULT 0,
  z_index         INTEGER          NOT NULL DEFAULT 0,
  created_by      BIGINT           REFERENCES users (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),
  -- 카드 종류별 필수값 (다형적 설계, erd.md 설계 포인트)
  CONSTRAINT board_items_type_fields CHECK (
    (item_type = 'article' AND article_id IS NOT NULL)
    OR (item_type = 'memo' AND content IS NOT NULL)
    OR (item_type = 'photo' AND image_key IS NOT NULL)
  )
);
CREATE INDEX board_items_board_id_idx ON board_items (board_id);
-- 30일 정리 작업에서 "보드에 올라간 기사인지" 확인
CREATE INDEX board_items_article_id_idx ON board_items (article_id) WHERE article_id IS NOT NULL;

CREATE TABLE board_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id    BIGINT      NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  user_id     BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  action_type TEXT        NOT NULL,
  payload     JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX board_events_board_id_created_at_idx ON board_events (board_id, created_at);

-- Down Migration
DROP TABLE IF EXISTS board_events;
DROP TABLE IF EXISTS board_items;
DROP TABLE IF EXISTS board_invites;
DROP TABLE IF EXISTS board_members;
DROP TABLE IF EXISTS boards;
