/**
 * 假适配器（阶段 0）
 *
 * 作用：**在碰任何真平台之前，先把契约跑熟。**
 *
 * 它做三件事，和真适配器一模一样：
 *   1. 声明能力（`Capabilities`）
 *   2. 把 `Outbound` 落地成"实际要发什么"（`plan`）——这里就是降级发生的地方
 *   3. 返回回执 `{ ok, messageIds, degraded, rendered }`
 *
 * 唯一的区别：它不发网络请求。
 *
 * 降级的两条铁规矩：
 *   · 平台做不到 → 记 `degraded`，能用等价形式就换（语音→文字、表情→它自带的字），
 *     换不了就丢弃并记下「丢了什么」
 *   · **声明能不做的，绝不降级**——降级只会发生在能力位为 false、
 *     或者超出平台上限（字数/图片数）的时候
 */
import { DEGRADE_REASONS, segmentChars, segmentKind } from './contract.js';

/**
 * 把意图排成"实际要发的东西"。纯函数，方便单测与对照跑。
 * @returns {{ messages: object[], degraded: {what:string, why:string}[], media: string[] }}
 */
export function planDelivery(capabilities, outbound) {
  const degraded = [];
  const units = [];
  const media = new Set();
  let imageCount = 0;

  for (const segment of outbound.segments) {
    const kind = segmentKind(segment);

    if (kind === 'text') {
      units.push({ type: 'text', text: segment.text });
      continue;
    }

    if (kind === 'voice') {
      media.add('voice');
      if (capabilities.voice) {
        units.push({ type: 'voice', text: segment.voice.text });
      } else {
        // 发不了语音，就把要说的话当文字发出去——不假装念了
        degraded.push({ what: 'voice', why: DEGRADE_REASONS.capability });
        units.push({ type: 'text', text: segment.voice.text });
      }
      continue;
    }

    if (kind === 'sticker') {
      media.add('sticker');
      if (capabilities.sticker) {
        units.push({ type: 'sticker', mood: segment.sticker.mood, fallback: segment.sticker.fallback });
      } else {
        degraded.push({ what: 'sticker', why: DEGRADE_REASONS.capability });
        const fallback = segment.sticker.fallback ?? (segment.sticker.mood ? `【${segment.sticker.mood}】` : '');
        if (fallback !== '') units.push({ type: 'text', text: fallback });
      }
      continue;
    }

    if (kind === 'image') {
      media.add('image');
      if (!capabilities.image) {
        degraded.push({ what: 'image', why: DEGRADE_REASONS.capability });
        continue;
      }
      if (segment.image.local !== undefined && !capabilities.localUpload) {
        // 有图能力，但吃不了本地文件（还没变成 URL）
        degraded.push({ what: 'image', why: DEGRADE_REASONS.unsupportedForm });
        continue;
      }
      if (imageCount >= capabilities.maxImages) {
        degraded.push({ what: 'image', why: DEGRADE_REASONS.overLimit });
        continue;
      }
      imageCount += 1;
      units.push({ type: 'image', ...segment.image });
      continue;
    }

    if (kind === 'file') {
      media.add('file');
      if (!capabilities.file) {
        degraded.push({ what: 'file', why: DEGRADE_REASONS.capability });
        continue;
      }
      if (!capabilities.localUpload) {
        degraded.push({ what: 'file', why: DEGRADE_REASONS.unsupportedForm });
        continue;
      }
      units.push({ type: 'file', ...segment.file });
      continue;
    }
  }

  const messages = [];

  if (capabilities.segments) {
    // 有多段能力：文字按平台字数上限切，媒体各自成条
    for (const unit of units) {
      if (unit.type === 'text' || unit.type === 'voice') {
        for (const piece of splitText(unit.text, capabilities.maxCharsPerMessage)) {
          messages.push(unit.type === 'voice' ? { type: 'voice', text: piece } : { type: 'text', text: piece });
        }
        continue;
      }
      messages.push(unit);
    }
  } else {
    // 只能发一条：所有文字并成一条，媒体能带几张带几张，其余记降级
    const texts = units.filter((u) => u.type === 'text' || u.type === 'voice').map((u) => u.text);
    const media1 = units.filter((u) => u.type === 'sticker' || u.type === 'image' || u.type === 'file');
    let merged = texts.join('\n').trim();
    if (merged !== '' && segmentChars({ text: merged }) > capabilities.maxCharsPerMessage) {
      merged = [...merged].slice(0, capabilities.maxCharsPerMessage).join('');
      degraded.push({ what: 'text', why: DEGRADE_REASONS.overLimit });
    }
    const attached = [];
    for (const m of media1) {
      if (m.type === 'image' && attached.length < capabilities.maxImages) attached.push(m);
      else degraded.push({ what: m.type, why: DEGRADE_REASONS.merged });
    }
    if (merged !== '' || attached.length > 0) {
      messages.push({ type: 'text', text: merged, ...(attached.length > 0 ? { attach: attached } : {}) });
    }
  }

  // 一段都没剩下：不许假装发了
  if (messages.length === 0) {
    degraded.push({ what: 'all', why: DEGRADE_REASONS.capability });
  }

  return { messages, degraded, media: [...media] };
}

