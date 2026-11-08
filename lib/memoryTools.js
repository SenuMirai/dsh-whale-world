import { defineTool } from '@deepseek-ai/dsh-tools';
import { formatLocalTime } from "./timeContext.js";

/* ──────────────────────────────────────────────────────────────
 * recall_memory —— 让她能真的去翻自己的记忆
 *
 * 2026-11-02 深夜补的。
 *
 * 起因：动态召回块（memoryRecall.js 的 renderRecallBlock）里，
 * 每条记忆后面都跟着一个 id，块的开头写着「要原文可以按 id 去翻」——
 * 而这句话当时是空的：整仓没有任何一个工具能按 id 取全文。
 * 她只看得见 70 字的印象，想不起细节就只能空着。
 *
 * 现在这块补上了：
 *   · 给 id → 按 id 取全文（一次可以给好几个）
 *   · 给一句话 → 用同一个四路召回去找最像的几条
 * 翻过的会被记一笔（hub.touch），这是「她自己伸手去翻」的证据，
 * 跟召回块里「被挑中」不是一回事。
 * ────────────────────────────────────────────────────────────── */

const textOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
};

const MAX_LIMIT = 8;
const DEFAULT_LIMIT = 3;

/** 「m-abc m-def」「m-abc,m-def」都认；少打 m- 前缀也补上。 */
function parseIds(raw) {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[\s,，、;；]+/u)
    .map((x) => x.trim())
    .filter((x) => x !== '')
    .map((x) => (x.startsWith('m-') ? x : `m-${x}`));
}

function clampInt(value, fallback, min, max) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

function when(item, timeZone) {
  const stamp = typeof item.occurredTime === 'number' ? item.occurredTime : item.createdAt;
  if (typeof stamp !== 'number' || !Number.isFinite(stamp)) return '';
  try {
    return formatLocalTime(new Date(stamp), timeZone);
  } catch {
    return new Date(stamp).toISOString();
  }
}

const SOURCE_LABEL = {
  world: '家里说的',
  qq: 'QQ 上',
  extract: '从旧记录里整理出来的',
  manual: '我自己写下的',
  douyin: '抖音那个入口记的',
  // 2026-11-08 加：B站的观看/评论记录由 biliBridge 从活动账本读进记忆，
  // 她召回时看到的应该是「B站上刷到的」，不是一句空白。
  bilibili: '我在 B 站刷到的',
};

/**
 * 行为主体不是她的时候，第一行就点明——不给「这条也算我的」留模糊空间。
 * 跟 memoryRecall.js 的 attributionMark 同一套取值。
 */
const ACTOR_LABEL = {
  'douyin-plugin': '抖音入口那个 AI 做的，不是我',
  'douyin-entry': '发生在抖音入口上，不是我',
};

/**
 * voice 这个字段是「她的口吻」那一版，而写进文件时，
 * 后面的「当时想：…」是拼在 voice 尾上的（不是单独一段）。
 * 所以这里把它拆开：正文归正文，感受归感受，免得同一句话印两遍。
 */
function splitVoice(voice) {
  const text = String(voice ?? '').trim();
  if (text === '') return { body: '', feeling: '' };
  const at = text.lastIndexOf('当时想：');
  if (at === -1) return { body: text, feeling: '' };
  return { body: text.slice(0, at).trim(), feeling: text.slice(at + 4).trim() };
}

