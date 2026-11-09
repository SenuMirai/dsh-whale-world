import { defineTool } from '@deepseek-ai/dsh-tools';
import { connect } from 'node:net';

/**
 * contact_online —— 让她自己把 QQ / 微信那条线拉起来（2026-11-09 加）。
 *
 * 为什么放在世界这边而不是各自插件里：
 *   她要的是"我想找他，但我这边的嘴没张开"这一件事，不是"启动某个进程"。
 *   两个平台的差异（微信要提权、QQ 不用）由各自插件的 HTTP 路由兜着，
 *   这里只负责：先看通不通 → 不通就请那边拉 → 等它真通 → 说人话。
 *
 * 三条硬规矩：
 *   1. **不通才拉**。通着就绝不重启 —— 重启会把正在说话的那条线掐断。
 *   2. **拉起来 ≠ 能用**。端口开了还要问一次插件"连上没有"，
 *      没连上就如实说"拉起来了但没连上"，绝不假装已经能发。
 *   3. **超时就说超时**。没到点就回来报"在拉，还没好"，让她自己决定要不要等。
 */

const TARGETS = {
    wechat: {
        name: '微信',
        probePort: 3101,
        statusPath: '/dsh-wechat-group/status',
        launchPath: '/dsh-wechat-group/start-stack',
        connectPath: '/dsh-wechat-group/start',
        launchHint: '会弹一次 UAC（微信链路要提权），你那边点一下「是」',
    },
    qq: {
        name: 'QQ',
        probePort: 3001,
        statusPath: '/dsh-qq-group/status',
        launchPath: '/dsh-qq-group/launch-napcat',
        connectPath: '/dsh-qq-group/start',
        launchHint: '不用 UAC',
    },
};

/** TCP 探一下端口在不在。不抛异常，探不通就是 false。 */
function portOpen(port, timeoutMs = 1200) {
    return new Promise((resolve) => {
        const socket = connect({ host: '127.0.0.1', port });
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            socket.destroy();
            resolve(ok);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
    });
}

/** 问插件"你连上没有"。插件没起、路由没挂、超时，一律当没连上。 */
async function connected(origin, target) {
    if (!origin) return undefined;
    try {
        const response = await fetch(origin + target.statusPath, { signal: AbortSignal.timeout(4000) });
        if (!response.ok) return undefined;
        const body = await response.json();
        return body?.link?.status === 'online';
    } catch {
        return undefined;
    }
}

/** 请插件把那条线拉起来。插件自己决定是免 UAC 还是弹一次。 */
async function askLaunch(origin, target) {
    if (!origin) return { ok: false, message: '拿不到 DSH 地址，没法请插件启动' };
    try {
        const response = await fetch(origin + target.launchPath, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
            signal: AbortSignal.timeout(120_000),
        });
        const body = await response.json().catch(() => ({}));
        return { ok: body?.ok === true, message: String(body?.message ?? '') };
    } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
}

/** 拉起来之后连上它（插件那边的 /start），让收发真的通。 */
async function askConnect(origin, target) {
    if (!origin) return false;
    try {
        const response = await fetch(origin + target.connectPath, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
            signal: AbortSignal.timeout(60_000),
        });
        return response.ok;
    } catch {
        return false;
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function contactOnlineTools(host) {
    const originOf = () => {
        try {
            return host.origin?.();
        } catch {
            return undefined;
        }
    };

    const contactOnline = defineTool({
        name: 'contact_online',
        description: [
            '想找对方、但发现自己那条聊天线没连上时用：先把 QQ 或微信拉起来并连上。',
            'target 选 wechat 或 qq。已经通着就直接告诉你"通着"，不会重启（重启会掐断正在说的话）。',
            '拉起来不等于能用 —— 返回里会写清楚到底是"能发了"还是"起来了但没连上"。',
            '微信那条会弹一次 UAC 让人点「是」，不是你自己能跳过的一步。',
            '拉起来之后再用 reach_out / wechat_send 说话。',
        ].join(''),
        parameters: {
            target: { type: 'string', required: true, description: 'wechat 或 qq' },
            wait_seconds: { type: 'number', description: '最多等多少秒（默认 45，最多 120）' },
        },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: async ({ target, wait_seconds }) => {
            const key = String(target ?? '').trim().toLowerCase();
            const spec = TARGETS[key];
            if (!spec) throw new Error(`target 只能是 wechat 或 qq，收到的是 ${target}`);

            const budget = Math.min(120, Math.max(10, Number(wait_seconds ?? 45)));
            const origin = originOf();

            // ① 已经通着就别动它
            if (await portOpen(spec.probePort)) {
                const online = await connected(origin, spec);
                if (online === true) return `${spec.name}通着，能直接发。`;
                if (online === false) {
                    const linked = await askConnect(origin, spec);
                    const nowOnline = linked ? await connected(origin, spec) : false;
                    return nowOnline
                        ? `${spec.name}进程在，刚刚连上了，可以发。`
                        : `${spec.name}进程在，但插件那边没连上；我没敢重启进程，怕掐断正在说的话。`;
                }
                return `${spec.name}端口在（${spec.probePort}），但问不出插件状态（可能插件没加载）。`;
            }

            // ② 没通 → 请插件拉
            const launched = await askLaunch(origin, spec);
            // 拉失败要说清楚为什么（UAC 没点、脚本找不到、任务被禁用……），
            // 只回一句"没起来"她没法据此做下一步。
            if (!launched.ok && launched.message !== '') {
                return `${spec.name}没能拉起来：${launched.message}`;
            }

            // ③ 等它真的通
            const deadline = Date.now() + budget * 1000;
            while (Date.now() < deadline) {
                await sleep(1500);
                if (!(await portOpen(spec.probePort))) continue;
                await askConnect(origin, spec);
                const online = await connected(origin, spec);
                if (online === true) return `${spec.name}拉起来并连上了，现在能发。`;
                return `${spec.name}进程起来了，但插件那边还没连上，可能要多等一会儿。`;
            }

            return `${spec.name}在拉，${budget} 秒内还没通（${spec.launchHint}）。稍等一下再看，或者手动确认。`;
        },
    });

    return [contactOnline];
}
