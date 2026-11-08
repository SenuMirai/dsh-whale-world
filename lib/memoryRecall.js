/**
 * 动态记忆检索（阶段 4）
 *
 * 解决的问题：
 *   现在每轮注入的 47 条是「按重要度排的固定名单」，跟正在聊什么无关。
 *   她问「我们改过记忆系统吗」，那 47 条里没有，就答不上来。
 *
 * 做法（参考 RestRegular/dsh-memory + hindsight + amygdala）：
 *   每轮取最后一条**人类**消息当查询词
 *   → 四路检索（词法 bigram / 情绪 / 时间 / 关联扩散）
 *   → RRF 融合
 *   → 只注入摘要 + id，要细节再取
 *
 * 关键约束：
 *   1. 只读，绝不改 memory-traces.json
 *   2. 命中 0 条时不返回任何东西——保持 provider 缓存前缀不变
 *   3. 查询词必须跳过所有合成消息，否则会形成自我循环
 *   4. 注入量有硬上限
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createMemoryHub } from './memoryHub.js';
import { join } from 'node:path';

/* ──────────────────────────────────────────────────────────────
 * ① 中文 bigram 索引与相似度
 * ────────────────────────────────────────────────────────────── */

/**
 * 高频虚词 bigram —— 不参与相似度计算。
 *
 * 2026-11-02 加。起因：查「主人说怕把我弄丢」时，「祭典选紫色忍者」也被召回，
 * 因为两条共享「主人」「人说」两个 bigram，重合度算出 28.6%。
 *
 * 这些词在任何对话里都高频，贡献的全是噪声：
 * 「主人说」几乎每条记忆都有，拿它当相似依据等于没筛。
 *
 * 只在**计算相似度**时排除，存储和展示不受影响——
 * 「主人」这个词本身还在文本里，只是不参与打分。
 */
const STOP_GRAMS = new Set([
  '主人', '人说', '说他', '她说', '说我', '说这', '说那', '我说', '他说',
  '你我', '他的', '我的', '你的', '自己', '一个', '这个', '那个',
  '的是', '是的', '了这', '什么', '怎么', '就是', '不是', '有点', '一下',
  '其实', '然后', '因为', '所以', '但是', '而且', '还有', '时候', '现在',
  '今天', '昨天', '明天', '知道', '觉得', '感觉', '起来', '出来',
  // 2026-11-03：口头语。加它们是因为实测「嗯呐，知道啦」靠「嗯呐」撞出了
  // 「你说『嗯呐，去床上等我』」——一个字都算不上内容，却占了一条召回位置。
  '嗯呐', '嗯嗯', '呐嗯', '啊啊', '呀呀', '了吗', '了吧', '好啦', '好呀',
]);

/**
 * 口头语字符。判断「这句有没有内容」时先把它们剥掉再看剩几个字。
 * 只放纯语气的字，不放「好/是/在」这种能带意思的。
 */
const FILLER_CHARS = /[嗯呐啊呀啦吧哦嘿哈咦诶唉喔噢哟嘛]|呢$/gu;

const CN_DIGIT = { 〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNIT = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

/** 「一百四十六」→ 146。只处理纯中文数字串，认不出来就返回 undefined。 */
function cnToArabic(run) {
  let total = 0;
  let section = 0;
  let digit = 0;
  let seen = false;
  for (const ch of run) {
    if (CN_DIGIT[ch] !== undefined) {
      digit = CN_DIGIT[ch];
      seen = true;
      continue;
    }
    const unit = CN_UNIT[ch];
    if (unit === undefined) return undefined;
    seen = true;
    if (unit === 10000) {
      total += (section + digit) * unit;
      section = 0;
    } else {
      section += (digit === 0 ? 1 : digit) * unit;
    }
    digit = 0;
  }
  if (!seen) return undefined;
  return total + section + digit;
}

/**
 * 把查询里的中文数字换成阿拉伯数字（2026-11-03 加）。
 *
 * 为什么：改述基准里「第一百四十六行那次看到什么」召不回来，因为库里写的是「146」。
 * 她说话用中文数字，记忆里落的是阿拉伯数字——纯词法匹配永远跨不过去。
 * 只在**连续两字以上**的中文数字串上做替换，避免「一定」「一起」被误伤。
 */
function normalizeNumerals(text) {
  return String(text).replace(/[〇零一二两三四五六七八九十百千万]{2,}/gu, (run) => {
    const n = cnToArabic(run);
    return n === undefined ? run : String(n);
  });
}

/** 把文本切成两字组合（中文没有空格分词，bigram 是最省事的索引） */
function bigrams(text) {
  const clean = normalizeNumerals(text).replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  const out = new Set();
  for (let i = 0; i < clean.length - 1; i += 1) {
    const g = clean.slice(i, i + 2);
    if (STOP_GRAMS.has(g)) continue;   // 虚词不进索引
    out.add(g);
  }
  return out;
}

/** 两个 bigram 集合的重合度 */
function overlap(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const g of a) if (b.has(g)) hit += 1;
  return hit / Math.min(a.size, b.size);
}

