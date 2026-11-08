import type { Context } from '@deepseek-ai/cordis';
import './hostContract.ts';
import { type WorldPromptSource } from './promptSection.ts';
import type { ArchiveStore } from './store.ts';
import type { WorldConfig } from './types.ts';
export type { WorldPromptSource } from './promptSection.ts';
/**
 * The memory line: her conversations are archived as they happen, and every world session gets a memory
 * block of the newest turns at its start and after each successful compaction, never in between, so it stays
 * inside the provider-cached prefix. `home` archives the current home; `workspace` uses host membership. The memory block still
 * goes to every world session. With a world prompt source, the world prompt joins every world session.
 * `memoryTurns` is read each time a block is built (default 200).
 */
export declare function createWorldRuntime(ctx: Context, config: WorldConfig, store: ArchiveStore, world?: WorldPromptSource, memoryTurns?: () => number): {
    start: (options?: {
        fresh?: boolean;
    }) => Promise<void>;
    retryCatchUp: () => Promise<void>;
    flush: () => Promise<void>;
    stop: () => Promise<void>;
    faults: () => string[];
};
