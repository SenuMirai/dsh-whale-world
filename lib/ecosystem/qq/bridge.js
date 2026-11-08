import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
/**
 * QQ: the outside `qq-bridge` process, managed as one more pipe into her home.
 *
 * Why it belongs here rather than in a .bat: the bridge is a separate process, and before this it took a
 * launcher by hand plus editing `state/sessions.json` by hand to point a QQ entry at a session. Inside the
 * plugin those become a click in the world console, and they share one lifecycle with memory, diary and the
 * life line. Nothing of the bridge's own logic is copied — this only probes, starts, stops, binds and reports.
 */
const PROBE_TIMEOUT_MS = 2500;
const STOP_WAIT_MS = 8000;
const START_WAIT_MS = 15000;
const sleep = (ms) => new Promise(resolve => { setTimeout(resolve, ms); });
const messageOf = (error) => error instanceof Error ? error.message : String(error);
/** The bridge's console token: `config.json` first, else `state/console-token` (rewritten on every start). */
export function readConsoleToken(dir) {
    try {
        const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
        const fromConfig = typeof config?.consoleToken === 'string' ? config.consoleToken.trim() : '';
        if (fromConfig)
            return fromConfig;
    }
    catch {
        // An unreadable config.json is not fatal: there is a second copy below.
    }
    try {
        return readFileSync(join(dir, 'state', 'console-token'), 'utf8').trim();
    }
    catch {
        return '';
    }
}
/** PowerShell and Notepad both like to save JSON with a BOM; `JSON.parse` dies on its first character. */
function readJsonTolerant(file) {
    const raw = readFileSync(file, 'utf8');
    return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
}
const INTENT_FILE = 'bridge.intent.json';
/**
 * 读桥写下的运行意图。读不到一律当 `running`——未知状态不能变成「永久不启动」，
 * 那是比「该停的又起来了」更难受的故障。
 */
export function readIntent(dir) {
    try {
        const raw = readJsonTolerant(join(dir, 'state', INTENT_FILE));
        return {
            desired: raw?.desired === 'stopped' ? 'stopped' : 'running',
            at: Number(raw?.at) || 0,
            by: String(raw?.by ?? ''),
        };
    }
    catch {
        return { desired: 'running', at: 0, by: '' };
    }
}
/**
 * Writes DSH's current origin back into the bridge's `config.json` (`dsh.baseUrl`).
 *
 * Why the plugin owns this: DSH picks a new port on every restart, the bridge's baseUrl is a fixed value, and
 * nothing complains when it goes stale — `dshReady` just stays false and the event stream reconnects every 30s
 * for zero frames. 2026-10-26 the link sat dead for four hours looking exactly like a crashed bridge.
 */
export function syncBridgeBaseUrl(dir, origin, logger) {
    const url = typeof origin === 'string' ? origin.trim().replace(/\/+$/, '') : '';
    if (!/^https?:\/\/[^/]/i.test(url))
        return { changed: false, reason: 'no-origin' };
    const file = join(dir, 'config.json');
    let config;
    try {
        config = readJsonTolerant(file);
    }
    catch (error) {
        return { changed: false, reason: `config.json 读不到：${messageOf(error)}` };
    }
    config.dsh = config.dsh ?? {};
    const before = typeof config.dsh.baseUrl === 'string' ? config.dsh.baseUrl.trim() : '';
    if (before === url)
        return { changed: false, baseUrl: url };
    config.dsh.baseUrl = url;
    // Written without a BOM: the bridge reads it as utf-8-sig, other tools choke on the BOM.
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    logger?.info?.(`[qq] 桥的 DSH 端点已更新：${before || '(空)'} → ${url}`);
    return { changed: true, baseUrl: url, before };
}
/**
 * 谁和谁共用一个会话，写进桥的 `socialV2.bindHomeSession`。
 *
 * 桥自己的默认是「谁都不绑」——装上之后每个群、每条私聊各建一个会话。那通常不是人想要的：主人私聊
 * 应该是她记得的那个家会话，只有群才该各自独立。这个开关让人在插件配置里说一次，不用去翻桥的
 * config.json。
 *
 * 空值表示不碰桥的配置（尊重人自己填的）；`none` 表示把这个键删掉，回到桥的默认。
 */
