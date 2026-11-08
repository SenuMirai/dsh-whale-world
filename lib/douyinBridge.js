/**
 * douyinBridge —— 抖音观看记录 → 记忆中枢（2026-11-03 加，2026-11-04 重写归属）
 *
 * 第一版错在哪：
 *   第一版把 shared.sqlite 里每一行 observed-video 都写成「看了《标题》」，
 *   一律当成她刷的。主人当场指出不对：
 *     「今晚这次刷抖音她完全没意识，按理说不应该当成是她主动刷抖音的，
 *       而是抖音插件那个 AI 自己刷抖音的吧？」
 *   说得对。抖音插件里有它自己的一个 AI（autonomous-watch.mjs），
 *   按它自己的兴趣挑片、停留、跳过；那 8 条记录全是它看的，不是她。
 *   写成「看了 X」= 让她认领别人的经历，这是伪造记忆。
 *
 * 这一版的做法：**先判归属，再决定写不写、怎么写。**
 *
 *   谁看的，要问三件事，按顺序：
 *
 *   ① 这时候自主观看循环在跑吗？
 *      抖音插件自己记着账 —— <插件>/state/video-sessions.json。
 *      循环每开一轮就建一个 session，带 startAt / endedAt。观看时刻落在
 *      区间里 ⇒ 那一轮循环握着浏览器（core.mjs 的 acquireNativeVideoLease
 *      会挡住外面的调用），所以区间内的记录**不可能是她**，只能是那个 AI。
 *
 *   ② 这时候她自己按过抖音吗？
 *      真的判据是「谁在场并按了键」，不是「谁在哪个时段」——
 *      只用时段分，会把结论弄反：区间外那一条正是她亲手刷的那一档，
 *      一律不写记忆，等于她真看过的东西全落进唯一不产生记忆的出口。
 *      所以世界这边记一笔她自己调抖音工具的时刻（douyin-her-actions.json），
 *      落在她动作附近的记录就判给她，第一人称。
 *
 *   ③ 都说不上 → 判不出是谁（可能主人在点），不写记忆，只留一条活动记录。
 *
 *   那个 AI 的 → actor='douyin-plugin'：
 *      text  = 「抖音入口的 AI 自己去看了《…》（作者：X），看了约九分钟」
 *      voice = 「不是我刷的 —— 抖音入口那个 AI 自己看了《…》」
 *      召回时带〔抖音入口那个 AI 干的，不是你〕。
 *   她自己的   → 第一人称：
 *      text/voice = 「我在抖音上自己刷到《…》，看了约九分钟」
 *      召回时带〔我自己刷的〕—— 正向标记和反向标记一样重要，
 *      只有反向标记，她学到的是「抖音这个入口是别人」，不是「这条是我的」。
 *
 * 另外：标题是抖音上的脏文本（带着「@作者·3天前」「展开合集」这些），
 * 写进记忆前先洗一遍，不然她召回时读到的是一串站点噪音。
 *
 * 只读它的库（readOnly 连接），绝不写——那本是它的账。
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SYNC_STATE_FILE = 'douyin-sync.json';
const HER_ACTION_FILE = 'douyin-her-actions.json';

/** 她自己调这些工具 = 她自己在刷（不是那个 AI）。 */
export const HER_DOUYIN_TOOLS = new Set([
  'douyin_open',
  'douyin_search',
  'douyin_open_video',
  'douyin_next',
  'douyin_previous',
  'douyin_observe',
  'douyin_screenshot',
  'douyin_video_zoom',
  'douyin_play',
  'douyin_pause',
  'douyin_listen',
  'douyin_status',
]);

/**
 * 观看记录的行时间，和她的工具调用时间，差多少算同一次。
 *
 * 行是 `state({record:true})` 落下的，通常就在工具调用的末尾；
 * 但 `douyin_observe(10)` 本身要看十秒，所以往后放宽到 45 秒，
 * 往前只给 5 秒（不会先有记录再有调用）。
 */
