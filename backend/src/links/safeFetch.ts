import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { Readable } from 'node:stream';
import zlib from 'node:zlib';

/** 링크 가져오기 실패. code로 사용자 안내 문구를 정한다 (원본 에러·내부 주소는 담지 않는다) */
export type LinkErrorCode =
  | 'invalid_url' // http/https가 아니거나 형식이 틀림
  | 'blocked' // 사설·내부 주소 (SSRF 방지)
  | 'fetch_failed' // 연결 실패·오류 응답
  | 'timeout'
  | 'too_large'
  | 'not_html'
  | 'too_many_redirects';

export class LinkError extends Error {
  constructor(
    readonly code: LinkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LinkError';
  }
}

/**
 * 공인 IP가 아닌 주소 (requirements.md F-03 처리 로직 1, CLAUDE.md 설계 원칙 '보안').
 * 사설망·loopback·link-local(클라우드 메타데이터 169.254.169.254 포함)·CGNAT·문서용·멀티캐스트·예약 대역을 막는다.
 */
const blocked = new net.BlockList();
for (const [net4, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net4, prefix, 'ipv4');
}
for (const [net6, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64 — 내부 IPv4로 이어질 수 있음
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net6, prefix, 'ipv6');
}

export function isPublicAddress(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return !blocked.check(ip, 'ipv4');
  if (version === 6) {
    // ::ffff:10.0.0.1 처럼 IPv6에 담긴 IPv4는 IPv4 규칙으로 본다
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return !blocked.check(mapped[1]!, 'ipv4');
    if (/^::ffff:/i.test(ip)) return false;
    return !blocked.check(ip, 'ipv6');
  }
  return false;
}

export interface SafeFetchOptions {
  /** 전체(리다이렉트 포함) 제한 시간 */
  timeoutMs?: number;
  /** 압축을 푼 본문 최대 크기 */
  maxBytes?: number;
  maxRedirects?: number;
  /** 테스트용: DNS 조회 바꾸기 */
  resolve?: (hostname: string) => Promise<string[]>;
  /** 테스트용: 허용 주소 판정 바꾸기 */
  isAllowed?: (ip: string) => boolean;
  /** 테스트용: 80·443 외 포트 허용 */
  allowAnyPort?: boolean;
}

export interface FetchedPage {
  finalUrl: string;
  contentType: string;
  html: string;
}

const DEFAULTS = { timeoutMs: 5000, maxBytes: 2 * 1024 * 1024, maxRedirects: 3 };

// 국내 언론사 다수가 봇 UA를 막아서 일반 브라우저와 같은 형식을 쓴다
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
  'accept-language': 'ko-KR,ko;q=0.9,en;q=0.7',
  'accept-encoding': 'gzip, deflate, br',
};

async function defaultResolve(hostname: string): Promise<string[]> {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
}

/**
 * SSRF를 막으며 웹 페이지를 가져온다 (F-03).
 * - http/https, 80·443 포트만 허용
 * - DNS로 조회한 **모든** 주소가 공인 IP여야 하고, 실제 연결도 그 검사한 주소로만 한다 (DNS 재바인딩 방지)
 * - 리다이렉트는 최대 3번, 매번 같은 검사를 다시 한다
 * - 전체 5초, 압축 푼 본문 2MB 제한, HTML만 허용
 */
