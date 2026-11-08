/**
 * 文件令牌（阶段 1）
 *
 * 为什么需要签名而不是直接暴露路径：
 *   媒体库在 `~/.dsh/worlds/<id>/media/` 下面，跟她的记忆挨着。
 *   一个 `GET /dsh-world/file/../memory-traces.json` 就能把整本记忆读走——
 *   所以路径必须是**签过名的**，而且带过期时间。
 *
 * 令牌长这样：
 *   `<过期毫秒>.<base64url(相对路径)>.<HMAC-SHA256 前 32 位十六进制>`
 *   签名覆盖「过期时间 + 相对路径」，改一个字都验不过。
 *
 * 密钥存在 `<world>/file-token.key`（32 字节 hex，0600）。轮换 = 删掉它重启，
 * 所有旧链接立刻全失效——这是想要的行为。
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_TTL_MS = 7 * 24 * 3600_000;

/** 读或造一份密钥。读不了又写不了就抛——没有密钥的令牌是不安全的，不能凑合。 */
export function loadOrCreateSecret(file) {
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/u.test(existing)) return existing;
  } catch {
    /* 不存在就造一份 */
  }
  const secret = randomBytes(32).toString('hex');
  // 世界目录可能还没建（第一次装）：先建目录，不然这里一抛，整个插件都起不来
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, secret + '\n', { encoding: 'utf8', mode: 0o600, flag: 'w' });
  return secret;
}

const b64u = (s) => Buffer.from(String(s), 'utf8').toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url').toString('utf8');

/**
 * @param secret 64 位十六进制密钥
 * @param deps.clock 可注入的时钟（测试过期用）
 */
export function createFileTokens(secret, deps = {}) {
  if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/u.test(secret)) throw new Error('fileTokens: 密钥必须是 64 位十六进制');
  const clock = deps.clock ?? (() => Date.now());
  const ttlMs = Number.isFinite(deps.ttlMs) ? deps.ttlMs : DEFAULT_TTL_MS;

  const sign = (expiresAt, rel) => createHmac('sha256', secret).update(`${expiresAt}.${rel}`).digest('hex').slice(0, 32);

  return {
    ttlMs,
    /** 相对路径 → 令牌 */
    issue(rel, options = {}) {
      const ttl = Number.isFinite(options.ttlMs) ? options.ttlMs : ttlMs;
      const expiresAt = clock() + ttl;
      return `${expiresAt}.${b64u(rel)}.${sign(expiresAt, rel)}`;
    },
    /**
     * 令牌 → 相对路径。
     * @returns {{ ok: true, rel: string } | { ok: false, reason: 'malformed'|'bad-signature'|'expired' }}
     */
    verify(token) {
      if (typeof token !== 'string' || token === '') return { ok: false, reason: 'malformed' };
      const parts = token.split('.');
      if (parts.length !== 3) return { ok: false, reason: 'malformed' };
      const [rawExpires, rawRel, rawSig] = parts;
      const expiresAt = Number(rawExpires);
      if (!Number.isFinite(expiresAt) || expiresAt <= 0) return { ok: false, reason: 'malformed' };
      let rel;
      try {
        rel = unb64u(rawRel);
      } catch {
        return { ok: false, reason: 'malformed' };
      }
      if (rel === '') return { ok: false, reason: 'malformed' };

      const expected = Buffer.from(sign(expiresAt, rel), 'utf8');
      const given = Buffer.from(String(rawSig), 'utf8');
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'bad-signature' };
      if (expiresAt <= clock()) return { ok: false, reason: 'expired' };
      return { ok: true, rel };
    },
    /** 给日志/排障用：不泄露签名，只报还剩多久 */
    describe(token) {
      const result = this.verify(token);
      if (!result.ok) return result;
      const expiresAt = Number(token.split('.')[0]);
      return { ok: true, rel: result.rel, remainingMs: expiresAt - clock() };
    },
  };
}

/** 密钥文件默认路径 */
export function secretFileIn(worldDir) {
  return `${String(worldDir).replace(/[\\/]+$/u, '')}/file-token.key`;
}

/** 有没有密钥（测试与诊断用） */
export function hasSecret(file) {
  try {
    return existsSync(file);
  } catch {
    return false;
  }
}
