/** What went wrong and is still wrong, shown in the world console's health; each entry clears when its work next succeeds. */
export declare class Faults {
    private readonly entries;
    set(key: string, text: string): void;
    clear(...keys: string[]): void;
    list(): string[];
    /** Runs async work whose failure is the fault `key` until it succeeds again; the failure still rejects. */
    track(key: string, label: string, work: () => Promise<void>): Promise<void>;
}
export declare const errorText: (error: unknown) => string;
