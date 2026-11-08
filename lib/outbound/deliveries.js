/**
 * 投递台账（阶段 0 · deliveries.jsonl）
 *
 * 一句话：**能对账的才算发出去。**
 *
 * 为什么要有它：
 *   现在 `reach` 是「发了就算」，`reply` 是「没等到就丢弃并记一行日志」。
 *   于是她可能以为自己说过了，而实际上那句从没离开过这台机器——
 *   这正是我们这两天反复在修的归属问题的另一面。
 *
 * 规矩：
 *   · 每次投递一条记录，字段见下；写不进去**不影响投递本身**（旁路）
 *   · `ok === true` 且 `messageIds.length > 0` 才算「真的发出去了」
 *   · 降级过的必须留下 `degraded`，方便回答「这条为什么没念出来」
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DAY = 86_400_000;

/** 一条投递记录的默认形状。 */
export function makeDeliveryRecord(input = {}) {
  const messageIds = Array.isArray(input.messageIds) ? input.messageIds.filter((x) => typeof x === 'string' && x !== '') : [];
  return {
    at: Number.isFinite(input.at) ? input.at : Date.now(),
    ticket: typeof input.ticket === 'string' ? input.ticket : '',
    kind: typeof input.kind === 'string' ? input.kind : 'reply',
    platform: typeof input.platform === 'string' ? input.platform : 'unknown',
    conversationId: typeof input.conversationId === 'string' ? input.conversationId : '',
    /** 打算发几段 */
    segments: Number.isInteger(input.segments) ? input.segments : 0,
    /** 实际发出去几段 */
    sentSegments: Number.isInteger(input.sentSegments) ? input.sentSegments : 0,
    /** 这条意图里带了哪些媒体：voice / sticker / image / file */
    media: Array.isArray(input.media) ? input.media.filter((x) => typeof x === 'string') : [],
    /** 降级记录：[{ what, why }] */
    degraded: Array.isArray(input.degraded)
      ? input.degraded.filter((d) => d && typeof d === 'object').map((d) => ({ what: String(d.what ?? ''), why: String(d.why ?? '') }))
      : [],
    /** 真的发出去了吗：ok 且至少一个平台消息 id */
    ok: input.ok === true && messageIds.length > 0,
    messageIds,
    error: input.error === undefined || input.error === null ? null : String(input.error),
  };
}

/** 「真的发出去了」的唯一判据。 */
export function isDelivered(record) {
  return record?.ok === true && Array.isArray(record.messageIds) && record.messageIds.length > 0;
}

/**
 * @param file 台账路径（通常是 `<world>/deliveries.jsonl`）
 */
export function createDeliveryLog(file) {
  function append(record) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, JSON.stringify(makeDeliveryRecord(record)) + '\n', 'utf8');
      return true;
    } catch {
      // 台账是旁路：写不进去也不能影响这条消息本身
      return false;
    }
  }

  function readAll() {
    try {
      if (!existsSync(file)) return [];
      return readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  return {
    file,
    append,
    readAll,
    /** 某一天的记录（按本地日期 YYYY-MM-DD） */
    readDay(day) {
      return readAll().filter((r) => new Date(r.at).toLocaleDateString('sv-SE') === day);
    },
    /** 按平台 / 成败统计，用来回答「这几天到底发出去多少」 */
    stats() {
      const all = readAll();
      const byPlatform = {};
      for (const r of all) {
        const key = r.platform || 'unknown';
        const bucket = (byPlatform[key] ??= { total: 0, ok: 0, failed: 0, degraded: 0 });
        bucket.total += 1;
        if (isDelivered(r)) bucket.ok += 1;
        else bucket.failed += 1;
        if (Array.isArray(r.degraded) && r.degraded.length > 0) bucket.degraded += 1;
      }
      return { total: all.length, byPlatform };
    },
    /**
     * 只保留最近 days 天。阶段 0 不自动调用，留给运维手动或定时任务。
     * 用「写临时文件再改名」保证不出现半截台账。
     */
    prune(days = 90) {
      const cutoff = Date.now() - days * DAY;
      const kept = readAll().filter((r) => Number(r.at) >= cutoff);
      const temp = join(dirname(file), `.deliveries.${process.pid}.tmp`);
      writeFileSync(temp, kept.map((r) => JSON.stringify(r)).join('\n') + (kept.length > 0 ? '\n' : ''), 'utf8');
      renameSync(temp, file);
      return { kept: kept.length };
    },
  };
}
