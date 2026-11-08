import type { Alarm } from './types.ts';
/** A home turn that stops more than this before her own alarm stopped early. */
export declare const EARLY_STOP_MS: number;
/**
 * Decides when a home turn that ends counts as her stopping early: a completed turn, well before her own
 * alarm, not yet asked about for that alarm. A turn in which her partner spoke is a conversation pausing,
 * and a turn the plugin started itself (the question, a new home's greeting) is never asked about, so nothing loops.
 */
export declare function createEarlyStopWatch(): {
    partnerSpoke(): void;
    /** Ends the turn's marks; true when this ending should be asked about. */
    turnEnded(completed: boolean, alarm: Alarm | undefined, now: Date): alarm is Alarm & {
        source: "plan";
    };
    /** The plugin is starting a turn of its own; that turn is not asked about. */
    startsOwnTurn(): void;
    /** Its message never arrived, so no turn of its own will follow. */
    ownTurnFailed(): void;
};
