/**
 * 交付物里进出的都是未知形状的 JSON。这个别名只干一件事：让字段访问合法。
 * 交付模块逐字保留，所以注解只加在参数上；真正的形状契约写在文件头那段注释里。
 */
type Loose = any;
/**
 * 把入站 message（段数组，或少数网关直接给的字符串）转成给上层/AI 看的文本。
 * @param {unknown} message event.message（JsonValue）
 * @returns {string}
 */
export declare function segmentsToText(message: Loose): string;
/**
 * 把一条 SDK 消息事件归一化成契约里的 msg；非消息事件返回 null。
 * @param {unknown} event
 */
export declare function normalizeMessageEvent(event: Loose): {
    kind: any;
    groupId: string | null;
    userId: string;
    messageId: string;
    selfId: string;
    time: number;
    rawMessage: string;
    text: string;
    segments: any[];
    sender: {
        userId: string;
        nickname: string;
        card: string | null;
        role: string | null;
    };
} | null;
/**
 * notice_type → 契约三的归一化名。运行时字符串集合，不穷举、不 throw。
 * @param {unknown} event
 * @returns {string}
 */
export declare function normalizeNoticeType(event: Loose): "other" | "bot_online" | "bot_offline" | "poke" | "group_increase" | "group_decrease" | "group_admin" | "group_recall" | "friend_recall";
/**
 * 把一条 SDK 通知事件归一化成 { type, msg }；非通知事件返回 null。
 * @param {unknown} event
 */
export declare function normalizeNoticeEvent(event: Loose): {
    kind: string;
    type: string;
    noticeType: string;
    subType: string | null;
    groupId: string | null;
    userId: string | null;
    operatorId: string | null;
    selfId: string;
    time: number;
    raw: any;
} | null;
/**
 * 把契约二的 parts 转成 SDK 段数组。错误以 throw 暴露（发送队列里统一变成 reject）。
 * @param {string|Array<object>} parts
 * @returns {Array<{type:string,data:object}>}
 */
export declare function buildSegments(parts: Loose): import("@snowluma/sdk").AnyMessageSegment[];
/**
 * @param {{
 *   wsUrl?: string,
 *   accessToken?: string,
 *   sendDelayMs?: number,
 *   log?: (level: string, message: string) => void,
 *   onGroupMessage?: (msg: any) => void,
 *   onPrivateMessage?: (msg: any) => void,
 *   onNotice?: (type: string, msg: any) => void,
 *   onState?: (state: BridgeState) => void
 * }} options
 */
export declare function createBridge(options: Loose): {
    start(): Promise<void>;
    stop(): Promise<void>;
    sendGroup(groupId: Loose, parts: Loose): Promise<{
        messageId: string;
    }>;
    sendPrivate(userId: Loose, parts: Loose): Promise<{
        messageId: string;
    }>;
    /**
     * 发账号收藏表情：它走 `send_custom_face`，不是消息段，只能单发一条。`emojiId` 可以是 emoji_id、
     * 第几个（1 起），或者一个意思（「开心」）——按备注挑。
     */
    sendCustomFace(emojiId: Loose, target: {
        groupId?: Loose;
        userId?: Loose;
    }): Promise<{
        messageId: string;
    }>;
    /** 发一条 QQ 空间说说（`send_qzone_msg`）：图片可选，`ugcRight` 缺省 1（所有人可见）。 */
    publishQzone(content: string, options?: {
        images?: string[];
        ugcRight?: number;
    }): Promise<{
        tid: string;
        time: number;
    }>;
    /** @returns {BridgeState} */
    getState(): string;
    __emitForTest(event: Loose): void;
};
export {};
