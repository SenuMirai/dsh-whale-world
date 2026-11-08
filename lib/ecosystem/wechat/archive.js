import { conversationRecordId } from "../../archive.js";
import { replyText } from "./messages.js";
export function wechatDeliveryPatch(record, delivery) {
    if (delivery.status === 'pending')
        return { content: record.content, wechatDelivery: delivery };
    const detail = delivery.status === 'sent' ? '整批已确认' : delivery.status === 'failed' ? '整批未发送' : `第 ${delivery.confirmed + 1} 条结果不明，后续未发送`;
    return { content: `微信回复给 ${record.conversationId}（已确认发送 ${delivery.confirmed}/${delivery.total}；${detail}）：\n${record.content.slice(record.content.indexOf('\n') + 1)}`, wechatDelivery: delivery };
}
/** Preserve the generated words, not the tool protocol; delivery is confirmed separately by the adapter. */
export function createWechatRecorder(store, worldId, archived = () => true) {
    async function record(reply) {
        const sourceMessageId = reply.messageId;
        const recordId = conversationRecordId(worldId, reply.sessionId, sourceMessageId);
        if (!archived(reply.sessionId)) {
            store.registerDelivery(recordId, reply.messages.length);
            return recordId;
        }
        const content = `微信待发送给 ${reply.identity.conversationId}（已生成，发送尚未确认）：\n` + replyText(reply.messages);
        const projection = {
            schemaVersion: 1, worldId, recordId,
            sourceSessionId: reply.sessionId, sourceMessageId, sourceSeq: reply.seq,
            turnId: `${reply.sessionId}:${reply.turn}`, role: 'assistant', occurredAt: new Date(reply.time).toISOString(),
            content, status: 'complete', channel: 'wechat', accountId: reply.identity.accountId,
            conversationId: reply.identity.conversationId, speakerId: `wechat:${reply.identity.accountId}`,
            conversationType: reply.identity.conversationType, conversationName: reply.identity.conversationName,
            wechatDelivery: { status: 'pending', confirmed: 0, total: reply.messages.length },
        };
        await store.commitRecords([projection]);
        // Source archiving may win the insert; enrich the same final message in either order.
        await store.updateRecord(recordId, current => current.wechatDelivery ? { content: current.content, wechatDelivery: current.wechatDelivery } : {
            content, wechatDelivery: projection.wechatDelivery, channel: projection.channel, accountId: projection.accountId,
            conversationId: projection.conversationId, speakerId: projection.speakerId,
            conversationType: projection.conversationType, conversationName: projection.conversationName,
        });
        return recordId;
    }
    function confirmedDelivery(previous, receipt) {
        const { confirmed, status } = receipt;
        if (!Number.isSafeInteger(confirmed) || confirmed < previous.confirmed || confirmed > previous.total
            || !['sent', 'uncertain', 'failed'].includes(status) || (status === 'sent') !== (confirmed === previous.total)
            || (status === 'failed' && confirmed !== 0) || (previous.status === 'sent' && status !== 'sent'))
            throw new Error('Invalid or stale WeChat receipt');
        return { status, confirmed, total: previous.total };
    }
    async function receipt(receipt) {
        if (store.delivery(receipt.id)) {
            if (!store.hasRecord(receipt.id)) {
                store.updateDelivery(receipt.id, previous => confirmedDelivery(previous, receipt));
                return;
            }
            confirmedDelivery(store.delivery(receipt.id), receipt);
        }
        await store.updateRecord(receipt.id, record => {
            const previous = record.wechatDelivery;
            if (record.worldId !== worldId || record.channel !== 'wechat' || !previous)
                throw new Error('Not a WeChat reply');
            const wechatDelivery = confirmedDelivery(previous, receipt);
            return wechatDeliveryPatch(record, wechatDelivery);
        });
    }
    return { record, receipt };
}
