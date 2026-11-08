import { existsSync, realpathSync } from 'node:fs';
export const validArchiveScope = (value) => value === 'home' || value === 'workspace';
/** Workspace membership comes from the host, never a preset or a display name. */
export function createArchiveSelection(ctx, scope, isHome, roomDir) {
    return id => {
        if (scope === 'home')
            return isHome(id);
        const registry = ctx.get('workspaceRegistry');
        if (!registry)
            throw new Error('工作区归档需要宿主工作区服务');
        const workspaces = registry.list();
        const room = workspaces.find(workspace => workspace.sessionIds.some(isHome))
            ?? workspaces.find(workspace => workspace.path === (existsSync(roomDir) ? realpathSync(roomDir) : roomDir));
        return room?.sessionIds.includes(id) ?? false;
    };
}
