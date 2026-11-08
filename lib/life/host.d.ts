import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Session } from '@deepseek-ai/dsh-session';
/** A workspace of the host: a directory that groups its sessions in the sidebar and opens new ones there. */
export interface HostWorkspace {
    id: string;
    sessionIds: readonly string[];
    attachSession(sessionId: string): Promise<void>;
}
export interface LifeHost {
    /** In `workspaceId` when given (its directory is the cwd), otherwise in `cwd`. */
    createSession(cwd: string, agentPreset: string, workspaceId?: string): Promise<string>;
    /** The workspace owning `path`, registered under `title` if none does; undefined when the host keeps no workspaces. */
    workspace(path: string, title: string): Promise<HostWorkspace | undefined>;
    /** The live or resumed Agent, or `undefined` when the session no longer exists; other failures throw. */
    resolveAgent(sessionId: string): Promise<Agent | undefined>;
    isArchived(sessionId: string): boolean;
    setFullAccess(session: Session): void;
    rename(sessionId: string, title: string): Promise<void>;
    origin(): string;
}
export declare function hostLife(ctx: Context): LifeHost;
