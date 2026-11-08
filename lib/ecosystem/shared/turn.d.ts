import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type UserMessage } from '@deepseek-ai/dsh-llm';
import { type LifeTimers } from '../../life/alarmTimer.ts';
import { type InWorld } from '../../worldScope.ts';
import '../../hostContract.ts';
/**
 * A channel's requests, one at a time: each gets a `cancelled` promise that rejects when it runs out of time or the
 * channel stops, and the queue refuses more than `limit` waiting at once.
 */
export declare function createChannelQueue(name: string, options: {
    limit: number;
    timeoutMs: number;
    timers?: LifeTimers | undefined;
}): {
    run: <T>(work: (cancelled: Promise<never>) => Promise<T>) => Promise<T>;
    readonly stopped: boolean;
    /** Throws once the channel has stopped, for work that resumes after a wait. */
    alive(): void;
    stop(): void;
};
/**
 * Hands `words` to the agent (after the optional `context`) and waits for exactly the turn that takes them in,
 * returning what she said in it. Anything the harness injects around that turn (runtime snapshot, skill catalog,
 * recall, her own alarm, history, channel context) is not someone speaking; only a real user message cuts the answer
 * short. An interrupted, truncated or unfinished turn is a failure, so the caller never sends half an answer.
 * The session's log is flushed before the answer is returned.
 */
export declare function askTurn(ctx: Context, agent: Agent, words: UserMessage, options: {
    name: string;
    inWorld?: InWorld | undefined;
    context?: UserMessage | undefined;
    cancelled?: Promise<never> | undefined;
}): Promise<string>;
