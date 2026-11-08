/**
 * 静态文件端点（阶段 1）
 *
 * `GET /dsh-world/file/<令牌>` —— 平台从这里把她的图/文件取走。
 *
 * 四条硬规矩：
 *   1. **只认签名**：路径必须是 fileToken 签过的；随手拼一个 `../memory-traces.json` 一律 403
 *   2. **过期就 410**：链接不是永久的，轮换密钥可以一次作废所有旧链接
 *   3. **只送能送的类型**：image / audio / video / text / pdf / json / zip / octet-stream，其它 403
 *   4. **只给本机**：和 console、bridge 一样走 `knownHost`，DNS rebinding 进来的请求拿不到
 *
 * 不做 Range：目标是"平台能把这张图取走"，不是当图床。真要拖进度条再补。
 */
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { knownHost, sendJson } from '../http.js';
import { isServableMime } from './media.js';

export const FILE_PREFIX = '/dsh-world/file';

const noStore = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

/**
 * @param store  createMediaStore() 的返回值
 * @param tokens createFileTokens() 的返回值
 * @param allowedHosts 除了本机之外还认哪些 Host（跟 console 共用配置）
 */
export function mediaRoute(store, tokens, allowedHosts = []) {
  return {
    kind: 'prefix',
    path: FILE_PREFIX,
    handler: async (req, res) => {
      try {
        const method = req.method ?? 'GET';
        if (method !== 'GET' && method !== 'HEAD') {
          return sendJson(res, { status: 405, body: { error: 'method not allowed' }, headers: { allow: 'GET, HEAD' } });
        }
        if (req.headers['sec-fetch-site'] === 'cross-site' || !knownHost(req.headers.host, allowedHosts)) {
          return sendJson(res, { status: 403, body: { error: 'forbidden' }, headers: noStore });
        }

        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const raw = url.pathname.slice(FILE_PREFIX.length).replace(/^\/+/u, '');
        if (raw === '') return sendJson(res, { status: 404, body: { error: 'no token' }, headers: noStore });

        let token;
        try {
          token = decodeURIComponent(raw);
        } catch {
          return sendJson(res, { status: 400, body: { error: 'bad token encoding' }, headers: noStore });
        }

        const checked = tokens.verify(token);
        if (!checked.ok) {
          // 过期给 410（"曾经存在，现在不再提供"），其它一律 403
          const status = checked.reason === 'expired' ? 410 : 403;
          return sendJson(res, { status, body: { error: checked.reason }, headers: noStore });
        }

        const found = store.stat(checked.rel);
        if (found === undefined) return sendJson(res, { status: 404, body: { error: 'not found' }, headers: noStore });
        if (!isServableMime(found.mime)) {
          return sendJson(res, { status: 403, body: { error: 'type not servable' }, headers: noStore });
        }

        const name = basename(found.abs);
        res.writeHead(200, {
          'content-type': found.mime,
          'content-length': String(found.bytes),
          'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
          ...noStore,
        });
        if (method === 'HEAD') {
          res.end();
          return undefined;
        }

        await new Promise((resolve) => {
          const stream = createReadStream(found.abs);
          stream.on('error', () => {
            // 头已经发出去了，只能掐断；客户端会看到一个不完整的响应
            try {
              res.destroy();
            } catch {
              /* 已经断了 */
            }
            resolve();
          });
          stream.on('end', resolve);
          res.on('close', () => {
            stream.destroy();
            resolve();
          });
          stream.pipe(res);
        });
        return undefined;
      } catch {
        if (!res.headersSent) sendJson(res, { status: 500, body: { error: 'internal error' }, headers: noStore });
        else {
          try {
            res.destroy();
          } catch {
            /* 已经断了 */
          }
        }
        return undefined;
      }
    },
  };
}

/** 拼一条给平台用的绝对地址。origin 由宿主给（每次重启端口都可能变）。 */
export function fileUrl(origin, token) {
  const base = String(origin ?? '').replace(/\/+$/u, '');
  return `${base}${FILE_PREFIX}/${encodeURIComponent(token)}`;
}
