import { readConsoleToken } from "./bridge.js";
const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_PROBE_TIMEOUT_MS = 1500;
const DEFAULT_FAILURES_BEFORE_RESTART = 3;
const DEFAULT_MAX_RESTARTS = 5;
const DEFAULT_BACKOFF_BASE_MS = 2000;
const MAX_BACKOFF_MS = 60000;
const RESTART_WINDOW_MS = 10 * 60 * 1000;
const sleep = (ms) => new Promise(resolve => { setTimeout(resolve, ms); });
const messageOf = (error) => error instanceof Error ? error.message : String(error);
export function createQqSupervisor(options) {
    const { dir, bridge, logger, port = 3100, intervalMs = DEFAULT_INTERVAL_MS, probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS, failuresBeforeRestart = DEFAULT_FAILURES_BEFORE_RESTART, maxRestartsPerWindow = DEFAULT_MAX_RESTARTS, backoffBaseMs = DEFAULT_BACKOFF_BASE_MS, now = () => Date.now(), random = () => Math.random(), } = options;
    const base = `http://127.0.0.1:${port}`;
    let state = 'stopped';
    let consecutiveFailures = 0;
    /** 本轮连续发起恢复的次数；成功或被探到桥好了就清零。退避按它算。 */
    let recoverAttempts = 0;
    let backoffMs = 0;
    let restartsInWindow = 0;
    let lastError;
    let lastProbeAt;
    let lastRestartAt;
    let dshReady;
    const restartTimes = [];
    /** 单飞：探测和恢复共用这把锁，避免慢探测叠在恢复上。 */
    let inFlight = false;
    let timer;
    function pruneWindow(at) {
        const cutoff = at - RESTART_WINDOW_MS;
        while (restartTimes.length > 0 && restartTimes[0] < cutoff)
            restartTimes.shift();
        restartsInWindow = restartTimes.length;
    }
    function nextBackoff() {
        // 按「第几次发起恢复」算，不按「连续探测失败几次」算：
        // 阈值是 3，用探测次数会让第一次恢复就先等 4 倍基数。
        const raw = backoffBaseMs * 2 ** Math.min(Math.max(0, recoverAttempts - 1), 5);
        // ±20% 抖动：几个实例同时恢复时不至于踩着同一个节奏互相抢锁。
        const jitter = 0.8 + random() * 0.4;
        return Math.min(MAX_BACKOFF_MS, Math.round(raw * jitter));
    }
    async function probe() {
        const token = readConsoleToken(dir);
        const url = `${base}/api/status${token ? `?token=${encodeURIComponent(token)}` : ''}`;
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(probeTimeoutMs) });
            if (response.status !== 200)
                return { ok: false, error: `status ${response.status}` };
            const body = await response.json();
            return { ok: true, body: body ?? {} };
        }
        catch (error) {
            return { ok: false, error: messageOf(error) };
        }
    }
    function intent() {
        try {
            return bridge.intent();
        }
        catch {
            // 读意图失败按「想跑」处理：未知状态不该变成永久不启动。
            return { desired: 'running', at: 0, by: '' };
        }
    }
    async function attemptRecovery(at) {
        const wanted = intent();
        if (wanted.desired === 'stopped') {
            // 用户主动停的：报状态就够了，别把手伸回去。
            state = 'stopped';
            logger?.info?.('[qq] 桥是用户主动停止的（desired=stopped），巡检不自动拉起');
            return;
        }
        pruneWindow(at);
        if (restartsInWindow >= maxRestartsPerWindow) {
            state = 'failed';
            lastError = `${RESTART_WINDOW_MS / 60000} 分钟内已自动拉起 ${restartsInWindow} 次，停止重试（修好再手动启动）`;
            logger?.warn?.(`[qq] ${lastError}`);
            return;
        }
        state = 'starting';
        logger?.warn?.(`[qq] 桥连续 ${consecutiveFailures} 次探测失败，尝试拉起`);
        try {
            const result = await bridge.start();
            if (result.started) {
                restartTimes.push(now());
                restartsInWindow = restartTimes.length;
                lastRestartAt = now();
                state = 'healthy';
                consecutiveFailures = 0;
                recoverAttempts = 0;
                backoffMs = 0;
                lastError = undefined;
                logger?.info?.('[qq] 桥已拉起');
                return;
            }
            lastError = `拉起没成功：${result.reason ?? '未知原因'}`;
        }
        catch (error) {
            lastError = `拉起失败：${messageOf(error)}`;
        }
        // 失败：进入退避等待，期间不再尝试；等待结束才回到 degraded 让下一轮重新判定。
        // 计数必须清零——否则「连续失败 3 次」这个闸门永远开着，退避等待一结束，
        // 下一次探测就直接又拉一遍，退避等于没做。
        state = 'recovering';
        consecutiveFailures = 0;
        recoverAttempts += 1;
        backoffMs = nextBackoff();
        logger?.warn?.(`[qq] ${lastError}；${Math.round(backoffMs / 1000)}s 后再试`);
        await sleep(backoffMs);
        if (state === 'recovering')
            state = 'degraded';
    }
    async function tick() {
        if (inFlight)
            return;
        inFlight = true;
        try {
            const at = now();
            lastProbeAt = at;
            const result = await probe();
            if (result.ok) {
                consecutiveFailures = 0;
                recoverAttempts = 0;
                backoffMs = 0;
                lastError = undefined;
                dshReady = result.body.dshReady === true;
                // 桥在跑但连不上 DSH：那是 baseUrl 过期，重启桥解决不了，交给 syncEndpoint。
                // 这里只把它标成 degraded，让人在界面上看得出来。
                state = dshReady ? 'healthy' : 'degraded';
                if (!dshReady)
                    lastError = '桥在线，但 dshReady=false（多半是 DSH 换了端口，跑一次 syncEndpoint）';
                return;
            }
            dshReady = undefined;
            // 用户主动停的桥不在线是**预期状态**，不该算故障：否则界面上先跳十几秒的
            // 「degraded / 连续失败 2 次」才变回 stopped，看着像巡检在犹豫要不要动手。
            if (intent().desired === 'stopped') {
                state = 'stopped';
                consecutiveFailures = 0;
                recoverAttempts = 0;
                lastError = undefined;
                return;
            }
            consecutiveFailures += 1;
            lastError = result.error;
            state = 'degraded';
            if (consecutiveFailures >= failuresBeforeRestart)
                await attemptRecovery(at);
        }
        finally {
            inFlight = false;
        }
    }
    return {
        start() {
            if (timer)
                return;
            // 先探一次，别让界面在头 5 秒里显示「未知」。
            void tick();
            timer = setInterval(() => { void tick(); }, intervalMs);
            // 巡检不该成为进程退出的阻碍。
            timer.unref?.();
        },
        stop() {
            if (timer)
                clearInterval(timer);
            timer = undefined;
            state = 'stopped';
        },
        async probeOnce() {
            await tick();
            return this.snapshot();
        },
        snapshot() {
            pruneWindow(now());
            return {
                state,
                consecutiveFailures,
                restartsInWindow,
                backoffMs,
                ...(dshReady === undefined ? {} : { dshReady }),
                ...(lastError ? { lastError } : {}),
                ...(lastProbeAt === undefined ? {} : { lastProbeAt }),
                ...(lastRestartAt === undefined ? {} : { lastRestartAt }),
            };
        },
    };
}
