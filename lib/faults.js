/** What went wrong and is still wrong, shown in the world console's health; each entry clears when its work next succeeds. */
export class Faults {
    entries = new Map();
    set(key, text) { this.entries.set(key, text); }
    clear(...keys) { for (const key of keys)
        this.entries.delete(key); }
    list() { return [...this.entries.values()]; }
    /** Runs async work whose failure is the fault `key` until it succeeds again; the failure still rejects. */
    track(key, label, work) {
        return work().then(() => this.clear(key), error => { this.set(key, `${label}：${errorText(error)}`); throw error; });
    }
}
export const errorText = (error) => error instanceof Error ? error.message : String(error);
