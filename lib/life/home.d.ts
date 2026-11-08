import type { Agent } from '@deepseek-ai/dsh-agent';
import { type Faults } from '../faults.ts';
import type { LifeHost } from './host.ts';
export interface HomeDeps {
    host: LifeHost;
    roomDir: string;
    agentPreset: string;
    title: string;
    /** The title of her room as a workspace. */
    roomTitle: string;
    faults: Faults;
    logger: {
        error(...args: unknown[]): void;
    };
    /** The recorded home, if any. */
    current(): string | undefined;
    /** Records a newly built home before anything else can fail, so a retry reuses it instead of building another. */
    moveIn(sessionId: string): void;
    /** Called with the home every time it is opened. */
    opened(agent: Agent): void;
    stopped(): boolean;
}
/**
 * Her home session: the recorded one while it exists and is not archived, otherwise a new one. Full access is
 * granted on every open (selecting the preset in effect is a no-op), so no "still needs access" state has to
 * survive a restart. Her room is a workspace of the host, so the home is listed under it rather than as
 * ungrouped, and new sessions can be opened in the room; a host without workspaces just gets the cwd. The title is applied when the home is built and again after its first turn, because the
 * host retitles a session from its first prompt.
 */
export declare function createHome(deps: HomeDeps): {
    /** The current home, resolving or rebuilding it; one attempt at a time. */
    open(): Promise<Agent>;
    turnEnded(sessionId: string): void;
};
