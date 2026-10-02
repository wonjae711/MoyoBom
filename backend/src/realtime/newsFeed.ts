import type { Server } from 'socket.io';
import type { NewsEvents } from '../news/events.js';
import { compareFeed, toFeedArticle, type FeedArticle } from '../news/feed.js';

export const NEWS_FEED_ROOM = 'news-feed';
export const NEW_ARTICLES_EVENT = 'feed:new-articles';

/**
 * 한 번에 보내는 최대 기사 수. 서버 첫 수집처럼 수천 건이 한꺼번에 저장될 때 소켓으로 전부 보내지 않고,
 * 최신 기사만 보낸 뒤 `truncated`로 알려 클라이언트가 REST로 다시 불러오게 한다.
 */
export const MAX_BROADCAST = 50;

export interface NewArticlesPayload {
  articles: FeedArticle[];
  /** 저장된 새 기사 전체 수 */
  total: number;
  /** articles에 다 담지 못했으면 true */
  truncated: boolean;
}

/**
 * F-02 실시간 뉴스 피드. 접속한 클라이언트를 news-feed room에 넣고,
 * 수집기가 새 기사를 저장할 때마다(articles:new) room 전체에 브로드캐스트한다.
 * 수집 1회에 저장된 기사는 최신순으로 정렬해 이벤트 하나로 묶어 보낸다.
 * (설계 문서의 `new-article` 기사 1건당 1이벤트 방식에서 변경 — 첫 수집 때 수천 번 emit되는 것을 막기 위함)
 */
export function attachNewsFeed(io: Server, events: NewsEvents): () => void {
  io.on('connection', (socket) => {
    void socket.join(NEWS_FEED_ROOM);
  });

  const onNewArticles: Parameters<NewsEvents['on']>[1] = (saved) => {
    const sorted = saved.map(toFeedArticle).sort(compareFeed);
    const payload: NewArticlesPayload = {
      articles: sorted.slice(0, MAX_BROADCAST),
      total: sorted.length,
      truncated: sorted.length > MAX_BROADCAST,
    };
    io.to(NEWS_FEED_ROOM).emit(NEW_ARTICLES_EVENT, payload);
  };
  events.on('articles:new', onNewArticles);

  return () => events.off('articles:new', onNewArticles);
}
