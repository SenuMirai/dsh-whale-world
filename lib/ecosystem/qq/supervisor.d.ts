import type { QqBridge, QqLogger } from './bridge.ts';
/**
 * QQ：看着那个外部进程，别让它悄悄死掉。
 *
 * 为什么需要一层巡检：桥是独立进程（`spawn` 出去的、detached），插件这边除了启动时的一次
 * `ensureRunning()` 之外对它一无所知。它崩了、被任务管理器结束、DSH 换端口后它连不上——
 * 三种情况在界面上长得一模一样：QQ 不说话了。2026-10-26 那次「链路死了四小时」就是这么来的。
 *
 * 这层只做三件事：探测、判断该不该拉、拉的时候别把自己拉爆。它不碰桥的业务逻辑，
 * 也不接管桥的启停实现（那是 `bridge.ts` 的事）。
 */
export type SupervisorState = 'stopped' | 'starting' | 'healthy' | 'degraded' | 'recovering' | 'failed';
export interface SupervisorSnapshot {
    state: SupervisorState;
    /** 连续探测失败次数；成功一次清零。 */
    consecutiveFailures: number;
    /** 最近 10 分钟内真正发起的自动拉起次数。 */
    restartsInWindow: number;
    /** 下次探测的间隔（恢复失败后会变长）。 */
    backoffMs: number;
    /** 桥在线且 `dshReady`——false 时桥在跑但连不上 DSH，那是端点问题，重启桥治不了。 */
    dshReady?: boolean;
    lastError?: string;
    lastProbeAt?: number;
    lastRestartAt?: number;
}
export interface SupervisorOptions {
    /** qq-bridge 目录；`state/bridge.intent.json` 也从这里读。 */
    dir: string;
    port?: number;
    /** 只用到 start / halt / intent 三个动作，方便测试塞假桥。 */
    bridge: Pick<QqBridge, 'start' | 'halt' | 'intent'>;
    logger?: QqLogger;
    /** 探测间隔，默认 5s。 */
    intervalMs?: number;
    /** 单次探测超时，默认 1.5s。 */
    probeTimeoutMs?: number;
    /** 连续失败到几次才尝试恢复，默认 3。 */
    failuresBeforeRestart?: number;
    /** 10 分钟内最多自动拉起几次，默认 5。 */
    maxRestartsPerWindow?: number;
    /** 退避基数，默认 2s；第 n 次失败后等 base * 2^(n-1)，上限 60s。 */
    backoffBaseMs?: number;
    /** 注入时钟与随机源，测试用。 */
    now?: () => number;
    random?: () => number;
}
export interface QqSupervisor {
    /** 开始巡检。不会立刻拉起桥——「该不该跑」是调用方先决定的事。 */
    start(): void;
    /** 停止巡检。不影响桥本身。 */
    stop(): void;
    /** 立刻探一次，可用于控制台刷新或测试。 */
    probeOnce(): Promise<SupervisorSnapshot>;
    snapshot(): SupervisorSnapshot;
}
export declare function createQqSupervisor(options: SupervisorOptions): QqSupervisor;
