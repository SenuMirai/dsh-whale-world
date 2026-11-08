import { conversationKey } from "./identity.js";
export function createChannelSessions(deps) {
    const opening = new Map();
    const firstTitles = new Map();
    let stopped = false;
    const dispose = deps.ctx.on('session/event', (session, event) => {
        const title = firstTitles.get(session.id);
        if (event.type !== 'turn/end' || !title || stopped)
            return;
        firstTitles.delete(session.id);
        void deps.host.rename(session.id, title).catch(error => deps.ctx.logger.error(error));
    });
    async function resolve(identity) {
        if (stopped)
            throw new Error('Channel sessions stopped');
        const key = conversationKey(identity);
        const title = `${identity.channel === 'wechat' ? '微信' : identity.channel === 'qq' ? 'QQ' : identity.channel} · ${identity.conversationName || identity.conversationId}`;
        const workspace = await deps.host.workspace(deps.roomDir, deps.roomTitle);
        if (!workspace)
            throw new Error('群聊需要支持工作区的宿主');
        let id = deps.store.channelSession(key);
        let agent = id && !deps.host.isArchived(id) ? await deps.host.resolveAgent(id) : undefined;
        if (!agent) {
            if (stopped)
                throw new Error('Channel sessions stopped');
            id = await deps.host.createSession(deps.roomDir, deps.agentPreset, workspace.id);
            deps.store.bindChannelSession(key, id);
            firstTitles.set(id, title);
            agent = await deps.host.resolveAgent(id);
            if (!agent)
                throw new Error('新建群聊会话无法打开');
        }
        else if (!workspace.sessionIds.includes(agent.id))
            await workspace.attachSession(agent.id);
        if (stopped)
            throw new Error('Channel sessions stopped');
        await deps.host.rename(agent.id, title);
        return agent;
    }
    return {
        open(identity) {
            const key = conversationKey(identity);
            let pending = opening.get(key);
            if (!pending) {
                pending = resolve(identity).finally(() => opening.delete(key));
                opening.set(key, pending);
            }
            return pending;
        },
        stop() { stopped = true; dispose(); firstTitles.clear(); },
    };
}
