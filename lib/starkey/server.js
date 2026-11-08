/**
 * star-key 网关（2026-11-03 夜加）
 *
 * 目的：让**桌宠**（dsh-whale-girl）把「说话」这件事交回她本人。
 *
 * 为什么不是改桌宠：桌宠的对话入口是 `ctx.llm.stream()`，而 DSH 的 LLM 层可以
 * 声明一个 OpenAI 兼容路由（`@deepseek-ai/dsh-llm-pi-ai` 的 hand-declared route）。
 * 所以这边只要开一个**说 OpenAI 话**的小服务，桌宠把 `chatModel` 指过来就行——
 * 桌宠一行代码都不用改，也不用重新构建。
 *
 * 链路：
 *   桌宠（麦克风 / 文字 / 识屏）
 *     → POST /v1/chat/completions
 *     → 取最后一条 user 正文（和图片）
 *     → bridge.say()：话以「主人说的」身份进她的家会话（和主人自己打字同一条路）
 *     → 等她的第一条可见回复
 *     → 包成 OpenAI 的响应回去
 *   桌宠拿到的就是她的话，用它的气泡和 gpt-sovits 语音说出来。
 *
 * 归属：这条路进来的话是**主人在说话**（麦克风转写 / 他打的字），所以以 source=user 进家
 * 是对的。识屏那条不是他说的——那边只带图不带「替我说」的语义，正文由网关补一句
 * 「（屏幕上）」提示，避免把她没说过的话记成主人原话。
 */
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const MAX_BODY = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 55_000;

/** 从 OpenAI 的 messages 里取最后一条 user 的正文与图片（data URL）。 */
export function readLastUser(messages) {
  if (!Array.isArray(messages)) return { text: '', images: [] };
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || m.role !== 'user') continue;
    const parts = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content ?? '') }];
    const texts = [];
    const images = [];
    for (const part of parts) {
      if (!part || typeof part !== 'object') {
        if (typeof part === 'string') texts.push(part);
        continue;
      }
      if (part.type === 'text' && typeof part.text === 'string') texts.push(part.text);
      if (part.type === 'image_url') {
        const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
        if (typeof url === 'string' && url.startsWith('data:')) images.push(url);
      }
    }
    return { text: texts.join('\n').trim(), images: images.slice(0, 4) };
  }
  return { text: '', images: [] };
}

/** 她不在说话的时候，问一句「你怎么看」也不会自己开口——所以空的 user 正文直接拒。 */
function badRequest(reason) {
  return { status: 400, body: { error: { message: reason, type: 'invalid_request_error' } } };
}

/**
 * data URL → 桥认识的形状 {data, mediaType, name}。
 *
 * 桥的 `say(text, images, ticket)` 拿的不是字符串，是已经解好的字节
 * （route.js 那边自己解析 data URL，我们直接调 bridge 就得自己来）。
 * 单张坏掉就跳过，不让一张坏图毁了整次对话。
 */
export function toImageParts(dataUrls) {
  const out = [];
  for (const url of Array.isArray(dataUrls) ? dataUrls : []) {
    if (typeof url !== 'string') continue;
    const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(url);
    if (m === null) continue;
    try {
      const data = Buffer.from(m[2], 'base64');
      if (data.byteLength === 0) continue;
      out.push({ data: new Uint8Array(data), mediaType: m[1], name: `starkey-${Date.now()}-${out.length}` });
    } catch {
      /* 单张坏掉不影响其他 */
    }
  }
  return out;
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function chunkOf(content) {
  return `data: ${JSON.stringify(content)}\n\n`;
}

/**
 * @param deps.say      (text, images, ticket) => Promise<{id}>   —— 就是 bridge.say
 * @param deps.wait     (ticket) => Promise<string>               —— 等她的回复正文
 * @param deps.logger
 */
/**
 * 往文件里记一行（JSONL）。DSH 的 console 我们看不到，所以这条链路自己留证据。
 * 写不进去就算了——诊断不能把功能带崩。
 */
export function createFileLog(file) {
  if (typeof file !== 'string' || file === '') return () => {};
  return (kind, data = {}) => {
    try {
      appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), kind, ...data }) + '\n', 'utf8');
    } catch {
      /* 记不下来不耽误正事 */
    }
  };
}

