export class OutsideWorldError extends Error {
    constructor() { super('会话不在世界工作区内'); this.name = 'OutsideWorldError'; }
}
/** The agent, if it is (still) in her world; without a predicate every agent is. */
export function admit(inWorld, agent) {
    if (inWorld && !inWorld(agent.session))
        throw new OutsideWorldError();
    return agent;
}
/** The tool, refusing to run once its agent has left her world; `left` lets the owner take it away. */
export function scopedTool(tool, inside, left) {
    return { ...tool, execute: (args, exec) => {
            if (!inside()) {
                left?.();
                throw new OutsideWorldError();
            }
            return tool.execute(args, exec);
        } };
}
/**
 * Membership can change after `agent/created`, so whatever a session's world providers depend on is synced as its
 * system prompt is assembled; when `sync` changed something, the prompt is assembled again to include it.
 */
export function reassembleOnChange(ctx, sync) {
    return ctx.on('system-prompt/assemble', (_assembly, context, next) => context.agent && sync(context.agent) ? context.agent.ctx.systemPrompt.assemble(context) : next());
}
