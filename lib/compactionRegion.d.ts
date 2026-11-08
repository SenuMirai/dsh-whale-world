import { type CompactionResult } from '@deepseek-ai/dsh-compaction';
import type { CommandId } from '@deepseek-ai/dsh-commands/brand';
import { type ContentBlock, type Message, type TokenUsage } from '@deepseek-ai/dsh-llm';
import { SessionSeq, type Session } from '@deepseek-ai/dsh-session';
import type { TokenMeasurement } from '@deepseek-ai/dsh-token-meter';
export interface SummaryResult {
    summary: ContentBlock[];
    rawOutput: ContentBlock[];
    provider: string;
    model: string;
    maxTokens: number;
    usage?: TokenUsage;
}
export interface RegionAgent {
    session: Session;
    options: {
        provider?: string;
        model?: string;
    };
}
export interface RegionDependencies {
    meter: {
        measure(session: Session): TokenMeasurement;
        estimateMessage(message: Message): number;
    };
    summarize(messages: Message[], agent: RegionAgent, signal?: AbortSignal): Promise<SummaryResult>;
    frame(summary: ContentBlock[]): ContentBlock[];
    recover(error: unknown, agent: RegionAgent, seqs: readonly SessionSeq[], signal?: AbortSignal): boolean;
}
export interface RegionOptions {
    owner: 'current-turn' | null;
    stability: 'whole-surface' | 'selected-span';
    sourceCommandId?: CommandId;
    flush?: () => Promise<void>;
}
/** Everything after the system head through the newest cut that splits no tool call from its result. */
export declare function selectWholeRange(session: Session, measurement: TokenMeasurement): {
    start: SessionSeq;
    end: SessionSeq;
} | null;
export declare function compactSurfaceRegion(deps: RegionDependencies, agent: RegionAgent, start: SessionSeq, end: SessionSeq, options: RegionOptions, signal?: AbortSignal): Promise<CompactionResult>;
export declare function assertNoActiveCompaction(session: Session, stage: string): void;
