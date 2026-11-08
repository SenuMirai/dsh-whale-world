import type { IncomingMessage, ServerResponse } from 'node:http';
import type { QqBridge } from './bridge.ts';
import type { ConsoleDoors } from './panel.ts';
/**
 * The QQ module's few doors, on the same webServer as the console. The `/dsh-world/qq` prefix is never eaten
 * by the console's `/dsh-world` prefix (the host matches the longer one first).
 *
 * Read:  GET  /dsh-world/qq           is the bridge up, is it talking to DSH, which entries are bound
 *        GET  /dsh-world/qq/proactive  the proactive-chat numbers (calls, tokens, sent, suppressed)
 *        GET  /dsh-world/qq/console   the two consoles' addresses, tokens in hand: qq-bridge (its token is a
 *                                     file) and SnowLuma (a fresh session token traded for the panel password)
 * Write: POST /dsh-world/qq/start     bring it up if it is down
 *        POST /dsh-world/qq/stop      ask it to exit gracefully (flushes state first)
 *        POST /dsh-world/qq/halt      stop it and mean it: the bridge records intent=stopped and no handoff
 *                                     process is spawned, so the supervisor will not bring it back
 *        POST /dsh-world/qq/bind      { key, sessionId } points a QQ entry at a session
 *        POST /dsh-world/qq/unbind    { key }
 *        POST /dsh-world/qq/panel-password  { username, password } remembers SnowLuma's panel password and
 *                                     trades it for a session token right away
 *        POST /dsh-world/qq/proactive  { enabled?, dryRun? } flips the two switches; the bridge writes them into
 *                                     its own config.json and applies them on the spot, so nothing restarts
 *
 * Writes require the `x-dsh-world` header: a cross-site page cannot add it (that would trigger a preflight,
 * and no preflight is answered here).
 */
export declare const QQ_PREFIX = "/dsh-world/qq";
export declare const WRITE_HEADER = "x-dsh-world";
export declare function qqRoute(qq: QqBridge, allowedHosts?: readonly string[], doors?: ConsoleDoors): {
    kind: "prefix";
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
};
