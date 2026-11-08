import type { OutletConfig } from './ecosystem/shared/outlets.ts';
import type { SessionHeader } from '@deepseek-ai/dsh-session';
import type { SpeakerIdentity } from './ecosystem/shared/identity.ts';
import type { MemoryArchiveScope } from './archiveSelection.ts';
export interface WorldConfig {
    worldId: string;
    agentPreset: string;
    timeZone: string;
    /** Archive her current home alone, or ordinary sessions in its workspace (default). */
    archiveScope?: MemoryArchiveScope;
    /** The life line (home session, alarm, tools, console); on by default. */
    life?: boolean;
    /** Her diary directory; defaults to `<world>/diary`. */
    diaryDir?: string;
    /** Local HH:MM of the morning wake when no alarm is pending (she set none, or cancelled hers); 09:00 by default. */
    fallbackWakeTime?: string;
    /** Her own "who I am" file, part of the world prompt; defaults to `<world>/room/我是谁.md` in the plugin. */
    selfFile?: string;
    /** Her name (home title, notifications, memory labels); TA when unset. */
    companionName?: string;
    /** What she calls her partner in the plugin's own words; 伙伴 when unset. */
    partnerName?: string;
    /** Her layered persona, edited in the world console; defaults to `<world>/persona.md`. */
    personaFile?: string;
    /** The world prompt template; defaults to `<world>/world-prompt.md` when it exists, else the shipped one. */
    worldPromptFile?: string;
    /** The alarm wording template; defaults to `<world>/alarm.md` when it exists, else the shipped one. */
    alarmTemplateFile?: string;
    /** Where her words go outside DSH: replies to bridged words, the busy notice, reach_out. */
    outlets?: OutletConfig[];
    /** Runs the bridge: a local app may hand her partner's words to her home. */
    bridge?: boolean;
    /** The independent local WeChat module; the Windows adapter uses `<world>/wechat.json`. */
    wechat?: boolean;
    /** With `wechat`, run the Windows adapter for as long as the module runs; naming both here is the standing permission for it to send (`--allow-send`). */
    wechatAdapter?: {
        python?: string;
        config?: string;
    };
    /** reach_out also shows a system notification (Windows only); on by default. */
    toast?: boolean;
    /** Names besides this machine the console and the bridge answer to (a LAN address or domain behind a reverse proxy). */
    allowedHosts?: string[];
    /** The qq-bridge checkout, so QQ can reach her home too; empty leaves the module off. */
    qqBridgeDir?: string;
    /** The bridge's console port; 3100 by default. */
    qqBridgePort?: number;
    /** Node used to start the bridge; the current process by default. */
    qqBridgeNode?: string;
    /** Start the bridge together with her world; off by default, so it stays a manual start from the console. */
    qqBridgeAutoStart?: boolean;
    /**
     * Who shares her home session. Empty leaves the bridge's own `socialV2.bindHomeSession` alone; `owner` keeps
     * every group on its own session and binds only the owner's private chat to her home; `all` binds every entry;
     * `none` removes the key so the bridge falls back to binding nothing.
     */
    qqBridgeBindHomeSession?: 'owner' | 'all' | 'none' | '';
}
export interface DeliveryState {
    status: 'pending' | 'sent' | 'uncertain' | 'failed';
    confirmed: number;
    total: number;
}
export interface ConversationRecord extends Partial<SpeakerIdentity> {
    schemaVersion: 1;
    worldId: string;
    recordId: string;
    sourceSessionId: string;
    sourceMessageId: string;
    sourceSeq: number;
    turnId: string;
    role: 'user' | 'assistant';
    occurredAt: string;
    content: string;
    status: 'complete' | 'interrupted';
    wechatDelivery?: DeliveryState;
}
export interface ArchiveScope {
    worldId: string;
    agentPreset: string;
    header: SessionHeader;
    inheritedEventCount: number;
    turn: number;
    archiveScope?: MemoryArchiveScope;
}
export interface ArchiveCursor {
    date: string;
    occurredAt: string;
    recordId: string;
    maxSequence: number;
}
export interface PageQuery {
    worldId: string;
    before?: ArchiveCursor;
    limit: number;
}
export interface RecordPage {
    records: ConversationRecord[];
    nextCursor?: ArchiveCursor;
}
export interface ConversationTurn {
    turnId: string;
    occurredAt: string;
    messages: ConversationRecord[];
}
export interface ArchiveReader {
    readPage(query: PageQuery): Promise<RecordPage>;
    readTurn(worldId: string, turnId: string, afterSeq?: number, limit?: number): Promise<ConversationRecord[]>;
}
