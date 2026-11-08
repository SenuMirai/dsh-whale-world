/**
 * Outbound 契约 v2（阶段 0 · 2026-11-04）
 *
 * 这一层只做一件事：把「她要说的话」变成一个**平台无关的意图对象**，并检查它是否合法。
 *
 * 为什么要有它：
 *   现在中枢往平台送东西，payload 只有 {text, kind, name, images[], image}——
 *   一段文字、最多四张网络图、一个表情名。分段、语音、贴纸语义、文件、@、回锚
 *   全都塞不进去，只能各平台自己想办法。结果就是每接一个平台，判定和发送逻辑
 *   又长出一套。
 *
 * 这层的规矩：
 *   · 中枢只产出**意图**，不写任何平台 API
 *   · 平台能力由适配器**声明**（`Capabilities`），中枢按能力**降级**
 *   · 降级必须留痕（`degraded: [{what, why}]`），不许假装发了
 *
 * 本文件是纯函数、零依赖，能在 node:test 与离线脚本里直接跑。
 */

/** 出站意图的种类。reply=回话，reach=主动找他，notice=通知（不算对话）。 */
export const OUTBOUND_KINDS = ['reply', 'reach', 'notice'];

/** 一次投递最多几段。再多就该合并成一段——人不会一口气发二十条。 */
export const MAX_SEGMENTS = 8;

/** 一段里只能有这些东西之一。 */
export const SEGMENT_KINDS = ['text', 'voice', 'sticker', 'image', 'file'];

/** 降级的理由码，排查时按它归类。 */
export const DEGRADE_REASONS = {
  /** 平台没有这个能力 */
  capability: 'platform-capability',
  /** 平台有这个能力，但这一段缺必要信息（比如只有本地图却没有上传能力） */
  unsupportedForm: 'unsupported-form',
  /** 超过平台上限（字数/图片数），被截断或丢弃 */
  overLimit: 'over-limit',
  /** 多段能力缺失，只好合并成一条 */
  merged: 'merged-into-one',
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const chars = (s) => [...String(s ?? '')].length;

/* ──────────────────────────────────────────────────────────
 * 能力声明
 * ────────────────────────────────────────────────────────── */

/**
 * 一份能力声明的默认值：**全部做不到**。
 *
 * 为什么默认是「全不行」而不是「全行」：接一个新平台时，最危险的是
 * 「以为它能发语音」——真发不出去时她已经说过那句了，收不回来。
 * 从全不行开始，每开一个能力都必须是明确写下的。
 */
export const EMPTY_CAPABILITIES = Object.freeze({
  segments: false,
  voice: false,
  sticker: false,
  image: false,
  file: false,
  mention: false,
  replyAnchor: false,
  /** 能不能直接吃本地文件（false ⇒ 只吃已经能取的 URL） */
  localUpload: false,
  /** 入站：push=平台推给我们，poll=我们轮询，none=没有入站 */
  inbound: 'none',
  maxCharsPerMessage: 1000,
  maxImages: 0,
  /** 分段之间的自然间隔；没有多段能力时无意义 */
  pace: Object.freeze({ minGapMs: 300, maxGapMs: 1200 }),
});

/**
 * 补齐并校验能力声明。写错了要当场说，不要带着错的能力去发消息。
 * @returns {{ ok: true, capabilities: object } | { ok: false, errors: string[] }}
 */
export function normalizeCapabilities(raw) {
  const errors = [];
  if (!isObject(raw)) return { ok: false, errors: ['capabilities 必须是对象'] };

  const out = { ...EMPTY_CAPABILITIES };
  for (const key of ['segments', 'voice', 'sticker', 'image', 'file', 'mention', 'replyAnchor', 'localUpload']) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== 'boolean') {
      errors.push(`capabilities.${key} 必须是布尔值`);
      continue;
    }
    out[key] = raw[key];
  }

  if (raw.inbound !== undefined) {
    if (!['push', 'poll', 'none'].includes(raw.inbound)) errors.push('capabilities.inbound 只能是 push/poll/none');
    else out.inbound = raw.inbound;
  }

  if (raw.maxCharsPerMessage !== undefined) {
    const n = raw.maxCharsPerMessage;
    if (!Number.isInteger(n) || n < 1 || n > 10_000) errors.push('capabilities.maxCharsPerMessage 须为 1..10000 的整数');
    else out.maxCharsPerMessage = n;
  }

  if (raw.maxImages !== undefined) {
    const n = raw.maxImages;
    if (!Number.isInteger(n) || n < 0 || n > 32) errors.push('capabilities.maxImages 须为 0..32 的整数');
    else out.maxImages = n;
  }

  if (raw.pace !== undefined) {
    if (!isObject(raw.pace)) errors.push('capabilities.pace 必须是对象');
    else {
      const { minGapMs, maxGapMs } = raw.pace;
      if (!Number.isFinite(minGapMs) || minGapMs < 0) errors.push('capabilities.pace.minGapMs 须为非负数');
      else if (!Number.isFinite(maxGapMs) || maxGapMs < minGapMs) errors.push('capabilities.pace.maxGapMs 须 ≥ minGapMs');
      else out.pace = Object.freeze({ minGapMs, maxGapMs });
    }
  }

  // 平台说能发图，却说 maxImages = 0，自相矛盾
  if (out.image && out.maxImages === 0) errors.push('capabilities 声明能发图但 maxImages 为 0');

  return errors.length > 0 ? { ok: false, errors } : { ok: true, capabilities: Object.freeze(out) };
}