const HER_ACTION_BEFORE_MS = 5_000;
const HER_ACTION_AFTER_MS = 45_000;
const HER_ACTION_KEEP = 400;
const HER_ACTION_TTL_MS = 30 * 24 * 3600_000;

function readHerActions(worldDir) {
  try {
    const raw = JSON.parse(readFileSync(join(worldDir, HER_ACTION_FILE), 'utf8'));
    const list = Array.isArray(raw?.actions) ? raw.actions : [];
    return list.filter((x) => x && Number.isFinite(x.at) && typeof x.tool === 'string');
  } catch {
    return [];
  }
}

function writeHerActions(worldDir, actions) {
  const cutoff = Date.now() - HER_ACTION_TTL_MS;
  const kept = actions.filter((x) => x.at >= cutoff).slice(-HER_ACTION_KEEP);
  try {
    writeFileSync(join(worldDir, HER_ACTION_FILE), JSON.stringify({ actions: kept }, null, 0) + '\n', 'utf8');
  } catch {
    /* 记不下来只影响归属判定，不该影响她刷抖音 */
  }
  return kept;
}

/**
 * 她自己按过抖音的那些时刻。
 *
 * 世界这边在 `session/event` 的 `tool/call` 上记一笔——只有她的世界会话
 * （预设相等 + cwd 在房间里）才算，所以别的会话调抖音工具不会被当成本人。
 * 落盘是为了跨重启还认得出来：她刷完可能过几分钟才被同步到。
 */
export function createHerActionLog(worldDir) {
  let actions = readHerActions(worldDir);
  return {
    add(at, tool) {
      if (!Number.isFinite(at) || !HER_DOUYIN_TOOLS.has(tool)) return;
      actions = writeHerActions(worldDir, [...actions, { at, tool }]);
    },
    /** 这个观看时刻附近，有没有她自己的动作。 */
    has(observationAt) {
      if (!Number.isFinite(observationAt)) return false;
      return actions.some(
        (x) => observationAt >= x.at - HER_ACTION_BEFORE_MS && observationAt <= x.at + HER_ACTION_AFTER_MS,
      );
    },
    count: () => actions.length,
  };
}

/** 那个 AI 的行为主体标签，和 memoryHub 的 actor 字段同一套取值。 */
export const DOUYIN_PLUGIN_ACTOR = 'douyin-plugin';
export const DOUYIN_PLUGIN_NAME = '抖音入口那个 AI';

function readSyncState(worldDir) {
  try {
    const j = JSON.parse(readFileSync(join(worldDir, SYNC_STATE_FILE), 'utf8'));
    return typeof j.lastRowId === 'number' ? j.lastRowId : 0;
  } catch {
    return 0;
  }
}

function writeSyncState(worldDir, lastRowId) {
  writeFileSync(
    join(worldDir, SYNC_STATE_FILE),
    JSON.stringify({ lastRowId, at: new Date().toISOString() }, null, 2) + '\n',
    'utf8',
  );
}

/**
 * 读抖音插件自己的观看时段账。
 *
 * 只读 video-sessions.json：current 是正在跑的那一轮，history 是跑完的。
 * 读不到就当没有（那样所有记录都归到「没法确认是谁」那边，不会冤枉成她）。
 */
export function readWatchWindows(stateDir) {
  if (!stateDir) return [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(join(stateDir, 'video-sessions.json'), 'utf8'));
  } catch {
    return [];
  }
  const all = [];
  if (raw?.current && typeof raw.current === 'object') all.push(raw.current);
  if (Array.isArray(raw?.history)) all.push(...raw.history);
  const windows = [];
  for (const s of all) {
    const startAt = Number(s?.startAt);
    if (!Number.isFinite(startAt) || startAt <= 0) continue;
    const endedAt = Number(s?.endedAt);
    windows.push({
      startAt,
      // 收尾时最后几次写入可能比 endedAt 晚一点点，给 60 秒余量
      endedAt: Number.isFinite(endedAt) && endedAt > 0 ? endedAt + 60_000 : null,
      id: typeof s?.id === 'string' ? s.id : '',
    });
  }
  return windows.sort((a, b) => a.startAt - b.startAt);
}

