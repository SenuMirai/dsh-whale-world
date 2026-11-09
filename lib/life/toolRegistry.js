import { errorText } from "../faults.js";
/**
 * 每个世界会话都拿到的工具：闹钟那三只（她在哪儿都能定，铃响在家里），
 * 外加翻记忆原文那只（recall_memory）——记忆是她的，不该只有家里能伸手。
 * reach_out 仍然只归当前的家（回话只能从家里发出）。
 */
const WORLD_TOOLS = ['plan_next', 'check_alarm', 'cancel_alarm', 'recall_memory'];
/*
 * 她的身体那三只（make_face / gesture / body_tilt）**只归家**，
 * 不进 WORLD_TOOLS：QQ 会话拿不到它们。理由和 reach_out 一样——
 * 身体只在她自己的房间里，隔着 QQ 看不见也动不了。
 */
const BODY_TOOLS = ['make_face', 'gesture', 'body_tilt'];
/** 信也只在家里写：写完落在 <world>/letters/，主人自己会在世界设置里读。 */
const HOME_TOOLS = ['reach_out', 'write_letter', 'contact_online', ...BODY_TOOLS];
/** Disposes in reverse; a disposer whose agent scope is already gone may throw and is skipped. */
function undo(list) {
    for (const dispose of list.splice(0).reverse()) {
        try {
            dispose();
        }
        catch { /* scope already disposed */ }
    }
}
/**
 * The alarm tools are held by every world session (she can set her alarm anywhere; it rings at home);
 * reach_out only by the current home. A registration that fails (a name clash) is a fault and never breaks
 * agent creation; it registers all of a group or none.
 */
export function createToolRegistry(deps) {
    const world = new Map();
    const home = new Map();
    function register(agent, tools, names) {
        const done = [];
        try {
            for (const tool of tools)
                if (names.includes(tool.name))
                    done.push(agent.ctx.tools.register(tool));
        }
        catch (error) {
            undo(done);
            throw error;
        }
        return done;
    }
    return {
        attach(agent) {
            const needsWorld = !world.get(agent)?.length, needsHome = deps.isHome(agent) && !home.get(agent)?.length;
            if (!needsWorld && !needsHome)
                return;
            try {
                const tools = deps.tools();
                if (needsWorld)
                    world.set(agent, register(agent, tools, WORLD_TOOLS));
                if (needsHome)
                    home.set(agent, register(agent, tools, HOME_TOOLS));
                deps.faults.clear(`attach:${agent.id}`);
            }
            catch (error) {
                deps.faults.set(`attach:${agent.id}`, `工具挂载失败：${errorText(error)}`);
                deps.logger.error(error);
            }
        },
        forget(agent) { world.delete(agent); home.delete(agent); deps.faults.clear(`attach:${agent.id}`); },
        /** A rebuilt home takes reach_out from the old one. */
        releaseOldHomes() { for (const [agent, list] of home)
            if (!deps.isHome(agent))
                undo(list); },
        clear() {
            for (const list of [...home.values(), ...world.values()])
                undo(list);
            home.clear();
            world.clear();
        },
    };
}