/** 按平台单条字数上限切段；不切词中间，尽量落在标点后。 */
export function splitText(text, maxChars) {
  const value = String(text ?? '');
  if (value === '' || maxChars < 1) return value === '' ? [] : [value];
  const chars = [...value];
  if (chars.length <= maxChars) return [value];

  const pieces = [];
  let current = '';
  let currentLen = 0;
  for (const ch of chars) {
    current += ch;
    currentLen += 1;
    if (currentLen >= maxChars) {
      pieces.push(current);
      current = '';
      currentLen = 0;
    }
  }
  if (current !== '') pieces.push(current);
  return pieces;
}

/**
 * 造一个假适配器。
 *
 * @param deps.name         平台名（写进台账）
 * @param deps.capabilities 能力声明（会被 contract 校验，写错了当场抛）
 * @param deps.failOn       'never' | 'all' | (outbound) => boolean，用来测失败分支
 * @param deps.maxMessages  平台一轮最多发几条（超出记降级），默认 8
 */
export function createFakeAdapter(deps) {
  const name = String(deps.name ?? 'fake');
  const capabilities = deps.capabilities;
  if (!capabilities || typeof capabilities !== 'object') throw new Error(`fakeAdapter(${name}): 缺少 capabilities`);
  const failOn = deps.failOn ?? 'never';
  const maxMessages = Number.isInteger(deps.maxMessages) ? deps.maxMessages : 8;
  let seq = 0;

  return {
    name,
    capabilities,
    /** 不发网络，只按能力排出"实际会发什么"，并给回执。 */
    async deliver(outbound) {
      const { messages, degraded, media } = planDelivery(capabilities, outbound);
      const willFail = failOn === 'all' || (typeof failOn === 'function' && failOn(outbound) === true);
      const sent = willFail ? [] : messages.slice(0, maxMessages);
      if (!willFail && messages.length > maxMessages) {
        degraded.push({ what: 'segments', why: DEGRADE_REASONS.overLimit });
      }
      const messageIds = sent.map(() => `${name}:msg-${++seq}`);
      return {
        ok: !willFail && messageIds.length > 0,
        messageIds,
        degraded,
        media,
        rendered: sent,
        error: willFail ? `${name} 发送失败（假适配器按配置失败）` : null,
      };
    },
  };
}

/**
 * 对照跑用的三档能力：全支持 / 半支持 / 只会发字。
 *
 * 三档的差别**只写在这里**——同一份 Outbound 喂进去，输出的差异必须全部体现在
 * `degraded` 与 `rendered` 上，意图本身一个字都不用改。
 */
export const TIERS = {
  full: {
    segments: true,
    voice: true,
    sticker: true,
    image: true,
    file: true,
    mention: true,
    replyAnchor: true,
    localUpload: true,
    inbound: 'push',
    maxCharsPerMessage: 1000,
    maxImages: 4,
    pace: { minGapMs: 300, maxGapMs: 1200 },
  },
  half: {
    segments: true,
    voice: false,
    sticker: true,
    image: true,
    file: false,
    mention: true,
    replyAnchor: true,
    localUpload: false,
    inbound: 'poll',
    maxCharsPerMessage: 40,
    maxImages: 2,
    pace: { minGapMs: 400, maxGapMs: 2000 },
  },
  textOnly: {
    segments: false,
    voice: false,
    sticker: false,
    image: false,
    file: false,
    mention: false,
    replyAnchor: false,
    localUpload: false,
    inbound: 'none',
    maxCharsPerMessage: 60,
    maxImages: 0,
  },
};
