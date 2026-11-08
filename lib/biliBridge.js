/**
 * biliBridge —— B站 那边的活动 → 世界记忆（2026-11-08 加）
 *
 * 为什么要这一层：
 *   B站 那个插件（现在叫「刷B站」）只出手：打开、翻片、读稿、发评论。
 *   它自己不再写日记、不再写信、不再存记忆 —— 那些事世界已经在做了。
 *   但「今晚刷到了什么」不能丢：它是她晚上写日记的素材。
 *   所以这里把它的活动账本读出来，写成世界记忆；她写日记时自然会想起
 *   今天刷到过什么，怎么写由她自己决定。
 *
 * 和 douyinBridge 的最大区别：**这里没有第二个 AI。**
 *   账本里每一条都是她自己在家里按出来的，所以不需要判归属、不需要 actor。
 *   只有 is_test=1 的行要跳过：那是主人点「测试」时造的假记录。
 *
 * 只读它的库，绝不写 —— 那本是它的账。
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SYNC_STATE_FILE = 'bili-sync.json';

/** 会计入记忆的活动类型。test 不算，写失败的记录也不算。 */
const KINDS = ['read', 'comment', 'danmaku', 'dynamic', 'like', 'coin', 'favorite', 'history'];

/** 标题、正文都可能很长；记忆一条只留 120 字，召回块才塞得下。 */
const CHARS = 120;

function clip(text, limit = CHARS) {
    const chars = [...String(text ?? '').replace(/\s+/gu, ' ').trim()];
    return chars.length > limit ? chars.slice(0, limit).join('') + '…' : chars.join('');
}

/** 账本里的 detail 长这样：作者 一支小馋猫 · 时长 125s · 覆盖 0%。作者拿来做括号。 */
export function authorOf(detail) {
    const match = /作者\s*([^·]+)/u.exec(String(detail ?? ''));
    return match ? clip(match[1], 30).trim() : '';
}

/** 一条活动 → 记忆正文。第一人称，因为账本里只有她自己。 */
export function toMemory(row) {
    const title = clip(row.title) || '一条没留下标题的视频';
    const author = authorOf(row.detail);
    const who = author ? '《' + title + '》（' + author + '）' : '《' + title + '》';
    switch (row.kind) {
        case 'read':
            return '我在 B 站看了' + who;
        case 'comment':
            return '我在 B 站的' + who + '下面留了一条评论：' + clip(row.detail);
        case 'danmaku':
            return '我在 B 站的' + who + '发了条弹幕：' + clip(row.detail);
        case 'dynamic':
            return '我在 B 站发了一条动态：' + clip(row.title || row.detail);
        case 'like':
            return '我给 B 站上的' + who + '点了赞';
        case 'coin':
            return '我给 B 站上的' + who + '投了币';
        case 'favorite':
            return '我把 B 站上的' + who + '收进了收藏夹';
        case 'history':
            return '我把 B 站上的' + who + '看到了' + clip(row.detail, 40);
        default:
            return '我在 B 站做了点什么：' + clip(row.title || row.detail);
    }
}

function readSyncState(worldDir) {
    try {
        const parsed = JSON.parse(readFileSync(join(worldDir, SYNC_STATE_FILE), 'utf8'));
        return Number.isFinite(parsed?.lastRowId) ? Number(parsed.lastRowId) : 0;
    }
    catch {
        return 0;
    }
}

function writeSyncState(worldDir, lastRowId) {
    try {
        writeFileSync(
            join(worldDir, SYNC_STATE_FILE),
            JSON.stringify({ lastRowId, at: new Date().toISOString() }, null, 2) + '\n',
            'utf8',
        );
    }
    catch { /* 记不下来只会多同步一次，记忆本身会去重 */ }
}

export function createBiliBridge(memoryHub, worldDir, deps = {}) {
    const dbPath = deps.dbPath ?? '';
    const logger = deps.logger ?? (() => {});
    const onSynced = typeof deps.onSynced === 'function' ? deps.onSynced : null;
    let lastRun = 0;

    async function syncOnce() {
        if (!dbPath || !existsSync(dbPath)) return { ok: false, skipped: true, reason: '账本不存在' };
        const now = Date.now();
        if (now - lastRun < 60_000) return { ok: false, skipped: true, reason: '间隔未到' };
        lastRun = now;

        let db;
        try {
            db = new DatabaseSync(dbPath, { readOnly: true });
            const lastRowId = readSyncState(worldDir);
            const kinds = KINDS.map(() => '?').join(',');
            const rows = db
                .prepare(
                    'SELECT rowid AS rid, id, at, kind, target, title, detail, status, link FROM activity ' +
                    'WHERE rowid > ? AND is_test = 0 AND kind IN (' + kinds + ') ' +
                    'ORDER BY rowid ASC LIMIT 30',
                )
                .all(lastRowId, ...KINDS);
            if (rows.length === 0) return { ok: true, written: 0 };

            let written = 0;
            let maxRowId = lastRowId;
            const synced = [];
            for (const row of rows) {
                maxRowId = Math.max(maxRowId, Number(row.rid) || maxRowId);
                const at = Date.parse(String(row.at ?? ''));
                const text = toMemory(row);
                try {
                    memoryHub.remember({
                        text,
                        voice: text,
                        domain: 'owner',
                        source: 'bilibili',
                        /** 刷一下不改变什么，但确实是她过的日子：中等偏下，写日记时能想起来就够。 */
                        importance: 0.3,
                        emotion: 0.25,
                        participants: [],
                        occurredTime: Number.isFinite(at) ? at : undefined,
                    });
                    written += 1;
                    synced.push({ rowId: Number(row.rid), at: Number.isFinite(at) ? at : Date.now(), kind: row.kind, title: String(row.title ?? ''), link: String(row.link ?? '') });
                }
                catch (e) {
                    logger('biliBridge: 写入失败 ' + (e?.message ?? e));
                }
            }

            writeSyncState(worldDir, maxRowId);
            if (synced.length && onSynced) {
                try {
                    onSynced(synced);
                }
                catch (e) {
                    logger('biliBridge: onSynced 回调失败 ' + (e?.message ?? e));
                }
            }
            return { ok: true, written };
        }
        catch (e) {
            return { ok: false, reason: e?.message ?? String(e) };
        }
        finally {
            try {
                db?.close();
            }
            catch { /* ignore */ }
        }
    }

    return { syncOnce };
}
