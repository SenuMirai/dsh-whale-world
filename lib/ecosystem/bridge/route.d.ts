import type { IncomingMessage, ServerResponse } from 'node:http';
import { type Bridge } from './bridge.ts';
export declare const BRIDGE_PATH = "/dsh-world/bridge/say";
/** The one outside route that changes something: a local app hands her partner's words to her home. */
export declare function bridgeRoute(bridge: () => Bridge | undefined, allowedHosts?: readonly string[]): {
    kind: "exact";
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
};
