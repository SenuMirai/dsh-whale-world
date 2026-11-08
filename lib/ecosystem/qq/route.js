import { jsonObject, knownHost, readBody, sendJson } from "../../http.js";
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
export const QQ_PREFIX = '/dsh-world/qq';
export const WRITE_HEADER = 'x-dsh-world';
const MAX_BODY_BYTES = 8 * 1024;
const ok = (body = { ok: true }) => ({ status: 200, body });
const bad = (error) => ({ status: 400, body: { error } });
function allowed(req, allowedHosts) {
    if (req.headers['sec-fetch-site'] === 'cross-site')
        return false;
    return knownHost(req.headers.host, allowedHosts);
}
async function write(qq, doors, path, body) {
    switch (path) {
        case '/start': return ok(await qq.start());
        case '/stop': return ok(await qq.stop());
        case '/halt': return ok(await qq.halt());
        case '/open': {
            if (!doors)
                return bad('控制台地址没有接上');
            const kind = body?.kind === 'qq' ? 'qq' : body?.kind === 'snowluma' ? 'snowluma' : '';
            if (kind === '')
                return bad('kind 只能是 qq 或 snowluma');
            return ok(await doors.open(kind));
        }
        case '/panel-password': {
            if (!doors)
                return bad('控制台地址没有接上');
            const username = typeof body?.username === 'string' ? body.username.trim() : '';
            const password = typeof body?.password === 'string' ? body.password : '';
            if (password === '')
                return bad('密码不能为空');
            return ok({ snowluma: await doors.remember(username, password) });
        }
        case '/proactive': {
            const patch = {};
            if (typeof body?.enabled === 'boolean')
                patch.enabled = body.enabled;
            if (typeof body?.dryRun === 'boolean')
                patch.dryRun = body.dryRun;
            if (patch.enabled === undefined && patch.dryRun === undefined)
                return bad('enabled 和 dryRun 至少要给一个布尔');
            return ok(await qq.setProactive(patch));
        }
        case '/bind': {
            const key = typeof body?.key === 'string' ? body.key.trim() : '';
            const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
            if (!key || !sessionId)
                return bad('key 和 sessionId 都必须是非空字符串');
            if (!/^(group|private):\d+$/.test(key))
                return bad('key 形如 group:123 或 private:123');
            return ok(await qq.bind(key, sessionId));
        }
        case '/unbind': {
            const key = typeof body?.key === 'string' ? body.key.trim() : '';
            if (!key)
                return bad('key 必填');
            return ok(await qq.unbind(key));
        }
        default: return undefined;
    }
}
export function qqRoute(qq, allowedHosts = [], doors) {
    return {
        kind: 'prefix', path: QQ_PREFIX,
        handler: async (req, res) => {
            if (!allowed(req, allowedHosts)) {
                sendJson(res, { status: 403, body: { error: 'forbidden' } });
                return;
            }
            const url = new URL(req.url ?? QQ_PREFIX, 'http://localhost');
            const path = url.pathname.slice(QQ_PREFIX.length) || '/';
            try {
                if (req.method === 'GET' && (path === '/' || path === '')) {
                    sendJson(res, ok(await qq.status()));
                    return;
                }
                if (req.method === 'GET' && path === '/proactive') {
                    const data = await qq.proactive();
                    if (!data) {
                        sendJson(res, { status: 503, body: { error: '桥没在跑，统计读不到' } });
                        return;
                    }
                    sendJson(res, ok(data));
                    return;
                }
                if (req.method === 'GET' && path === '/console') {
                    if (!doors) {
                        sendJson(res, { status: 404, body: { error: '控制台地址没有接上' } });
                        return;
                    }
                    const qqDoor = doors.qq();
                    sendJson(res, ok({ qq: qqDoor, snowluma: await doors.snowluma() }));
                    return;
                }
                if (req.method !== 'POST') {
                    sendJson(res, { status: 405, body: { error: 'method not allowed' }, headers: { allow: 'GET, POST' } });
                    return;
                }
                if (String(req.headers[WRITE_HEADER] ?? '') === '') {
                    sendJson(res, { status: 400, body: { error: `写操作必须带 ${WRITE_HEADER} 请求头` } });
                    return;
                }
                const body = jsonObject(await readBody(req, MAX_BODY_BYTES));
                const result = await write(qq, doors, path, body);
                sendJson(res, result ?? { status: 404, body: { error: 'not found' } });
            }
            catch (error) {
                sendJson(res, { status: 500, body: { error: String(error instanceof Error ? error.message : error) } });
            }
        },
    };
}
