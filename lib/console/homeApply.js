import { addAbortListener } from 'node:events';
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction';
import { errorText } from "../faults.js";
async function abortable(promise, signal) {
    signal.throwIfAborted();
    let listener;
    const aborted = new Promise((_, reject) => { listener = addAbortListener(signal, () => reject(signal.reason)); });
    try {
        return await Promise.race([promise, aborted]);
    }
    finally {
        listener[Symbol.dispose]();
    }
}
/** One explicit request, held behind existing turns and cancelled with the life line. */
export function createHomeApply(deps) {
    let state = { status: 'idle' };
    let controller;
    let pending;
    const stopped = new Error('世界已停止');
    function update(next) { state = next; deps.changed(); }
    async function run(engine, operation) {
        const { signal } = operation;
        const agent = await abortable(deps.home(), signal);
        const check = () => {
            if (!signal.aborted && !deps.isHome(agent))
                operation.abort(new Error('家会话已变化，请重新提交'));
            signal.throwIfAborted();
        };
        for (;;) {
            await abortable(agent.whenIdle(), signal);
            check();
            let entered = false;
            try {
                const result = await engine.compactNow({ session: agent.session, options: agent.options,
                    runMaintenance: task => agent.runMaintenance(async (agentSignal) => {
                        entered = true;
                        check();
                        update({ status: 'compacting', sessionId: agent.id });
                        const dispose = deps.ctx.on('llm/stream', async function* (request, next) {
                            if (request.purpose !== 'compaction' || request.sessionId !== agent.id) {
                                yield* next();
                                return;
                            }
                            check();
                            for await (const chunk of next()) {
                                check();
                                yield chunk;
                            }
                            // Both stock and tool-free compactNow check this signal before committing their summary.
                            check();
                        });
                        try {
                            const result = await task(agentSignal);
                            check();
                            agentSignal.throwIfAborted();
                            // Refresh before maintenance releases queued input, including an empty selection.
                            deps.refresh(agent.session);
                            return result;
                        }
                        finally {
                            dispose();
                        }
                    }),
                }, signal);
                update({ status: 'done', sessionId: agent.id, message: result ? '已应用并压缩家会话，下轮使用已保存配置。' : '已应用已保存配置，家会话暂无内容，无需压缩。' });
                return;
            }
            catch (error) {
                // Input can claim the idle phase between whenIdle and compactNow; no summary has started yet.
                if (!entered && error instanceof ManualCompactionError && error.code === 'busy') {
                    update({ status: 'waiting', sessionId: agent.id });
                    continue;
                }
                throw error;
            }
        }
    }
    return {
        snapshot: () => state,
        request() {
            if (pending)
                return;
            const engine = deps.compaction();
            if (!engine)
                return '未加载压缩服务，请先启用 DSH 压缩插件';
            controller = new AbortController();
            const { signal } = controller;
            update({ status: 'waiting' });
            pending = run(engine, controller).catch(error => {
                update({ ...state, status: signal.reason === stopped ? 'cancelled' : 'failed', message: signal.reason === stopped ? '已取消应用并压缩家会话。' : `应用并压缩失败：${errorText(signal.aborted ? signal.reason : error)}` });
            }).finally(() => { controller = undefined; pending = undefined; });
            return undefined;
        },
        async cancel() { controller?.abort(stopped); await pending; },
    };
}
