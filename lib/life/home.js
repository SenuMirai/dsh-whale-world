import { mkdirSync } from 'node:fs';
import { errorText } from "../faults.js";
/**
 * Her home session: the recorded one while it exists and is not archived, otherwise a new one. Full access is
 * granted on every open (selecting the preset in effect is a no-op), so no "still needs access" state has to
 * survive a restart. Her room is a workspace of the host, so the home is listed under it rather than as
 * ungrouped, and new sessions can be opened in the room; a host without workspaces just gets the cwd. The title is applied when the home is built and again after its first turn, because the
 * host retitles a session from its first prompt.
 */
export function createHome(deps) {
    const { host, faults } = deps;
    let opening;
    /** A new home whose title is not applied yet; retried on the next open. */
    let untitled;
    /** A new home before its first turn ends. */
    let firstTurn;
    async function rename(sessionId) {
        try {
            await host.rename(sessionId, deps.title);
            faults.clear('rename');
            return true;
        }
        catch (error) {
            faults.set('rename', `家改名失败：${errorText(error)}`);
            deps.logger.error(error);
            return false;
        }
    }
    async function ready(agent) {
        host.setFullAccess(agent.session);
        if (untitled === agent.id && await rename(agent.id) && untitled === agent.id)
            untitled = undefined;
        deps.opened(agent);
        return agent;
    }
    /** Her room as a workspace; a failure is a fault and the home still opens, ungrouped. */
    async function room() {
        mkdirSync(deps.roomDir, { recursive: true });
        try {
            const workspace = await host.workspace(deps.roomDir, deps.roomTitle);
            faults.clear('room');
            return workspace;
        }
        catch (error) {
            faults.set('room', `房间没能成为工作区：${errorText(error)}`);
            deps.logger.error(error);
            return undefined;
        }
    }
    async function build() {
        const workspace = await room();
        const current = deps.current();
        if (current && !host.isArchived(current)) {
            const agent = await host.resolveAgent(current);
            if (agent) {
                // A home built before her room was a workspace moves in.
                if (workspace && !workspace.sessionIds.includes(agent.id)) {
                    try {
                        await workspace.attachSession(agent.id);
                    }
                    catch (error) {
                        faults.set('room', `家没能挂进房间：${errorText(error)}`);
                        deps.logger.error(error);
                    }
                }
                return ready(agent);
            }
        }
        const sessionId = await host.createSession(deps.roomDir, deps.agentPreset, workspace?.id);
        if (deps.stopped())
            throw new Error('生活线已停止');
        untitled = sessionId;
        firstTurn = sessionId;
        deps.moveIn(sessionId);
        const agent = await host.resolveAgent(sessionId);
        if (!agent)
            throw new Error(`dsh-world: the new home ${sessionId} cannot be resolved`);
        return ready(agent);
    }
    return {
        /** The current home, resolving or rebuilding it; one attempt at a time. */
        open() { return opening ??= build().finally(() => { opening = undefined; }); },
        /**
         * 把家换成一个已经存在的会话。
         *
         * 2026-10-29 加：以前只会在「没有家」时新建，没法换成别的会话。
         * 这里先做三重校验，任何一种不满足就明确报错，不要留下半挂的状态：
         *   1. 生活线没停
         *   2. 那个会话没归档
         *   3. 那个会话的 cwd 必须是这个世界的房间目录（attachSession 会拦）
         */
        async moveIn(sessionId) {
            if (deps.stopped())
                throw new Error('生活线已停止，先按「开始」再切换');
            if (host.isArchived(sessionId))
                throw new Error('这个会话已归档，不能当作她的家');
            const agent = await host.resolveAgent(sessionId);
            if (!agent)
                throw new Error('这个会话还没被载入，先在侧边栏点开它一次');
            const workspace = await room();
            if (workspace && !workspace.sessionIds.includes(agent.id)) {
                // cwd 对不上时这里会抛，正是不该允许的情况
                await workspace.attachSession(agent.id);
            }
            deps.moveIn(sessionId);
            return agent.id;
        },
        turnEnded(sessionId) {
            if (firstTurn !== sessionId || deps.stopped())
                return;
            firstTurn = undefined;
            void rename(sessionId).then(ok => { if (!ok && deps.current() === sessionId)
                untitled = sessionId; });
        },
    };
}
