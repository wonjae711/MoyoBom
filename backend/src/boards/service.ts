import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { CategoryCode } from '../news/types.js';
import {
  BoardError,
  type BoardItem,
  type BoardCluster,
  type BoardConnection,
  type BoardMember,
  type BoardRole,
  type BoardSnapshot,
  type BoardSummary,
  type BoardThumbItem,
  type ItemType,
} from './types.js';

/** 초대 링크 유효기간 7일 (requirements.md F-07 초대 링크 정책) */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface ItemRow {
  id: string;
  item_type: ItemType;
  article_id: string | null;
  content: string | null;
  image_key: string | null;
  position_x: number;
  position_y: number;
  rotation: number;
  z_index: number;
  created_by: string | null;
  updated_at: Date;
  version: string;
  arranged: boolean;
  a_title: string | null;
  a_description: string | null;
  a_source: string | null;
  a_category: string | null;
  a_original_link: string | null;
  a_published_at: Date | null;
  a_created_at: Date | null;
  a_source_type: string | null;
  a_image_url: string | null;
}

const ITEM_COLUMNS = `
  bi.id, bi.item_type, bi.article_id, bi.content, bi.image_key, bi.position_x, bi.position_y,
  bi.rotation, bi.z_index, bi.created_by, bi.updated_at, bi.version::text AS version,
  (bi.arranged_version IS NOT NULL) AS arranged,
  a.title AS a_title, a.description AS a_description, a.source AS a_source, a.category AS a_category,
  a.original_link AS a_original_link, a.published_at AS a_published_at,
  a.created_at AS a_created_at, a.source_type AS a_source_type, a.image_url AS a_image_url`;

function toItem(row: ItemRow): BoardItem {
  return {
    id: row.id,
    type: row.item_type,
    articleId: row.article_id,
    article:
      row.article_id && row.a_title !== null
        ? {
            title: row.a_title,
            description: row.a_description ?? '',
            source: row.a_source ?? '',
            category: row.a_category as CategoryCode | null,
            originalLink: row.a_original_link ?? '',
            publishedAt: row.a_published_at?.toISOString() ?? null,
            collectedAt: (row.a_created_at ?? row.updated_at).toISOString(),
            submitted: row.a_source_type === 'user_submitted',
            imageUrl: row.a_image_url,
          }
        : null,
    content: row.content,
    imageKey: row.image_key,
    x: row.position_x,
    y: row.position_y,
    rotation: row.rotation,
    zIndex: row.z_index,
    createdBy: row.created_by,
    updatedAt: row.updated_at.toISOString(),
    version: Number(row.version),
    arranged: row.arranged,
  };
}

/** 자동 정렬 배치: 클러스터 카드 오른쪽에 3열 격자 (목업의 tidy 배치와 같은 간격) */
export function arrangedPosition(cluster: { x: number; y: number }, index: number): { x: number; y: number } {
  return { x: cluster.x + 260 + (index % 3) * 232, y: cluster.y + Math.floor(index / 3) * 190 };
}

export interface NewCluster {
  title: string;
  summary: string;
  x: number;
  y: number;
  itemIds: string[];
}

type Db = pg.Pool | pg.PoolClient;

/** 새 카드 기울기: -4°~+4°, 0.5° 단위 (2026-10-10 탐정 보드 느낌 — 사용자 요청) */
export const MAX_AUTO_TILT = 4;
function randomTilt(): number {
  return Math.round((Math.random() * 2 - 1) * MAX_AUTO_TILT * 2) / 2;
}

export type NewItemInput =
  | { type: 'article'; articleId: string; x: number; y: number }
  | { type: 'memo'; content: string; x: number; y: number }
  /** 사진은 PhotoService.verifyUpload로 이 보드에 올라간 것을 확인한 key만 넘긴다. content는 설명 */
  | { type: 'photo'; imageKey: string; content: string | null; x: number; y: number };

