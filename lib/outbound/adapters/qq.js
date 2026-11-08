/**
 * QQ 适配器（阶段 2 · 2026-11-04）
 *
 * 它把本体的 `Outbound` 意图，落到 QQ 插件那个 outlet 上。
 *
 * ── 这份能力声明是**读着代码写下来的**，不是猜的 ──
 *
 *   · 分段：**主动（reach）能，回话（reply）不能**。
 *     QQ 的 reply 是"一问一答"通道：`outlet()` 收到第一条就把等待中的私聊解决了，
 *     后面几条会被丢弃。所以 reply 分段在这里被**强制合并**，并记一条 `merged` 降级——
 *     不是悄悄少发几条。
 *   · 图片：能。但只吃 `http(s)` URL（`outlet()` 会过滤掉别的）→ `localUpload: false`，
 *     本地图必须先过阶段 1 的媒体库拿到签名 URL。
 *   · 语音：**不能**。outlet 的 payload 里没有音频字段，`voice` 只用于入站。
 *     这是**我们没做**，不是平台限制（QQ 侧本来能发语音）。
 *   · 表情：**不能**。`pushOf` 会带 `image`（表情名），但 QQ 的 `outlet()` 只读
 *     `text` 和 `images`，`image` 被忽略。同样是**我们没做**。
 *   · 文件 / @ / 回锚：都不能。
 *   · 送达确认：**没有 messageId**。outlet 只回"推送被接受"（HTTP 2xx 且没说 ok:false），
 *     所以台账里的 id 是本地编号，不能当成平台送达凭证。
 *
 * 这张清单就是规划里那张矩阵的 QQ 行。做不到的写做不到，谁没做写清楚。
 */
import { DEGRADE_REASONS } from '../contract.js';
import { planDelivery } from '../fakeAdapter.js';

/**
 * QQ 那条腿的真实能力。改动这里之前，先去 `dsh-qq-group/src/qq/world.ts` 的 `outlet()`
 * 确认一遍——声明比实现跑得快，就是"她以为发了其实没发"的来源。
 */
export const QQ_CAPABILITIES = {
  segments: true,
  voice: false,
  sticker: false,
  image: true,
  file: false,
  mention: false,
  replyAnchor: false,
  localUpload: false,
  inbound: 'push',
  maxCharsPerMessage: 1000,
  maxImages: 4,
  pace: { minGapMs: 600, maxGapMs: 1800 },
};

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 两条之间的间隔：在 pace 区间里取一个，避免"机器人一口气刷屏"。 */
function gapFor(outbound, capabilities) {
  const pace = outbound.pace ?? capabilities.pace;
  const min = Math.max(0, Number(pace?.minGapMs ?? 0));
  const max = Math.max(min, Number(pace?.maxGapMs ?? min));
  return min + Math.random() * (max - min);
}

/**
 * reply 只有一次机会：把几条并成一条。
 * 文字按顺序换行连起来；图片能带几张带几张，超出的记降级。
 */
export function mergeForReply(messages, capabilities) {
  const texts = [];
  const images = [];
  const degraded = [];
  for (const message of messages) {
    if (typeof message.text === 'string' && message.text.trim() !== '') texts.push(message.text);
    if (message.type === 'voice' && typeof message.text === 'string' && message.text.trim() !== '') texts.push(message.text);
    for (const attachment of Array.isArray(message.attach) ? message.attach : []) {
      if (attachment.type !== 'image') continue;
      if (images.length >= capabilities.maxImages) {
        degraded.push({ what: 'image', why: DEGRADE_REASONS.overLimit });
        continue;
      }
      images.push(attachment);
    }
    if (message.type === 'image') {
      if (images.length >= capabilities.maxImages) {
        degraded.push({ what: 'image', why: DEGRADE_REASONS.overLimit });
        continue;
      }
      images.push(message);
    }
  }
  let text = texts.join('\n').trim();
  if ([...text].length > capabilities.maxCharsPerMessage) {
    text = [...text].slice(0, capabilities.maxCharsPerMessage).join('');
    degraded.push({ what: 'text', why: DEGRADE_REASONS.overLimit });
  }
  return { merged: { type: 'text', text, ...(images.length > 0 ? { attach: images } : {}) }, degraded };
}

