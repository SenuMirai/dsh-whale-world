/**
 * dsh-memory-hub —— 她的记忆本体
 *
 * ── 为什么需要这个文件 ──────────────────────────────────────────────
 *
 * 现状：记忆的写入逻辑全在 dsh-qq-group 里，world 只是硬编码读那个文件。
 * 后果：
 *   · 如果不用 QQ 了，dsh-qq-group 一卸载，就没有代码能写记忆
 *   · B站、抖音各管各的，它们的记忆是孤岛
 *   · 以后接微信，又得重写一遍写入逻辑
 *   · 记忆格式的知识分散在多个插件里，改一处要改好几处
 *
 * 目标：记忆中枢是她完整独立的本体，外接插件只是对外窗口。
 *
 *   QQ / 抖音 / B站 / 微信 / 家会话
 *          ↓ 只调这几个接口，不知道存储长什么样
 *   ┌────────────────────────────────┐
 *   │  dsh-memory-hub                │
 *   │  · 存储（唯一真源）            │
 *   │  · 格式（schema 版本）         │
 *   │  · 去重（coreJaccard / 实体）  │
 *   │  · 衰减（半衰期）              │
 *   │  · 检索（四路 + RRF）          │
 *   └────────────────────────────────┘
 *
 * ── 可移植性 ────────────────────────────────────────────────────────
 *
 * 所有路径都从调用方传进来的 root 派生，不写死盘符。
 * 调用方用 resolveDshHome() 拿到根，所以搬到别的硬盘、别的机器都跟得上。
 *
 * ── 兼容性 ──────────────────────────────────────────────────────────
 *
 * 存储格式和现有 memory-traces.json 完全一致。
 * 这个模块只做「逻辑搬家 + 加接口层」，不改数据结构——
 * 随时能把调用方切回老路径，一条记忆都不会丢。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/* ══════════════════════════════════════════════════════════════════════
 * 类型
 * ══════════════════════════════════════════════════════════════════════ */

/** 记忆归属：和主人 / 群聊 / 工作 */
/** 写进来的东西从哪来。以后接微信就是 'wechat'。 */
/* ══════════════════════════════════════════════════════════════════════
 * 常量
 * ══════════════════════════════════════════════════════════════════════ */

/** 三级半衰期。core 十年，是「不会淡的锚点」。 */
const TIER_TAU = {
  core: 3650,
  important: 30,
  normal: 7,
};

/**
 * 高频虚词 —— 不参与相似度计算。
 *
 * 2026-11-02 加。起因：查「主人说怕把我弄丢」时，「祭典选紫色忍者」也被召回，
 * 因为两条共享「主人」「人说」两个 bigram，重合度算出 28.6%。
 * 这些词在任何对话里都高频，贡献的全是噪声。
 */
const FUZZY_GRAMS = new Set([
  '主人', '人说', '说他', '她说', '说我', '说这', '说那', '我说', '他说',
  '你我', '他的', '我的', '你的', '自己', '一个', '这个', '那个',
  '的是', '是的', '了这', '什么', '怎么', '就是', '不是', '有点', '一下',
  '其实', '然后', '因为', '所以', '但是', '而且', '还有', '时候', '现在',
  '今天', '昨天', '明天', '知道', '觉得', '感觉', '起来', '出来', '看到',
  '亲眼', '一眼', '真的', '已经', '可以', '没有', '一样',
]);

/* ══════════════════════════════════════════════════════════════════════
 * bigram 与相似度
 * ══════════════════════════════════════════════════════════════════════ */

function bigrams(text) {
  const clean = String(text).replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  const out = new Set();
  for (let i = 0; i < clean.length - 1; i += 1) {
    const g = clean.slice(i, i + 2);
    if (FUZZY_GRAMS.has(g)) continue;
    out.add(g);
  }
  return out;
}

function overlap(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const g of a) if (b.has(g)) hit += 1;
  return hit / Math.min(a.size, b.size);
}

function jaccardRaw(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const g of a) if (b.has(g)) hit += 1;
  return hit / (a.size + b.size - hit);
}

