import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('GET /api/health', () => {
  it('DB가 연결되어 있으면 200과 ok를 반환한다', async () => {
    const app = createApp({ checkDb: async () => true });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: true });
  });

  it('DB 연결이 실패하면 503과 degraded를 반환한다', async () => {
    const app = createApp({ checkDb: async () => false });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'degraded', db: false });
  });
});