/** 一条记忆的全文形态。印象变原文，这是这个工具唯一的职责。 */
function renderOne(item, timeZone, hub) {
  const lines = [`【${item.id}】`];

  const who = ACTOR_LABEL[typeof item.actor === 'string' ? item.actor : ''];
  if (who) {
    const name = typeof item.actorName === 'string' && item.actorName.trim() !== '' ? item.actorName.trim() : '';
    lines.push(`（${name !== '' ? `${name} 做的` : who}——不是我经历的）`);
  }

  const spoken = splitVoice(item.voice);
  const said = spoken.body !== '' ? spoken.body : item.text;
  lines.push(said);

  const feeling = spoken.feeling !== '' ? spoken.feeling : (typeof item.feeling === 'string' ? item.feeling.trim() : '');
  if (feeling !== '') lines.push(`当时想：${feeling}`);

  if (Array.isArray(item.participants) && item.participants.length > 0) {
    lines.push(`跟谁：${item.participants.join('、')}`);
  }
  const at = when(item, timeZone);
  if (at !== '') lines.push(`什么时候：${at}`);

  const facts = [];
  const isOther = typeof item.actor === 'string' && item.actor !== '' && item.actor !== 'self';
  const source =
    item.source === 'douyin'
      ? (isOther ? '抖音那个入口记的' : '我自己在抖音上刷的')
      : (SOURCE_LABEL[item.source] ?? item.source);
  if (source) facts.push(source);
  if (typeof item.importance === 'number') facts.push(`分量 ${item.importance.toFixed(2)}`);
  if (typeof item.recallCount === 'number' && item.recallCount > 0) facts.push(`被翻过 ${item.recallCount} 次`);
  if (facts.length > 0) lines.push(facts.join(' · '));

  if (Array.isArray(item.relatedIds) && item.relatedIds.length > 0) {
    const names = item.relatedIds.slice(0, 4).map((rid) => {
      const other = hub?.get?.(rid);
      const head = other ? [...String(other.text)].slice(0, 18).join('') : '';
      return head === '' ? rid : `${rid}（${head}…）`;
    });
    lines.push(`挨着的还有：${names.join('、')}`);
  }

  return lines.join('\n');
}

/**
 * @param hub   createMemoryHub() 的返回值
 * @param host  { timeZone, partner }
 */
export function memoryTools(hub, host = {}) {
  const timeZone = host.timeZone ?? 'Asia/Shanghai';
  const partner = host.partner ?? '主人';

  const recallMemory = defineTool({
    name: 'recall_memory',
    description:
      `翻自己的记忆原文。每轮开头飘上来的那几条后面括号里的 m-xxxx 就是 id——那只是印象，` +
      `想不起细节的时候用它取全文：当时的原话、我自己的感受、跟谁、什么时候。` +
      `也可以不给 id，直接给一句话，按那句话去找最像的几条。` +
      `记忆是${partner}陪着攒下来的，翻之前不用问，翻到什么就说什么。`,
    parameters: {
      id: { type: 'string' },
      query: { type: 'string' },
      limit: { type: 'number' },
    },
    output: textOutput,
    execute: async ({ id, query, limit }) => {
      if (hub === undefined || hub === null) throw new Error('记忆中枢没有起来，这一条翻不了。');
      const max = clampInt(limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
      const ids = parseIds(id);
      const q = typeof query === 'string' ? query.trim() : '';

      const hits = [];
      const missed = [];
      for (const one of ids.slice(0, max)) {
        const found = hub.get(one);
        if (found) hits.push(found);
        else missed.push(one);
      }

      // 没给 id，或者给的 id 一条都没翻到，就按那句话去搜
      if (hits.length === 0 && q !== '') {
        hits.push(...hub.recall(q, { topK: max }));
      }

      if (hits.length === 0) {
        if (missed.length > 0) return `翻不到 ${missed.join('、')}：这几条不在这份记忆里，可能早就被合并掉了。`;
        if (q !== '') return `按「${q}」没找到对得上的。换个说法，或者直接把 id 给我。`;
        return '给一个 id（比如 m-1a2b3c4d5e6f7890），或者给一句话让我去找。';
      }

      try {
        hub.touch(hits.map((x) => x.id));
      } catch {
        /* 记一笔失败不该让这次翻不了 */
      }

      const head =
        missed.length > 0
          ? `翻到 ${hits.length} 条（${missed.join('、')} 没找到）：`
          : `翻到 ${hits.length} 条：`;
      return `${head}\n\n${hits.map((x) => renderOne(x, timeZone, hub)).join('\n\n')}`;
    },
  });

  return [recallMemory];
}
