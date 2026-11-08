import { SessionId } from '@deepseek-ai/dsh-session';
import { extractConversationRecords } from "./archive.js";
import { wechatDeliveryPatch } from "./ecosystem/wechat/archive.js";
const pageSize = 128;
/**
 * A session log the host itself cannot read (a compaction cut off mid-write, a half-flushed turn). It is not
 * our bug and it never fixes itself, so retrying adds nothing — one broken conversation must not cost her the
 * whole world: flushed and thrown, it fails the plugin's load and every session loses its memory block.
 */
export function isCorruptSessionLog(error) {
    const text = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '');
    return /stored log is corrupt|SessionFormatError|does not match an open turn/i.test(text);
}
export function belongsToWorld(session, config) {
    const header = session.header;
    return header.agentPreset === config.agentPreset && header.origin !== 'subagent' && (header.delegationDepth ?? 0) === 0;
}
/**
 * 这个会话是不是就在她的房间里。
 *
 * belongsToWorld 只看 header.agentPreset，可同一台机器上通常不止她一个会话用那个预设
 * （无限制模式既是她的家，也是主人改代码时随手开的那几个）。只靠预设判断，
 * 编码窗口也会被当成「她的会话」：吃她的世界提示词、被写进她的记忆、拿到她的生活线工具。
 * 所以凡是要「对她」做的事，都再问一句 cwd 在不在房间里。
 */
export function inRoom(session, roomDir) {
    const cwd = session?.header?.cwd;
    if (typeof cwd !== 'string' || cwd === '' || typeof roomDir !== 'string' || roomDir === '')
        return false;
    const tidy = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const here = tidy(cwd);
    const root = tidy(roomDir);
    return here === root || here.startsWith(`${root}/`);
}
const isNotFound = (error) => error instanceof Error && error.name === 'SessionPersistenceNotFoundError';
const ordinary = (header) => header.origin !== 'subagent' && (header.delegationDepth ?? 0) === 0;
/**
 * Copies her conversations from the host's session logs into the archive. Each session is replayed from where
 * the archive left off; replays run one at a time, and a session already queued is not queued twice. Sessions
 * outside `archived` are left alone.
 */
export function createSourceArchive(ctx, config, store, archived = () => true) {
    const dirty = new Set();
    const jobs = new Map();
    const failures = new Map();
    let tail = Promise.resolve();
    /** Copies what the archive has not seen yet; `skip` moves past it without keeping it. */
    async function replay(sessionId, skip = false) {
        const id = SessionId(sessionId);
        const live = ctx.sessions.get(id);
        if (live)
            await ctx.sessions.flush(live);
        // A deleted session keeps what it already archived; there is nothing left to replay.
        const handle = await ctx.sessionPersistence.open(id, 'read').catch(error => {
            if (isNotFound(error)) {
                ctx.logger.warn(`dsh-world: session ${sessionId} is no longer stored; skipping replay`);
                store.forgetProgress(sessionId);
                return undefined;
            }
            throw error;
        });
        if (!handle)
            return;
        try {
            let { nextSeq, turn } = store.progress(id);
            while (true) {
                const { events } = await handle.read(nextSeq, pageSize);
                if (!events.length)
                    break;
                const records = events.flatMap(event => {
                    if (event.type === 'turn/start')
                        turn = event.data.turn;
                    return skip ? [] : extractConversationRecords(event, { ...config, header: handle.header, inheritedEventCount: handle.inheritedEventCount, turn }).map(record => {
                        const delivery = record.wechatDelivery ? store.delivery(record.recordId) : undefined;
                        return delivery ? { ...record, ...wechatDeliveryPatch(record, delivery) } : record;
                    });
                });
                nextSeq = events.at(-1).seq + 1;
                await store.commitRecords(records, { sessionId: id, nextSeq, turn });
            }
        }
        finally {
            await handle.close();
        }
    }
    /** Runs after every queued replay. */
    function enqueue(work) {
        const job = tail.then(work);
        tail = job.catch(error => { ctx.logger.error(error); });
        return job;
    }
    function schedule(sessionId) {
        // Not archived itself, it still waits for the replays already queued, so its memory block is current.
        if (!archived(sessionId))
            return tail;
        dirty.add(sessionId);
        const pending = jobs.get(sessionId);
        if (pending)
            return pending;
        const job = tail.then(async () => {
            while (dirty.delete(sessionId))
                await replay(sessionId);
            failures.delete(sessionId);
        });
        jobs.set(sessionId, job);
        tail = job.catch(error => {
            // Skips and a warning instead of a stored failure — see `isCorruptSessionLog`.
            if (isCorruptSessionLog(error)) {
                dirty.delete(sessionId);
                ctx.logger.warn(`dsh-world: 会话 ${sessionId} 的日志读不动，先跳过（这段对话不归档）`);
                return;
            }
            failures.set(sessionId, error);
            ctx.logger.error(error);
        }).finally(() => { jobs.delete(sessionId); });
        return job;
    }
    return {
        schedule,
        /**
         * Every session the archive has seen, replayed again so nothing written while the plugin was not loaded is
         * missed; with `skip`, what was said while her world was stopped is passed over instead.
         */
        async catchUp(skip = false) {
            // One session's failure is kept for flush(); it must not stop the sessions after it.
            const replayOne = (id) => (skip ? enqueue(() => replay(id, true)) : schedule(id)).catch(() => { });
            // The host exposes a metadata inventory; every selected message log is still read in pages.
            const snapshots = await ctx.sessionPersistence.list();
            const visited = new Set();
            for (let offset = 0; offset < snapshots.length; offset += pageSize) {
                for (const { header } of snapshots.slice(offset, offset + pageSize)) {
                    if (!ordinary(header) || (!config.archiveScope && header.agentPreset !== config.agentPreset) || !archived(header.id))
                        continue;
                    visited.add(header.id);
                    await replayOne(header.id);
                }
            }
            let after = '';
            for (let ids = store.sourcePage(after); ids.length; ids = store.sourcePage(after)) {
                for (const id of ids) {
                    after = id;
                    if (visited.has(id))
                        continue;
                    // A session deleted from the host (not merely archived there) keeps its records but has nothing left to resume.
                    if (!await ctx.sessionPersistence.stat(SessionId(id))) {
                        store.forgetProgress(id);
                        continue;
                    }
                    if (!archived(id))
                        continue;
                    await replayOne(id);
                }
            }
        },
        /** Moves past everything a session holds now without keeping it (said while her world was stopped). */
        skip: (sessionId) => enqueue(() => replay(sessionId, true)),
        /** Waits for every queued replay; rejects while any session still has an unresolved failure. */
        async flush() {
            let current;
            do {
                current = tail;
                await current;
            } while (current !== tail);
            if (failures.size)
                throw new AggregateError([...failures.values()], 'dsh-world: source archive has unresolved failures');
        },
    };
}