/**
 * 보드·멤버·초대·카드 (F-05, F-06, F-07 초대).
 * 모든 작업은 먼저 멤버인지 확인한다. 멤버가 아니면 보드가 있어도 not_found로 답해 존재 여부를 숨긴다.
 * 카드 변경은 board_items(현재 상태)와 board_events(변경 기록)에 함께 저장한다.
 *
 * 변경 순서 (L-02·L-05): 보드를 바꾸는 트랜잭션은 맨 먼저 bump()로 boards.seq를 올리고, 그 뒤에 권한을 확인한다(L-06 —
 * 내보내기와 동시에 들어온 변경이 내보내기 커밋 전의 멤버 정보로 통과하지 않도록). 이 행 잠금을 커밋까지 쥐므로
 * 같은 보드의 변경은 한 줄로 서고, seq 순서가 곧 커밋 순서다. 카드의 version = 마지막으로 바뀐 때의 seq이며,
 * 클라이언트는 이 값으로 늦게 도착한 이벤트·스냅샷과 겹친 이벤트를 걸러낸다. z_index(최대+1)도 잠금 뒤에 계산해 겹치지 않는다.
 */
export class BoardService {
  /** 새 카드의 기울기(도). 탐정 보드처럼 살짝 비뚤게 붙인다 — 테스트에서는 고정값을 주입 */
  private readonly tilt: () => number;

  constructor(
    private readonly pool: pg.Pool,
    options: { tilt?: () => number } = {},
  ) {
    this.tilt = options.tilt ?? randomTilt;
  }

  private async tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getRole(boardId: string, userId: string, db: Db = this.pool): Promise<BoardRole | null> {
    const { rows } = await db.query<{ role: BoardRole }>(
      'SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2',
      [boardId, userId],
    );
    return rows[0]?.role ?? null;
  }

  private async requireRole(boardId: string, userId: string, need: 'member' | 'owner', db: Db = this.pool) {
    const role = await this.getRole(boardId, userId, db);
    if (!role) throw new BoardError('not_found', '보드를 찾을 수 없습니다');
    if (need === 'owner' && role !== 'owner') throw new BoardError('forbidden', '보드 주인만 할 수 있습니다');
    return role;
  }

  /** 보드 변경 순번을 올리고(행 잠금 — 커밋까지 같은 보드의 다른 변경을 기다리게 함) 새 순번을 돌려준다 */
  private async bump(client: pg.PoolClient, boardId: string): Promise<number> {
    const { rows } = await client.query<{ seq: string }>(
      'UPDATE boards SET seq = seq + 1, updated_at = now() WHERE id = $1 RETURNING seq::text AS seq',
      [boardId],
    );
    if (!rows[0]) throw new BoardError('not_found', '보드를 찾을 수 없습니다');
    return Number(rows[0].seq);
  }

  private async log(db: Db, boardId: string, userId: string, actionType: string, payload: object) {
    await db.query('INSERT INTO board_events (board_id, user_id, action_type, payload) VALUES ($1, $2, $3, $4)', [
      boardId,
      userId,
      actionType,
      JSON.stringify(payload),
    ]);
  }

  // ---------- 보드 (F-06) ----------

