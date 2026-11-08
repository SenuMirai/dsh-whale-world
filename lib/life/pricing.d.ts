import type { TokenUsage } from '@deepseek-ai/dsh-llm';
export declare function isPeak(at: Date): boolean;
/** What one model step cost in CNY. DeepSeek reports cache hits apart from the other input; reasoning is part of the output. */
export declare function stepCost(usage: TokenUsage, model: string, at: Date): number;