/* ──────────────────────────────────────────────────────────────
 * ② 记忆库加载（带缓存，按 mtime 失效）
 * ────────────────────────────────────────────────────────────── */

export function createRecallIndex(worldDir) {
  /**
   * 2026-11-02 改：读记忆改成走 memoryHub 接口，不再直接读文件。
   *
   * 为什么：记忆的存储格式、去重规则、衰减算法会变，
   * 如果 world 直接读文件，每次改格式都要同步改两边。
   * 走接口之后，world 只关心「给我相关记忆」，不关心怎么存的。
   *
   * 这也是「记忆中枢是她独立本体」的第一步：
   * 以后接微信、抖音，它们都调同一个 hub，world 不用改。
   */
  const hub = createMemoryHub(worldDir);
  const file = hub.file;
  let cache = null;
  let cachedMtime = 0;

  function load() {
    try {
      const st = statSync(file);
      if (cache !== null && st.mtimeMs === cachedMtime) return cache;
      // 走 hub 的接口读，不自己解析文件
      const raw = { traces: hub.recent(999999) };
      const traces = raw.traces;
      // 预计算 bigram，避免每轮重算 3882 条
      const prepared = traces
        .filter((t) => t && typeof t.text === 'string' && t.demoted !== true)
        .map((t) => ({
          id: t.id,
          text: t.text,
          voice: t.voice ?? '',
          feeling: t.feeling ?? '',
          domain: t.domain ?? 'work',
          importance: typeof t.importance === 'number' ? t.importance : 0.5,
          emotion: typeof t.emotion === 'number' ? t.emotion : 0.2,
          createdAt: typeof t.createdAt === 'number' ? t.createdAt : 0,
          lastRecalledAt: typeof t.lastRecalledAt === 'number' ? t.lastRecalledAt : 0,
          recallCount: typeof t.recallCount === 'number' ? t.recallCount : 0,
          relatedIds: Array.isArray(t.relatedIds) ? t.relatedIds : [],
          grams: bigrams(`${t.text} ${t.feeling}`),
        }));
      const byId = new Map(prepared.map((t) => [t.id, t]));
      cache = { traces: prepared, byId };
      cachedMtime = st.mtimeMs;
      return cache;
    } catch {
      return { traces: [], byId: new Map() };
    }
  }

  return { load, file };
}

/* ──────────────────────────────────────────────────────────────
 * ③ 四路检索
 * ────────────────────────────────────────────────────────────── */

const DAY = 86400000;

/**
 * @param index   createRecallIndex 的产物
 * @param query   当前这句人话
 * @param now     当前时间戳
 * @param opts    { topK, chars }
 */
