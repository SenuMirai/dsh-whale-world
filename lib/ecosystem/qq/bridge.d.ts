/** The host logger, or nothing at all when the module runs without one. */
export interface QqLogger {
    info?(message: string): void;
    warn?(message: string): void;
}
export interface QqSessionEntry {
    key: string;
    sessionId: string;
    owner: boolean;
}
/**
 * 桥自己记下的运行意图。`stopped` 只可能来自一次显式的 `/api/stop`（或插件 halt），
 * 意思是「人让它停的，别再自动拉」。巡检靠它区分「死了」和「关掉了」。
 */
export interface QqIntent {
    desired: 'running' | 'stopped';
    at: number;
    by: string;
}
/** What the console shows: is it up, is it talking to DSH, which entries are bound where. */
export interface QqStatus {
    running: boolean;
    port: number;
    dir: string;
    /** `reserved2` / `closed-agent` …; absent while the bridge is not answering. */
    mode?: string | null;
    /** DSH answers the bridge's own API calls — this is what goes false first when DSH moves to a new port. */
    dsh?: boolean;
    /** The QQ protocol side is online; when it drops, messages stop arriving. */
    connected?: boolean;
    accountOnline?: boolean;
    lastPacketAgoMs?: number | null;
    ownerQQ?: string | null;
    allowGroups?: string[];
    sessions: QqSessionEntry[];
    faults: string[];
    /** 上次是「想跑」还是「想停」。桥不在线时从 state 文件读，在线时取桥自报的值。 */
    intent: QqIntent;
    /** 巡检状态：由 index.ts 在 console 快照里填上，桥自己不认识它。 */
    supervisor?: unknown;
}
export interface SyncResult {
    changed: boolean;
    reason?: string;
    baseUrl?: string;
    before?: string;
    mode?: string;
}
/** 谁和谁共用一个会话：群各自一份，还是所有入口都用她的家会话，还是谁都不绑。 */
export type BindHomeSession = 'owner' | 'all' | 'none';
export interface StartResult {
    started: boolean;
    reason?: string;
}
export interface StopResult {
    stopped: boolean;
    reason?: string;
}
export interface BindResult extends StartResult {
    key: string;
    sessionId?: string;
}
export interface SyncEndpointResult extends SyncResult {
    restarted?: boolean;
}
export interface QqBridgeOptions {
    /** The qq-bridge checkout; nothing is guessed when this is empty, the module is simply off. */
    dir: string;
    /** The bridge's console port. */
    port?: number;
    /** Node to start the bridge with; the current process by default. */
    nodePath?: string;
    /** DSH's current origin, read fresh every time. */
    origin?: () => string;
    logger?: QqLogger;
}
export interface QqBridge {
    status(): Promise<QqStatus>;
    start(): Promise<StartResult>;
    /** 重启式停止：桥会自己回来。给 bind/unbind/syncEndpoint 这类「中间改文件」的场景用。 */
    stop(): Promise<StopResult>;
    /** 真停：桥不会回来，并写下 desired=stopped 让巡检别拉起。 */
    halt(): Promise<StopResult>;
    /** 只读意图文件，不联网；巡检判「该不该拉」用这个。 */
    intent(): QqIntent;
    bind(key: string, sessionId: string): Promise<BindResult>;
    unbind(key: string): Promise<BindResult>;
    ensureRunning(): Promise<StartResult>;
    syncEndpoint(): Promise<SyncEndpointResult>;
    /** 主动聊天的统计：今天花了多少次、平均多少 token、成了几条、被规则拦下几条。读不到返回 undefined。 */
    proactive(): Promise<any>;
    setProactive(patch: {
        enabled?: boolean;
        dryRun?: boolean;
    }): Promise<any>;
    faults(): string[];
}
/** The bridge's console token: `config.json` first, else `state/console-token` (rewritten on every start). */
export declare function readConsoleToken(dir: string): string;
/**
 * 读桥写下的运行意图。读不到一律当 `running`——未知状态不能变成「永久不启动」，
 * 那是比「该停的又起来了」更难受的故障。
 */
export declare function readIntent(dir: string): QqIntent;
/**
 * Writes DSH's current origin back into the bridge's `config.json` (`dsh.baseUrl`).
 *
 * Why the plugin owns this: DSH picks a new port on every restart, the bridge's baseUrl is a fixed value, and
 * nothing complains when it goes stale — `dshReady` just stays false and the event stream reconnects every 30s
 * for zero frames. 2026-10-26 the link sat dead for four hours looking exactly like a crashed bridge.
 */
export declare function syncBridgeBaseUrl(dir: string, origin: string, logger?: QqLogger): SyncResult;
/**
 * 谁和谁共用一个会话，写进桥的 `socialV2.bindHomeSession`。
 *
 * 桥自己的默认是「谁都不绑」——装上之后每个群、每条私聊各建一个会话。那通常不是人想要的：主人私聊
 * 应该是她记得的那个家会话，只有群才该各自独立。这个开关让人在插件配置里说一次，不用去翻桥的
 * config.json。
 *
 * 空值表示不碰桥的配置（尊重人自己填的）；`none` 表示把这个键删掉，回到桥的默认。
 */
export declare function syncBridgeSessionMode(dir: string, mode: BindHomeSession | '', logger?: QqLogger): SyncResult;
export declare function createQqBridge(options: QqBridgeOptions): QqBridge;
