import { type MemoryArchiveScope } from './archiveSelection.ts';
/** How many of the newest turns the memory block carries when nothing else is set. */
export declare const DEFAULT_MEMORY_TURNS = 200;
/** WeChat group messages read before a mention, and seconds a private image waits for its companions. */
export declare const DEFAULT_WECHAT_CONTEXT = 8, MAX_WECHAT_CONTEXT = 20;
export declare const DEFAULT_WECHAT_BUFFER_SECONDS = 3, MAX_WECHAT_BUFFER_SECONDS = 30;
/**
 * Her world's own settings, changed from the world console and kept in `<world>/world.json` so they outlast a
 * restart: whether it runs (memory block, prompts, archive and life line together), how much her home may
 * spend a day, and how many recent turns her memory block carries. A world that already has a life line from before the switch existed is running; a new one waits
 * for its partner to press start.
 */
export declare function createWorldSwitch(worldDir: string, configuredScope?: MemoryArchiveScope): {
    archiveScope: () => MemoryArchiveScope;
    selectedArchiveScope: () => MemoryArchiveScope;
    restartRequired: () => boolean;
    setArchiveScope(scope: MemoryArchiveScope): void;
    running: () => boolean;
    set: (running: boolean) => void;
    /** CNY a day for her home; undefined is no limit. */
    dailyBudget: () => number | undefined;
    setDailyBudget(yuan: number | undefined): void;
    /** Turns in her memory block; read when a block is built, so a change shows from the next session start or compaction. */
    memoryTurns: () => number;
    setMemoryTurns(turns: number | undefined): void;
    /** The console's switches for the WeChat and QQ modules; on unless turned off, and only an off switch is written out. */
    wechatEnabled: () => boolean;
    qqEnabled: () => boolean;
    setModules(next: {
        wechat?: boolean;
        qq?: boolean;
    }): void;
    /** Read by the WeChat adapter on its next poll; a batch already waiting keeps the value it started with. */
    wechatContext: () => number;
    wechatBufferSeconds: () => number;
    setWechat(next: {
        context?: number | null;
        bufferSeconds?: number | null;
    }): void;
};
export type WorldSwitch = ReturnType<typeof createWorldSwitch>;
export declare const validTurns: (value: unknown) => value is number;
export declare const validWechatContext: (value: unknown) => value is number;
export declare const validWechatBuffer: (value: unknown) => value is number;
