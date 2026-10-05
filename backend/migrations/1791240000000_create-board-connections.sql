-- Up Migration
-- F-10 카드 간 수동 연결선 (docs/erd.md BOARD_CONNECTIONS). 사용자가 직접 긋는 선이며 AI 클러스터 연결선과 별개.
-- 카드 쌍은 항상 작은 id를 from으로 저장해(CHECK) A→B와 B→A를 같은 연결로 본다 — UNIQUE로 중복 연결 방지.
-- version: 연결을 만든 때의 보드 변경 순번(L-02와 같은 규칙으로 늦게 온 이벤트를 걸러냄)

CREATE TABLE board_connections (
  id            BIGSERIAL PRIMARY KEY,
  board_id      BIGINT      NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  from_item_id  BIGINT      NOT NULL REFERENCES board_items(id) ON DELETE CASCADE,
  to_item_id    BIGINT      NOT NULL REFERENCES board_items(id) ON DELETE CASCADE,
  created_by    BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  version       BIGINT      NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT board_connections_order CHECK (from_item_id < to_item_id),
  CONSTRAINT board_connections_pair_key UNIQUE (from_item_id, to_item_id)
);
CREATE INDEX board_connections_board_idx ON board_connections (board_id);
CREATE INDEX board_connections_to_idx ON board_connections (to_item_id);

-- Down Migration
DROP TABLE IF EXISTS board_connections;
