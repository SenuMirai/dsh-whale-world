export interface QqSdkProfile {
    dir: string;
    name: string;
    packageManager?: {
        command: string;
        args?: readonly string[];
        env?: Record<string, string>;
    };
    [key: string]: unknown;
}
export interface HostInstaller {
    withFileLock<T>(file: string, work: () => Promise<T>, options?: {
        signal: AbortSignal;
    }): Promise<T>;
    writeFileAtomic(file: string, bytes: Uint8Array, options: {
        mode: number;
    }): Promise<unknown>;
    runProfilePnpm(profile: QqSdkProfile, args: string[], options: Record<string, unknown>): Promise<{
        exitCode: number;
        output: string;
        timedOut?: boolean;
        incompatible?: unknown[];
    }>;
}
export declare function hostSdkInstaller(): Promise<HostInstaller>;
/** Invoked by an explicit QQ enable action; startup and ordinary turns never install packages. */
export declare function createQqSdkInstaller(deps: {
    available(): boolean;
    profile(): QqSdkProfile | undefined;
    signal: AbortSignal;
    loadHost?: () => Promise<HostInstaller>;
}): {
    needsRestart: () => boolean;
    ensure(): Promise<boolean>;
};