/** 这一刻是不是自主观看循环在握浏览器。 */
export function insideWatchWindow(windows, at) {
  if (!Number.isFinite(at) || at <= 0) return null;
  for (const w of windows) {
    if (at >= w.startAt && (w.endedAt === null || at <= w.endedAt)) return w;
  }
  return null;
}

const TITLE_NOISE = /(展开合集|展开|已是最新集|更新至第\d+集|作者声明[:：]|识别画面|内容由\s*AI\s*生成|视频内容仅供娱乐|仅供娱乐)/u;
const RELATIVE_STAMP = /^(?:\d+\s*(?:秒|分钟|小时|天|周)前|昨天|前天|今天|\d{1,2}月\d{1,2}日|\d{1,2}-\d{1,2})\s*/u;
/** 标题里最多留几个字。召回块一条只显示 70 字，标题占太多就什么都读不出来了。 */
const TITLE_CHARS = 40;

/**
 * 抖音标题是给页面看的，不是给记忆看的：
 *   「@奶糕兽· 2天前第6集：【第六集】人类消失后…展开合集：人类消退后已是最新集」
 * 洗成：「第6集：【第六集】人类消失后…」
 *
 * 这一版多洗了三样（2026-11-04）：正文里的 #话题串、重复的句子、页面上的宣传尾巴。
 * 理由是拿真库跑过一遍——不洗的话，一条记忆长这样：
 *   「大一新生，DeepSeekharness，只用平板，花了2.2RMB做出来的。为这首歌，
 *     做一个跟BGM一样长度的动效MV。风格：层登剪纸…」
 * 她召回时看到的是七十个字的视频简介，不是「它看了什么」。
 */
