import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type CompactionEngine } from '@deepseek-ai/dsh-compaction';
import type { Session } from '@deepseek-ai/dsh-session';
export interface HomeApplyState {
    status: 'idle' | 'waiting' | 'compacting' | 'done' | 'failed' | 'cancelled';
    sessionId?: string;
    message?: string;
}
interface HomeApplyDeps {
    ctx: Context;
    home(): Promise<Agent>;
    isHome(agent: Agent): boolean;
    compaction(): Pick<CompactionEngine, 'compactNow'> | undefined;
    refresh(session: Session): void;
    changed(): void;
}
/** One explicit request, held behind existing turns and cancelled with the life line. */
export declare function createHomeApply(deps: HomeApplyDeps): {
    snapshot: () => HomeApplyState;
    request(): string | undefined;
    cancel(): Promise<void>;
};
export {};
