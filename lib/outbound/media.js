/**
 * 媒体库（阶段 1 · 2026-11-04）
 *
 * 解决的问题：**她截的图、要发的文件，现在出不了这台机器。**
 * 世界只暴露了三个路由（bridge/say、qq、wechat/ask），没有静态文件端点，
 * 所以平台侧拿到的永远只能是 `http(s)` URL —— 本地字节变不成 URL 就等于发不出去。
 *
 * 这一层做两件事：
 *   1. 把本地文件**按内容寻址**收进来（sha256 命名，重复收同一个文件不会存两份）
 *   2. 给它一个**平台取得到的相对路径**（真正的签名与路由在 fileToken.js / fileRoute.js）
 *
 * 为什么按内容寻址而不是按时间戳：
 *   · 同一个文件被反复引用（她说过三次同一张图）时只占一份
 *   · 台账里记 sha256 就能对账「发出去的那张图到底是哪张」
 *
 * 不做的事：不压缩、不转码、不生成缩略图。那些是上层的事，这里只保证**字节一致**。
 */
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, normalize, sep } from 'node:path';

/** 认得的类型；认不出的一律 application/octet-stream（也允许发）。 */
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.zip': 'application/zip',
};

/** 允许通过文件端点送出去的类型前缀。别的类型不拦入库，只是不给它 URL。 */
export const SERVABLE_MIME_PREFIX = [
  'image/',
  'audio/',
  'video/',
  'text/',
  'application/octet-stream',
  'application/pdf',
  'application/json',
  'application/zip',
];

export function mimeOf(name) {
  const ext = extname(String(name ?? '')).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export function isServableMime(mime) {
  return SERVABLE_MIME_PREFIX.some((prefix) => String(mime).startsWith(prefix));
}

/** 控制字符（含 NUL）一律去掉。用 charCode 判断，避免在源码里写转义。 */
function stripControl(value) {
  let out = '';
  for (const ch of String(value ?? '')) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    out += ch;
  }
  return out;
}

/**
 * 把文件名洗成一个安全的名字：去掉路径、控制字符与 Windows 非法字符，限长，保留扩展名。
 * 不是安全边界（真正的边界在 resolve() 与令牌校验），只是让目录看起来干净。
 */
export function safeName(raw, fallback = 'file') {
  const base = basename(String(raw ?? ''));
  const cleaned = stripControl(base)
    .replace(/[\\/:*?"<>|]/gu, '_')
    .trim()
    .replace(/^\.+/u, '');
  const effective = cleaned === '' ? fallback : cleaned;
  const ext = extname(effective);
  const stem = effective.slice(0, Math.max(1, effective.length - ext.length));
  const limitedStem = [...stem].slice(0, 60).join('');
  const limitedExt = [...ext].slice(0, 12).join('');
  return `${limitedStem}${limitedExt}`;
}

/**
 * @param rootDir 媒体库根目录（通常是 `<world>/media`）
 */
export function createMediaStore(rootDir) {
  if (typeof rootDir !== 'string' || rootDir.trim() === '') throw new Error('mediaStore: 需要 rootDir');

  const root = normalize(rootDir);

  function ensureRoot() {
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
  }

  /**
   * 相对路径 → 绝对路径。**只接受媒体库里面的文件**。
   *
   * 拒绝的三类：
   *   · 盘符路径（`C:...`）与绝对路径——进了 join 会变成「库里一个奇怪的名字」，
   *     虽然出不去，但该明确拒绝，而不是悄悄改写成别的名字
   *   · 含控制字符
   *   · 归一化之后跑出 root 的（`..` 穿越）
   */
  function resolve(rel) {
    if (typeof rel !== 'string' || rel === '') return undefined;
    if (isAbsolute(rel) || /^[a-zA-Z]:/u.test(rel)) return undefined;
    const cleaned = rel.replace(/^[/\\]+/u, '');
    if (cleaned === '' || stripControl(cleaned) !== cleaned) return undefined;
    const abs = normalize(join(root, cleaned));
    if (abs !== root && !abs.startsWith(root + sep)) return undefined;
    return abs;
  }

  /**
   * 收一份字节进来。内容相同的文件只存一份（flag 'wx'，已存在就跳过）。
   * @returns {{ ok: true, sha256, bytes, mime, name, rel, abs } | { ok: false, reason }}
   */
  function putBuffer(buffer, options = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { ok: false, reason: 'empty' };
    ensureRoot();
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const name = safeName(options.name ?? 'file');
    const mime = options.mime ?? mimeOf(name);
    const rel = `${sha256.slice(0, 16)}-${name}`;
    const abs = resolve(rel);
    if (abs === undefined) return { ok: false, reason: 'bad-name' };
    if (!existsSync(abs)) writeFileSync(abs, buffer, { flag: 'wx' });
    return { ok: true, sha256, bytes: buffer.length, mime, name, rel, abs };
  }

  /**
   * 收一个本地文件进来。超过 maxBytes 的不收。
   * @returns 同 putBuffer；失败时 reason 可能是 'missing' | 'not-file' | 'too-large' | 'empty'
   */
  function putFile(sourcePath, options = {}) {
    if (typeof sourcePath !== 'string' || sourcePath === '') return { ok: false, reason: 'missing' };
    let stat;
    try {
      stat = statSync(sourcePath);
    } catch {
      return { ok: false, reason: 'missing' };
    }
    if (!stat.isFile()) return { ok: false, reason: 'not-file' };
    if (stat.size === 0) return { ok: false, reason: 'empty' };
    const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : 64 * 1024 * 1024;
    if (stat.size > maxBytes) return { ok: false, reason: 'too-large' };

    const buffer = readFileSync(sourcePath);
    return putBuffer(buffer, { name: options.name ?? sourcePath, ...(options.mime ? { mime: options.mime } : {}) });
  }

  /** 只看头 4 KB 猜一下类型（给没有扩展名的文件用；不确定就返回 undefined）。 */
  function sniffMime(sourcePath) {
    let fd;
    try {
      fd = openSync(sourcePath, 'r');
      const head = Buffer.alloc(4096);
      const read = readSync(fd, head, 0, head.length, 0);
      const b = head.subarray(0, read);
      if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
      if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
      if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav';
      if (b.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
      return undefined;
    } catch {
      return undefined;
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          /* 关不掉也没别的办法 */
        }
      }
    }
  }

  return {
    root,
    resolve,
    putBuffer,
    putFile,
    sniffMime,
    /** 媒体库里现在有什么（调试用；超过 limit 就只报总数） */
    list(limit = 50) {
      try {
        const all = readdirSync(root).filter((name) => !name.startsWith('.'));
        return { total: all.length, items: all.slice(0, limit) };
      } catch {
        return { total: 0, items: [] };
      }
    },
    /** 某个相对路径存不存在、多大 */
    stat(rel) {
      const abs = resolve(rel);
      if (abs === undefined) return undefined;
      try {
        const s = statSync(abs);
        return s.isFile() ? { abs, bytes: s.size, mime: mimeOf(abs) } : undefined;
      } catch {
        return undefined;
      }
    },
    /** 同内容的文件在不在库里 */
    has(sha256) {
      try {
        return readdirSync(root).some((name) => name.startsWith(String(sha256).slice(0, 16)));
      } catch {
        return false;
      }
    },
    isAbsoluteInside(abs) {
      if (typeof abs !== 'string' || !isAbsolute(abs)) return false;
      const cleaned = normalize(abs);
      return cleaned === root || cleaned.startsWith(root + sep);
    },
  };
}
