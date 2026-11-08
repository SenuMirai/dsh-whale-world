import { createUserMessage, isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import "./hostContract.js";
import { Faults } from "./faults.js";
import { createHistory, excludePresentMessages, renderHistory } from "./history.js";
import { createPromptSections } from "./promptSection.js";
import { belongsToWorld, createSourceArchive, inRoom } from "./sourceArchive.js";
import { worldNames } from "./worldPrompt.js";
import { DEFAULT_MEMORY_TURNS } from "./worldSwitch.js";
const memorySource = 'dsh-world-history';
/**
 * The memory line: her conversations are archived as they happen, and every world session gets a memory
 * block of the newest turns at its start and after each successful compaction, never in between, so it stays
 * inside the provider-cached prefix. `home` archives the current home; `workspace` uses host membership. The memory block still
 * goes to every world session. With a world prompt source, the world prompt joins every world session.
 * `memoryTurns` is read each time a block is built (default 200).
 */
export function createWorldRuntime(ctx, config, store, world, memoryTurns = () => DEFAULT_MEMORY_TURNS) {
    if (config.archiveScope === 'workspace' && !world?.archiveSession)
        throw new Error('Workspace archive requires the host workspace selection');
    const archivedByScope = world?.archiveSession ?? ((sessionId) => config.archiveScope !== 'home' || !!world?.isHome(sessionId));
    /** False while some session's workspace was unknown (the host's workspace service was not up yet); `retryCatchUp` reads those later. */
    let undecided = false;
    /** Archiving never fails on unknown membership: the session waits, and what it said is read in order later. */
    const archived = (sessionId) => { try {
        return archivedByScope(sessionId);
    }
    catch {
        undecided = true;
        return false;
    } };
    const archive = createSourceArchive(ctx, config, store, archived);
    const history = createHistory(store);
    const names = world?.prompt.names ?? worldNames(config);
    const faults = new Faults();
    /**
     * 「这个会话算不算她的」——预设相等，且（配了房间时）cwd 就在她的房间里。
     *
     * 只判预设不够：这台机器上 her home 用的 wish 也是主人的常用预设，
     * 新开一个 wish 会话就会吃她的世界提示词和记忆块。world.room 没配时退回只看预设，
     * 保持旧行为，不留一个悄悄失效的分支。
     */
    const hers = (session) => belongsToWorld(session, config) && (world?.room === undefined || inRoom(session, world.room));
    const prompts = world && createPromptSections(config, world, { faults, logger: ctx.logger });
    const memory = new WeakMap();
    const attaching = new WeakMap();
    const disposers = [];
    let stopping;
    /** Locate earlier memory blocks; every runtime start rebuilds from the active scope and real times. */
    async function readMemoryState(session) {
        const injected = new Map();
        const surface = new Set(session.surface.nodes);
        const handle = await ctx.sessionPersistence.open(session.id, 'read');
        try {
            for (let offset = 0;; offset += 128) {
                const { events } = await handle.read(offset, 128);
                if (!events.length)
                    break;
                for (const event of events) {
                    const block = event.type === 'user/message' && event.data.source.kind === memorySource;
                    if (block && surface.has(event.seq))
                        injected.set(event.data.id, event.seq);
                }
            }
        }
        finally {
            await handle.close();
        }
        return { reload: true, injected };
    }
    async function attach(agent) {
        const { session } = agent;
        if (!hers(session) || memory.has(session))
            return;
        const pending = attaching.get(session);
        if (pending)
            return pending;
        const job = (async () => {
            if (archived(session.id))
                await store.commitRecords([], store.progress(session.id));
            await archive.schedule(session.id);
            memory.set(session, await readMemoryState(session));
        })();
        attaching.set(session, job);
        try {
            await job;
        }
        finally {
            attaching.delete(session);
        }
    }
    /** Retires the blocks still on the surface (they must be found, or the session would carry two) and builds a fresh one without the messages already present. */
    async function freshBlock(session, state) {
        const messages = session.deriveMessages();
        const turns = await history.loadRecentTurns(config.worldId, memoryTurns(), archivedByScope);
        const present = new Set(messages.filter(message => message.role === 'assistant' || message.source.kind === 'user').map(message => message.id));
        const text = renderHistory(excludePresentMessages(turns, present), config.timeZone, names, config.archiveScope === 'home');
        const oldBlocks = messages.filter(message => message.source.kind === memorySource);
        for (const [index, message] of oldBlocks.entries()) {
            const seq = state.injected.get(message.id);
            if (seq === undefined || !session.surface.nodes.includes(seq))
                throw new Error('dsh-world: cannot locate retained injected context in the host surface');
            const replacement = createUserMessage({ content: [{ type: 'text', text: index === 0 ? text : '' }], source: { kind: memorySource, form: 'recall' } });
            session.append('user/message', replacement, { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] });
            state.injected.delete(message.id);
        }
        if (oldBlocks.length)
            return undefined;
        return text ? createUserMessage({ content: [{ type: 'text', text }], source: { kind: memorySource, form: 'recall' } }) : undefined;
    }
    /** Reads what the first catch-up had to leave, once the host can say which sessions belong to her. */
    async function retryCatchUp() {
        if (!undecided)
            return;
        undecided = false;
        await archive.catchUp();
    }
    /** `fresh`: her world was just started from the console, so what was said while it was stopped is not archived. */
    async function start(options = {}) {
        try {
            disposers.push(ctx.on('session/event', (session, event) => {
                if (session.header.origin === 'subagent' || (session.header.delegationDepth ?? 0) > 0 || (!config.archiveScope && !belongsToWorld(session, config)))
                    return;
                const state = memory.get(session);
                const compacted = event.type === 'compaction/end' && event.data.error === undefined;
                if (state && event.type === 'user/message' && event.data.source.kind === memorySource)
                    state.injected.set(event.data.id, event.seq);
                if (state && event.type === 'user/message' && event.data.id === state.pendingId) {
                    state.reload = false;
                    state.pendingId = undefined;
                }
                if (state && compacted)
                    state.reload = true;
                if (compacted)
                    prompts?.refresh(session);
                if (event.type === 'assistant/message' || event.type === 'turn/end' || event.type === 'turn/start' || event.type === 'compaction/end' || (event.type === 'user/message' && event.data.source.kind === 'user'))
                    void archive.schedule(session.id).catch(() => { });
            }));
            disposers.push(ctx.on('agent/created', async ({ agent }) => { prompts?.add(agent); await attach(agent); return undefined; }));
            // Admitted ahead of the step's new input; the host's own admission order (contexts, time-context last) is kept.
            disposers.push(ctx.on('agent/pre-step', async (payload, next) => {
                const decision = await next();
                const { agent, turn, step, signal } = payload;
                // An empty first step ends the turn; any later step runs anyway, so adding to it is safe.
                if (decision.kind !== 'enter' || (step === 1 && !decision.messages.length) || signal.aborted || !hers(agent.session))
                    return decision;
                await attach(agent);
                await archive.schedule(agent.id);
                signal.throwIfAborted();
                const state = memory.get(agent.session);
                if (!state.reload)
                    return decision;
                const block = await freshBlock(agent.session, state);
                if (!block) {
                    state.reload = false;
                    return decision;
                }
                state.pendingId = block.id;
                return { ...decision, messages: [block, ...decision.messages] };
            }));
            disposers.push(ctx.on('llm/stream', async function* (request, next) {
                const agent = isAgentLoopRequest(request) && request.sessionId ? ctx.agents.get(request.sessionId) : undefined;
                const owned = agent && hers(agent.session);
                for await (const chunk of next()) {
                    if (owned && chunk.type === 'finish' && chunk.reason.kind === 'error' && chunk.reason.failure.code === 'CONTEXT_WINDOW_EXCEEDED')
                        yield {
                            ...chunk, reason: { ...chunk.reason, failure: { ...chunk.reason.failure, message: `dsh-world: 模型总容量不足，完整近期记忆未被裁剪。${chunk.reason.failure.message}` } },
                        };
                    else
                        yield chunk;
                }
            }));
            await archive.catchUp(options.fresh);
            if (options.fresh)
                for (const agent of ctx.agents.list())
                    if (hers(agent.session))
                        await archive.skip(agent.id);
            for (const agent of ctx.agents.list()) {
                prompts?.add(agent);
                await attach(agent);
            }
        }
        catch (error) {
            await stop();
            throw error;
        }
    }
    function stop() {
        return stopping ??= (async () => {
            prompts?.clear();
            for (const dispose of disposers.splice(0).reverse())
                dispose();
            await archive.flush();
        })();
    }
    return { start, retryCatchUp, flush: archive.flush, stop, faults: () => faults.list() };
}
