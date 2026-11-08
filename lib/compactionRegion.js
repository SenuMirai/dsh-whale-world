// Surface transaction adapted from @deepseek-ai/dsh-compaction-basic@0.2.1-rc.2 (MIT, Copyright (c) 2026 DeepSeek).
// Kept local so the stock package is used unmodified; selection here always runs to the newest balanced cut.
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CompactionId, ManualCompactionError, compactCheckpointSource, toolPairingBalancedAfter, toolPairingBalancedBefore } from '@deepseek-ai/dsh-compaction';
import { createUserMessage, errorChain } from '@deepseek-ai/dsh-llm';
import { SessionSeq } from '@deepseek-ai/dsh-session';
function eventAt(session, seq) {
    const event = session.eventAt(seq);
    if (event === undefined)
        throw new Error(`compaction: session seq ${seq} has no event`);
    return event;
}
class SurfaceChangedError extends Error {
}
/** Everything after the system head through the newest cut that splits no tool call from its result. */
export function selectWholeRange(session, measurement) {
    const nodes = session.surface.nodes;
    if (!nodes.length)
        return null;
    if (nodes.length !== measurement.nodes.length || nodes.some((seq, index) => seq !== measurement.nodes[index]?.seq))
        throw new Error('compaction: token-meter surface does not match the current session surface');
    const firstIdx = eventAt(session, nodes[0]).type === 'system/message' ? 1 : 0;
    let endIdx = nodes.length - 1;
    while (endIdx >= firstIdx && !toolPairingBalancedAfter(session, nodes[endIdx]))
        endIdx -= 1;
    return endIdx < firstIdx ? null : { start: nodes[firstIdx], end: nodes[endIdx] };
}
export async function compactSurfaceRegion(deps, agent, start, end, options, signal) {
    const { session } = agent;
    if (options.owner === null)
        signal?.throwIfAborted();
    const selection = validateSurfaceRegion(session, start, end);
    const entry = inspectEntryState(session);
    assertInactive(entry, 'compaction');
    if (options.owner === null && entry.openTurn !== null)
        throw new ManualCompactionError('busy', 'manual compaction: the session already has an open turn');
    if (options.owner !== null && entry.openTurn === null)
        throw new Error('compactRegion: no open turn — automatic compaction events must be enclosed in a turn');
    const lifecycle = { compactionId: CompactionId(randomUUID()), ...(options.sourceCommandId === undefined ? {} : { sourceCommandId: options.sourceCommandId }), turn: options.owner === null ? null : entry.openTurn };
    const startEvent = session.append('compaction/start', lifecycle);
    const assertStable = options.stability === 'whole-surface' ? assertWholeSurfaceUnchanged : assertSelectedSpanStable;
    let failure;
    let flushFailure;
    let result;
    let closed = false;
    let closing = false;
    let stage = 'summary';
    try {
        const summarized = await summarize(deps, prepare(deps, session, selection), agent, lifecycle.compactionId, options.sourceCommandId, assertStable, signal);
        if (options.owner === null)
            signal?.throwIfAborted();
        assertStable(deps, session, summarized);
        stage = 'commit';
        const pending = commitBody(session, startEvent.seq, lifecycle, summarized);
        closing = true;
        const endEvent = session.append('compaction/end', lifecycle);
        closed = true;
        result = { ...pending, endSeq: endEvent.seq };
    }
    catch (error) {
        failure = { error, stage: closing ? 'commit' : stage };
        if (!closing) {
            closing = true;
            try {
                session.append('compaction/end', { ...lifecycle, error: errorChain(error) });
                closed = true;
            }
            catch (closeError) {
                failure = { error: closeError, stage: 'commit' };
            }
        }
    }
    if (closed && options.flush)
        try {
            await options.flush();
        }
        catch (error) {
            flushFailure = error;
        }
    if (options.owner === null)
        signal?.throwIfAborted();
    if (failure) {
        if (options.owner !== null)
            throw failure.error;
        if (failure.stage === 'commit')
            throw new ManualCompactionError('commit', 'manual compaction did not commit cleanly', { cause: failure.error });
        if (failure.error instanceof SurfaceChangedError)
            throw new ManualCompactionError('changed', 'the compacted history changed during manual compaction', { cause: failure.error });
        throw new ManualCompactionError('summary', 'manual compaction could not produce a smaller summary', { cause: failure.error });
    }
    if (flushFailure !== undefined)
        throw new ManualCompactionError('persistence', 'manual compaction durability checkpoint failed', { cause: flushFailure });
    return result;
}
export function assertNoActiveCompaction(session, stage) { assertInactive(inspectEntryState(session), stage); }
function assertInactive(entry, stage) {
    if (entry.unmatchedStart === undefined || (entry.latestEndSeedSeq !== undefined && entry.latestEndSeedSeq > entry.unmatchedStart))
        return;
    throw new ManualCompactionError('busy', `${stage}: compaction already in progress; the session compaction lock is already active`);
}
function validateSurfaceRegion(session, start, end) {
    const nodes = session.surface.nodes;
    const startIdx = nodes.indexOf(start);
    const endIdx = nodes.indexOf(end);
    if (startIdx === -1)
        throw new Error(`compactRegion: start seq ${start} not found in surface`);
    if (endIdx === -1)
        throw new Error(`compactRegion: end seq ${end} not found in surface`);
    if (startIdx > endIdx)
        throw new Error(`compactRegion: start seq ${start} is after end seq ${end} on the surface`);
    if (!toolPairingBalancedBefore(session, nodes[startIdx]))
        throw new Error(`compactRegion: start seq ${start} would split a tool-call/result pair`);
    if (!toolPairingBalancedAfter(session, nodes[endIdx]))
        throw new Error(`compactRegion: end seq ${end} would split a tool-call/result pair, or the step is still open`);
    return { start, end, startIdx, endIdx, shadowedSeqs: nodes.slice(startIdx, endIdx + 1) };
}
function prepare(deps, session, selection) {
    const measurement = deps.meter.measure(session);
    const selectedNodes = measurement.nodes.slice(selection.startIdx, selection.endIdx + 1);
    if (selectedNodes.length !== selection.shadowedSeqs.length || selectedNodes.some((node, index) => node.seq !== selection.shadowedSeqs[index]))
        throw new SurfaceChangedError('compaction: selected surface changed before summarization began');
    return {
        ...selection, measurement, selectedNodes,
        shadowedTokenCount: selectedNodes.reduce((total, node) => total + node.heuristicTokens, 0),
        shadowedRouteTokenCount: selectedNodes.reduce((total, node) => total + node.tokens, 0),
        messages: selection.shadowedSeqs.map(seq => session.deriveEventMessage(eventAt(session, seq))).filter((message) => message !== null),
    };
}
async function summarize(deps, prepared, agent, compactionId, sourceCommandId, assertStable, signal) {
    let summary;
    for (;;) {
        signal?.throwIfAborted();
        try {
            summary = await deps.summarize(prepared.messages, agent, signal);
            break;
        }
        catch (error) {
            if (signal?.aborted)
                throw error;
            assertStable(deps, agent.session, prepared);
            if (!deps.recover(error, agent, prepared.shadowedSeqs, signal))
                throw error;
            prepared = prepare(deps, agent.session, validateSurfaceRegion(agent.session, prepared.start, prepared.end));
        }
    }
    const checkpointMessage = createUserMessage({ content: deps.frame(summary.summary), source: compactCheckpointSource(compactionId, sourceCommandId) });
    const framed = deps.meter.estimateMessage(checkpointMessage);
    if (framed >= prepared.shadowedRouteTokenCount)
        throw new Error(`summary is not smaller than the shadowed content (${framed} estimated framed tokens >= ${prepared.shadowedRouteTokenCount})`);
    return { ...prepared, ...summary, checkpointMessage };
}
function assertWholeSurfaceUnchanged(deps, session, prepared) {
    if (!isDeepStrictEqual(deps.meter.measure(session).nodes, prepared.measurement.nodes))
        throw new SurfaceChangedError('compaction: session surface changed during summarization');
}
function assertSelectedSpanStable(deps, session, prepared) {
    let current;
    try {
        current = validateSurfaceRegion(session, prepared.start, prepared.end);
    }
    catch (error) {
        throw new SurfaceChangedError('compaction: the selected span is no longer a valid replacement target', { cause: error });
    }
    if (!isDeepStrictEqual([...current.shadowedSeqs], [...prepared.shadowedSeqs]))
        throw new SurfaceChangedError('compaction: the selected span changed during summarization');
    if (!isDeepStrictEqual(deps.meter.measure(session).nodes.slice(current.startIdx, current.endIdx + 1), prepared.selectedNodes))
        throw new SurfaceChangedError('compaction: the selected span was rewritten during summarization');
}
function commitBody(session, startSeq, lifecycle, summarized) {
    const { start, end, shadowedSeqs, shadowedTokenCount, summary, rawOutput, provider, model, maxTokens, usage, checkpointMessage } = summarized;
    const { compactionId, sourceCommandId } = lifecycle;
    const command = sourceCommandId === undefined ? {} : { sourceCommandId };
    const summaryEvent = session.append('compaction/summary', {
        compactionId, ...command, summary, rawOutput, shadowedRange: { start, end }, shadowedSeqs: [...shadowedSeqs], shadowedTokenCount, provider, model, maxTokens, ...(usage === undefined ? {} : { usage }),
    });
    session.append('user/message', checkpointMessage, { surfaceOp: { op: 'replace', startSeq: start, endSeq: end }, sourceEventSeqs: [startSeq, summaryEvent.seq, ...shadowedSeqs] });
    return { compactionId, ...command, startSeq, summarySeq: summaryEvent.seq, summary, shadowedRange: { start, end }, shadowedSeqs: [...shadowedSeqs], shadowedTokenCount };
}
function inspectEntryState(session) {
    let openTurn = null;
    let turnKnown = false;
    let unmatchedStart;
    let lockKnown = false;
    let latestEndSeedSeq;
    for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
        const event = eventAt(session, SessionSeq(seq));
        if (latestEndSeedSeq === undefined && event.type === 'session/end-seed')
            latestEndSeedSeq = event.seq;
        if (!lockKnown) {
            if (event.type === 'compaction/start') {
                unmatchedStart = event.seq;
                lockKnown = true;
            }
            else if (event.type === 'compaction/end')
                lockKnown = true;
        }
        if (!turnKnown) {
            if (event.type === 'turn/start') {
                openTurn = event.data.turn;
                turnKnown = true;
            }
            else if (event.type === 'turn/end')
                turnKnown = true;
        }
        if (turnKnown && lockKnown && latestEndSeedSeq !== undefined)
            break;
    }
    return { openTurn, unmatchedStart, latestEndSeedSeq };
}