/** 抽「核心实体」——一件事的身份标记。 */
function entitiesOf(text) {
  const s = String(text);
  const out = new Set();
  for (const m of s.matchAll(/\d{2,}/g)) out.add('#' + m[0]);
  for (const m of s.matchAll(/[「『""]([^」』""]{2,40})[」』""]/g)) {
    out.add('Q' + m[1].trim().slice(0, 12));
  }
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9+/\-]{1,20}/g)) out.add('E' + m[0].toLowerCase());
  return out;
}

/** 共享稀有实体（数字 / 长引文）。英文词不算，见下面的说明。 */
function sharedRare(a, b) {
  let n = 0;
  for (const x of a) {
    if (!b.has(x)) continue;
    if (x.startsWith('#')) { if (x.slice(1).length >= 2) n += 1; }
    else if (x.startsWith('Q') && x.length >= 5) n += 1;
  }
  return n;
}

/**
 * 两条记忆是不是「同一件事」。
 *
 * ⚠ 2026-11-03 01:10 重写。原来第一档是「共享核心实体 ≥2 就算同一件事」，
 * 而 entitiesOf 把**每个英文单词**都当实体（dsh / qq / deepseek / kfc…）。
 * 她的语料里到处是 DSH 和 QQ，于是任意两条提到这两样的记忆都判成同一件事。
 *
 * 实测（在现网 3,883 条上做全量两两比对，296 万对）：
 *   旧规则判「同一件事」  6,930 对  ← 几乎全是误判
 *     例：「一点半了主人还在修 DSH 更新后不兼容的旧插件」⟷「主人在QQ发消息我没回上」
 *   去掉实体档后按字面重合：
 *      Jaccard ≥ 0.28  771 对
 *      Jaccard ≥ 0.35  262 对
 *      Jaccard ≥ 0.42    0 对   ← 原来第三档从来没生效过
 *
 * 所以真正在干活的是那个误判档。危害不是「多留几条」，是**写的时候把新事并进旧事**：
 * 她说「主人说 QQ 又没收到消息」，会并进某条八竿子打不着的 QQ 旧记忆里，这条新事就没了。
 *
 * 现在的判据（任一成立），都用字面重合兜底：
 *   ① Jaccard ≥ 0.35                      —— 措辞基本一样
 *   ② 共享 1 个真稀有实体 且 Jaccard ≥ 0.28 —— 「第146行」那种只像 28~39% 但确实是同一件事
 * 英文词不再当身份标记。
 */
export function sameEvent(a, b) {
  const similarity = jaccardRaw(bigrams(a), bigrams(b));
  if (similarity >= 0.35) return true;
  if (similarity >= 0.28 && sharedRare(entitiesOf(a), entitiesOf(b)) >= 1) return true;
  return false;
}

/* ══════════════════════════════════════════════════════════════════════
 * Hub
 * ══════════════════════════════════════════════════════════════════════ */