export function createStarKeyServer(deps) {
  const say = deps.say;
  const wait = deps.wait;
  const logger = deps.logger ?? (() => {});
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const trace = deps.trace ?? (() => {});
  let server;
  let seq = 0;

  async function handleCompletion(req, res) {
    const body = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return sendJson(res, 400, { error: { message: 'body 不是合法 JSON', type: 'invalid_request_error' } });
    }
    const { text, images } = readLastUser(parsed?.messages);
    trace('request', { model: parsed?.model ?? null, stream: parsed?.stream !== false, chars: [...text].length, images: images.length, roles: Array.isArray(parsed?.messages) ? parsed.messages.map((m) => m?.role) : null });
    if (text === '' && images.length === 0) return sendJson(res, 400, badRequest('没有可交给她的内容').body);
    /*
     * 识屏那条只有图、没有字：补一句说明，让家会话里的这句话读起来是「主人把屏幕给我看」，
     * 而不是伪造一句主人没说过的话。
     */
    const spoken = text !== '' ? text : '（主人把屏幕给我看了，没说话）';
    const ticket = `starkey-${Date.now()}-${(seq += 1)}`;
    let accepted;
    try {
      accepted = await say(spoken, toImageParts(images), ticket);
    } catch (error) {
      trace('say-failed', { message: String(error?.message ?? error) });
      logger('star-key: 话没进家 ' + (error?.message ?? error));
      return sendJson(res, 503, { error: { message: '她家里现在接不了话', type: 'server_error' } });
    }
    let reply;
    try {
      reply = await wait(ticket, timeoutMs);
    } catch (error) {
      const message = error?.code === 'STAR_KEY_TIMEOUT' ? '她这次没回话（超时）' : `等她的回复失败：${error?.message ?? error}`;
      trace('wait-failed', { message });
      logger('star-key: ' + message);
      return sendJson(res, 504, { error: { message, type: 'server_error' } });
    }
    const id = `chatcmpl-${ticket}`;
    const model = typeof parsed?.model === 'string' ? parsed.model : 'home';
    if (parsed?.stream === false) {
      return sendJson(res, 200, {
        id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
        usage: { prompt_tokens: estimate(spoken), completion_tokens: estimate(reply), total_tokens: estimate(spoken) + estimate(reply) },
      });
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const base = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model };
    res.write(chunkOf({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] }));
    res.write(chunkOf({ ...base, choices: [{ index: 0, delta: { content: reply }, finish_reason: null }] }));
    res.write(chunkOf({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
    res.write('data: [DONE]\n\n');
    res.end();
    trace('replied', { chars: [...reply].length, head: [...reply].slice(0, 40).join('') });
    logger(`star-key: 已经把她的话交回去（${[...reply].length} 字）`);
    return undefined;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          reject(new Error('body 太大'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  function estimate(text) {
    return Math.max(1, Math.ceil([...String(text ?? '')].length / 1.6));
  }

  return {
    async start(port = 50124) {
      server = createServer((req, res) => {
        void (async () => {
          try {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            // 2026-11-04：连"路径不对"的请求也要留痕。
            // 第一次接桌宠时它一条日志都没有，我在"它没调"和"它调错地方"之间只能猜。
            trace('hit', { method: req.method ?? 'GET', path: url.pathname, host: String(req.headers.host ?? '') });
            if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/v1/health')) {
              return sendJson(res, 200, { ok: true, provider: 'star-key', home: deps.homeName ?? '' });
            }
            if (req.method === 'GET' && url.pathname === '/v1/models') {
              return sendJson(res, 200, { object: 'list', data: [{ id: 'home', object: 'model', owned_by: 'star-key' }] });
            }
            if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
              return await handleCompletion(req, res);
            }
            return sendJson(res, 404, { error: { message: 'not found', type: 'invalid_request_error' } });
          } catch (error) {
            logger('star-key: 请求处理失败 ' + (error?.message ?? error));
            if (!res.headersSent) sendJson(res, 500, { error: { message: 'internal error', type: 'server_error' } });
            else res.end();
          }
          return undefined;
        })();
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        // 只认本机回环：这条路上说的话会以主人身份进她的家，不能给局域网听。
        server.listen(port, '127.0.0.1', () => resolve());
      });
      logger(`star-key: 网关在 127.0.0.1:${port} 上等着（OpenAI 兼容）`);
      return port;
    },
    stop() {
      if (!server) return Promise.resolve();
      const closing = server;
      server = undefined;
      return new Promise((resolve) => closing.close(() => resolve()));
    },
  };
}
