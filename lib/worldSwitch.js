import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { durableWrite } from "./life/lifeStore.js";
import { validArchiveScope } from "./archiveSelection.js";
/** How many of the newest turns the memory block carries when nothing else is set. */
export const DEFAULT_MEMORY_TURNS = 200;
/** WeChat group messages read before a mention, and seconds a private image waits for its companions. */
export const DEFAULT_WECHAT_CONTEXT = 8, MAX_WECHAT_CONTEXT = 20;
export const DEFAULT_WECHAT_BUFFER_SECONDS = 3, MAX_WECHAT_BUFFER_SECONDS = 30;
/**
 * Her world's own settings, changed from the world console and kept in `<world>/world.json` so they outlast a
 * restart: whether it runs (memory block, prompts, archive and life line together), how much her home may
 * spend a day, and how many recent turns her memory block carries. A world that already has a life line from before the switch existed is running; a new one waits
 * for its partner to press start.
 */
export function createWorldSwitch(worldDir, configuredScope = 'workspace') {
    const file = join(worldDir, 'world.json');
    const stored = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
    let settings = {
        running: stored ? stored.running === true : existsSync(join(worldDir, 'life.json')),
        ...(typeof stored?.dailyBudget === 'number' ? { dailyBudget: stored.dailyBudget } : {}),
        ...(validTurns(stored?.memoryTurns) ? { memoryTurns: stored.memoryTurns } : {}),
        ...(validArchiveScope(stored?.archiveScope) ? { archiveScope: stored.archiveScope } : {}),
        ...(validWechatContext(stored?.wechatContext) ? { wechatContext: stored.wechatContext } : {}),
        ...(validWechatBuffer(stored?.wechatBufferSeconds) ? { wechatBufferSeconds: stored.wechatBufferSeconds } : {}),
        ...(stored?.wechatEnabled === false ? { wechatEnabled: false } : {}),
        ...(stored?.qqEnabled === false ? { qqEnabled: false } : {}),
    };
    const activeScope = settings.archiveScope ?? configuredScope;
    function save(next) {
        durableWrite(file, JSON.stringify(next, null, 2));
        settings = next;
    }
    return {
        archiveScope: () => activeScope,
        selectedArchiveScope: () => settings.archiveScope ?? configuredScope,
        restartRequired: () => (settings.archiveScope ?? configuredScope) !== activeScope,
        setArchiveScope(scope) {
            if (!validArchiveScope(scope))
                throw new Error('归档范围只能为 home 或 workspace');
            save({ ...settings, archiveScope: scope });
        },
        running: () => settings.running,
        set: (running) => save({ ...settings, running }),
        /** CNY a day for her home; undefined is no limit. */
        dailyBudget: () => settings.dailyBudget,
        setDailyBudget(yuan) {
            const { dailyBudget: _old, ...rest } = settings;
            save(yuan === undefined ? rest : { ...rest, dailyBudget: yuan });
        },
        /** Turns in her memory block; read when a block is built, so a change shows from the next session start or compaction. */
        memoryTurns: () => settings.memoryTurns ?? DEFAULT_MEMORY_TURNS,
        setMemoryTurns(turns) {
            const { memoryTurns: _old, ...rest } = settings;
            save(turns === undefined || turns === DEFAULT_MEMORY_TURNS ? rest : { ...rest, memoryTurns: turns });
        },
        /** The console's switches for the WeChat and QQ modules; on unless turned off, and only an off switch is written out. */
        wechatEnabled: () => settings.wechatEnabled !== false,
        qqEnabled: () => settings.qqEnabled !== false,
        setModules(next) {
            const { wechatEnabled, qqEnabled, ...rest } = settings;
            const wechat = next.wechat ?? wechatEnabled !== false, qq = next.qq ?? qqEnabled !== false;
            save({ ...rest, ...(wechat ? {} : { wechatEnabled: false }), ...(qq ? {} : { qqEnabled: false }) });
        },
        /** Read by the WeChat adapter on its next poll; a batch already waiting keeps the value it started with. */
        wechatContext: () => settings.wechatContext ?? DEFAULT_WECHAT_CONTEXT,
        wechatBufferSeconds: () => settings.wechatBufferSeconds ?? DEFAULT_WECHAT_BUFFER_SECONDS,
        setWechat(next) {
            const { wechatContext: oldContext, wechatBufferSeconds: oldBuffer, ...rest } = settings;
            const context = next.context === undefined ? oldContext : next.context ?? undefined;
            const buffer = next.bufferSeconds === undefined ? oldBuffer : next.bufferSeconds ?? undefined;
            save({ ...rest, ...(context === undefined || context === DEFAULT_WECHAT_CONTEXT ? {} : { wechatContext: context }), ...(buffer === undefined || buffer === DEFAULT_WECHAT_BUFFER_SECONDS ? {} : { wechatBufferSeconds: buffer }) });
        },
    };
}
export const validTurns = (value) => typeof value === 'number' && Number.isInteger(value) && value >= 1;
export const validWechatContext = (value) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_WECHAT_CONTEXT;
export const validWechatBuffer = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_WECHAT_BUFFER_SECONDS;