export async function safeFetchHtml(input: string, options: SafeFetchOptions = {}): Promise<FetchedPage> {
  const opts = { ...DEFAULTS, ...options };
  const resolve = opts.resolve ?? defaultResolve;
  const isAllowed = opts.isAllowed ?? isPublicAddress;
  const deadline = Date.now() + opts.timeoutMs;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new LinkError('invalid_url', '올바른 주소가 아닙니다');
  }

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new LinkError('invalid_url', 'http 또는 https 주소만 쓸 수 있습니다');
    if (url.username || url.password) throw new LinkError('invalid_url', '주소에 계정 정보를 넣을 수 없습니다');
    if (!opts.allowAnyPort && url.port && url.port !== '80' && url.port !== '443') {
      throw new LinkError('blocked', '이 주소는 가져올 수 없습니다');
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    let addresses: string[];
    if (net.isIP(hostname)) addresses = [hostname];
    else {
      try {
        addresses = await withDeadline(resolve(hostname), deadline);
      } catch (error) {
        if (error instanceof LinkError) throw error;
        throw new LinkError('fetch_failed', '사이트에 연결할 수 없습니다');
      }
    }
    if (addresses.length === 0 || !addresses.every(isAllowed)) throw new LinkError('blocked', '이 주소는 가져올 수 없습니다');

    const response = await request(url, addresses[0]!, deadline);
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      url = new URL(response.headers.location, url);
      continue;
    }
    if (status < 200 || status >= 300) {
      response.resume();
      throw new LinkError('fetch_failed', `페이지를 가져오지 못했습니다 (HTTP ${status})`);
    }
    const contentType = String(response.headers['content-type'] ?? '');
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      response.resume();
      throw new LinkError('not_html', '웹 페이지(HTML) 주소가 아닙니다');
    }
    const body = await readBody(response, opts.maxBytes, deadline);
    return { finalUrl: url.toString(), contentType, html: decodeHtml(body, contentType) };
  }
  throw new LinkError('too_many_redirects', '리다이렉트가 너무 많습니다');
}

function withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const ms = deadline - Date.now();
  if (ms <= 0) return Promise.reject(new LinkError('timeout', '페이지 응답이 너무 늦습니다'));
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new LinkError('timeout', '페이지 응답이 너무 늦습니다')), ms);
    }),
  ]);
}

/** 검사를 통과한 주소(address)로만 연결한다. TLS 인증서·Host 헤더는 원래 호스트 이름 기준 */
function request(url: URL, address: string, deadline: number): Promise<http.IncomingMessage> {
  const family = net.isIP(address);
  const pinnedLookup = (
    _hostname: string,
    options: { all?: boolean },
    callback: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void,
  ) => {
    if (options?.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const ms = deadline - Date.now();
    if (ms <= 0) return reject(new LinkError('timeout', '페이지 응답이 너무 늦습니다'));
    const req = client.request(url, { method: 'GET', headers: HEADERS, lookup: pinnedLookup as never, timeout: ms }, resolve);
    req.on('timeout', () => req.destroy(new LinkError('timeout', '페이지 응답이 너무 늦습니다')));
    req.on('error', (error) => reject(error instanceof LinkError ? error : new LinkError('fetch_failed', '사이트에 연결할 수 없습니다')));
    req.end();
  });
}

function readBody(response: http.IncomingMessage, maxBytes: number, deadline: number): Promise<Buffer> {
  const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase();
  let stream: Readable = response;
  if (encoding.includes('br')) stream = response.pipe(zlib.createBrotliDecompress());
  else if (encoding.includes('gzip')) stream = response.pipe(zlib.createGunzip());
  else if (encoding.includes('deflate')) stream = response.pipe(zlib.createInflate());

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => fail(new LinkError('timeout', '페이지 응답이 너무 늦습니다')), Math.max(0, deadline - Date.now()));
    const fail = (error: LinkError) => {
      clearTimeout(timer);
      response.destroy();
      stream.destroy();
      reject(error);
    };
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) fail(new LinkError('too_large', '페이지가 너무 큽니다'));
      else chunks.push(chunk);
    });
    stream.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    stream.on('error', () => fail(new LinkError('fetch_failed', '페이지를 읽지 못했습니다')));
  });
}

/** 응답 헤더나 <meta charset>의 문자 인코딩으로 읽는다 (국내 언론사 일부는 EUC-KR) */
export function decodeHtml(body: Buffer, contentType = ''): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const head = body.subarray(0, 4096).toString('latin1');
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  const charset = (fromHeader ?? fromMeta ?? 'utf-8').toLowerCase();
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}