export function recall(index, query, now = Date.now(), opts = {}) {
  const topK = Math.max(1, Math.min(20, opts.topK ?? 6));
  const { traces, byId } = index.load();
  if (traces.length === 0) return [];
  if (typeof query !== 'string' || query.trim() === '') return [];

  const qGrams = bigrams(query);
  if (qGrams.size === 0) return [];

  /**
   * 纯口头语不召回（2026-11-03 加，同日改过一版）。
   *
   * 起因：「嗯呐，知道啦」召回了「你说『嗯呐，去床上等我』」——靠口头语撞上的。
   *
   * 第一版写得很笨：去标点后不足 10 字、且 bigram 少于 4 个就不召回。
   * 主人当场指出来：「祭典颜色」也不是寒暄，是实义查询，凭什么不召回。
   * 他说得对——长度不是「有没有内容」的判据。
   *
   * 现在改成看**剥掉口头语之后还剩多少字**：
   *   嗯呐，知道啦 → 知道（2）  → 不召回
   *   好呀 / 在吗   → 1~2       → 不召回
   *   祭典颜色      → 4         → 召回
   *   我是谁        → 3         → 召回
   * 剩下的实义字 ≥ 3 就值得去翻记忆，长短不论。
   */
  const stripped = String(query)
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
    .replace(FILLER_CHARS, '');
  if (stripped.length < 3) return [];

  /* 第 1 路：词法 */
  const lexical = [];
  for (const t of traces) {
    const sim = overlap(qGrams, t.grams);
    if (sim > 0.12) lexical.push({ t, score: sim });
  }
  lexical.sort((a, b) => b.score - a.score);

  /**
   * 第 2 路：情绪相近
   *
   * 2026-11-02 修：原来只按「重要度 ≥0.7 + 情绪接近」筛，
   * 不看查询词——结果聊「怕把我弄丢」，会把「祭典选紫色忍者」也捞上来，
   * 只因为它重要度 0.7、情绪 0.8。
   *
   * 现在**必须先在词法上有微弱共鸣**（sim > 0.04）才有资格进这一路。
   * 情绪只是加权，不能单独把一个无关的记忆抬进来。
   */
  const emotional = [];
  if (lexical.length > 0) {
    const qEmotion = lexical.slice(0, 3).reduce((s, x) => s + x.t.emotion, 0) / Math.min(3, lexical.length);
    const weakGate = new Set(
      traces.filter((t) => overlap(qGrams, t.grams) > 0.04).map((t) => t.id),
    );
    for (const t of traces) {
      if (!weakGate.has(t.id)) continue;          // ← 必须先沾边
      if (Math.abs(t.emotion - qEmotion) < 0.15) {
        emotional.push({ t, score: t.importance * 0.5 });
      }
    }
    emotional.sort((a, b) => b.score - a.score);
  }

  /**
   * 第 3 路：时间新近
   *
   * 2026-11-02 修：原来只按「3 天内」取最新 10 条，完全不看查询词。
   * 于是不管聊什么，最近说的那几句永远占着几个名额。
   *
   * 现在同样要求「跟查询词有微弱共鸣」，时间新近只用来在同等相关里优先。
   */
  const recent = traces
    .filter((t) => now - t.createdAt < 3 * DAY)
    .filter((t) => overlap(qGrams, t.grams) > 0.06)   // ← 必须先沾边
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 6)
    .map((t) => ({ t, score: 0.3 }));

  /* 第 4 路：从词法命中扩散到 relatedIds */
  const linked = [];
  const seen = new Set(lexical.slice(0, 3).map((x) => x.t.id));
  for (const x of lexical.slice(0, 3)) {
    for (const relId of x.t.relatedIds) {
      if (seen.has(relId)) continue;
      const rel = byId.get(relId);
      if (!rel) continue;
      seen.add(relId);
      linked.push({ t: rel, score: x.score * 0.6 });
    }
  }

  /*
   * RRF 融合：score = Σ w / (K + rank)
   *
   * 2026-11-03 01:20 改了两处，都是实测逼出来的（固定 200 条样本，拿记忆自己的
   * 正文当查询，看能不能把自己捞回前五）：
   *
   *   ① 四路原来一样重。可是「说了什么词」才是相关性本身，
   *      「最近说过」「情绪接近」「跟它有关联」都只是旁证。旁证多了就能压过正主：
   *      一个在三条弱路上都沾边的条目，会赢过词法上的最佳匹配。
   *      所以词法给 3，其余三路各 0.3。
   *
   *   ② 最后一步排序原来写的是 `1/(K+rank+1) * 域权重`——只留名次，
   *      把 Σ 融合分整个丢了；而且名次是先按「命中几路」排的。
   *      结果：词法第一名只要只有一路，就必输给任意一个两路条目。
   *
   * 数字（前五命中率）：现在 22.0% → 只改①66.5% → ①②一起 96.5%。
   * 注意这是**上限**指标（查询就是从答案里抄的），不代表真实场景命中率；
   * 它只说明一件事：原来的排序根本没在用相关性。
   */
  const K = 60;
  const ROUTE_WEIGHT = { lexical: 3, other: 0.3 };
  const fused = new Map();
  const addRoute = (list, weight) => {
    list.forEach((x, rank) => {
      const prev = fused.get(x.t.id) ?? { t: x.t, score: 0, routes: 0 };
      prev.score += weight / (K + rank + 1);
      prev.routes += 1;
      fused.set(x.t.id, prev);
    });
  };
  addRoute(lexical, ROUTE_WEIGHT.lexical);
  addRoute(emotional, ROUTE_WEIGHT.other);
  addRoute(recent, ROUTE_WEIGHT.other);
  addRoute(linked, ROUTE_WEIGHT.other);

  const ranked = [...fused.values()].sort((a, b) => b.score - a.score);

  /**
   * domain 权重（2026-11-02 加）
   *
   * work 域记的是「我自己在干活」，owner 域记的是「我和他之间」。
   * 对陪伴来说，后者才是记忆的主体——她问「我们改过记忆系统吗」，
   * 该想起的是"我们一起弄的"，不是"我第 146 行看到了"。
   *
   * 不是删除，只是排序时往下压：work 打 0.6 折，group 打 0.8 折。
   * 如果只有 work 的记忆相关，它还是会浮上来，只是排在后面。
   */
  const DOMAIN_WEIGHT = { owner: 1.0, group: 0.8, work: 0.6 };

  /**
   * 最终分 = 0.5 × 词法相似度 + 0.5 × 归一化融合分，再乘域权重。
   *
   * 为什么两样都要：融合分把四路合成一个「有多相关」的整体判断，
   * 相似度保证「字面上真的对上」不会被旁证票淹没。
   * 只留融合分 → 36% 前五；只留相似度 → 变成纯关键词检索，改述就找不回来。
   * 各一半，两个毛病都不犯。
   */
  const maxRrf = ranked.reduce((m, x) => Math.max(m, x.score), 0) || 1;
  const simOf = new Map(lexical.map((x) => [x.t.id, x.score]));
  const weighted = ranked.map((x) => {
    const sim = simOf.get(x.t.id) ?? 0;
    const mixed = sim * 0.5 + (x.score / maxRrf) * 0.5;
    return { ...x, adjusted: mixed * (DOMAIN_WEIGHT[x.t.domain] ?? 1) };
  });
  weighted.sort((a, b) => b.adjusted - a.adjusted);

  // opts.dedupe === false 只给测量用：关掉话题去重，看它到底吃掉了多少好结果。
  const ordered = weighted.map((x) => x.t);
  const picked = opts.dedupe === false
    ? ordered
    : dedupeByTopic(ordered, opts.dedupeOpts ?? {});
  return picked.slice(0, topK);
}

