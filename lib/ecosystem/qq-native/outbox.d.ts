/**
 * Messages that failed to go out wait here and are tried again every few seconds for a while, so a reply that
 * lands while the socket is reconnecting (a plugin reload stops it for a moment) is not simply lost.
 */
export declare function createOutbox<T>(options: {
    send(item: T): Promise<void>;
    /** Called once for an item given up on. */
    dropped(item: T): void;
    intervalMs?: number;
    ttlMs?: number;
    maxTries?: number;
}): {
    /** Sends now; a failure is queued for later instead of thrown. True when it went out. */
    send(item: T): Promise<boolean>;
    readonly size: number;
    start(): void;
    stop(): void;
};
