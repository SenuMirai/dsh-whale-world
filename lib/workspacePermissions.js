import { existsSync, realpathSync } from 'node:fs';
/** The host seeds every session; a workspace default overrides that seed only on fresh creation. */
export function createWorkspacePermissions(ctx, roomDir, settings) {
    const presets = ctx.get('permissionPresets');
    ctx.on('agent/created', ({ agent, source }) => {
        const { session } = agent, header = session.header;
        if (source !== 'startup' || header.isSeeded || header.parentSession || header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0 || !header.cwd || !existsSync(header.cwd) || !existsSync(roomDir))
            return undefined;
        // Native resolution canonicalizes case on Windows, where the JS fallback keeps the input's spelling.
        if (realpathSync.native(header.cwd) === realpathSync.native(roomDir))
            presets.set(session, settings.workspacePermission());
        return undefined;
    }, { prepend: true });
    return {
        snapshot: () => ({ defaultPermission: settings.workspacePermission(), options: presets.catalog().defaultOptions }),
        set(permission) {
            if (!presets.catalog().defaultOptions.some(option => option.value === permission))
                throw new Error('未知的工作区权限选项');
            settings.setWorkspacePermission(permission);
        },
    };
}
