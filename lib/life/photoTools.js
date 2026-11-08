import { SessionSeq } from '@deepseek-ai/dsh-session';
import { defineTool } from '@deepseek-ai/dsh-tools';
/** Channel images stay in recall data, linked to the current message rather than shared memory. */
function currentImages(agent) {
    let messageId;
    for (let seq = agent.session.seq - 1; seq >= 0; seq--) {
        const event = agent.session.eventAt(SessionSeq(seq));
        if (event?.type === 'turn/start' || event?.type === 'turn/end')
            break;
        if (event?.type !== 'user/message')
            continue;
        const source = event.data.source;
        if (source.kind === 'user' || (source.kind === 'dsh-world-channel-context' && !source.forMessageId)) {
            if (messageId !== undefined)
                return [];
            messageId = event.data.id;
            const images = event.data.content.flatMap(block => block.type === 'image' ? [block.attachment] : []);
            if (images.length)
                return images;
        }
        else if (source.kind === 'dsh-world-channel-context' && messageId !== undefined && source.forMessageId === messageId) {
            return event.data.content.flatMap(block => block.type === 'image' ? [block.attachment] : []);
        }
    }
    return [];
}
export function photoTools(deps) {
    const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
    const check = () => { if (!deps.inside())
        throw new Error('相册工具只能在当前家会话的世界工作区内使用'); };
    return [
        defineTool({ name: 'keep_photo', description: '想收藏当前消息里值得长期保留的图片时使用，由我自己决定。index 从 0 开始，只能选本轮最新消息中的图片（含本轮已读取的微信图片和引用图）；照片保存到我的相册，不自动加入之后每轮上下文。description 最多 500 字，tags 最多 8 个、每个 40 字。', parameters: { index: { type: 'integer' }, description: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, output,
            execute: async ({ index = 0, description = '', tags = [] }, context) => {
                check();
                const images = currentImages(deps.agent);
                if (!Number.isSafeInteger(index) || index < 0 || index >= images.length)
                    throw new Error('index 必须指向本轮最新用户消息中的图片');
                const attachments = deps.attachments();
                if (!attachments)
                    throw new Error('宿主图片存储不可用');
                const image = await attachments.readImage(images[index], context.signal);
                context.signal.throwIfAborted();
                check();
                return JSON.stringify(deps.store().keep(image, description, tags));
            } }),
        defineTool({ name: 'list_photos', description: '分页查看我收藏的照片描述、标签、日期和尺寸，不读取图片正文。limit 默认 20、最多 100，offset 默认 0；hasMore 表示还有下一页。', parameters: { limit: { type: 'integer' }, offset: { type: 'integer' } }, output,
            execute: async ({ limit = 20, offset = 0 }) => { check(); return JSON.stringify(deps.store().list(limit, offset)); } }),
        defineTool({ name: 'forget_photo', description: '移除一张收藏及其相册内图片副本，id 必须来自 list_photos。不会删除原聊天消息或原始附件。', parameters: { id: { type: 'string', required: true } }, output,
            execute: async ({ id }) => { check(); deps.store().forget(id); return '已移出相册。'; } }),
    ];
}