/** 一条"实际要发的东西" → QQ outlet 的 payload。 */
export function pushFor(message, outbound, name) {
  const images = [];
  for (const attachment of Array.isArray(message.attach) ? message.attach : []) {
    if (attachment?.type === 'image' && typeof attachment.url === 'string' && /^https?:\/\//iu.test(attachment.url)) images.push(attachment.url);
  }
  if (message.type === 'image' && typeof message.url === 'string' && /^https?:\/\//iu.test(message.url)) images.push(message.url);
  return {
    text: typeof message.text === 'string' ? message.text : '',
    kind: outbound.kind,
    name,
    ...(images.length > 0 ? { images: images.slice(0, 4) } : {}),
    ...(outbound.trace?.ticket ? { ticket: outbound.trace.ticket } : {}),
  };
}

/**
 * @param deps.outlet  世界那边的 outlet（`{ name, kinds, send(push) }`）
 * @param deps.name    写进 push 的发送方名字（她的名字）
 * @param deps.sleep   可注入（测试用，避免真等）
 */
export function createQqAdapter(deps) {
  const outlet = deps.outlet;
  if (!outlet || typeof outlet.send !== 'function') throw new Error('qqAdapter: 需要 outlet.send');
  const name = String(deps.name ?? 'TA');
  const capabilities = deps.capabilities ?? QQ_CAPABILITIES;
  const sleep = deps.sleep ?? defaultSleep;
  const logger = deps.logger ?? (() => {});
  const accepts = new Set(Array.isArray(outlet.kinds) && outlet.kinds.length > 0 ? outlet.kinds : ['reply', 'busy', 'reach']);

  return {
    name: 'qq',
    capabilities,
    /**
     * @returns {{ ok, messageIds, degraded, media, rendered, error, delivery }}
     *   `delivery` 直接就是 createDeliveryLog.append() 要的那条记录。
     */
    async deliver(outbound) {
      const plan = planDelivery(capabilities, outbound);
      const degraded = [...plan.degraded];
      let messages = plan.messages;

      // 这条腿不收这个 kind：不发，也不假装发了
      if (!accepts.has(outbound.kind)) {
        degraded.push({ what: 'kind', why: DEGRADE_REASONS.unsupportedForm });
        return {
          ok: false,
          messageIds: [],
          degraded,
          media: plan.media,
          rendered: [],
          error: `QQ 这条出口不收 ${outbound.kind}（只收 ${[...accepts].join('/')}）`,
          delivery: {
            kind: outbound.kind,
            platform: 'qq',
            conversationId: outbound.replyTo?.conversationId ?? '',
            segments: outbound.segments.length,
            sentSegments: 0,
            media: plan.media,
            degraded,
            ok: false,
            messageIds: [],
            error: `kind ${outbound.kind} 不被接受`,
          },
        };
      }

      // reply 是一次性的：多条必须并成一条
      if (outbound.kind === 'reply' && messages.length > 1) {
        const mergedResult = mergeForReply(messages, capabilities);
        messages = [mergedResult.merged];
        degraded.push({ what: 'segments', why: DEGRADE_REASONS.merged }, ...mergedResult.degraded);
      }

      const ticket = outbound.trace?.ticket ?? `qq-${Date.now()}`;
      const messageIds = [];
      const rendered = [];
      let error = null;

      for (const [index, message] of messages.entries()) {
        if (index > 0) await sleep(gapFor(outbound, capabilities));
        const push = pushFor(message, outbound, name);
        if (push.text === '' && (push.images === undefined || push.images.length === 0)) {
          // 空的就别发：QQ 那边会判成空推送
          degraded.push({ what: 'text', why: DEGRADE_REASONS.unsupportedForm });
          continue;
        }
        try {
          await outlet.send(push);
          messageIds.push(`qq:push:${ticket}:${index + 1}`);
          rendered.push({ type: 'text', text: push.text, ...(push.images ? { images: push.images } : {}) });
        } catch (failure) {
          error = failure instanceof Error ? failure.message : String(failure);
          logger(`qqAdapter: 第 ${index + 1} 条推送失败：${error}`);
          break;
        }
      }

      const ok = error === null && messageIds.length > 0;
      return {
        ok,
        messageIds,
        degraded,
        media: plan.media,
        rendered,
        error,
        delivery: {
          kind: outbound.kind,
          platform: 'qq',
          conversationId: outbound.replyTo?.conversationId ?? '',
          segments: outbound.segments.length,
          sentSegments: rendered.length,
          media: plan.media,
          degraded,
          ok,
          messageIds,
          error,
        },
      };
    },
  };
}
