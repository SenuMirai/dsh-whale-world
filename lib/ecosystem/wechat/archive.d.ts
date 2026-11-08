import type { ArchiveStore } from '../../store.ts';
import type { SpeakerIdentity } from '../shared/identity.ts';
import type { WechatMessage } from './messages.ts';
import type { ConversationRecord, DeliveryState } from '../../types.ts';
export interface WechatReceipt {
    id: string;
    confirmed: number;
    status: 'sent' | 'uncertain' | 'failed';
}
export interface PreparedReply {
    sessionId: string;
    messageId: string;
    seq: number;
    turn: number;
    time: number;
    identity: SpeakerIdentity;
    messages: WechatMessage[];
}
export declare function wechatDeliveryPatch(record: ConversationRecord, delivery: DeliveryState): Pick<ConversationRecord, 'content' | 'wechatDelivery'>;
/** Preserve the generated words, not the tool protocol; delivery is confirmed separately by the adapter. */
export declare function createWechatRecorder(store: Pick<ArchiveStore, 'commitRecords' | 'hasRecord' | 'updateRecord' | 'delivery' | 'registerDelivery' | 'updateDelivery'>, worldId: string, archived?: (sessionId: string) => boolean): {
    record: (reply: PreparedReply) => Promise<string>;
    receipt: (receipt: WechatReceipt) => Promise<void>;
};
