/**
 * 最小 WebSocket 客户端（2026-11-04）
 *
 * 为什么不用 Node 自带的 `WebSocket`：
 *   Node 24 的 undici WebSocket 在握手时会带上
 *   `Sec-WebSocket-Extensions: permessage-deflate`，
 *   而 **VTS 对这种握手的回复是坏的**：它回一条**空帧**代替正常响应。
 *   表现极具误导性——"请求发出去了，回复永远是空字符串"，
 *   用 Node 原生 WebSocket 查了半小时，换 Python 的 websocket-client
 *   （默认不请求压缩）立刻正常。
 *
 * 所以这里自己握手：**明确不发 permessage-deflate**，只要求最朴素的一问一答。
 *
 * 支持范围（够用就好，不做通用库）：
 *   · 文本帧、分片重组、ping/pong、close
 *   · 客户端→服务器必须掩码（RFC 6455 硬性要求）
 *   · 不做压缩、不做扩展、不做重定向
 */
import { connect as netConnect } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** 拼一个 WebSocket 握手请求。**故意不含 Sec-WebSocket-Extensions**。 */
export function handshakeRequest(host, port, path) {
  const key = randomBytes(16).toString('base64');
  const lines = [
    `GET ${path} HTTP/1.1`,
    `Host: ${host}:${port}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
  ];
  return { text: lines.join('\r\n') + '\r\n\r\n', key };
}

/** 校验服务器回的 101 与 Accept。 */
export function checkHandshake(head, key) {
  const text = String(head);
  const status = /^HTTP\/1\.1 (\d{3})/u.exec(text);
  if (status === null) return { ok: false, reason: '服务器没回 HTTP 状态行' };
  if (status[1] !== '101') return { ok: false, reason: `握手失败：HTTP ${status[1]}` };
  const accept = /sec-websocket-accept:\s*(\S+)/iu.exec(text);
  if (accept === null) return { ok: false, reason: '服务器没回 Sec-WebSocket-Accept' };
  const expected = createHash('sha1').update(key + GUID).digest('base64');
  if (accept[1] !== expected) return { ok: false, reason: 'Sec-WebSocket-Accept 不匹配' };
  return { ok: true };
}

/** 客户端帧必须掩码。 */
export function encodeFrame(text, opcode = 0x1) {
  const payload = Buffer.from(String(text), 'utf8');
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  const mask = randomBytes(4);
  const masked = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i += 1) masked[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

/**
 * 从缓冲区里切出一个完整帧。
 * @returns {{ frame, rest } | undefined} 数据不够时返回 undefined
 */
export function decodeFrame(buffer) {
  if (buffer.length < 2) return undefined;
  const b0 = buffer[0];
  const b1 = buffer[1];
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let length = b1 & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) return undefined;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return undefined;
    const big = buffer.readBigUInt64BE(offset);
    if (big > BigInt(16 * 1024 * 1024)) throw new Error('帧太大');
    length = Number(big);
    offset += 8;
  }

  let mask;
  if (masked) {
    if (buffer.length < offset + 4) return undefined;
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + length) return undefined;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (masked) for (let i = 0; i < length; i += 1) payload[i] ^= mask[i & 3];

  return { frame: { fin, opcode, payload }, rest: buffer.subarray(offset + length) };
}

/**
 * 连上并握手。返回一个 { send, onMessage, close } 的小对象。
 *
 * @param deps.port  端口
 * @param deps.path  路径，默认 '/'
 * @param deps.timeoutMs 握手超时
 */
export function createWebSocket(deps = {}) {
  const host = deps.host ?? '127.0.0.1';
  const port = Number(deps.port ?? 8001);
  const path = deps.path ?? '/';
  const timeoutMs = Number(deps.timeoutMs ?? 6000);

  let socket;
  let open = false;
  let buffer = Buffer.alloc(0);
  let fragments = [];
  const listeners = { message: [], close: [], error: [] };
  const emit = (name, arg) => {
    for (const fn of listeners[name]) {
      try {
        fn(arg);
      } catch {
        /* 监听器自己炸了不该影响 socket */
      }
    }
  };

  function handleFrame(frame) {
    if (frame.opcode === 0x8) {
      open = false;
      try {
        socket?.end();
      } catch {
        /* ignore */
      }
      emit('close', { reason: 'server-close', code: frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : 1005 });
      return;
    }
    if (frame.opcode === 0x9) {
      // ping → pong
      try {
        socket?.write(encodeFrame(frame.payload.toString('utf8'), 0xa));
      } catch {
        /* ignore */
      }
      return;
    }
    if (frame.opcode === 0xa) return;
    if (frame.opcode === 0x0) {
      fragments.push(frame.payload);
      if (frame.fin) {
        const whole = Buffer.concat(fragments).toString('utf8');
        fragments = [];
        emit('message', whole);
      }
      return;
    }
    // 0x1 文本 / 0x2 二进制：都当文本处理（VTS 只发 JSON）
    if (frame.fin) emit('message', frame.payload.toString('utf8'));
    else fragments = [frame.payload];
  }

  function start() {
    return new Promise((resolve, reject) => {
      const { text, key } = handshakeRequest(host, port, path);
      const c = netConnect({ host, port });
      socket = c;
      let handshook = false;
      let raw = Buffer.alloc(0);

      const timer = setTimeout(() => {
        reject(Object.assign(new Error(`连 VTS 超时（${host}:${port}）`), { code: 'ws/timeout' }));
        try {
          c.destroy();
        } catch {
          /* ignore */
        }
      }, timeoutMs);
      timer.unref?.();

      c.on('connect', () => {
        c.write(text);
      });

      c.on('data', (chunk) => {
        if (!handshook) {
          raw = Buffer.concat([raw, chunk]);
          const end = raw.indexOf('\r\n\r\n');
          if (end === -1) return;
          const head = raw.subarray(0, end).toString('utf8');
          const checked = checkHandshake(head, key);
          if (!checked.ok) {
            clearTimeout(timer);
            try {
              c.destroy();
            } catch {
              /* ignore */
            }
            reject(Object.assign(new Error(checked.reason), { code: 'ws/handshake' }));
            return;
          }
          handshook = true;
          open = true;
          clearTimeout(timer);
          buffer = raw.subarray(end + 4);
          resolve();
          // 握手包里可能已经带了帧
          drain();
          return;
        }
        buffer = Buffer.concat([buffer, chunk]);
        drain();
      });

      function drain() {
        for (;;) {
          let decoded;
          try {
            decoded = decodeFrame(buffer);
          } catch (error) {
            emit('error', error);
            return;
          }
          if (decoded === undefined) return;
          buffer = decoded.rest;
          handleFrame(decoded.frame);
          if (!open) return;
        }
      }

      c.on('close', () => {
        if (open) {
          open = false;
          emit('close', { reason: 'socket-close' });
        }
      });
      c.on('error', (error) => {
        clearTimeout(timer);
        if (!handshook) reject(error);
        else emit('error', error);
      });
    });
  }

  return {
    get isOpen() {
      return open;
    },
    start,
    send(text) {
      if (!open || socket === undefined) throw Object.assign(new Error('socket 没开'), { code: 'ws/closed' });
      socket.write(encodeFrame(text));
    },
    on(name, fn) {
      listeners[name]?.push(fn);
    },
    close() {
      if (socket === undefined) return;
      try {
        if (open) socket.write(encodeFrame(Buffer.alloc(0), 0x8));
      } catch {
        /* ignore */
      }
      open = false;
      try {
        socket.end();
      } catch {
        /* ignore */
      }
      socket = undefined;
    },
  };
}
