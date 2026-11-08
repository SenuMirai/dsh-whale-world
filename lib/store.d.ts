import type { ConversationRecord, DeliveryState, PageQuery, RecordPage, WorldConfig } from './types.ts';
import type { SpeakerIdentity } from './ecosystem/shared/identity.ts';
export interface ExportProgress {
    sessionId: string;
    nextSeq: number;
    turn: number;
}
export declare function createArchiveStore(config: WorldConfig & {
    root: string;
}): {
    commitRecords: (records: readonly ConversationRecord[], progress?: ExportProgress) => Promise<void>;
    hasRecord: (recordId: string) => boolean;
    updateRecord: (recordId: string, revise: (record: ConversationRecord) => Pick<ConversationRecord, "content" | "wechatDelivery"> & Partial<SpeakerIdentity>) => Promise<void>;
    readPage: (query: PageQuery) => Promise<RecordPage>;
    readTurn: (_worldId: string, turnId: string, afterSeq?: number, limit?: number) => Promise<ConversationRecord[]>;
    progress: (sessionId: string) => ExportProgress;
    forgetProgress: (sessionId: string) => void;
    sourcePage: (afterId?: string, limit?: number) => string[];
    stats: () => {
        records: number;
        sessions: number;
    };
    close: () => void;
    channelSession: (key: string) => string | undefined;
    bindChannelSession: (key: string, sessionId: string) => void;
    delivery: (recordId: string) => DeliveryState | undefined;
    registerDelivery: (recordId: string, total: number) => void;
    updateDelivery: (recordId: string, revise: (previous: DeliveryState) => DeliveryState) => void;
};
export type ArchiveStore = ReturnType<typeof createArchiveStore>;
