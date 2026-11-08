/** Ephemeral host view of the adapter's durable, account-bound counters. */
export declare function createWechatPresence(): {
    clear(): void;
    accept(value: unknown): void;
    summary(now: Date): string | undefined;
};