  async listBoards(userId: string): Promise<BoardSummary[]> {
    const { rows } = await this.pool.query<{
      id: string;
      title: string;
      role: BoardRole;
      member_count: number;
      item_count: number;
      updated_at: Date;
      thumb: BoardThumbItem[] | null;
    }>(
      `SELECT b.id, b.title, m.role, b.updated_at,
         (SELECT count(*)::int FROM board_members WHERE board_id = b.id) AS member_count,
         (SELECT count(*)::int FROM board_items WHERE board_id = b.id) AS item_count,
         (SELECT json_agg(json_build_object('x', t.position_x, 'y', t.position_y, 'type', t.item_type))
            FROM (SELECT position_x, position_y, item_type FROM board_items
                  WHERE board_id = b.id ORDER BY z_index DESC, id DESC LIMIT 10) t) AS thumb
       FROM board_members m JOIN boards b ON b.id = m.board_id
       WHERE m.user_id = $1
       ORDER BY b.updated_at DESC, b.id DESC`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      role: r.role,
      memberCount: r.member_count,
      itemCount: r.item_count,
      updatedAt: r.updated_at.toISOString(),
      thumb: r.thumb ?? [],
    }));
  }

  /** 새 보드를 만들고 만든 사람을 owner로 넣는다 */
  async createBoard(userId: string, title: string): Promise<BoardSummary> {
    return this.tx(async (client) => {
      const { rows } = await client.query<{ id: string; updated_at: Date }>(
        'INSERT INTO boards (owner_id, title) VALUES ($1, $2) RETURNING id, updated_at',
        [userId, title],
      );
      const board = rows[0]!;
      await client.query("INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, 'owner')", [
        board.id,
        userId,
      ]);
      return { id: board.id, title, role: 'owner', memberCount: 1, itemCount: 0, updatedAt: board.updated_at.toISOString(), thumb: [] };
    });
  }

  /**
   * 보드 전체 상태. 한 트랜잭션(REPEATABLE READ)에서 읽어 seq와 카드 목록이 같은 시점을 가리키게 한다 —
   * seq 이하의 변경은 모두 들어 있고, 그보다 큰 변경은 하나도 들어 있지 않다.
   */
  async getSnapshot(boardId: string, userId: string): Promise<BoardSnapshot> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const role = await this.requireRole(boardId, userId, 'member', client);
      const board = await client.query<{ id: string; title: string; owner_id: string; updated_at: Date; seq: string }>(
        'SELECT id, title, owner_id, updated_at, seq::text AS seq FROM boards WHERE id = $1',
        [boardId],
      );
      const members = await client.query<{ user_id: string; nickname: string; role: BoardRole }>(
        `SELECT m.user_id, u.nickname, m.role FROM board_members m JOIN users u ON u.id = m.user_id
         WHERE m.board_id = $1 ORDER BY m.role DESC, m.joined_at`,
        [boardId],
      );
      const items = await client.query<ItemRow>(
        `SELECT ${ITEM_COLUMNS} FROM board_items bi LEFT JOIN articles a ON a.id = bi.article_id
         WHERE bi.board_id = $1 ORDER BY bi.z_index, bi.id`,
        [boardId],
      );
      const clusters = await this.listClusters(boardId, client);
      const connections = await this.listConnections(boardId, client);
      await client.query('COMMIT');
      const b = board.rows[0]!;
      return {
        board: { id: b.id, title: b.title, ownerId: b.owner_id, updatedAt: b.updated_at.toISOString(), seq: Number(b.seq) },
        role,
        members: members.rows.map((m): BoardMember => ({ userId: m.user_id, nickname: m.nickname, role: m.role })),
        items: items.rows.map(toItem),
        clusters,
        connections,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async renameBoard(boardId: string, userId: string, title: string): Promise<void> {
    await this.requireRole(boardId, userId, 'owner');
    await this.pool.query('UPDATE boards SET title = $2, updated_at = now() WHERE id = $1', [boardId, title]);
  }

  async deleteBoard(boardId: string, userId: string): Promise<void> {
    await this.requireRole(boardId, userId, 'owner');
    await this.pool.query('DELETE FROM boards WHERE id = $1', [boardId]);
  }

  // ---------- 멤버·초대 (F-07) ----------

  /** owner만: 현재 초대 링크를 돌려준다. 없거나 만료됐으면 새로 만든다 */
  async getInvite(boardId: string, userId: string, now = new Date()): Promise<{ token: string; expiresAt: string }> {
    await this.requireRole(boardId, userId, 'owner');
    const { rows } = await this.pool.query<{ token: string; expires_at: Date }>(
      'SELECT token, expires_at FROM board_invites WHERE board_id = $1 AND expires_at > $2',
      [boardId, now],
    );
    const current = rows[0];
    return current
      ? { token: current.token, expiresAt: current.expires_at.toISOString() }
      : this.reissueInvite(boardId, userId, now);
  }

  /** owner만: 초대 링크를 새로 만든다. 기존 링크는 더 이상 쓸 수 없다 */
  async reissueInvite(boardId: string, userId: string, now = new Date()): Promise<{ token: string; expiresAt: string }> {
    await this.requireRole(boardId, userId, 'owner');
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    await this.pool.query(
      `INSERT INTO board_invites (board_id, token, created_by, expires_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (board_id) DO UPDATE SET token = EXCLUDED.token, created_by = EXCLUDED.created_by,
         expires_at = EXCLUDED.expires_at, created_at = now()`,
      [boardId, token, userId, expiresAt],
    );
    return { token, expiresAt: expiresAt.toISOString() };
  }

  private async findInvite(token: string, now: Date, db: Db = this.pool) {
    const { rows } = await db.query<{ board_id: string; title: string; member_count: number }>(
      `SELECT i.board_id, b.title, (SELECT count(*)::int FROM board_members WHERE board_id = b.id) AS member_count
       FROM board_invites i JOIN boards b ON b.id = i.board_id
       WHERE i.token = $1 AND i.expires_at > $2`,
      [token, now],
    );
    if (!rows[0]) throw new BoardError('invite_invalid', '만료되었거나 올바르지 않은 초대 링크입니다');
    return rows[0];
  }

  /** 초대 링크를 열었을 때 보여줄 보드 정보 */
  async previewInvite(token: string, now = new Date()): Promise<{ boardId: string; title: string; memberCount: number }> {
    const invite = await this.findInvite(token, now);
    return { boardId: invite.board_id, title: invite.title, memberCount: invite.member_count };
  }

  /** 초대 수락: editor로 참여한다. 이미 멤버면 그대로 둔다 */
  async acceptInvite(token: string, userId: string, now = new Date()): Promise<{ boardId: string; joined: boolean }> {
    return this.tx(async (client) => {
      const invite = await this.findInvite(token, now, client);
      await this.bump(client, invite.board_id);
      const { rowCount } = await client.query(
        `INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, 'editor')
         ON CONFLICT (board_id, user_id) DO NOTHING`,
        [invite.board_id, userId],
      );
      if (rowCount) await this.log(client, invite.board_id, userId, 'member:join', {});
      return { boardId: invite.board_id, joined: rowCount === 1 };
    });
  }

  /** owner는 editor를 내보낼 수 있고, editor는 스스로 나갈 수 있다. owner는 나갈 수 없다(보드 삭제만 가능) */
  async removeMember(boardId: string, actorId: string, targetUserId: string): Promise<void> {
    const actorRole = await this.requireRole(boardId, actorId, 'member');
    if (actorId !== targetUserId && actorRole !== 'owner') {
      throw new BoardError('forbidden', '보드 주인만 다른 멤버를 내보낼 수 있습니다');
    }
    const targetRole = await this.getRole(boardId, targetUserId);
    if (!targetRole) throw new BoardError('not_found', '보드 멤버가 아닙니다');
    if (targetRole === 'owner') throw new BoardError('invalid', '보드 주인은 나갈 수 없습니다. 보드를 삭제해 주세요');
    await this.tx(async (client) => {
      await this.bump(client, boardId);
      await client.query('DELETE FROM board_members WHERE board_id = $1 AND user_id = $2', [boardId, targetUserId]);
      await this.log(client, boardId, actorId, actorId === targetUserId ? 'member:leave' : 'member:remove', {
        userId: targetUserId,
      });
    });
  }

  // ---------- 카드 (F-05) ----------

  private async selectItem(db: Db, boardId: string, itemId: string): Promise<BoardItem> {
    const { rows } = await db.query<ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM board_items bi LEFT JOIN articles a ON a.id = bi.article_id
       WHERE bi.board_id = $1 AND bi.id = $2`,
      [boardId, itemId],
    );
    if (!rows[0]) throw new BoardError('not_found', '이미 삭제된 카드입니다');
    return toItem(rows[0]);
  }

  /**
   * 새 카드는 맨 위(z_index 최대+1)에 놓는다.
   * 사용자가 링크로 추가한 기사(user_submitted)는 그 기사가 이미 이 보드에 있을 때만 id로 다시 올릴 수 있다 —
   * 다른 보드의 제출 기사를 id 추측으로 가져오지 못하게 한다 (C-06). 링크 추가(F-03)는 allowSubmitted로 통과한다
   */
  /** 뉴스 화면에서 고른 기사를 보드의 맨 아래 왼쪽(기존 카드 아래 260)에 놓는다 (B7) */
  async addArticleBelow(boardId: string, userId: string, articleId: string): Promise<BoardItem> {
    const { rows } = await this.pool.query<{ x: number | null; y: number | null }>(
      'SELECT min(position_x) AS x, max(position_y) AS y FROM board_items WHERE board_id = $1',
      [boardId],
    );
    const x = rows[0]?.x ?? 0;
    const y = rows[0]?.y === null || rows[0]?.y === undefined ? 0 : rows[0].y + 260;
    return this.addItem(boardId, userId, { type: 'article', articleId, x, y });
  }

  async addItem(
    boardId: string,
    userId: string,
    input: NewItemInput,
    options: { allowSubmitted?: boolean } = {},
  ): Promise<BoardItem> {
    return this.tx(async (client) => {
      // 잠금을 먼저 잡고 권한을 본다 — 진행 중인 내보내기가 커밋된 뒤의 멤버 상태로 판단하도록 (L-06)
      const seq = await this.bump(client, boardId);
      await this.requireRole(boardId, userId, 'member', client);
      if (input.type === 'article') {
        const { rows } = await client.query<{ source_type: string; on_board: boolean }>(
          `SELECT a.source_type,
             EXISTS (SELECT 1 FROM board_items bi WHERE bi.board_id = $2 AND bi.article_id = a.id) AS on_board
           FROM articles a WHERE a.id = $1`,
          [input.articleId, boardId],
        );
        const article = rows[0];
        const hidden = article?.source_type === 'user_submitted' && !article.on_board && !options.allowSubmitted;
        if (!article || hidden) throw new BoardError('invalid', '없는 기사입니다');
      }
      if (input.type === 'photo') {
        // 한 사진은 한 카드만 — 두 카드가 같은 사진을 쓰면 한쪽을 지울 때 다른 쪽 사진도 사라진다
        const { rowCount } = await client.query('SELECT 1 FROM board_items WHERE image_key = $1', [input.imageKey]);
        if (rowCount) throw new BoardError('invalid', '이미 카드로 만든 사진입니다');
      }
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO board_items (board_id, item_type, article_id, content, image_key, position_x, position_y, rotation, z_index, created_by, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
           (SELECT coalesce(max(z_index), 0) + 1 FROM board_items WHERE board_id = $1), $9, $10)
         RETURNING id`,
        [
          boardId,
          input.type,
          input.type === 'article' ? input.articleId : null,
          input.type === 'article' ? null : input.content,
          input.type === 'photo' ? input.imageKey : null,
          input.x,
          input.y,
          this.tilt(),
          userId,
          seq,
        ],
      );
      const itemId = rows[0]!.id;
      await this.log(client, boardId, userId, 'card:add', { itemId, type: input.type });
      return this.selectItem(client, boardId, itemId);
    });
  }

  /**
   * 드래그가 끝난 뒤 위치를 저장한다 (last-write-wins). 옮긴 카드는 맨 위로 올라온다.
   * 드래그 중의 중간 위치는 저장하지 않는다 (card:moving은 소켓으로 중계만).
   */
  async moveItem(
    boardId: string,
    userId: string,
    itemId: string,
    to: { x: number; y: number; rotation?: number },
  ): Promise<BoardItem> {
    return this.tx(async (client) => {
      // 잠금을 먼저 잡고 권한을 본다 — 진행 중인 내보내기가 커밋된 뒤의 멤버 상태로 판단하도록 (L-06)
      const seq = await this.bump(client, boardId);
      await this.requireRole(boardId, userId, 'member', client);
      const { rowCount } = await client.query(
        `UPDATE board_items SET position_x = $3, position_y = $4, rotation = coalesce($5, rotation),
           z_index = (SELECT coalesce(max(z_index), 0) + 1 FROM board_items WHERE board_id = $1),
           updated_at = now(), version = $6
         WHERE board_id = $1 AND id = $2`,
        [boardId, itemId, to.x, to.y, to.rotation ?? null, seq],
      );
      if (!rowCount) throw new BoardError('not_found', '이미 삭제된 카드입니다');
      await this.log(client, boardId, userId, 'card:move', { itemId, x: to.x, y: to.y, rotation: to.rotation });
      return this.selectItem(client, boardId, itemId);
    });
  }

  /** 메모 내용 또는 사진 설명을 바꾼다 */
  async updateMemo(boardId: string, userId: string, itemId: string, content: string): Promise<BoardItem> {
    return this.tx(async (client) => {
      // 잠금을 먼저 잡고 권한을 본다 — 진행 중인 내보내기가 커밋된 뒤의 멤버 상태로 판단하도록 (L-06)
      const seq = await this.bump(client, boardId);
      await this.requireRole(boardId, userId, 'member', client);
      const { rowCount } = await client.query(
        `UPDATE board_items SET content = $3, updated_at = now(), version = $4
         WHERE board_id = $1 AND id = $2 AND item_type IN ('memo', 'photo')`,
        [boardId, itemId, content, seq],
      );
      if (!rowCount) throw new BoardError('not_found', '이미 삭제된 메모입니다');
      await this.log(client, boardId, userId, 'card:update', { itemId });
      return this.selectItem(client, boardId, itemId);
    });
  }

  /**
   * 삭제도 순번을 받는다. 클라이언트는 이 순번 이하의 늦은 이벤트로 카드를 되살리지 않는다.
   * 사진 카드면 imageKey를 돌려준다 — 커밋 뒤 호출한 쪽이 S3 사진을 지운다
   */
  async deleteItem(boardId: string, userId: string, itemId: string): Promise<{ version: number; imageKey: string | null }> {
    return this.tx(async (client) => {
      // 잠금을 먼저 잡고 권한을 본다 — 진행 중인 내보내기가 커밋된 뒤의 멤버 상태로 판단하도록 (L-06)
      const seq = await this.bump(client, boardId);
      await this.requireRole(boardId, userId, 'member', client);
      const { rows } = await client.query<{ image_key: string | null }>(
        'DELETE FROM board_items WHERE board_id = $1 AND id = $2 RETURNING image_key',
        [boardId, itemId],
      );
      if (!rows[0]) throw new BoardError('not_found', '이미 삭제된 카드입니다');
      await this.log(client, boardId, userId, 'card:delete', { itemId });
      return { version: seq, imageKey: rows[0].image_key };
    });
  }

  // ---------- AI 클러스터 (F-08) ----------
  // 클러스터를 바꾸는 작업도 bump()로 보드 변경 순번을 올린다 — 클라이언트는 순번이 큰 클러스터 목록만 받아들인다

  async listClusters(boardId: string, db: Db = this.pool): Promise<BoardCluster[]> {
    const { rows } = await db.query<{ id: string; title: string; summary: string; x: number; y: number; item_ids: string[] }>(
      `SELECT c.id, c.title, c.summary, c.x, c.y,
         coalesce(array_agg(ci.board_item_id::text ORDER BY ci.board_item_id) FILTER (WHERE ci.board_item_id IS NOT NULL), '{}') AS item_ids
       FROM clusters c LEFT JOIN cluster_items ci ON ci.cluster_id = c.id
       WHERE c.board_id = $1 GROUP BY c.id ORDER BY c.id`,
      [boardId],
    );
    return rows.map((r) => ({ id: r.id, title: r.title, summary: r.summary, x: r.x, y: r.y, itemIds: r.item_ids }));
  }

  /** 보드의 클러스터를 새 분석 결과로 통째로 바꾼다. 분석 중 지워진 카드는 빠진다. 카드 좌표는 바꾸지 않는다 */
  async replaceClusters(
    boardId: string,
    userId: string,
    clusters: NewCluster[],
  ): Promise<{ seq: number; clusters: BoardCluster[] }> {
    return this.tx(async (client) => {
      // 잠금을 먼저 잡고 권한을 본다 — 진행 중인 내보내기가 커밋된 뒤의 멤버 상태로 판단하도록 (L-06)
      const seq = await this.bump(client, boardId);
      await this.requireRole(boardId, userId, 'member', client);
      await client.query('DELETE FROM clusters WHERE board_id = $1', [boardId]);
      for (const cluster of clusters) {
        const { rows } = await client.query<{ id: string }>(
          'INSERT INTO clusters (board_id, title, summary, x, y, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [boardId, cluster.title, cluster.summary, cluster.x, cluster.y, userId],
        );
        await client.query(
          `INSERT INTO cluster_items (cluster_id, board_item_id)
           SELECT $1, bi.id FROM board_items bi WHERE bi.board_id = $2 AND bi.id = ANY($3::bigint[])
           ON CONFLICT (board_item_id) DO NOTHING`,
          [rows[0]!.id, boardId, cluster.itemIds],
        );
      }
      await this.log(client, boardId, userId, 'clusters:replace', { count: clusters.length });
      return { seq, clusters: await this.listClusters(boardId, client) };
    });
  }

  /** "제안 무시": 클러스터만 지우고 카드는 그대로 둔다 */
  async dismissCluster(boardId: string, userId: string, clusterId: string): Promise<{ seq: number; clusters: BoardCluster[] }> {
    return this.tx(async (client) => {
      // 잠금을 먼저 잡고 권한을 본다 — 진행 중인 내보내기가 커밋된 뒤의 멤버 상태로 판단하도록 (L-06)
      const seq = await this.bump(client, boardId);
      await this.requireRole(boardId, userId, 'member', client);
      const { rowCount } = await client.query('DELETE FROM clusters WHERE board_id = $1 AND id = $2', [boardId, clusterId]);
      if (!rowCount) throw new BoardError('not_found', '이미 사라진 클러스터입니다');
      await this.log(client, boardId, userId, 'cluster:dismiss', { clusterId });
      return { seq, clusters: await this.listClusters(boardId, client) };
    });
  }

  /**
   * "자동 정렬": 클러스터의 카드를 클러스터 카드 옆 격자로 옮긴다 (F-08 처리 로직 6).
   * 옮기기 전 좌표를 prev_position에 저장한다. 이미 정렬된 상태라 저장된 좌표가 있으면 그 원래 좌표를 지킨다
   */
  async arrangeCluster(boardId: string, userId: string, clusterId: string): Promise<BoardItem[]> {
    return this.tx(async (client) => {
      // 잠금을 먼저 잡고 권한을 본다 — 진행 중인 내보내기가 커밋된 뒤의 멤버 상태로 판단하도록 (L-06)
      const seq = await this.bump(client, boardId);
      await this.requireRole(boardId, userId, 'member', client);
      const cluster = await this.clusterOf(client, boardId, clusterId);
      const { rows } = await client.query<{ id: string }>(
        `SELECT bi.id FROM cluster_items ci JOIN board_items bi ON bi.id = ci.board_item_id
         WHERE ci.cluster_id = $1 ORDER BY bi.id`,
        [clusterId],
      );
      const items: BoardItem[] = [];
      for (const [index, row] of rows.entries()) {
        const to = arrangedPosition(cluster, index);
        await client.query(
          `UPDATE board_items SET
             prev_position_x = coalesce(prev_position_x, position_x), prev_position_y = coalesce(prev_position_y, position_y),
             position_x = $2, position_y = $3, version = $4, arranged_version = $4, updated_at = now()
           WHERE id = $1`,
          [row.id, to.x, to.y, seq],
        );
        items.push(await this.selectItem(client, boardId, row.id));
      }
      await this.log(client, boardId, userId, 'cluster:arrange', { clusterId, count: items.length });
      return items;
    });
  }

  /**
   * "원래대로": 자동 정렬 뒤 아무도 손대지 않은 카드만 정렬 전 좌표로 되돌린다.
   * 그 사이 누가 직접 옮긴 카드는 그 자리에 둔다 — 사람의 배치가 AI 배치보다 우선 (C-05 기본안, 설계 원칙 'AI는 보조 도구')
   */
  async restoreCluster(boardId: string, userId: string, clusterId: string): Promise<BoardItem[]> {
    return this.tx(async (client) => {
      // 잠금을 먼저 잡고 권한을 본다 — 진행 중인 내보내기가 커밋된 뒤의 멤버 상태로 판단하도록 (L-06)
      const seq = await this.bump(client, boardId);
      await this.requireRole(boardId, userId, 'member', client);
      await this.clusterOf(client, boardId, clusterId);
      const { rows } = await client.query<{ id: string }>(
        `UPDATE board_items bi SET
           position_x = bi.prev_position_x, position_y = bi.prev_position_y, version = $2, updated_at = now(),
           prev_position_x = NULL, prev_position_y = NULL, arranged_version = NULL
         FROM cluster_items ci
         WHERE ci.cluster_id = $1 AND bi.id = ci.board_item_id
           AND bi.arranged_version IS NOT NULL AND bi.version = bi.arranged_version AND bi.prev_position_x IS NOT NULL
         RETURNING bi.id`,
        [clusterId, seq],
      );
      // 손으로 옮긴 카드는 위치는 두고 "정렬됨" 표시만 지운다 (화면 위치가 바뀌지 않으므로 알릴 필요 없음)
      await client.query(
        `UPDATE board_items bi SET prev_position_x = NULL, prev_position_y = NULL, arranged_version = NULL
         FROM cluster_items ci WHERE ci.cluster_id = $1 AND bi.id = ci.board_item_id AND bi.arranged_version IS NOT NULL`,
        [clusterId],
      );
      const items: BoardItem[] = [];
      for (const row of rows) items.push(await this.selectItem(client, boardId, row.id));
      await this.log(client, boardId, userId, 'cluster:restore', { clusterId, count: items.length });
      return items;
    });
  }

  private async clusterOf(client: pg.PoolClient, boardId: string, clusterId: string) {
    const { rows } = await client.query<{ x: number; y: number }>('SELECT x, y FROM clusters WHERE board_id = $1 AND id = $2', [
      boardId,
      clusterId,
    ]);
    if (!rows[0]) throw new BoardError('not_found', '이미 사라진 클러스터입니다');
    return rows[0];
  }

  // ---------- 카드 간 수동 연결선 (F-10) ----------

  async listConnections(boardId: string, db: Db = this.pool): Promise<BoardConnection[]> {
    const { rows } = await db.query<{ id: string; from_item_id: string; to_item_id: string; created_by: string | null; version: string }>(
      `SELECT id, from_item_id, to_item_id, created_by, version::text AS version
       FROM board_connections WHERE board_id = $1 ORDER BY id`,
      [boardId],
    );
    return rows.map((r) => ({
      id: r.id,
      fromId: r.from_item_id,
      toId: r.to_item_id,
      createdBy: r.created_by,
      version: Number(r.version),
    }));
  }

  /**
   * 두 카드를 잇는다. 카드 쌍은 작은 id를 from으로 정렬해 저장하므로 A→B·B→A가 같은 연결이다.
   * 이미 연결된 쌍·같은 카드·다른 보드의 카드는 거절한다 (F-10 예외 처리)
   */
  async addConnection(boardId: string, userId: string, a: string, b: string): Promise<BoardConnection> {
    return this.tx(async (client) => {
      const seq = await this.bump(client, boardId);
      await this.requireRole(boardId, userId, 'member', client);
      if (a === b) throw new BoardError('invalid', '같은 카드끼리는 연결할 수 없습니다');
      const [from, to] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
      const { rowCount } = await client.query('SELECT 1 FROM board_items WHERE board_id = $1 AND id = ANY($2::bigint[])', [
        boardId,
        [from, to],
      ]);
      if (rowCount !== 2) throw new BoardError('not_found', '이미 삭제된 카드입니다');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO board_connections (board_id, from_item_id, to_item_id, created_by, version)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (from_item_id, to_item_id) DO NOTHING RETURNING id`,
        [boardId, from, to, userId, seq],
      );
      if (!rows[0]) throw new BoardError('invalid', '이미 연결된 카드입니다');
      await this.log(client, boardId, userId, 'connection:add', { connectionId: rows[0].id, fromId: from, toId: to });
      return { id: rows[0].id, fromId: from, toId: to, createdBy: userId, version: seq };
    });
  }

  /** 연결선 삭제도 순번을 받는다 — 클라이언트는 이 순번 이하의 늦은 추가 이벤트로 선을 되살리지 않는다 */
  async deleteConnection(boardId: string, userId: string, connectionId: string): Promise<{ version: number }> {
    return this.tx(async (client) => {
      const seq = await this.bump(client, boardId);
      await this.requireRole(boardId, userId, 'member', client);
      const { rowCount } = await client.query('DELETE FROM board_connections WHERE board_id = $1 AND id = $2', [
        boardId,
        connectionId,
      ]);
      if (!rowCount) throw new BoardError('not_found', '이미 지워진 연결선입니다');
      await this.log(client, boardId, userId, 'connection:delete', { connectionId });
      return { version: seq };
    });
  }
}
