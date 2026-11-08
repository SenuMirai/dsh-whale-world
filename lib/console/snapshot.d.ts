import type { Context } from '@deepseek-ai/cordis';
import type { LifeStore } from '../life/lifeStore.ts';
import type { LifeRuntime } from '../life/runtime.ts';
import type { ArchiveStore } from '../store.ts';
import type { WorldConfig } from '../types.ts';
import type { WorldNames } from '../worldPrompt.ts';
import type { MemoryArchiveScope } from '../archiveSelection.ts';
import type { ConsoleSources } from './routes.ts';
export declare function estimateTokens(text: string): number;
export interface SnapshotDeps {
    ctx: Context;
    config: WorldConfig;
    archive: ArchiveStore;
    names(): WorldNames;
    /** Absent when the life line could not be set up. */
    lifeStore?: LifeStore;
    /** The running life line; undefined while her world is stopped. */
    life(): LifeRuntime | undefined;
    diaryDir: string;
    running(): boolean;
    /** CNY a day for her home; undefined is no limit. */
    dailyBudget(): number | undefined;
    /** Turns her memory block carries. */
    memoryTurns(): number;
    selectedArchiveScope?(): MemoryArchiveScope;
    /** The WeChat module's state; undefined while it is off or her world is stopped. */
    wechat?(): unknown;
    includesSession?(id: string): boolean;
    /** Faults outside the life line: the memory line, the bridge, the QQ bridge, starting and stopping. */
    faults(): string[];
    /** Which modules the config allows, whether their console switch is on, and whether they are running now. */
    modules?(): unknown;
    /** The QQ bridge, when the module is on; absent leaves that card out of the console. */
    qq?: () => Promise<unknown>;
}
/** Read-only views for the console; repeated polling within a few seconds reuses one snapshot until `invalidate`. */
export declare function consoleSources(deps: SnapshotDeps): ConsoleSources & {
    invalidate(): void;
};
