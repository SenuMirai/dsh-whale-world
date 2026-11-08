const clean = (value) => [...value.replace(/[\r\n\u0000-\u001f「」]/g, ' ')].slice(0, 40).join('');
// The adapter permits a 60-second poll; leave one poll and a control-request margin before expiry.
const PRESENCE_TTL_MS = 2 * 60_000 + 5_000;
function ago(milliseconds) {
    const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
    return minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前` : `${Math.floor(minutes / 1440)} 天前`;
}
/** Ephemeral host view of the adapter's durable, account-bound counters. */
export function createWechatPresence() {
    let groups = [], observedAt = 0;
    return {
        clear() { groups = []; observedAt = 0; },
        accept(value) {
            const input = value;
            if (!input.presence) {
                groups = [];
                observedAt = 0;
                return;
            }
            const report = input.presence;
            const at = typeof report.observedAt === 'string' ? Date.parse(report.observedAt) : NaN;
            if (!Number.isFinite(at) || !Array.isArray(report.groups) || report.groups.length > input.chats.length)
                throw new Error('微信群动态格式无效');
            const next = report.groups.map((value) => {
                if (!value || typeof value !== 'object' || Array.isArray(value))
                    throw new Error('微信群动态格式无效');
                const row = value;
                const chat = input.chats.find(chat => chat.id === row.chatId && chat.id.endsWith('@chatroom'));
                const lastAt = typeof row.lastAt === 'string' ? Date.parse(row.lastAt) : NaN;
                if (!chat || !Number.isSafeInteger(row.count) || row.count < 0 || row.count > 100
                    || typeof row.lastSpeaker !== 'string' || !row.lastSpeaker || [...row.lastSpeaker].length > 80 || typeof row.lastSelf !== 'boolean'
                    || !Number.isFinite(lastAt) || lastAt > at + 60_000)
                    throw new Error('微信群动态不属于已配置群聊或内容无效');
                return { chatId: chat.id, name: clean(chat.name), count: row.count, lastSpeaker: clean(row.lastSpeaker), lastAt, lastSelf: row.lastSelf };
            });
            if (new Set(next.map(row => row.chatId)).size !== next.length)
                throw new Error('微信群动态重复');
            groups = next;
            observedAt = at;
        },
        summary(now) {
            const age = now.getTime() - observedAt;
            if (!groups.length || age < -60_000 || age > PRESENCE_TTL_MS)
                return;
            const entries = [...groups].sort((a, b) => Number(b.count > 0) - Number(a.count > 0) || b.lastAt - a.lastAt).slice(0, 8).map(row => {
                const speaker = row.lastSelf ? '我自己' : row.lastSpeaker;
                const elapsed = ago(now.getTime() - row.lastAt);
                return row.count ? `「${row.name}」${row.count > 99 ? '99+' : row.count} 条未读，最后是${speaker}（${elapsed}）`
                    : `「${row.name}」${elapsed.endsWith('前') ? elapsed.slice(0, -1) + '没人说话' : '刚刚有发言'}，最后是${speaker}`;
            });
            if (groups.length > entries.length)
                entries.push(`另有 ${groups.length - entries.length} 个群`);
            return '微信：' + entries.join('；');
        },
    };
}
