import { errorText } from "../faults.js";
import { summarizeCall } from "./activity.js";
/**
 * What the console shows of her life: every tool call in her home, logged once its result is known, and every
 * compaction in her world sessions.
 */
export function createJournal(deps) {
    const { store, faults } = deps;
    const calls = new Map();
    const shadowed = new Map();
    function logCall(callId, call, status) {
        const { summary, outside } = summarizeCall(call.name, call.arguments, deps.roomDir);
        if (store.appendActivity({ time: call.time, sessionId: call.sessionId, callId, tool: call.name, summary, outside, ...(status ? { status } : {}) }))
            faults.clear('activity');
        else {
            faults.set('activity', '活动记录写入失败，下一条会标记缺口');
            deps.logger.error('dsh-world: activity log write failed');
        }
    }
    return {
        /** Any world session: compactions. */
        world(session, event) {
            if (event.type === 'compaction/summary')
                shadowed.set(event.data.compactionId, event.data.shadowedTokenCount);
            if (event.type !== 'compaction/end')
                return;
            const tokens = shadowed.get(event.data.compactionId);
            shadowed.delete(event.data.compactionId);
            const { error } = event.data;
            try {
                store.appendCompaction({ time: new Date(event.time).toISOString(), sessionId: session.id, ok: error === undefined, ...(tokens === undefined ? {} : { shadowedTokens: tokens }), ...(error === undefined ? {} : { error }) });
                faults.clear('compaction');
            }
            catch (cause) {
                faults.set('compaction', `压缩记录写入失败：${errorText(cause)}`);
                deps.logger.error(cause);
            }
        },
        /** Her home: tool calls, logged at their result; one that never got a result (cancelled, crashed) is logged when the turn ends. */
        home(session, event) {
            if (event.type === 'tool/call')
                calls.set(event.data.callId, { sessionId: session.id, name: event.data.name, arguments: event.data.arguments, time: new Date(event.time).toISOString() });
            if (event.type === 'tool/result') {
                const callId = event.data.message.toolCallId;
                const call = calls.get(callId);
                if (call) {
                    calls.delete(callId);
                    logCall(callId, call, event.data.message.isError ? 'error' : 'ok');
                }
            }
            if (event.type === 'turn/end')
                for (const [callId, call] of calls)
                    if (call.sessionId === session.id) {
                        calls.delete(callId);
                        logCall(callId, call);
                    }
        },
    };
}