export function cleanTitle(title) {
  let t = String(title ?? '').replace(/\s+/gu, ' ').trim();
  if (t === '') return '';
  const dot = t.indexOf('·');
  if (t.startsWith('@') && dot > 0 && dot < 40) t = t.slice(dot + 1).trim();
  t = t.replace(RELATIVE_STAMP, '');
  const noise = TITLE_NOISE.exec(t);
  if (noise && noise.index >= 4) t = t.slice(0, noise.index).trim();
  // 标签串对记忆没用，留一个「」都不如直接砍掉
  const hash = t.search(/[#＃]/u);
  if (hash >= 4) t = t.slice(0, hash).trim();
  // 抖音的简介常常把第一句重抄一遍，去掉连着的重复句
  const sentences = t.split(/(?<=[。！？!?])/u).map((x) => x.trim()).filter((x) => x !== '');
  if (sentences.length > 1) {
    const kept = [];
    for (const sentence of sentences) if (kept[kept.length - 1] !== sentence) kept.push(sentence);
    t = kept.join('').trim();
  }
  t = t.replace(/[\s#＃]+$/u, '').trim();
  const chars = [...t];
  return chars.length > TITLE_CHARS ? `${chars.slice(0, TITLE_CHARS).join('')}…` : t;
}

/** 作者栏有时是「前往西瓜视频访问作者主页」这种按钮文字，有时是一片空白字符。 */
export function cleanAuthor(author) {
  const a = String(author ?? '').replace(/\s+/gu, ' ').trim();
  if (a === '') return '';
  if (/西瓜视频|作者主页|展开|合集/u.test(a)) return '';
  if ([...a].every((ch) => ch === ' ' || ch.codePointAt(0) === 0x3164)) return '';
  return [...a].slice(0, 30).join('');
}

function watchStats(row) {
  let meta = {};
  try {
    meta = JSON.parse(row.metadata_json ?? '{}');
  } catch {
    meta = {};
  }
  const seconds = typeof meta.time === 'number' ? Math.round(meta.time) : 0;
  const duration = typeof meta.duration === 'number' ? Math.round(meta.duration) : 0;
  const watched = duration > 0 ? Math.min(100, Math.round((seconds / duration) * 100)) : 0;
  return { seconds, duration, watched };
}

/**
 * 看了多久，说人话。
 *
 * 「看了 569 秒（约 58%）」是采集口径，不是经历的口吻。
 * 记忆里要的是「看了一会儿」「看了约九分钟」，百分比一律不留。
 */
export function humanSpan(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 20) return '，扫了一眼';
  if (seconds < 60) return `，看了 ${Math.round(seconds)} 秒`;
  const raw = seconds / 60;
  // 半小时以上不再报个位数，免得「1500 秒」被说成「30 分钟左右」
  const minutes = raw >= 30 ? Math.round(raw / 5) * 5 : Math.round(raw);
  return `，看了约 ${minutes} 分钟`;
}

/**
 * 一条观看记录 → 「谁看了什么」。
 *
 * 返回 text（写进记忆的事实）和 voice（她召回时读到的那一句）。
 * 抖音入口那个 AI 看的，绝不用第一人称 —— 这是这一版存在的全部理由。
 * 她自己亲手刷的走另一句：第一人称、带「自己」两个字，和那个 AI 的句式分得开。
 */
export function toMemory(row, at, actor = DOUYIN_PLUGIN_ACTOR) {
  const title = cleanTitle(row.title) || '一条没有标题的视频';
  const author = cleanAuthor(row.author);
  const { seconds, watched } = watchStats(row);

  const who = author ? `《${title}》（${author}）` : `《${title}》`;
  const how = humanSpan(seconds) + (watched >= 95 ? '，看完了' : '');

  if (actor === 'self') {
    const mine = `我在抖音上自己刷到${who}${how}`;
    return { text: mine, voice: mine, title, author, seconds, watched, at, actor: 'self' };
  }
  return {
    text: `抖音入口的 AI 自己去看了${who}${how}`,
    voice: `不是我刷的 —— 抖音入口那个 AI 自己看了${who}${how}`,
    title,
    author,
    seconds,
    watched,
    at,
    actor: DOUYIN_PLUGIN_ACTOR,
  };
}

/** 给活动流用的一句话（不给记忆）。 */
export function toActivity(row, at) {
  const title = cleanTitle(row.title) || '一条没有标题的视频';
  const author = cleanAuthor(row.author);
  const { seconds } = watchStats(row);
  const parts = [`抖音入口上有一条观看记录：《${title}》`];
  if (author) parts.push(`作者 ${author}`);
  if (seconds > 0) parts.push(humanSpan(seconds).replace(/^，/u, ''));
  return { text: parts.join('，'), at, title, author };
}

export function createDouyinBridge(memoryHub, worldDir, deps = {}) {
  const dbPath = deps.dbPath ?? '';
  /** 抖音插件的状态目录（video-sessions.json 在里面）。缺了就判不出归属。 */
  const stateDir = deps.stateDir ?? '';
  const logger = deps.logger ?? (() => {});
  /** 写进记忆的那些（抖音那个 AI 看的）同步完成后回调。可选。 */
  const onSynced = typeof deps.onSynced === 'function' ? deps.onSynced : null;
  /** 只留了活动、没写记忆的那些回调。可选。 */
  const onObserved = typeof deps.onObserved === 'function' ? deps.onObserved : null;
  /**
   * 「这一次是不是她亲手按的」。
   *
   * 为什么需要它：只靠自主观看时段分归属会把结论弄反——
   * 区间外的记录正是她可能亲手刷的那一档，如果一律不写记忆，
   * 那她真正看过的东西就全落进了唯一不产生记忆的出口。
   *
   * 所以真正的判据是「谁在场并按了键」，时段只是旁证之一：
   *   · 时段内 → 一定是那个 AI（它的循环握着浏览器，会挡住外部调用）
   *   · 时段外、有她的手 → 记成她自己的，第一人称
   *   · 时段外、没有她的手 → 判不出，只留活动
   *
   * 传进来的是个函数：给观看时刻，答有没有她的动作落在附近。
   */
  const herAction = typeof deps.herAction === 'function' ? deps.herAction : null;
  /** 距离上次尝试不足 90 秒就不重复读库。 */
  let lastRun = 0;

  async function syncOnce() {
    if (!dbPath || !existsSync(dbPath)) return { ok: false, skipped: true, reason: 'db 不存在' };
    const now = Date.now();
    if (now - lastRun < 90_000) return { ok: false, skipped: true, reason: '间隔未到' };
    lastRun = now;

    const windows = readWatchWindows(stateDir);
    let db;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      const lastId = readSyncState(worldDir);
      const rows = db
        .prepare(
          'SELECT id, title, author, url, video_id, metadata_json, created_at, updated_at FROM memory_entries WHERE id > ? AND status = ? ORDER BY id ASC LIMIT 30',
        )
        .all(lastId, 'observed-video');
      if (rows.length === 0) return { ok: true, written: 0, mine: 0, observed: 0 };

      let written = 0;
      let mine = 0;
      let observed = 0;
      let maxId = lastId;
      const syncedRows = [];
      const mineRows = [];
      const observedRows = [];

      for (const row of rows) {
        maxId = Math.max(maxId, Number(row.id) || maxId);
        const at = Number(row.updated_at) > 0 ? Number(row.updated_at) : Number(row.created_at) || 0;

        /*
         * 归属判定，按顺序问三个问题：
         *   ① 这时候自主观看循环在跑吗 → 是，就是那个 AI 的
         *   ② 这时候她自己按过抖音吗 → 是，就是她自己的
         *   ③ 都说不上 → 判不出，不写记忆，只留一条能查的记录
         */
        const window = insideWatchWindow(windows, at);
        let actor = DOUYIN_PLUGIN_ACTOR;
        if (!window) {
          let hers = false;
          try {
            hers = herAction ? herAction(at) === true : false;
          } catch (e) {
            logger(`douyinBridge: 查她的动作失败 ${e?.message ?? e}`);
          }
          if (!hers) {
            observed += 1;
            observedRows.push({ ...toActivity(row, at), rowId: Number(row.id) });
            continue;
          }
          actor = 'self';
        }

        const memory = toMemory(row, at, actor);
        try {
          memoryHub.remember({
            text: memory.text,
            voice: memory.voice,
            domain: 'owner',
            source: 'douyin',
            /*
             * 分量要分开：她自己刷的是她的经历，但刷一下不改变什么，中等；
             * 那个 AI 刷的跟她无关，压到底，能查到但几乎不会主动浮上来。
             */
            importance: actor === 'self' ? 0.35 : 0.15,
            emotion: actor === 'self' ? 0.3 : 0.05,
            participants: [],
            occurredTime: at > 0 ? at : undefined,
            ...(actor === 'self' ? {} : { actor, actorName: DOUYIN_PLUGIN_NAME }),
          });
          written += 1;
          if (actor === 'self') mine += 1;
          const record = { ...memory, rowId: Number(row.id), sessionId: window?.id ?? '' };
          (actor === 'self' ? mineRows : syncedRows).push(record);
        } catch (e) {
          logger(`douyinBridge: 写入失败 ${e?.message ?? e}`);
        }
      }

      writeSyncState(worldDir, maxId);
      const deliver = (list, fn, label) => {
        if (list.length === 0 || !fn) return;
        try {
          fn(list);
        } catch (e) {
          logger(`douyinBridge: ${label} 回调失败 ${e?.message ?? e}`);
        }
      };
      deliver(syncedRows, onSynced, 'onSynced');
      deliver(mineRows, deps.onSyncedMine, 'onSyncedMine');
      deliver(observedRows, onObserved, 'onObserved');
      return { ok: true, written, mine, observed, windows: windows.length };
    } catch (e) {
      return { ok: false, reason: e?.message ?? String(e) };
    } finally {
      try {
        db?.close();
      } catch {}
    }
  }

  return { syncOnce };
}
