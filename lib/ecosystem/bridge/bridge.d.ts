import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type LifeTimers } from '../../life/alarmTimer.ts';
import { type Outlet } from '../shared/outlets.ts';
export interface BridgeImage {
    data: Uint8Array;
    mediaType: string;
    name?: string;
}
export declare const REPLY_TIMEOUT_MS: number;
/** The words could not be handed to her home; the route answers 503. */
export declare class HomeUnavailable extends Error {
}
export interface BridgeDeps {
    ctx: Context;
    /** The current home, resolving or rebuilding it (the life line's own). */
    home(): Promise<Agent>;
    /** Where her replies and the busy notice go; each takes the kinds it lists. */
    outlets: readonly Outlet[];
    origin(): string;
    /** `<world>/bridge.json`, where a local app finds the bridge. */
    file: string;
    timers?: LifeTimers;
    clock?: () => Date;
    /** Her name, in the busy notice and the console's faults; TA when unnamed. */
    name?: string;
}
/**
 * A local app's way into her home: its words arrive as her partner's own (source `user`), and the first
 * visible text she says after they are admitted goes to the outlets. Only the latest words are tracked.
 */
export declare function createBridge(deps: BridgeDeps): {
    start: () => void;
    stop: () => void;
    say: (text: string, images?: BridgeImage[]) => Promise<{
        id: string;
    }>;
    checkToken: (value: string | undefined) => boolean;
    faults: () => string[];
};
export type Bridge = ReturnType<typeof createBridge>;
