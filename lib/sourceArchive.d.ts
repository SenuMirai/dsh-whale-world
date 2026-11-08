import type { Context } from '@deepseek-ai/cordis';
import { type Session } from '@deepseek-ai/dsh-session';
import type { ArchiveStore } from './store.ts';
import type { WorldConfig } from './types.ts';
/**
 * A session log the host itself cannot read (a compaction cut off mid-write, a half-flushed turn). It is not
 * our bug and it never fixes itself, so retrying adds nothing — one broken conversation must not cost her the
 * whole world: flushed and thrown, it fails the plugin's load and every session loses its memory block.
 */
export declare function isCorruptSessionLog(error: unknown): boolean;
export declare function belongsToWorld(session: Pick<Session, 'header'>, config: WorldConfig): boolean;
/**
 * Copies her conversations from the host's session logs into the archive. Each session is replayed from where
 * the archive left off; replays run one at a time, and a session already queued is not queued twice. Sessions
 * outside `archived` are left alone.
 */
export declare function createSourceArchive(ctx: Context, config: WorldConfig, store: ArchiveStore, archived?: (sessionId: string) => boolean): {
    schedule: (sessionId: string) => Promise<void>;
    /**
     * Every session the archive has seen, replayed again so nothing written while the plugin was not loaded is
     * missed; with `skip`, what was said while her world was stopped is passed over instead.
     */
    catchUp(skip?: boolean): Promise<void>;
    /** Moves past everything a session holds now without keeping it (said while her world was stopped). */
    skip: (sessionId: string) => Promise<void>;
    /** Waits for every queued replay; rejects while any session still has an unresolved failure. */
    flush(): Promise<void>;
};
