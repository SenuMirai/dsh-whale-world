export function hostLife(ctx) {
    const host = ctx;
    return {
        createSession: async (cwd, agentPreset, workspaceId) => (await host.sessionController.create({ ...(workspaceId ? { workspaceId } : { cwd }), agentPreset })).sessionId,
        // Optional like isArchived; `create` returns the existing workspace of a directory without retitling it.
        workspace: async (path, title) => {
            const registry = ctx.get('workspaceRegistry');
            return registry?.create ? registry.create(path, title) : undefined;
        },
        async resolveAgent(sessionId) {
            const found = await host.sessionController.resolveAgent(sessionId);
            if ('agent' in found)
                return found.agent;
            if (found.error.code === 'session/not-found')
                return undefined;
            throw new Error(`dsh-world: home ${sessionId} cannot be resolved: ${found.error.message}`);
        },
        // Optional, so read without injecting it: Cordis throws on an un-injected property access.
        isArchived: sessionId => Array.from(ctx.get('workspaceRegistry')?.archivedSessionIds ?? []).includes(sessionId),
        setFullAccess: session => host.permissionPresets.set(session, 'danger-full-access'),
        rename: async (sessionId, title) => { await host.sessionController.rename({ sessionId, title }); },
        origin: () => host.webServer.getOrigin(),
    };
}
