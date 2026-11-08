import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { CompactionEngine, type CompactionAgentContext, type CompactionResult, type CompactionTrigger, type ManualCompactAgentContext } from '@deepseek-ai/dsh-compaction';
import type { CommandId } from '@deepseek-ai/dsh-commands/brand';
import { type Message } from '@deepseek-ai/dsh-llm';
import { type SessionSeq } from '@deepseek-ai/dsh-session';
import { type RegionAgent, type SummaryResult } from './compactionRegion.ts';
import './hostContract.ts';
interface SummaryAudit {
    policyVersion: 2;
    provider: string;
    model: string;
    maxTokens: number;
    instruction: string;
    timeContext: string;
    replayedMessageIds: string[];
}
declare module '@deepseek-ai/dsh-session/types' {
    interface PluginRecordMap {
        'plugin:dsh-world/compaction-request': SummaryAudit;
    }
}
interface Policy {
    thresholdRatio: number;
    headroomTokens: number;
    summarizationProvider: string;
    summarizationModel: string;
    maxTokens: number;
    maxOverflowRetries: number;
}
export interface ToolFreeCompactionConfig extends Partial<Policy> {
    timeZone?: string;
    auto?: boolean;
    modelPolicies?: (Partial<Policy> & {
        provider: string;
        model: string;
    })[];
}
/**
 * The compacted span exactly as the conversation request sent it, minus every
 * tool call and tool result, so the summary request shares the longest possible
 * provider-cached prefix. Assistant text split around a removed call is rejoined.
 */
export declare function toolFreeMessages(messages: readonly Message[]): Message[];
/**
 * Replacement for `@deepseek-ai/dsh-compaction-basic`: drops every tool call,
 * tool result, tool schema and reasoning block from the compacted span, then
 * replaces the whole conversation with one summary paragraph.
 */
export default class ToolFreeCompaction extends CompactionEngine {
    static inject: string[];
    static Config: z<Schemastery.ObjectS<NoInfer<{
        timeZone: z<string, string, "plain">;
        auto: z<boolean, boolean, "plain">;
        thresholdRatio: z<number, number, "plain">;
        headroomTokens: z<number, number, "plain">;
        summarizationProvider: z<string, string, "plain">;
        summarizationModel: z<string, string, "plain">;
        maxTokens: z<number, number, "plain">;
        maxOverflowRetries: z<number, number, "plain">;
        modelPolicies: z<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            thresholdRatio?: number | null | undefined;
            headroomTokens?: number | null | undefined;
            summarizationProvider?: string | null | undefined;
            summarizationModel?: string | null | undefined;
            maxTokens?: number | null | undefined;
            maxOverflowRetries?: number | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: z<string, string, "defined">;
            model: z<string, string, "defined">;
            thresholdRatio: z<number, number, "plain">;
            headroomTokens: z<number, number, "plain">;
            summarizationProvider: z<string, string, "plain">;
            summarizationModel: z<string, string, "plain">;
            maxTokens: z<number, number, "plain">;
            maxOverflowRetries: z<number, number, "plain">;
        }>>[], "plain">;
    }>>, Schemastery.ObjectT<NoInfer<{
        timeZone: z<string, string, "plain">;
        auto: z<boolean, boolean, "plain">;
        thresholdRatio: z<number, number, "plain">;
        headroomTokens: z<number, number, "plain">;
        summarizationProvider: z<string, string, "plain">;
        summarizationModel: z<string, string, "plain">;
        maxTokens: z<number, number, "plain">;
        maxOverflowRetries: z<number, number, "plain">;
        modelPolicies: z<({
            provider?: string | null | undefined;
            model?: string | null | undefined;
            thresholdRatio?: number | null | undefined;
            headroomTokens?: number | null | undefined;
            summarizationProvider?: string | null | undefined;
            summarizationModel?: string | null | undefined;
            maxTokens?: number | null | undefined;
            maxOverflowRetries?: number | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            provider: z<string, string, "defined">;
            model: z<string, string, "defined">;
            thresholdRatio: z<number, number, "plain">;
            headroomTokens: z<number, number, "plain">;
            summarizationProvider: z<string, string, "plain">;
            summarizationModel: z<string, string, "plain">;
            maxTokens: z<number, number, "plain">;
            maxOverflowRetries: z<number, number, "plain">;
        }>>[], "plain">;
    }>>, "plain">;
    private readonly policy;
    private readonly overrides;
    private readonly timeZone;
    private readonly warnedTargets;
    private readonly overflowRetries;
    private readonly overflowAgents;
    constructor(ctx: Context, config?: ToolFreeCompactionConfig);
    private policyFor;
    private registerAutomaticCompaction;
    compactIfNeeded(agent: CompactionAgentContext, trigger: CompactionTrigger, signal: AbortSignal): Promise<CompactionResult | null>;
    compactRegion(start: SessionSeq, end: SessionSeq, agent: CompactionAgentContext, signal?: AbortSignal): Promise<CompactionResult>;
    compactNow(agent: ManualCompactAgentContext, signal: AbortSignal, sourceCommandId?: CommandId): Promise<CompactionResult | null>;
    private dependencies;
    protected summarize(messages: Message[], agent: RegionAgent, signal?: AbortSignal): Promise<SummaryResult>;
}
export {};
