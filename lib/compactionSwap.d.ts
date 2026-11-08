export type CompactionSwap = {
    status: 'swapped';
    backup: string;
} | {
    status: 'already';
} | {
    status: 'unchanged';
    reason: string;
};
/**
 * Replaces the profile's stock compaction row with `dsh-world/compaction`, the same edit as
 * `scripts/enable-tool-free-compaction.ps1`: a bundle patch cannot do it, because the stock row is written out in the
 * profile's own `cordis.patch.yml`, which sits above every plugin's patch. It changes the file only when exactly one
 * stock row is there, keeps a backup beside it and swaps atomically; DSH has to be restarted to load the new backend.
 */
export declare function swapStockCompaction(profileDir: string): CompactionSwap;
/**
 * Once per world, when the plugin first runs in a profile: make the profile use the tool-free compaction. The attempt is
 * remembered only when it succeeded or was already done, so a partner who later puts the stock one back is left alone,
 * while a profile this could not read is looked at again next start.
 */
export declare function swapCompactionOnce(deps: {
    enabled: boolean;
    profileDir: string | undefined;
    done(): boolean;
    markDone(): void;
    report(message: string): void;
    swap?: (profileDir: string) => CompactionSwap;
}): void;