export function syncBridgeSessionMode(dir, mode, logger) {
    if (!mode)
        return { changed: false, reason: 'no-mode' };
    const file = join(dir, 'config.json');
    let config;
    try {
        config = readJsonTolerant(file);
    }
    catch (error) {
        return { changed: false, reason: `config.json 读不到：${messageOf(error)}` };
    }
    const socialV2 = (config.socialV2 = config.socialV2 ?? {});
    const before = typeof socialV2.bindHomeSession === 'string' ? socialV2.bindHomeSession : '';
    if (mode === 'none') {
        if (!('bindHomeSession' in socialV2))
            return { changed: false, mode, before };
        delete socialV2.bindHomeSession;
        writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
        logger?.info?.(`[qq] 桥的会话绑定已去掉（原来 ${before || '空'}）：每个入口各用各的会话`);
        return { changed: true, mode, before };
    }
    if (before === mode)
        return { changed: false, mode, before };
    socialV2.bindHomeSession = mode;
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    logger?.info?.(`[qq] 桥的会话绑定已设为 ${mode}（原来 ${before || '空'}）：${mode === 'owner' ? '群各自独立，主人私聊用她的家会话' : '所有入口都用她的家会话'}`);
    return { changed: true, mode, before };
}
async function call(base, path, init = {}) {
    const response = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const text = await response.text();
    let body;
    try {
        body = text ? JSON.parse(text) : undefined;
    }
    catch {
        body = { raw: text.slice(0, 400) };
    }
    return { status: response.status, body };
}
export function createQqBridge(options) {
    const { dir, logger, port = 3100, nodePath = process.execPath, origin = () => '' } = options;
    const base = `http://127.0.0.1:${port}`;
    const entry = join(dir, 'src', 'bridge.js');
    const stateDir = join(dir, 'state');
    const faults = new Map();
    let child;
    const note = (key, error) => {
        faults.set(key, `${key}：${messageOf(error)}`);
        logger?.warn?.(`[qq] ${key}: ${messageOf(error)}`);
    };
    const clear = (key) => { faults.delete(key); };
    function ensureDir() {
        if (!existsSync(entry))
            throw new Error(`找不到桥的入口：${entry}`);
    }
    /** Whether the bridge is up: `/api/status` wants the console token too (401 without it), so it serves as the probe. */
    async function ping() {
        try {
            const token = readConsoleToken(dir);
            const { status, body } = await call(base, `/api/status${token ? `?token=${encodeURIComponent(token)}` : ''}`);
            return status === 200 ? body ?? {} : undefined;
        }
        catch {
            return undefined;
        }
    }
    /**
     * 主动聊天的统计。
     *
     * 只读：这个方法的唯一用途是给设置页画一张表，它不该能改开关（那要走 POST）。
     * 桥没起来时返回 undefined —— 面板显示「未运行」，而不是报一个错。
     */
    async function proactive() {
        try {
            const token = readConsoleToken(dir);
            const { status, body } = await call(base, `/api/socialV2/proactive${token ? `?token=${encodeURIComponent(token)}` : ''}`);
            return status === 200 ? body ?? {} : undefined;
        }
        catch {
            return undefined;
        }
    }
    /**
     * 改主动聊天的两个开关。
     *
     * 桥收到后会写进它自己的 config.json 并当场生效（引擎的 configure 是就地改），
     * 所以不用重启桥。桥没起来就抛错，让上面那层回 503，而不是假装改成功。
     */
    async function setProactive(patch) {
        const token = readConsoleToken(dir);
        const { status, body } = await call(base, `/api/socialV2/proactive${token ? `?token=${encodeURIComponent(token)}` : ''}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch),
        });
        if (status !== 200)
            throw new Error(String(body?.error ?? `桥没接受这次改动（HTTP ${status}）`));
        return body;
    }
    async function sessions() {
        try {
            const token = readConsoleToken(dir);
            const { status, body } = await call(base, `/api/sessions${token ? `?token=${encodeURIComponent(token)}` : ''}`);
            return status === 200 && Array.isArray(body?.sessions) ? body.sessions : [];
        }
        catch {
            return [];
        }
    }
    async function status() {
        const alive = await ping();
        const stored = readIntent(dir);
        if (!alive)
            return { running: false, port, dir, faults: [...faults.values()], sessions: [], intent: stored };
        const list = await sessions();
        const snowluma = (alive.snowluma ?? {});
        return {
            running: true,
            port,
            dir,
            mode: typeof alive.mode === 'string' ? alive.mode : null,
            dsh: alive.dshReady === true,
            connected: snowluma.connected === true,
            accountOnline: snowluma.accountOnline === true,
            lastPacketAgoMs: snowluma.lastPacketAgoMs ?? null,
            ownerQQ: alive.ownerQQ ?? null,
            allowGroups: Array.isArray(alive.allowGroups) ? alive.allowGroups : [],
            sessions: list.map((item) => ({ key: String(item?.key ?? ''), sessionId: String(item?.sessionId ?? ''), owner: item?.owner === true })),
            faults: [...faults.values()],
            // 桥在线时以它自报的为准：那是最新的（刚被 /api/stop 写过也不会漏），
            // 拿不到就退回文件里的那份。
            intent: alive?.intent?.desired === 'stopped' || alive?.intent?.desired === 'running'
                ? { desired: alive.intent.desired, at: Number(alive.intent.at) || 0, by: String(alive.intent.by ?? '') }
                : stored,
        };
    }
    async function start() {
        ensureDir();
        // Line the endpoint up first: the bridge never notices DSH moved, and this is its only lifeline.
        const synced = syncBridgeBaseUrl(dir, origin(), logger);
        if (await ping()) {
            if (!synced.changed)
                return { started: false, reason: 'already-running' };
            // It already read the old baseUrl into memory — writing the file is not enough, it has to be restarted.
            await stop();
        }
        const proc = spawn(nodePath, ['src/bridge.js'], { cwd: dir, detached: true, stdio: 'ignore', windowsHide: true });
        proc.unref();
        child = proc;
        const deadline = Date.now() + START_WAIT_MS;
        while (Date.now() < deadline) {
            await sleep(600);
            if (await ping()) {
                clear('start');
                return { started: true };
            }
        }
        note('start', new Error(`拉起后 ${START_WAIT_MS / 1000}s 内没连上控制台，去看 state/bridge.log`));
        return { started: false, reason: 'not-ready' };
    }
    /**
     * 重启式停止：打 `/api/restart`，桥先拉起接力子进程再退出，所以它几秒后**自己会回来**。
     *
     * 这个语义对 bind/unbind/syncEndpoint 是**对的**——它们紧接着就要 start()，中间那点空档正好
     * 用来改 `sessions.json` / `config.json`。但它不能当「停止」按钮：用户点停止，桥又活了。
     * 真要停请用 halt()。
     */
    async function stop() {
        const token = readConsoleToken(dir);
        if (!(await ping()))
            return { stopped: false, reason: 'already-stopped' };
        try {
            await call(base, `/api/restart${token ? `?token=${encodeURIComponent(token)}` : ''}`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
            });
        }
        catch {
            // It drops the connection on the way out; that error is expected.
        }
        const deadline = Date.now() + STOP_WAIT_MS;
        while (Date.now() < deadline) {
            await sleep(400);
            if (!(await ping())) {
                clear('stop');
                return { stopped: true };
            }
        }
        note('stop', new Error('请求重启后端口仍在响应，可能被别的守护进程又拉起来了'));
        return { stopped: false, reason: 'still-alive' };
    }
    /**
     * 真停：打 `/api/stop`，桥写下 `desired=stopped` 的意图、落盘、释放锁、退出，**不拉接力进程**。
     *
     * 意图文件是巡检的唯一判据：`desired=stopped` 时巡检只报状态不拉起。想让它再起来必须显式
     * start()（桥启动成功时会把意图翻回 running）。
     *
     * 旧版桥没有 `/api/stop`（会 404），这时退回 `/api/restart` 并如实报 stop-failed——
     * 宁可界面说「没停干净」，也不要假装停了然后它自己又回来。
     */
    async function halt() {
        ensureDir();
        const token = readConsoleToken(dir);
        if (!(await ping()))
            return { stopped: false, reason: 'already-stopped' };
        let status = 0;
        try {
            const res = await call(base, `/api/stop${token ? `?token=${encodeURIComponent(token)}` : ''}`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
            });
            status = res.status;
        }
        catch {
            // 退出过程中会掐断连接，这个错误是预期内的。
        }
        const deadline = Date.now() + STOP_WAIT_MS;
        while (Date.now() < deadline) {
            await sleep(300);
            if (!(await ping())) {
                clear('stop');
                return { stopped: true };
            }
        }
        note('stop', new Error(status === 404
            ? '桥没有 /api/stop（旧版本）：这个桥只会重启不会停，请更新 qq-bridge'
            : '请求停止后端口仍在响应：可能有别的守护进程把它拉起来了'));
        return { stopped: false, reason: 'still-alive' };
    }
    /**
     * Points a QQ entry (`group:123` / `private:123`) at a DSH session.
     * The bridge must be stopped while the file is edited: it reads `sessions.json` into memory at startup and
     * writes it back over anything changed while running — done by hand once, and that is exactly how it went.
     */
    async function bind(key, sessionId) {
        const file = join(stateDir, 'sessions.json');
        if (!existsSync(file))
            throw new Error(`找不到 ${file}`);
        await stop();
        const raw = readJsonTolerant(file);
        raw.sessions = raw.sessions ?? {};
        raw.sessions[key] = sessionId;
        writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
        const started = await start();
        return { key, sessionId, ...started };
    }
    async function unbind(key) {
        const file = join(stateDir, 'sessions.json');
        if (!existsSync(file))
            throw new Error(`找不到 ${file}`);
        await stop();
        const raw = readJsonTolerant(file);
        if (raw.sessions)
            delete raw.sessions[key];
        writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
        const started = await start();
        return { key, ...started };
    }
    /**
     * Endpoint alignment: writes the current origin into the bridge's config.json, and if it is running (holding
     * the old value in memory) restarts it once. With autoStart off only the first half happens — a bridge that
     * is meant to be stopped is not started behind the user's back.
     */
    async function syncEndpoint() {
        const synced = syncBridgeBaseUrl(dir, origin(), logger);
        if (!synced.changed)
            return synced;
        if (!(await ping()))
            return { ...synced, restarted: false };
        const stopped = await stop();
        if (!stopped.stopped)
            return { ...synced, restarted: false, reason: 'stop-failed' };
        const started = await start();
        return { ...synced, restarted: started.started === true };
    }
    async function ensureRunning() {
        try {
            return await start();
        }
        catch (error) {
            note('start', error);
            return { started: false, reason: 'failed' };
        }
    }
    return { status, start, stop, halt, intent: () => readIntent(dir), bind, unbind, ensureRunning, syncEndpoint, proactive, setProactive, faults: () => [...faults.values()] };
}
