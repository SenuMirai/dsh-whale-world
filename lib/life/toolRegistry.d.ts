import type { Agent } from '@deepseek-ai/dsh-agent';
import { type Faults } from '../faults.ts';
import type { lifeTools } from './tools.ts';
/**
 * The alarm tools are held by every world session (she can set her alarm anywhere; it rings at home);
 * reach_out only by the current home. A registration that fails (a name clash) is a fault and never breaks
 * agent creation; it registers all of a group or none.
 */
export declare function createToolRegistry(deps: {
    faults: Faults;
    logger: {
        error(...args: unknown[]): void;
    };
    tools: () => ReturnType<typeof lifeTools>;
    isHome(agent: Agent): boolean;
}): {
    attach(agent: Agent): void;
    forget(agent: Agent): void;
    /** A rebuilt home takes reach_out from the old one. */
    releaseOldHomes(): void;
    clear(): void;
};
