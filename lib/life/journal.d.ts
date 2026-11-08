import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import { type Faults } from '../faults.ts';
import type { LifeStore } from './lifeStore.ts';
/**
 * What the console shows of her life: every tool call in her home, logged once its result is known, and every
 * compaction in her world sessions.
 */
export declare function createJournal(deps: {
    store: LifeStore;
    faults: Faults;
    roomDir: string;
    logger: {
        error(...args: unknown[]): void;
    };
}): {
    /** Any world session: compactions. */
    world(session: Session, event: SessionEvent): void;
    /** Her home: tool calls, logged at their result; one that never got a result (cancelled, crashed) is logged when the turn ends. */
    home(session: Session, event: SessionEvent): void;
};
