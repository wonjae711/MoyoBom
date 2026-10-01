import { EventEmitter } from 'node:events';
import type { Article } from './types.js';

interface NewsEventMap {
  /** 새 기사가 저장됨 — F-02 실시간 피드가 구독해 접속자에게 브로드캐스트한다 */
  'articles:new': [articles: Article[]];
}

export class NewsEvents extends EventEmitter<NewsEventMap> {}
