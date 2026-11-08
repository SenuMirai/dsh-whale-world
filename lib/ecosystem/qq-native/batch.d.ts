/**
 * Messages of one conversation that arrive close together are asked as one: people send two or three lines in a
 * row, and asking her each half sentence on its own costs a turn apiece. The quiet window restarts with every
 * message but never stretches past `maxMs` from the first, so a busy group still gets its answer.
 */
export declare function createBatcher<T>(options: {
    quietMs(): number;
    maxMs?: number;
    flush(key: string, items: T[]): void;
}): {
    add(key: string, item: T): void;
    /** Conversations with words still gathering. */
    readonly size: number;
    clear(): void;
};
