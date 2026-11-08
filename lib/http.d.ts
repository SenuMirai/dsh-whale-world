import type { IncomingMessage, ServerResponse } from 'node:http';
export interface JsonResult {
    status: number;
    body: unknown;
    headers?: Record<string, string>;
}
/** The request body as text, or undefined past `limit` bytes (still drained, so the client sees the answer). */
export declare function readBody(req: IncomingMessage, limit: number): Promise<string | undefined>;
/** The parsed JSON object of a body, or undefined when it is not one. */
export declare function jsonObject(raw: string | undefined): Record<string, unknown> | undefined;
/** JSON, never cached, no CORS headers. */
export declare function sendJson(res: ServerResponse, result: JsonResult): void;
/**
 * Whether DSH is reached by a name its owner knows: this machine, or one listed in `allowedHosts` (a LAN
 * address or domain behind a reverse proxy). A page of another site that has its name resolve to this machine
 * (DNS rebinding) is same-origin to the browser but still sends its own name here, so it is refused.
 */
export declare function knownHost(host: string | undefined, allowed?: readonly string[]): boolean;
