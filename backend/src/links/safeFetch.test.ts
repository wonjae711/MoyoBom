import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LinkError, decodeHtml, isPublicAddress, safeFetchHtml } from './safeFetch.js';

describe('[보안] 공인 IP 판정 (SSRF 방지)', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.10',
    '169.254.169.254', // 클라우드 메타데이터
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '64:ff9b::a00:1',
    'not-an-ip',
  ])('%s 는 막는다', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(['8.8.8.8', '223.130.200.104', '172.32.0.1', '2001:4860:4860::8888', '::ffff:8.8.8.8'])('%s 는 허용한다', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
});

describe('safeFetchHtml', () => {
  let server: Server;
  let port: number;
  const routes: Record<string, (res: import('node:http').ServerResponse) => void> = {
    '/article': (res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><title>기사</title><body>본문</body></html>');
    },
    '/gzip-euckr': (res) => {
      const html = Buffer.from(new Uint8Array([0x3c, 0x70, 0x3e, 0xc7, 0xd1, 0xb1, 0xdb, 0x3c, 0x2f, 0x70, 0x3e])); // <p>한글</p> (EUC-KR)
      res.writeHead(200, { 'content-type': 'text/html; charset=EUC-KR', 'content-encoding': 'gzip' });
      res.end(zlib.gzipSync(html));
    },
    '/pdf': (res) => {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      res.end('%PDF');
    },
    '/huge': (res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('a'.repeat(3000));
    },
    '/slow': () => {
      /* 응답하지 않음 */
    },
    '/to-internal': (res) => {
      res.writeHead(302, { location: 'http://internal.test/admin' });
      res.end();
    },
    '/loop': (res) => {
      res.writeHead(302, { location: '/loop' });
      res.end();
    },
    '/missing': (res) => {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('nope');
    },
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const route = routes[req.url ?? ''];
      if (route) route(res);
      else res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  /** 테스트 서버(127.0.0.1)만 허용하고, 가짜 호스트 이름을 지정한 주소로 풀어 준다 */
  const options = (dns: Record<string, string[]> = {}) => ({
    allowAnyPort: true,
    isAllowed: (ip: string) => ip === '127.0.0.1',
    resolve: async (host: string) => dns[host] ?? [],
  });
  const local = (path: string, host = 'news.test') => `http://${host}:${port}${path}`;

  it('검사한 주소로만 연결한다 — 호스트 이름은 그대로 두고 연결 대상만 고정 (DNS 재바인딩 방지)', async () => {
    const page = await safeFetchHtml(local('/article'), options({ 'news.test': ['127.0.0.1'] }));
    expect(page.html).toContain('본문');
    expect(page.finalUrl).toBe(local('/article'));
  });

  it('[보안] DNS 결과에 내부 주소가 하나라도 있으면 연결하지 않는다', async () => {
    const error = await safeFetchHtml(local('/article'), options({ 'news.test': ['127.0.0.1', '10.0.0.8'] })).catch((e) => e);
    expect(error).toBeInstanceOf(LinkError);
    expect((error as LinkError).code).toBe('blocked');
  });

  it('[보안] 리다이렉트로 내부 주소에 가려 하면 막는다 (리다이렉트마다 다시 검사)', async () => {
    const error = await safeFetchHtml(
      local('/to-internal'),
      options({ 'news.test': ['127.0.0.1'], 'internal.test': ['10.0.0.5'] }),
    ).catch((e) => e);
    expect((error as LinkError).code).toBe('blocked');
  });

  it('[보안] 기본 설정에서는 loopback·사설 IP 주소와 80·443 외 포트를 막는다', async () => {
    expect(((await safeFetchHtml(`http://127.0.0.1:${port}/article`).catch((e) => e)) as LinkError).code).toBe('blocked');
    expect(((await safeFetchHtml('http://169.254.169.254/latest/meta-data').catch((e) => e)) as LinkError).code).toBe('blocked');
    expect(((await safeFetchHtml('http://example.com:8080/').catch((e) => e)) as LinkError).code).toBe('blocked');
  });

  it.each(['ftp://news.test/a', 'file:///etc/passwd', 'javascript:alert(1)', 'http://user:pw@news.test/', 'not a url'])(
    '[보안] http/https 일반 주소가 아니면(%s) 거절한다',
    async (url) => {
      expect(((await safeFetchHtml(url, options()).catch((e) => e)) as LinkError).code).toBe('invalid_url');
    },
  );

  it('리다이렉트는 3번까지만 따라간다', async () => {
    const error = await safeFetchHtml(local('/loop'), options({ 'news.test': ['127.0.0.1'] })).catch((e) => e);
    expect((error as LinkError).code).toBe('too_many_redirects');
  });

  it('HTML이 아니거나, 너무 크거나, 너무 늦거나, 오류 응답이면 실패로 알린다', async () => {
    const dns = { 'news.test': ['127.0.0.1'] };
    expect(((await safeFetchHtml(local('/pdf'), options(dns)).catch((e) => e)) as LinkError).code).toBe('not_html');
    expect(((await safeFetchHtml(local('/huge'), { ...options(dns), maxBytes: 1000 }).catch((e) => e)) as LinkError).code).toBe(
      'too_large',
    );
    expect(((await safeFetchHtml(local('/slow'), { ...options(dns), timeoutMs: 300 }).catch((e) => e)) as LinkError).code).toBe(
      'timeout',
    );
    expect(((await safeFetchHtml(local('/missing'), options(dns)).catch((e) => e)) as LinkError).code).toBe('fetch_failed');
  });

  it('gzip 압축과 EUC-KR 인코딩 페이지도 읽는다', async () => {
    const page = await safeFetchHtml(local('/gzip-euckr'), options({ 'news.test': ['127.0.0.1'] }));
    expect(page.html).toBe('<p>한글</p>');
  });

  it('응답 헤더에 인코딩이 없으면 <meta charset>을 따른다', () => {
    const body = Buffer.concat([Buffer.from('<meta charset="euc-kr"><p>'), Buffer.from([0xc7, 0xd1]), Buffer.from('</p>')]);
    expect(decodeHtml(body, 'text/html')).toContain('<p>한</p>');
  });
});
