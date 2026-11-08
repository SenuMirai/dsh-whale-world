import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type SpeakerIdentity } from '../shared/identity.ts';
import { type QqPart } from './replies.ts';
import { type SnowlumaStatus } from '../qq/supervisor.ts';
import { type StartResult } from '../qq/snowluma-start.ts';
import type { NativePatch } from '../qq/route.ts';
import type { InWorld } from '../../worldScope.ts';
import { type BridgeStatus } from './native-bridge.ts';
export type { QqPart } from './replies.ts';
export interface QqNativeConfig {
    enabled: boolean;
    wsUrl: string;
    accessToken: string;
    /** QQ numbers allowed to talk to her at all; empty means nobody. */
    allowPrivate: readonly string[];
    /** 她自己开口（家里闹钟、世界线那一轮）的话推给谁；空着退回 allowPrivate 的第一个。 */
    ownerQQ: string;
    allowGroups: readonly string[];
    /** 她会不会回。关掉是「收到但不理」——连问都不问，不花调用。 */
    autoReply: boolean;
    /** How many earlier messages of the same conversation are shown to her with each new one. */
    contextMessages: number;
    /** 同一会话这几毫秒内说的话攒成一条再问她；0 = 一条一问。 */
    batchQuietMs: number;
    /** 群里什么时候接话：mention 只接被叫到的（被 @ / 被引用她的消息 / 命中关键词），all 每句都接。 */
    groupTrigger: 'mention' | 'all';
    /** 群里命中这些词也算在叫她。 */
    groupKeywords: readonly string[];
    /** 只停嘴不停耳：这个时间（ISO）之前照收、照记上下文，但不回；到点自己醒。空着就是没静默。 */
    mutedUntil: string;
    /** SnowLuma 的家目录；看门狗和「拉起 SnowLuma」都靠它。 */
    snowlumaHome: string;
    /** 看门狗：通道开着时盯住 wsUrl 的端口，不通就拉起 SnowLuma。 */
    supervise: boolean;
    /** Who shares her home session: `owner` keeps it for the owner's private chat, `none` gives every
     *  conversation its own, empty follows whatever the bridge's own setting says. */
    bindHomeSession: 'owner' | 'all' | 'none' | '';
    /** 阳台：让这台机器上别的程序能跟家里说话的那条线。`port` 为 0 就整块不开。 */
    bridge: {
        port: number;
        token: string;
        title: string;
        contextMessages: number;
    };
}
export interface QqNativeStatus {
    enabled: boolean;
    connected: boolean;
    url: string;
    allowPrivate: number;
    allowGroups: number;
    /** 名单本身，面板拿它填输入框。 */
    allowPrivateIds: string[];
    allowGroupsIds: string[];
    autoReply: boolean;
    conversations: number;
    answering: number;
    lastEventAt: string | null;
    lastError: string | null;
    sent: number;
    failed: number;
    /** 发不出去、在队里等重试的条数。 */
    outbox: number;
    /** 阳台那条线现在什么样（没开就是 null）。 */
    bridge: BridgeStatus | null;
    /** 到了通道、但不在白名单里被挡下的条数。 */
    blocked: number;
    /** 最近一次被白名单挡下的时刻。 */
    lastBlockedAt: string | null;
    bindHomeSession: 'owner' | 'all' | 'none' | '';
    /** 群里接话的规矩。 */
    groupTrigger: 'mention' | 'all';
    /** 静默到什么时候；没在静默就是 null。 */
    mutedUntil: string | null;
    supervisor: SnowlumaStatus;
    /** 这次请求按下「拉起 SnowLuma」的结果。 */
    launch?: StartResult;
}
/** 传输层交给通道的那几件（真身上是 snowluma.js 的 createBridge，测试可以换掉）。 */
export interface QqTransport {
    start(): Promise<void>;
    stop(): Promise<void>;
    getState(): string;
    sendGroup(groupId: string, parts: string | QqPart[]): Promise<{
        messageId: string;
    }>;
    sendPrivate(userId: string, parts: string | QqPart[]): Promise<{
        messageId: string;
    }>;
    /** 发账号收藏表情（不是消息段，单发一条）；测试替身可以不实现。 */
    sendCustomFace?(emojiId: string, target: {
        groupId?: string;
        userId?: string;
    }): Promise<{
        messageId: string;
    }>;
    /** 发一条 QQ 空间说说；测试替身可以不实现。 */
    publishQzone?(content: string): Promise<{
        tid: string;
    }>;
}
/** createBridge 认的那几个选项，通道只用到这几个。 */
export interface QqTransportOptions {
    wsUrl: string;
    accessToken?: string;
    log(level: string, message: string): void;
    onGroupMessage?(message: unknown): void;
    onPrivateMessage?(message: unknown): void;
    onNotice?(type: string, notice?: unknown): void;
}
/**
 * QQ as another way into the same home, without a bridge process in between.
 *
 * One OneBot connection in, the same `home` the WeChat channel uses in the middle, and a reply sent
 * back out. There is no separate session store: a conversation's identity key is the whole mapping,
 * so a group keeps talking to the same conversation she already has for it.
 */
export declare function createQqNativeModule(deps: {
    ctx: Context;
    home(identity: SpeakerIdentity): Promise<Agent>;
    inWorld?: InWorld;
    /** Whether the session is her home now: what she says there on her own goes to the owner too. */
    isHome?(sessionId: string): boolean;
    config(): QqNativeConfig;
    /** 面板拨的开关存这儿；不给就只在内存里活到下一次重载。 */
    stateFile?: string;
    logger: {
        info(...args: unknown[]): void;
        warn(...args: unknown[]): void;
        error(...args: unknown[]): void;
    };
    /** 传输层；不给就用真身（snowluma.js 那条线）。测试靠它把合成事件灌进来。 */
    transport?(options: QqTransportOptions): QqTransport;
}): {
    status: () => QqNativeStatus;
    /**
     * 面板上拨的那些：会不会自己回、静默到几点（null 立刻恢复）、白名单（整组换掉，空数组谁都不收）、
     * 阳台端口（当场关掉重开那条线，0 就是关），以及手动拉起 SnowLuma 一次。一次请求里给的几项一起生效。
     */
    update(patch: NativePatch): QqNativeStatus;
    start(): void;
    stop(): void;
};
export type QqNativeModule = ReturnType<typeof createQqNativeModule>;
