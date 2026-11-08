import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { wechatTextOutput } from "./messages.js";
const messageIdPattern = /^[A-Za-z0-9_.-]{1,64}:\d{1,20}$/;
const labels = (tags) => tags.join('/');
/**
 * The model's side of the world's own sticker library. Kept deliberately small: nothing here puts a catalog or a
 * picture in front of the model unless it asked, and sending is the ordinary `wechat_send`.
 */
export function createStickerTools(deps) {
    const { library } = deps;
    return [
        defineTool({
            name: 'sticker_search',
            description: '按关键词查表情库（匹配名称、标签），返回 id｜名称｜标签；不带词看最近收的，limit 默认 8、最多 20。发送用 wechat_send 的 {type:"sticker", stickerId}。',
            parameters: { query: { type: 'string' }, limit: { type: 'integer' } },
            output: wechatTextOutput,
            execute: async ({ query, limit }) => {
                const { total, items } = await library.search({ ...(query === undefined ? {} : { query }), ...(limit === undefined ? {} : { limit }) });
                if (!total)
                    return '表情库还是空的，可以用 sticker_save 收别人发来的表情包。';
                if (!items.length)
                    return `没有匹配「${query ?? ''}」的表情（库里共 ${total} 张）。换个词，或不带关键词看最近收的。`;
                return `共 ${total} 张，显示 ${items.length} 张：\n` + items.map(sticker => `${sticker.id}｜${sticker.name}｜${labels(sticker.tags)}`).join('\n');
            },
        }),
        defineTool({
            name: 'sticker_save',
            description: '把聊天里别人发来的表情包收进库。chatId、messageId 取自那条消息；tags 1–8 个短词（每个≤16 字）概括情绪和用法；name 可省。同一张图不重复收。',
            parameters: { chatId: { type: 'string', required: true }, messageId: { type: 'string', required: true }, tags: { type: 'array', items: { type: 'string' }, required: true }, name: { type: 'string' } },
            output: wechatTextOutput,
            execute: async ({ chatId, messageId, tags, name }, context) => {
                if (!messageIdPattern.test(messageId))
                    throw new Error('messageId 必须是那条表情消息的 id');
                const identity = deps.target(chatId);
                const staged = JSON.parse(await deps.ask(identity, { chatId, limit: 1, stickerId: messageId }, context));
                const file = join(deps.stagingDir, staged.file);
                try {
                    context.signal.throwIfAborted();
                    const { sticker, existing } = await library.add(await readFile(file), { tags, ...(name === undefined ? {} : { name }) }, { expectedMd5: staged.md5 });
                    return existing ? `库里已经有这张：${sticker.id}「${sticker.name}」（标签 ${labels(sticker.tags)}，没有改动）。` : `已收进表情库：${sticker.id}「${sticker.name}」（标签 ${labels(sticker.tags)}）。`;
                }
                finally {
                    await rm(file, { force: true });
                }
            },
        }),
        defineTool({
            name: 'sticker_edit',
            description: '改表情的名称或标签（tags 整个替换）。',
            parameters: { id: { type: 'string', required: true }, name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
            output: wechatTextOutput,
            execute: async ({ id, name, tags }) => {
                if (name === undefined && tags === undefined)
                    throw new Error('需要给出新的 name 或 tags');
                const sticker = await library.edit(id, { ...(name === undefined ? {} : { name }), ...(tags === undefined ? {} : { tags }) });
                return `已更新 ${sticker.id}「${sticker.name}」：${labels(sticker.tags)}`;
            },
        }),
        defineTool({
            name: 'sticker_remove',
            description: '删除表情及其图片文件。',
            parameters: { id: { type: 'string', required: true } },
            output: wechatTextOutput,
            execute: async ({ id }) => { await library.remove(id); return `已移出 ${id}。`; },
        }),
    ];
}