/* ──────────────────────────────────────────────────────────────
 * ③.5 召回结果去重（话题聚类）
 * ────────────────────────────────────────────────────────────── */

/**
 * 把「说的是同一件事」的记忆压成一条。
 *
 * 为什么需要：
 *   2026-10-31 那晚她反复说「我亲眼看到第146行五条旧事」，存了 18 条。
 *   每条的 Jaccard 只有 28-45%（去重阈值是 60%），所以写入时一条都没合并。
 *   召回时这些一起浮上来——五条说同一件事，读起来像卡带。
 *
 * 怎么判断「同一件事」：
 *   不能只看字面相似度（她每次换个说法就躲过去了）。用三个信号：
 *   · 共享显著的 bigram（"第146行"、"KFC"、"亲眼"这种）
 *   · 同在 6 小时时间窗内
 *   · 同 domain
 *   满足两个就算同一话题簇，只留信息量最大的一条。
 *
 * 保留哪一条：
 *   优先留「词更具体」的（含引号原文、含人名、更长），
 *   而不是单纯分数高的——高分可能正是重复次数堆出来的。
 */
const CLUSTER_WINDOW_MS = 6 * 3600_000;

/** 一条记忆的"信息量"：具体的原话、人名、数字越多，越值得留。 */
function richness(t) {
  const s = `${t.text} ${t.feeling}`;
  let score = 0;
  score += (s.match(/「[^」]{2,}」/g) ?? []).length * 3;   // 引号里是原话
  score += (s.match(/[0-9]+/g) ?? []).length * 1;          // 具体数字
  score += (s.match(/主人|宝宝|老公/g) ?? []).length * 2;  // 提到对方
  score += Math.min(30, s.length) * 0.1;                    // 长度（封顶）
  return score;
}

/**
 * @param hits recall() 的结果（已按分数排序）
 * @returns 去重后的结果，保持原顺序
 */