/* ──────────────────────────────────────────────────────────
 * 出站意图
 * ────────────────────────────────────────────────────────── */

function parseSegment(raw, index, errors) {
  const at = `segments[${index}]`;
  if (!isObject(raw)) {
    errors.push(`${at} 必须是对象`);
    return undefined;
  }
  const present = SEGMENT_KINDS.filter((k) => raw[k] !== undefined);
  if (present.length !== 1) {
    errors.push(`${at} 必须有且只有一个字段（${SEGMENT_KINDS.join('/')}），现在是 ${present.join('+') || '空'}`);
    return undefined;
  }
  const kind = present[0];
  const value = raw[kind];

  if (kind === 'text') {
    if (!isNonEmptyString(value)) {
      errors.push(`${at}.text 必须是非空字符串`);
      return undefined;
    }
    return { text: String(value).trim() };
  }

  if (kind === 'voice') {
    const text = isObject(value) ? value.text : value;
    if (!isNonEmptyString(text)) {
      errors.push(`${at}.voice 需要 { text }（要说出来的那句话）`);
      return undefined;
    }
    return { voice: { text: String(text).trim() } };
  }

  if (kind === 'sticker') {
    if (!isObject(value) || (!isNonEmptyString(value.mood) && !isNonEmptyString(value.fallback))) {
      errors.push(`${at}.sticker 需要 { mood } 或 { fallback }`);
      return undefined;
    }
    return {
      sticker: {
        ...(isNonEmptyString(value.mood) ? { mood: String(value.mood).trim() } : {}),
        ...(isNonEmptyString(value.fallback) ? { fallback: String(value.fallback).trim() } : {}),
      },
    };
  }

  if (kind === 'image') {
    if (!isObject(value)) {
      errors.push(`${at}.image 需要 { url } 或 { local }`);
      return undefined;
    }
    const url = isNonEmptyString(value.url) ? String(value.url).trim() : undefined;
    const local = isNonEmptyString(value.local) ? String(value.local).trim() : undefined;
    if ((url === undefined) === (local === undefined)) {
      errors.push(`${at}.image 的 url 与 local 必须二选一`);
      return undefined;
    }
    return { image: { ...(url ? { url } : { local }) } };
  }

  // file
  if (!isObject(value) || !isNonEmptyString(value.local)) {
    errors.push(`${at}.file 需要 { local, name? }`);
    return undefined;
  }
  return {
    file: {
      local: String(value.local).trim(),
      ...(isNonEmptyString(value.name) ? { name: String(value.name).trim() } : {}),
    },
  };
}

/**
 * 校验一份出站意图。
 *
 * 只校验**形状**，不判断平台能不能做——那是适配器的事。
 * @returns {{ ok: true, outbound: object } | { ok: false, errors: string[] }}
 */
