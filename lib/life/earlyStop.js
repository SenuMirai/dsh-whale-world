/** A home turn that stops more than this before her own alarm stopped early. */
export const EARLY_STOP_MS = 5 * 60_000;
/**
 * Decides when a home turn that ends counts as her stopping early: a completed turn, well before her own
 * alarm, not yet asked about for that alarm. A turn in which her partner spoke is a conversation pausing,
 * and a turn the plugin started itself (the question, a new home's greeting) is never asked about, so nothing loops.
 */
export function createEarlyStopWatch() {
    let partnerSpoke = false;
    let ownTurn = false;
    return {
        partnerSpoke() { partnerSpoke = true; },
        /** Ends the turn's marks; true when this ending should be asked about. */
        turnEnded(completed, alarm, now) {
            const quiet = completed && !partnerSpoke && !ownTurn;
            partnerSpoke = false;
            ownTurn = false;
            return quiet && alarm?.source === 'plan' && !alarm.nudged && Date.parse(alarm.at) - now.getTime() > EARLY_STOP_MS;
        },
        /** The plugin is starting a turn of its own; that turn is not asked about. */
        startsOwnTurn() { ownTurn = true; },
        /** Its message never arrived, so no turn of its own will follow. */
        ownTurnFailed() { ownTurn = false; },
    };
}
