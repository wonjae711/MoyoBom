-- Up Migration
-- F-08 AI 이슈 클러스터링 (docs/erd.md CLUSTERS·CLUSTER_ITEMS). 보드를 다시 분석하면 그 보드의 클러스터를 통째로 바꾼다.
-- x·y: 보드 위 클러스터 카드 위치(분석할 때 묶인 카드들의 가운데 위쪽에 놓음)

CREATE TABLE clusters (
  id          BIGSERIAL PRIMARY KEY,
  board_id    BIGINT      NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  summary     TEXT        NOT NULL DEFAULT '',
  x           DOUBLE PRECISION NOT NULL DEFAULT 0,
  y           DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_by  BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX clusters_board_idx ON clusters (board_id);

-- 카드 하나는 한 클러스터에만 속한다 (UNIQUE(board_item_id))
CREATE TABLE cluster_items (
  cluster_id     BIGINT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  board_item_id  BIGINT NOT NULL UNIQUE REFERENCES board_items(id) ON DELETE CASCADE,
  PRIMARY KEY (cluster_id, board_item_id)
);

-- "자동 정렬"한 시점의 카드 버전. 이후 누가 손으로 옮기면 version이 달라져 "원래대로"에서 그 카드는 건드리지 않는다 (C-05 기본안)
ALTER TABLE board_items ADD COLUMN arranged_version BIGINT;

-- Down Migration
ALTER TABLE board_items DROP COLUMN IF EXISTS arranged_version;
DROP TABLE IF EXISTS cluster_items;
DROP TABLE IF EXISTS clusters;