export function createMemoryHub(root) {
  const file = join(root, 'memory-traces.json');
  let cache = null;
  let cacheMtime = 0;

  function load() {
    try {
      if (!existsSync(file)) return [];
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      const arr = Array.isArray(raw) ? raw : (raw.traces ?? []);
      const out = [];
      for (const item of arr) {
        if (!item || typeof item.text !== 'string') continue;
        out.push({
          // 先把原样铺开，再按下面的规则覆盖已知字段。
          //
          // 2026-11-02 深夜补的：原来是「只挑我认识的字段」，于是
          // 读一次 → save() 写一次，就把不认识的字段全洗掉了。
          // 现网 3,882 条里每条都带 halfLifeDays（7/20/60，按域给的新鲜度半衰期），
          // 而 QQ 侧忆旧（memory-v3.ts 的 freshness / emotionFreshness）真的在读它。
          // 这条路径一直没被踩到，只因为 remember() 今晚之前从没成功写过一次——
          // 她第一轮家会话一落地，就会一次性抹掉全部 3,882 个 halfLifeDays。
          ...item,
          id: typeof item.id === 'string' ? item.id : makeId(item.text),
          text: item.text,
          ...(typeof item.voice === 'string' ? { voice: item.voice } : {}),
          ...(typeof item.feeling === 'string' ? { feeling: item.feeling } : {}),
          domain: item.domain === 'owner' || item.domain === 'group' ? item.domain : 'work',
          ...(typeof item.source === 'string' ? { source: item.source } : {}),
          importance: typeof item.importance === 'number' ? item.importance : 0.5,
          emotion: typeof item.emotion === 'number' ? item.emotion : 0.2,
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
          lastRecalledAt: typeof item.lastRecalledAt === 'number' ? item.lastRecalledAt : Date.now(),
          recallCount: typeof item.recallCount === 'number' ? item.recallCount : 0,
          pinned: item.pinned === true,
          ...(item.demoted === true ? { demoted: true } : {}),
          ...(Array.isArray(item.participants) ? { participants: item.participants } : {}),
          ...(Array.isArray(item.relatedIds) ? { relatedIds: item.relatedIds } : {}),
          ...(item.occurredTime === null || typeof item.occurredTime === 'number'
            ? { occurredTime: item.occurredTime }
            : {}),
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  function makeId(text) {
    return 'm-' + createHash('sha256').update(text + Date.now()).digest('hex').slice(0, 16);
  }

  /** 只在文件真的变了时重读。 */
  function snapshot() {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      const arr = Array.isArray(raw) ? raw : (raw.traces ?? []);
      const mtime = arr.length;
      if (cache !== null && mtime === cacheMtime) return cache;
      cache = load();
      cacheMtime = mtime;
      return cache;
    } catch {
      return cache ?? [];
    }
  }

  function save(list) {
    const raw = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, traces: [] };
    const out = Array.isArray(raw) ? list : { ...raw, traces: list };
    writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
    cache = list;
    cacheMtime = list.length;
  }

  /**
   * 在同一把「进程内锁」里做读-改-写（2026-11-03 加，M2 的第一块）。
   *
   * 为什么需要：世界和 QQ 插件都在**同一个 Node 进程**里，各自都是
   * 「读整份文件 → 改 → 写回整份」。两边几乎同时写，就会有一方的改动被覆盖——
   * 不是理论风险，是 read-modify-write 的固有竞态。
   *
   * mutate() 把「读」和「写」之间隔开的那段时间收进一条串行队列：
   * 后到的写法拿到的一定是前一个写完之后的列表，于是谁都不会被吞。
   *
   * 用法：`hub.mutate((list) => { ...改 list...; return list; })`
   * 回调里拿到的是**当前最新**的列表（不是调用方手里那份旧快照）。
   */
  let queue = Promise.resolve();
  function mutate(change) {
    const run = queue.then(() => {
      const list = load();
      const next = change(list);
      if (Array.isArray(next)) save(next);
      return Array.isArray(next) ? next : list;
    });
    // 队列不能因为某一次失败就断掉
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  /**
   * 写入一条记忆。
   *
   * 内部依次做：
   *   ① 去重（同一件事不重复存）
   *   ② 补齐字段（id / 时间 / 强度）
   *   ③ 落盘
   *
   * 去重命中时不是丢弃，而是「强化旧的那条」——
   * 同一件事说两遍，说明它更重要，把它往上抬。
   */
  function remember(input) {
    const text = String(input.text ?? '').trim();
    if (text === '') throw new Error('remember: text 不能为空');

    const list = load();

    /*
     * actor：这条记忆是谁做的（2026-11-03 深夜加）。
     *
     * 起因：抖音那个插件里有个它自己的 AI，会自己刷视频。把它的观看记录
     * 写成「看了《…》」摆进她的记忆，等于让她认领别人的经历——
     * 主人当场就指出来了：「这次刷抖音她完全没意识，不该当成她主动刷的」。
     *
     * 所以每条记忆带一个行为主体：
     *   · 没有这个字段 = 'self'，就是她自己（现存 3,915 条旧记录全是这种）
     *   · 'douyin-plugin' = 抖音那个入口自带的 AI 干的
     *   · 'douyin-entry'  = 发生在抖音入口上、但不是她本人（具体是谁不清楚）
     * 召回时按它决定用第几人称，去重时也必须同主体才合并，
     * 否则「它看的」会被并进「我看的」里。
     */
    const actor = input.actor ?? 'self';

    // ① 去重：同域 + 同主体 + 同一件事
    for (const old of list) {
      if (old.pinned) continue;
      if (old.domain !== input.domain) continue;
      if ((old.actor ?? 'self') !== actor) continue;
      const haystack = `${old.text} ${old.feeling ?? ''}`;
      const needle = `${text} ${input.feeling ?? ''}`;
      if (!sameEvent(needle, haystack)) continue;

      // 命中：强化旧的，不新增
      old.recallCount += 1;
      old.lastRecalledAt = Date.now();
      old.importance = Math.min(1, Math.max(old.importance, input.importance ?? old.importance));
      old.emotion = Math.min(1, Math.max(old.emotion, input.emotion ?? old.emotion));
      // 新版本更长就换掉正文（信息更全）
      if (text.length > old.text.length) old.text = text;
      if (input.feeling && (old.feeling ?? '').length < input.feeling.length) old.feeling = input.feeling;
      /*
       * voice 补写（2026-11-03 加）。
       *
       * 合并路径原来只抬计数和强度，不动 voice。可旧记录（比如今晚 00:21 写进去那条）
       * 是「没有 voice」的，之后同一件事再说一遍也补不上，它会一直以「主人说「…」」
       * 的笔录形态躺着。这里补一条：旧记录没有 voice、新的有，就拿新的。
       */
      if (typeof old.voice !== 'string' || old.voice.trim() === '') {
        if (typeof input.voice === 'string' && input.voice.trim() !== '') old.voice = input.voice;
      }
      save(list);
      return { id: old.id, merged: true };
    }

    // ② 新增
    const now = Date.now();
    const item = {
      id: makeId(text),
      text,
      // voice 是「她能直接认领的那一版」。2026-11-03 补：
      // 新增分支原来只写 text/feeling，把调用方算好的 voice 丢了——
      // 结果只有合并路径有 voice，新写入的一条永远没有。
      ...(input.voice ? { voice: input.voice } : {}),
      ...(input.feeling ? { feeling: input.feeling } : {}),
      ...(actor !== 'self' ? { actor, ...(input.actorName ? { actorName: input.actorName } : {}) } : {}),
      domain: input.domain,
      ...(input.source ? { source: input.source } : {}),
      importance: clamp01(input.importance ?? 0.5),
      emotion: clamp01(input.emotion ?? 0.4),
      createdAt: now,
      lastRecalledAt: now,
      recallCount: 0,
      pinned: false,
      ...(input.participants ? { participants: input.participants } : {}),
      relatedIds: [],
      occurredTime: input.occurredTime ?? null,
    };

    list.push(item);
    save(list);
    return { id: item.id, merged: false };
  }

  /**
   * 按当前这句话召回相关记忆。
   *
   * 四路并行 → RRF 融合 → 话题去重 → 域权重。
   */
  function recall(query, opts = {}) {
    const topK = Math.max(1, Math.min(20, opts.topK ?? 5));
    const list = snapshot().filter((t) => t.demoted !== true);
    if (list.length === 0) return [];
    const q = String(query ?? '').trim();
    if (q === '') return [];

    const qG = bigrams(q);
    if (qG.size === 0) return [];

    const pool = opts.domain ? list.filter((t) => t.domain === opts.domain) : list;
    const gMap = new Map(pool.map((t) => [t.id, bigrams(`${t.text} ${t.feeling ?? ''}`)]));

    // 第 1 路：词法
    const lexical = [];
    for (const t of pool) {
      const sim = overlap(qG, gMap.get(t.id));
      if (sim > 0.12) lexical.push({ t, score: sim });
    }
    lexical.sort((a, b) => b.score - a.score);

    // 第 2 路：情绪（必须先沾边）
    const emotional = [];
    if (lexical.length > 0) {
      const qEmotion = lexical.slice(0, 3).reduce((s, x) => s + x.t.emotion, 0) / Math.min(3, lexical.length);
      for (const t of pool) {
        if (overlap(qG, gMap.get(t.id)) <= 0.04) continue;
        if (Math.abs(t.emotion - qEmotion) < 0.15) emotional.push({ t, score: t.importance * 0.5 });
      }
      emotional.sort((a, b) => b.score - a.score);
    }

    // 第 3 路：时间新近（必须先沾边）
    const now = Date.now();
    const recent = pool
      .filter((t) => now - t.createdAt < 3 * 86400000)
      .filter((t) => overlap(qG, gMap.get(t.id)) > 0.06)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 6)
      .map((t) => ({ t, score: 0.3 }));

    // 第 4 路：关联扩散
    const linked = [];
    const byId = new Map(pool.map((t) => [t.id, t]));
    const seen = new Set(lexical.slice(0, 3).map((x) => x.t.id));
    for (const x of lexical.slice(0, 3)) {
      for (const rid of x.t.relatedIds ?? []) {
        if (seen.has(rid)) continue;
        const rel = byId.get(rid);
        if (!rel) continue;
        seen.add(rid);
        linked.push({ t: rel, score: x.score * 0.6 });
      }
    }

    // RRF 融合
    const K = 60;
    const fused = new Map();
    const addRoute = (arr) => {
      arr.forEach((x, rank) => {
        const prev = fused.get(x.t.id) ?? { t: x.t, score: 0, routes: 0 };
        prev.score += 1 / (K + rank + 1);
        prev.routes += 1;
        fused.set(x.t.id, prev);
      });
    };
    addRoute(lexical);
    addRoute(emotional);
    addRoute(recent);
    addRoute(linked);

    // 域权重
    const DOMAIN_WEIGHT = { owner: 1.0, group: 0.8, work: 0.6 };
    const weighted = [...fused.values()].map((x, i) => ({
      ...x,
      adjusted: (x.routes * 2 + x.score) * (DOMAIN_WEIGHT[x.t.domain] ?? 1),
    }));
    weighted.sort((a, b) => b.adjusted - a.adjusted);

    // 话题去重
    const picked = [];
    for (const x of weighted) {
      let dup = false;
      for (const kept of picked) {
        if (Math.abs(x.t.createdAt - kept.createdAt) > 6 * 3600000) continue;
        if (x.t.domain !== kept.domain) continue;
        if (overlap(gMap.get(x.t.id), gMap.get(kept.id)) < 0.3) continue;
        dup = true;
        break;
      }
      if (!dup) picked.push(x.t);
      if (picked.length >= topK) break;
    }
    return picked;
  }

  /** 最近 N 条。 */
  function recent(limit = 10) {
    return snapshot()
      .filter((t) => t.demoted !== true)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  /** 按 id 取全文。 */
  function get(id) {
    return snapshot().find((t) => t.id === id);
  }

  /**
   * 她主动翻过一条之后记一笔。
   *
   * 为什么要单独一个方法：召回块里飘上来的是「被挑中的」，
   * 而这里是她自己伸手去翻的——后者才是她真的在意那条的证据。
   * 只抬 recallCount 和 lastRecalledAt，不动正文、不动强度，读不出副作用。
   * 返回真翻到的 id；没找到的不算，也不新建。
   */
  function touch(ids) {
    const wanted = new Set((Array.isArray(ids) ? ids : [ids]).filter((x) => typeof x === 'string' && x !== ''));
    if (wanted.size === 0) return [];
    const list = load();
    const now = Date.now();
    const hit = [];
    for (const t of list) {
      if (!wanted.has(t.id)) continue;
      t.recallCount += 1;
      t.lastRecalledAt = now;
      hit.push(t.id);
    }
    if (hit.length > 0) save(list);
    return hit;
  }

  /** 统计。 */
  function stats() {
    const list = snapshot();
    const byDomain = {};
    const bySource = {};
    for (const t of list) {
      byDomain[t.domain] = (byDomain[t.domain] ?? 0) + 1;
      const s = t.source ?? 'legacy';
      bySource[s] = (bySource[s] ?? 0) + 1;
    }
    return { total: list.length, byDomain, bySource };
  }

  return { remember, recall, recent, get, touch, stats, file };
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