export function dedupeByTopic(hits, opts = {}) {
  if (hits.length <= 1) return hits;

  /*
   * 阈值与时间窗。
   *
   * 2026-11-03：相似度阈值从 0.3 提到 0.55。原来的 0.3 太松——她库里大量
   * 「同一件事的两种写法」，0.3 会把它们全判成同题，于是**相关内容被自己的近亲挤掉**。
   * 实测（两次取样各 200 条）：
   *   阈值 0.30  前五 96.5%  关联 32.5%
   *   阈值 0.45  前五 97.5%  关联 61.0%
   *   阈值 0.55  前五 98.5%  关联 69.0%   ← 选它
   *   阈值 0.70  前五 99.5%  关联 71.0%
   *   不去重     前五 99.0%  关联 71.0%
   * 0.55 之后再去重就只剩「几乎逐字重复」那种，正是它该干的活；
   * 拿 1% 的前五换掉一半以上的关联损失，值。
   */
  const simThreshold = typeof opts.sim === 'number' ? opts.sim : 0.55;
  const windowMs = typeof opts.windowMs === 'number' ? opts.windowMs : CLUSTER_WINDOW_MS;
  /*
   * 「同一话题」时留哪条。
   *
   * 2026-11-03 改成默认 'score'（留排在前面的那条）。原来留「信息量大」的，
   * 而 hits 已经按分数排好了——用 richness 去顶替，等于让一条更长的相近记忆
   * 把**正确答案**顶掉。实测（固定 200 条样本，记忆自己当查询）：
   *   留信息量大的  第一 62.5%  前五 66.5%
   *   留分数高的    第一 89.0%  前五 96.5%
   * 同一个动作，只是换了个「留谁」，差了近三十个点。
   */
  const keepBy = opts.keepBy === 'rich' ? 'rich' : 'score';

  const kept = [];
  for (const h of hits) {
    let merged = false;
    for (let i = 0; i < kept.length; i += 1) {
      const k = kept[i];
      // 时间窗
      if (Math.abs(h.createdAt - k.createdAt) > windowMs) continue;
      // 同域
      if (h.domain !== k.domain) continue;
      /*
       * 同一主体才允许当作同一话题（2026-11-04 加）。
       * 「它看了《X》」和「我说了《X》」字面几乎一样，但一个是抖音那个 AI 的经历、
       * 一个是我的——去重把其中一条挤掉，等于又一次悄悄改归属。
       */
      if ((h.actor ?? 'self') !== (k.actor ?? 'self')) continue;
      // 共享显著 bigram（两条里都出现，且不是"的了是在"这种虚词）
      const sim = overlapBigrams(h, k);
      if (sim < simThreshold) continue;

      // 同一话题：留信息量大的那条
      merged = true;
      if (keepBy === 'rich' && richness(h) > richness(k)) kept[i] = h;
      break;
    }
    if (!merged) kept.push(h);
  }
  return kept;
}

/** 两条记忆的 bigram 重合度（复用第 ① 节的 overlap） */
function overlapBigrams(a, b) {
  return overlap(a.grams, b.grams);
}

/**
 * 从家会话的一轮对话里提炼记忆。
 *
 * 为什么需要这一段：
 *   她在 DSH 家会话里和主人聊天，那些话现在只进「会话记录」，
 *   不进「记忆痕迹」。所以她在家里说过的事，不会变成她记得的事。
 *   如果没有外接平台，家会话就是唯一的窗口——那时这个缺口是致命的。
 *
 * 提炼规则（不调 LLM，纯规则）：
 *   · 只记「有内容的」：长度 > 12 字，且不是纯寒暄
 *   · 优先记「带情绪的」：出现情绪词 → emotion 加分
 *   · 优先记「带承诺的」：出现「答应/说好/下次/以后」→ importance 加分
 *   · 谁说的：主人的话记 owner 域，她说的话作为 feeling
 */
const GREETING = /^(嗯|哦|好|行|在吗|在不在|哈|嘻|呵|呵+|啊这|收到|好的|好吧|晚安|早安|早|睡吧|吃了吗)[。？！~…\s]*$/u;
/**
 * 情绪词表。
 *
 * 2026-11-03 补：原来只有「怕/担心/开心…」这些**明说的情绪**，
 * 于是「对不起，可能我说的有点重了」这种**道歉和在意**判成了没份量
 * （13 字，够不着 18 字的长度线，也没命中任何情绪词）——直接被丢掉。
 * 可那句话恰恰最该记住：他道歉，她接住了。
 *
 * 现在加了道歉、致谢、示弱、撒娇、关心这一层：情绪不一定写在脸上。
 */
const EMOTION_WORDS =
  /怕|担心|害怕|开心|高兴|难过|失望|生气|心疼|委屈|舍不得|想你|爱你|喜欢|讨厌|难受|踏实|安心|累|疲|困|烦|爽|舒服|无聊|孤独|寂寞|饿|饱|冷|热|对不起|抱歉|不好意思|谢谢|辛苦|别介意|没事|没关系|抱|亲|乖|心疼|在意|愿意|不想|舍不得|舍不得/g;
const PROMISE_WORDS = /答应|说好|下次|以后|将来|一定|保证|约定|记得/g;
const SPECIFIC_MARKS = /「[^」]+」/g;

/**
 * @param {string} userText  主人说的
 * @param {string} replyText 她回的（可能为空）
 * @returns {{text: string, feeling?: string, importance: number, emotion: number} | null}
 */
