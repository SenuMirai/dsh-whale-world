/** The request body as text, or undefined past `limit` bytes (still drained, so the client sees the answer). */
export async function readBody(req, limit) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size <= limit)
            chunks.push(buffer);
    }
    return size > limit ? undefined : Buffer.concat(chunks).toString('utf8');
}
/** The parsed JSON object of a body, or undefined when it is not one. */
export function jsonObject(raw) {
    if (raw === undefined)
        return undefined;
    try {
        const value = JSON.parse(raw);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
    }
    catch {
        return undefined;
    }
}
/** JSON, never cached, no CORS headers. */
export function sendJson(res, result) {
    res.writeHead(result.status, { ...result.headers, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(result.body));
}
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];
/**
 * Whether DSH is reached by a name its owner knows: this machine, or one listed in `allowedHosts` (a LAN
 * address or domain behind a reverse proxy). A page of another site that has its name resolve to this machine
 * (DNS rebinding) is same-origin to the browser but still sends its own name here, so it is refused.
 */
export function knownHost(host, allowed = []) {
    const name = host?.replace(/:\d+$/, '').toLowerCase();
    return name !== undefined && [...LOOPBACK, ...allowed.map(entry => entry.toLowerCase())].includes(name);
}
