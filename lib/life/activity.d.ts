import type { ActivityRecord } from './types.ts';
/** Shell commands cannot be reliably scoped, so they always count as outside the room. The path check is lexical: symlinks/junctions, `~` and `%VAR%` are not resolved. */
export declare function summarizeCall(tool: string, argumentsJson: string, roomDir: string): {
    summary: string;
    outside: boolean;
};
/**
 * What she actually did between `since` and `now`, in one line she can hold against the note she wrote.
 *
 * She asked for this (2026-10-26): an alarm that only repeats her own promise lets her believe she kept
 * it. Counting her calls and naming the last thing she touched turns "歇着" into a claim that can fail.
 * Empty string means "nothing to say" — the caller drops the sentence rather than print an empty one.
 */
export declare function summarizeSince(records: readonly ActivityRecord[], sinceIso: string, now: Date): string;
