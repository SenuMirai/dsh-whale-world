import { spawn, type ChildProcess } from 'node:child_process';
/** The adapter script ships next to the sources; this resolves from both `src/` and the built `lib/`. */
export declare const ADAPTER_SCRIPT: string;
/** The adapter exits with this when a person must check WeChat and run `acknowledge`; restarting cannot help. */
export declare const EXIT_NEEDS_HUMAN = 2;
export interface AdapterStatus {
    running: boolean;
    pid: number | null;
    restarts: number;
    lastExit: string | null;
    error: string | null;
    needsHuman: boolean;
}
export interface AdapterSupervisorDeps {
    python: string;
    config: string;
    logFile: string;
    script?: string;
    /** Delay before the first restart and the cap it doubles up to. */
    minDelayMs?: number;
    maxDelayMs?: number;
    spawnProcess?: typeof spawn;
    killTree?(child: ChildProcess): void;
    log(message: string): void;
}
/**
 * Runs the Windows WeChat adapter for as long as the world's WeChat module lives: started with the module,
 * restarted with a growing delay when it exits or cannot start (a file missing during an upgrade comes back),
 * and stopped (its whole process tree) with the module. An exit that says a person must act is not retried.
 * The adapter itself waits for the same WeChat account to log in again, so a WeChat restart needs nothing from here.
 */
export declare function createAdapterSupervisor(deps: AdapterSupervisorDeps): {
    start(): void;
    /** The console's restart: also the way out of "a person must check" once the person has. */
    restart(): Promise<void>;
    stop(): Promise<void>;
    status(): AdapterStatus;
};
export type AdapterSupervisor = ReturnType<typeof createAdapterSupervisor>;
