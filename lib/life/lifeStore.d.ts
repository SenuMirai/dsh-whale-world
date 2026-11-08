import type { ActivityRecord, CompactionRecord, LifeState, WakeRecord } from './types.ts';
/** Exported for tests only (injectable rename). On Windows a reader, indexer or antivirus can briefly lock the target, so a rename that fails with EPERM/EBUSY/EACCES is retried with a short backoff. */
export declare function durableWrite(file: string, text: string, rename?: (from: string, to: string) => void): void;
export declare function createLifeStore(worldDir: string, timeZone: string): {
    read: () => LifeState;
    write: (state: LifeState) => void;
    appendWake: (record: WakeRecord) => void;
    appendCompaction: (record: CompactionRecord) => void;
    /** Never throws: a failed write is reported to the caller and marks the next record. The gap flag is in-memory and marks the next successful write, which may land in a later day's file. */
    appendActivity(record: ActivityRecord): boolean;
    wakes: () => WakeRecord[];
    compactions: () => CompactionRecord[];
    activity: (day: string) => ActivityRecord[];
    activityDays: () => string[];
};
export type LifeStore = ReturnType<typeof createLifeStore>;
