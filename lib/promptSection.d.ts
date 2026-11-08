import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Session } from '@deepseek-ai/dsh-session';
import { type Faults } from './faults.ts';
import type { WorldConfig } from './types.ts';
import { type WorldPrompt } from './worldPrompt.ts';
export interface WorldPromptSource {
    prompt: WorldPrompt;
    isHome(sessionId: string): boolean;
    archiveSession?(sessionId: string): boolean;
}
/**
 * Her persona and the world prompt, sections of every world session's system prompt so she sees them on every
 * request. They are read when the session opens and again after each successful compaction (the host assembles
 * the system prompt before pre-step, so the refresh happens on compaction/end), never in between, so the prompt
 * stays in the provider-cached prefix. Whether the session is her home is asked per request.
 *
 * Her persona takes the place of the host's: registered under the host persona's name for her agent, it shadows
 * the deployment default. Where her preset already gave her agent a persona, that name is taken, so hers follows
 * it under its own name and the console says so.
 */
export declare function createPromptSections(config: WorldConfig, world: WorldPromptSource, deps: {
    faults: Faults;
    logger: {
        warn(...args: unknown[]): void;
    };
}): {
    add(agent: Agent): void;
    refresh(session: Session): void;
    clear(): void;
};