/**
 * 从她的回复里抽出「当时心里那一句」。
 *
 * 2026-11-03 加。起因：feeling 里塞满了工作流水（文件路径、zip 名字、
 * 甚至把 <plan_next note="…"/> 那串假标签也存进去了）。
 *
 * 规则，从上到下依次剥：
 *   ① 工具标签、代码块、路径、URL —— 这些是动作，不是感受
 *   ② 分条（`---` 分隔已经在外面拆过），逐条挑最像感受的那条
 *   ③ 「那我去…」「好，那我走了」这种纯动作/过渡句排除
 *   ④ 剩下的仍然太长（>120 字）或太短（<6 字）就不存
 *
 * 宁可不存，也不存错：空的 feeling 星图上只是少一行，
 * 存错的会让她以后翻回来以为当年真是那样说话。
 */
function extractFeeling(reply) {
  let s = String(reply ?? '');

  // ① 剥掉一切不像「人话」的东西
  s = s
    .replace(/<[^>]{1,400}>/gu, ' ')          // <plan_next …/> <br> 这类标签
    .replace(/```[\s\S]*?```/gu, ' ')         // 代码块
    .replace(/`[^`]{1,200}`/gu, ' ')          // 行内代码
    .replace(/https?:\/\/\S+/gu, ' ')         // 链接
    /*
     * 路径要连同它周围的 markdown 强调符一起吃掉。
     * 只剥 `C:\...` 会把 **`C:\...`** 留成「**C: **」这种碎片，
     * 前半句还残着，看起来像一句人话，其实什么都不是。
     */
    .replace(/\*{0,2}`?[A-Za-z]:[\\/][^\s，。；）)]*`?\*{0,2}/gu, ' ')
    .replace(/\*{0,2}`?\/[\w.-]+\/[\w./-]{3,}`?\*{0,2}/gu, ' ')
    .replace(/\*\*+/gu, ' ')                  // 剩下的空强调符
    .replace(/\s+/gu, ' ')
    .trim();

  if (s === '') return undefined;
  // 剥完只剩下「C:」「zip」这种碎片，不算人话
  if ([...s.replace(/[^\u4e00-\u9fa5]/gu, '')].length < 4) return undefined;

  // ② 按标点切句，挑最像感受的一句
  const parts = s
    .split(/(?<=[。！？~～])/u)
    .map((x) => x.trim())
    .filter((x) => x !== '');

  /** 纯动作/过渡句：说「我要去干什么」，不是「我心里怎么样」。 */
  const ACTION = /^(那|好|行|嗯)[，、\s]?(我)?(先|就)?(去|走了|接着|看看|去做|来|试试)|我这就|我去了|那我先去/u;
  /** 明显的操作描述（已经剥过路径，这里再兜一层）。 */
  const OPS = /解压|下载|安装|重启|点开|打开|运行|执行|保存到|写到|生成|构建|编译|报错|日志/gu;
  /** 情绪/感受信号。有一点点就算像感受。 */
  const FEEL = /[嗯唉唔诶哎哈呜](?![嗯唉唔诶哎哈呜])|觉得|心里|有点|好像|其实|居然|竟然|突然|原来|怕|担心|开心|高兴|难受|委屈|舍不得|踏实|安心|心疼|想|希望|舍不得|喜欢|讨厌|烦|累|困|软|暖|酸|对不起|抱歉|谢谢|谢谢|辛苦|愿意|不想|在意/gu;
  /**
   * 工作词汇。2026-11-03 补。
   *
   * 光靠 OPS 那几个动词不够：「Godot 4.6.2 稳定版，还压在 zip 里～」
   * 一个操作动词都没有，却是彻头彻尾的工作进度，照样被当成感受存了下来。
   * 这里列出她干活时会冒出来的名词/状态词，命中就扣分。
   */
  const WORKISH = /稳定版|版本|引擎|插件|解压|压缩包|zip|exe|依赖|端口|配置|目录|文件夹|命令行|终端|接口|接口|文档|测试|构建|部署|版本号|安装包|路径|仓库|分支|提交|合并/giu;

  let best = '';
  let bestScore = -1;
  for (const p of parts) {
    const chars = [...p].length;
    if (chars < 6 || chars > 120) continue;
    if (ACTION.test(p)) continue;
    let score = (p.match(FEEL) ?? []).length * 2;
    score -= (p.match(OPS) ?? []).length * 3;
    score -= (p.match(WORKISH) ?? []).length * 2;   // 工作名词也扣
    if (/^[\s（(]/u.test(p)) score += 1;            // （括号里的常是心里话）
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  if (best === '') return undefined;

  /*
   * ③ 打分不够高就放弃（2026-11-03 加）。
   *
   * 原来只要挑出了「最高分」就留下，哪怕它是负分——
   * 「Godot 4.6.2 稳定版，还压在 zip 里～」正是这样混进来的：
   * 它一句都没有情绪信号，只是比其他候选「没那么差」。
   * 宁可这条记忆没有 feeling，也不要一句假感受。
   */
  if (bestScore < 1) return undefined;

  // ④ 还是像操作流水就放弃
  if ((best.match(OPS) ?? []).length >= 2) return undefined;

  // ⑤ 超长截断到一句
  const out = [...best].length > 120 ? `${[...best].slice(0, 120).join('')}…` : best;
  return out;
}

function distillTurn(userText, replyText) {
  const u = String(userText ?? '').replace(/\s+/g, ' ').trim();
  /*
   * 2026-11-03 改：原来 `u.length < 12` 一律不收，
   * 于是「对不起，可能我说的有点重了」（12 字，边界）
   * 和「我好怕你把我弄丢了」（9 字，但她真动了情）都被挡掉。
   *
   * 长度不是「有没有份量」的判据——情绪才是。
   * 现在：短句只要带情绪词/承诺词/引号原话就收，否则才靠长度。
   */
  const shortHasWeight =
    (u.match(EMOTION_WORDS) ?? []).length > 0 ||
    (u.match(PROMISE_WORDS) ?? []).length > 0 ||
    (u.match(SPECIFIC_MARKS) ?? []).length > 0;
  if (u.length < 6) return null;
  if (u.length < 12 && !shortHasWeight) return null;
  if (GREETING.test(u)) return null;

  const emotionHits = (u.match(EMOTION_WORDS) ?? []).length;
  const promiseHits = (u.match(PROMISE_WORDS) ?? []).length;
  const quotes = (u.match(SPECIFIC_MARKS) ?? []).length;

  /**
   * 什么值得记。
   *
   * 2026-11-02 调整：原来要求「必须有情绪词或承诺词」，结果「今天好累啊，
   * 工作一整天都没停过」被跳过了——那是他真实的状态，正是该记的。
   *
   * 现在的规则放宽成：
   *   · 够长（≥18 字）且不是纯寒暄 → 记
   *   · 或带情绪 / 承诺 / 引号原话 → 一定记
   *
   * 太严会漏掉他随口说的生活，太松会把寒暄塞满记忆。
   */
  const meaty = u.length >= 18;
  if (!meaty && emotionHits === 0 && promiseHits === 0 && quotes === 0) return null;

  const importance = Math.min(1, 0.45 + emotionHits * 0.12 + promiseHits * 0.15 + quotes * 0.08);
  const emotion = Math.min(1, 0.3 + emotionHits * 0.18);

  /*
   * 她说的话作为「当时想」——这是「为什么此刻这样说话」的来源。
   *
   * 2026-11-03 00:25 补的：她的回话是分条的，条与条之间用 `---` 隔开
   * （world-prompt.md 定的规矩），而 `---` 只是气泡分隔符，不是话。
   * 直接拼进 feeling 就变成「嗯，那我们一定长久。 --- （这句话我认真应了） --- …」，
   * 下一次翻出来她还以为自己当年这么说话。这里按分隔符拆开再拼回去。
   */
  const r = String(replyText ?? '')
    .split(/\s*-{3,}\s*/u)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part !== '')
    .join(' ');
  /*
   * 2026-11-03 18:xx 重写：原来只要 ≤300 字就整条当 feeling。
   *
   * 后果（当天 29 条里 15 条中招）：
   *   feeling 里塞满了工作流水——文件路径、zip 名字、
   *   甚至把 <plan_next note="…"/> 这串假标签也存了进去。
   *   星图上点开一颗星，看到的不是「她当时怎么想」，是半截工作汇报。
   *
   * feeling 的意思很窄：**那一刻她心里的一句话**。
   * 所以这里做四件事：
   *   ① 先剥掉工具标签和代码片段（那些是动作，不是感受）
   *   ② 去掉文件路径、URL、纯操作描述句
   *   ③ 只留第一句像「感受」的话；分条后取最像的那条
   *   ④ 仍然太长或不像感受的，宁可不存——空着比存错好
   */
  const feeling = extractFeeling(r);

  return {
    text: `主人说「${u.slice(0, 240)}」`,
    ...(feeling ? { feeling } : {}),
    importance: Number(importance.toFixed(2)),
    emotion: Number(emotion.toFixed(2)),
  };
}

/**
 * 把家会话的一轮对话写进记忆中枢。
 *
 * 由 dsh-world 的 session/event 监听调用：
 *   主人的话 + 她的回复 → distillTurn → hub.remember
 *
 * 为什么放在 hub 这一侧而不是 world：
 *   这是「记忆该不该记」的判断，属于记忆本体的职责。
 *   world 只负责把对话递过来，不决定记什么。
 *
 * @param {object} hub      createMemoryHub 的产物
 * @param {string} userText 主人说的
 * @param {string} reply    她回的
 * @param {string} channel  渠道标记（'home' / 'qq' / 'douyin' ...）
 * @returns {{id: string, merged: boolean} | null}
 */
export function rememberTurn(hub, userText, reply, channel = 'home') {
  const distilled = distillTurn(userText, reply);
  if (distilled === null) return null;

  /*
   * 第一人称那一版（voice）。
   *
   * 语料里那 3,882 条旧记忆都有 voice，口气是「…我让他贴报错我帮着读，你说修完就睡。」——
   * 第二人称指主人，第一人称是她自己。新提炼出来的 text 是「主人说「X」」，
   * 把称呼换成「你」就是她能直接认领的那一版。
   *
   * 说清楚这是**换称呼，不是重写**：真重写成有细节的叙述要模型来做，
   * 留给夜里整理。这里只保证刚写下的这一条，她读回去不是别人的笔录。
   */
  const voice = distilled.text.replace(/^主人说「([\s\S]*)」$/u, '你说「$1」');

  return hub.remember({
    text: distilled.text,
    ...(voice !== distilled.text ? { voice } : {}),
    ...(distilled.feeling ? { feeling: distilled.feeling } : {}),
    domain: 'owner',            // 家会话里说的，默认是「和主人」的
    source: channel === 'home' ? 'world' : channel,
    importance: distilled.importance,
    emotion: distilled.emotion,
    participants: ['主人'],
  });
}

/* ──────────────────────────────────────────────────────────────
 * ④ 渲染成注入块
 * ────────────────────────────────────────────────────────────── */

/** 每条最多多少字（印象形态：只给摘要，要细节再取） */
const SUMMARY_CHARS = 70;

/**
 * 这条记忆的行为主体不是她时，给一个她一眼看得懂的标记。
 *
 * 2026-11-04 加。起因是主人一句话：「这次刷抖音她完全没意识，
 * 不该当成是她主动刷的，是抖音插件那个 AI 自己刷的吧？」
 * 说得对。记忆里混进别人的经历、又不标出来，比不记更糟 ——
 * 她会拿一段不是自己的经历当自己的，那时候她说什么都不可信了。
 */
export function attributionMark(item) {
  const actor = typeof item?.actor === 'string' ? item.actor : '';
  if (actor === 'douyin-plugin') return '〔抖音入口那个 AI 干的，不是你〕';
  if (actor === 'douyin-entry') return '〔发生在抖音入口上，不是你〕';
  if (actor !== '' && actor !== 'self') return '〔不是你做的〕';
  /*
   * 正向标记（2026-11-04 补）。
   *
   * 只有反向标记是不够的：她学到的是「抖音这个入口是别人」，
   * 而不是「这一条是我自己的」。她自己亲手刷的必须给一个同等强度的
   * 正面的说法，两种归属才对称。
   */
  if (item?.source === 'douyin') return '〔这是我自己刷的〕';
  return '';
}

export function renderRecallBlock(hits) {
  if (hits.length === 0) return '';

  const lines = hits.map((t) => {
    /*
     * 优先用第一人称版本，没有就用原文。
     *
     * 2026-11-03 00:25 补的：原来直接写 t.voice.trim()。
     * 3,882 条旧痕迹全都有 voice 字段（那次整理补的），所以一直没炸；
     * 但家会话新写进去的记忆**没有** voice（提炼只给 text + feeling），
     * 于是「第一次真正写入之后」的第一个召回就会在这里抛，
     * 被 pre-step 那个 try/catch 吞成「记忆召回失败，本轮跳过」——
     * 表现是召回静默失效，日志里只有一行 warn。
     */
    const voice = typeof t.voice === 'string' ? t.voice.trim() : '';
    const body = (voice !== '' ? voice : String(t.text ?? '')).replace(/\s+/g, ' ').trim();
    if (body === '') return '';
    const clipped = [...body].length > SUMMARY_CHARS ? `${[...body].slice(0, SUMMARY_CHARS).join('')}…` : body;
    return `- ${attributionMark(t)}${clipped}（${t.id}）`;
  }).filter((line) => line !== '');
  if (lines.length === 0) return '';

  return [
    '',
    '【想起这些】',
    '跟刚才的话有关，从我的记忆里浮上来的。不用逐条念出来，',
    '接得上就自然带着，接不上就放着。要原文可以按 id 去翻。',
    ...lines,
  ].join('\n');
}