export function parseOutbound(raw) {
  const errors = [];
  if (!isObject(raw)) return { ok: false, errors: ['outbound 必须是对象'] };

  const kind = raw.kind === undefined ? 'reply' : raw.kind;
  if (!OUTBOUND_KINDS.includes(kind)) errors.push(`kind 只能是 ${OUTBOUND_KINDS.join('/')}`);

  if (!Array.isArray(raw.segments) || raw.segments.length === 0) {
    errors.push('segments 至少一段');
  } else if (raw.segments.length > MAX_SEGMENTS) {
    errors.push(`segments 最多 ${MAX_SEGMENTS} 段`);
  }

  const segments = [];
  if (Array.isArray(raw.segments)) {
    raw.segments.forEach((seg, i) => {
      const parsed = parseSegment(seg, i, errors);
      if (parsed !== undefined) segments.push(parsed);
    });
  }

  let mentions;
  if (raw.mentions !== undefined) {
    if (!Array.isArray(raw.mentions)) errors.push('mentions 必须是数组');
    else {
      mentions = [];
      for (const [i, m] of raw.mentions.entries()) {
        if (!isObject(m) || !isNonEmptyString(m.id)) {
          errors.push(`mentions[${i}] 需要 { id, name? }`);
          continue;
        }
        mentions.push({ id: String(m.id).trim(), ...(isNonEmptyString(m.name) ? { name: String(m.name).trim() } : {}) });
      }
    }
  }

  let replyTo;
  if (raw.replyTo !== undefined) {
    if (!isObject(raw.replyTo) || !isNonEmptyString(raw.replyTo.conversationId) || !isNonEmptyString(raw.replyTo.messageId)) {
      errors.push('replyTo 需要 { conversationId, messageId }');
    } else {
      replyTo = { conversationId: String(raw.replyTo.conversationId).trim(), messageId: String(raw.replyTo.messageId).trim() };
    }
  }

  let pace;
  if (raw.pace !== undefined) {
    if (!isObject(raw.pace) || !Number.isFinite(raw.pace.minGapMs) || !Number.isFinite(raw.pace.maxGapMs) || raw.pace.maxGapMs < raw.pace.minGapMs) {
      errors.push('pace 需要 { minGapMs, maxGapMs } 且 maxGapMs ≥ minGapMs');
    } else {
      pace = { minGapMs: raw.pace.minGapMs, maxGapMs: raw.pace.maxGapMs };
    }
  }

  let trace;
  if (raw.trace !== undefined) {
    if (!isObject(raw.trace)) errors.push('trace 必须是对象');
    else trace = { ...(raw.trace.ticket ? { ticket: String(raw.trace.ticket) } : {}), ...(raw.trace.reason ? { reason: String(raw.trace.reason) } : {}) };
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    outbound: Object.freeze({
      kind,
      segments: Object.freeze(segments.map((s) => Object.freeze(s))),
      ...(mentions ? { mentions: Object.freeze(mentions) } : {}),
      ...(replyTo ? { replyTo: Object.freeze(replyTo) } : {}),
      ...(pace ? { pace: Object.freeze(pace) } : {}),
      ...(trace ? { trace: Object.freeze(trace) } : {}),
    }),
  };
}

/* ──────────────────────────────────────────────────────────
 * 入站事件
 * ────────────────────────────────────────────────────────── */

/**
 * 平台 → 本体的入站事件。中枢收到后自己决定写不写记忆、该不该接话。
 * @returns {{ ok: true, inbound: object } | { ok: false, errors: string[] }}
 */
export function parseInbound(raw) {
  const errors = [];
  if (!isObject(raw)) return { ok: false, errors: ['inbound 必须是对象'] };
  if (!isNonEmptyString(raw.platform)) errors.push('platform 必填');
  if (!isNonEmptyString(raw.conversationId)) errors.push('conversationId 必填');
  if (!['message', 'mention', 'reply'].includes(raw.kind)) errors.push('kind 只能是 message/mention/reply');
  if (!isNonEmptyString(raw.messageId)) errors.push('messageId 必填');
  if (!isObject(raw.from) || !isNonEmptyString(raw.from.id)) errors.push('from 需要 { id, name? }');
  if (raw.at !== undefined && !Number.isFinite(raw.at)) errors.push('at 须为毫秒时间戳');
  if (raw.text !== undefined && typeof raw.text !== 'string') errors.push('text 须为字符串');

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    inbound: Object.freeze({
      platform: String(raw.platform),
      conversationId: String(raw.conversationId),
      kind: raw.kind,
      messageId: String(raw.messageId),
      from: Object.freeze({ id: String(raw.from.id), ...(isNonEmptyString(raw.from.name) ? { name: String(raw.from.name) } : {}) }),
      text: typeof raw.text === 'string' ? raw.text : '',
      ...(Array.isArray(raw.images) ? { images: Object.freeze(raw.images.filter(isNonEmptyString)) } : {}),
      at: Number.isFinite(raw.at) ? raw.at : Date.now(),
    }),
  };
}

/** 一段意图里占多少字（给适配器判断要不要切）。 */
export function segmentChars(segment) {
  if (segment.text !== undefined) return chars(segment.text);
  if (segment.voice !== undefined) return chars(segment.voice.text);
  return 0;
}

/** 这一段是什么类型。 */
export function segmentKind(segment) {
  for (const kind of SEGMENT_KINDS) if (segment[kind] !== undefined) return kind;
  return 'unknown';
}
