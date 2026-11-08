export interface LifeTimers {
    set(fn: () => void, ms: number): unknown;
    clear(handle: unknown): void;
}
export declare const realTimers: LifeTimers;
/**
 * Waits for the pending alarm and calls `fire` once it is due, never before. A failed delivery backs off
 * (1, 5, 15, 30, 60 minutes); a new alarm or a delivery that worked starts the backoff over.
 */
export declare function createAlarmTimer(deps: {
    clock: () => Date;
    timers: LifeTimers;
    dueAlarm: () => string | undefined;
    fire: () => void;
}): {
    arm: () => void;
    /** Starts the backoff over (a new alarm, or one that was delivered) and re-arms. */
    reset(): void;
    /** A delivery failed: the next try waits out the backoff. Returns the wait in minutes. */
    failed(): number;
    stop(): void;
};
