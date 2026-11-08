import { existsSync, readFileSync } from 'node:fs';
import { SessionId } from '@deepseek-ai/dsh-session';
import { createHistory, renderHistory } from "../history.js";
import { createDiaryReader } from "../life/diary.js";
import { createLetterStore } from "../letters.js";
const SNAPSHOT_TTL_MS = 5000;
export function estimateTokens(text) {
    const cjk = (text.match(/[㐀-鿿豈-﫿　-〿＀-￯]/g) ?? []).length;
    return Math.round(cjk * 0.6 + (text.length - cjk) / 3.5);
}
/** Read-only views for the console; repeated polling within a few seconds reuses one snapshot until `invalidate`. */
export function consoleSources(deps) {
    const { config, archive, lifeStore } = deps;
    const history = createHistory(archive);
    const diary = createDiaryReader(deps.diaryDir);
    /*
     * 她写的信（2026-11-08 从「鱼与人」搬回世界）。
     * deps.lettersDir 必须显式转发给控制台，否则页面永远读到空 —— 和 body 那次同一个坑。
     */
    const letters = deps.lettersDir ? createLetterStore(deps.lettersDir, { timeZone: config.timeZone }) : undefined;
    let cached;
    async function compute() {
        const life = deps.life()?.snapshot();
        const home = life?.homeSessionId ? deps.ctx.agents.get(SessionId(life.homeSessionId)) : undefined;
        const window = deps.memoryTurns();
        const turns = await history.loadRecentTurns(config.worldId, window, deps.includesSession);
        const archiveScope = config.archiveScope ?? 'workspace';
        const selectedArchiveScope = deps.selectedArchiveScope?.() ?? archiveScope;
        // Never let a dead bridge take the whole console down with it: a broken QQ module shows as "not running".
        const qq = deps.qq ? await deps.qq().catch(() => null) : null;
        return {
            worldId: config.worldId, timeZone: config.timeZone, now: new Date().toISOString(), running: deps.running(), name: deps.names().companion,
            budget: { daily: deps.dailyBudget() ?? null, today: life?.spend ?? null },
            life: life ? { homeSessionId: life.homeSessionId, status: home ? home.status : 'cold', alarm: life.alarm, review: life.review, recentWakes: lifeStore?.wakes().slice(-5).reverse() ?? [] } : null,
            health: [...(life?.faults ?? []), ...deps.faults()],
            /**
             * 每轮请求的上下文构成（2026-10-28 加）。
             *
             * 为什么单独算这一块：主人一直以为「记忆 60 轮」就是她的记忆总量，
             * 其实那只是**短期衔接**——角色卡、世界提示词、工具表、记忆痕迹注入
             * 都在别处，加起来比历史大一倍。不摊开看就一直在错的量上调参。
             */
            context: (() => {
                const read = (f) => { try { return existsSync(f) ? readFileSync(f, 'utf8') : ''; } catch { return ''; } };
                const persona = read(deps.personaFile ?? '');
                const worldPromptRaw = read(deps.worldPromptFile ?? '');
                // 记忆痕迹是拼进世界提示词里的（<!-- MEMORY-TRACES:BEGIN -->…END）
                const traceMatch = /<!--\s*MEMORY-TRACES:BEGIN\s*-->([\s\S]*?)<!--\s*MEMORY-TRACES:END\s*-->/.exec(worldPromptRaw);
                const traceText = traceMatch?.[1] ?? '';
                const worldPrompt = traceMatch ? worldPromptRaw.replace(traceMatch[0], '') : worldPromptRaw;
                const historyText = renderHistory(turns, config.timeZone, deps.names(), archiveScope === 'home');
                // 工具表：会话里记着上一次请求的头，里面有 tools 和 route
                let toolsCount = null;
                let toolsTokens = null;
                let route = null;
                try {
                    const header = home?.session?.requestHeader?.();
                    if (header !== undefined && header !== null) {
                        if (Array.isArray(header.tools)) {
                            toolsCount = header.tools.length;
                            toolsTokens = estimateTokens(JSON.stringify(header.tools));
                        }
                        if (header.config) route = { provider: header.config.provider, model: header.config.model };
                    }
                } catch { /* 拿不到就不显示这一块 */ }
                const blocks = [
                    { key: 'persona', label: '角色卡', tokens: estimateTokens(persona), hint: 'QQ 插件里的人设卡，同步进 persona.md' },
                    { key: 'worldPrompt', label: '世界提示词', tokens: estimateTokens(worldPrompt), hint: '她怎么过日子：作息、分条、日记写法' },
                    { key: 'traces', label: '记忆痕迹注入', tokens: estimateTokens(traceText), hint: '和主人/群里的重要记忆，挑几条拼进提示词' },
                    { key: 'history', label: '对话历史（短期衔接）', tokens: estimateTokens(historyText), hint: `最近 ${turns.length} 轮，由「历史轮数」控制` },
                ];
                if (toolsTokens !== null) blocks.push({ key: 'tools', label: '工具表', tokens: toolsTokens, hint: `已注册 ${toolsCount} 个工具的定义` });
                const total = blocks.reduce((n, b) => n + b.tokens, 0);
                return { blocks, total, route, toolsCount };
            })(),
            memory: { turns: turns.length, windowTurns: window, archiveScope, selectedArchiveScope, restartRequired: archiveScope !== selectedArchiveScope, approxTokens: estimateTokens(renderHistory(turns, config.timeZone, deps.names(), archiveScope === 'home')), oldest: turns.at(-1)?.messages[0]?.occurredAt, ...archive.stats() },
            wechat: deps.wechat?.() ?? null,
            compactions: lifeStore?.compactions().slice(-5).reverse() ?? [],
            diaryDates: diary.dates(), activityDays: lifeStore?.activityDays() ?? [],
            qq: deps.qq ? qq : null,
            modules: deps.modules?.() ?? null,
        };
    }
    return {
        /**
         * 她的身体（2026-11-04）。
         *
         * 这里必须**显式转发**：`consoleSources(...)` 的返回值是一个白名单对象，
         * 调用方传进来的 deps.body 不写在这里就等于没传——表现是
         * `/console/body` 永远返回"没有接"，而配置明明是好的。
         */
        body: deps.body,
        snapshot() {
            if (cached && Date.now() - cached.at < SNAPSHOT_TTL_MS)
                return cached.value;
            const entry = { at: Date.now(), value: compute() };
            cached = entry;
            entry.value.catch(() => { if (cached === entry)
                cached = undefined; });
            return entry.value;
        },
        invalidate() { cached = undefined; },
        activity: (day, outsideOnly) => lifeStore?.activity(day).filter(record => !outsideOnly || record.outside).reverse() ?? [],
        diary: date => diary.read(date),
        letters: () => letters?.list() ?? [],
        letter: name => letters?.read(name),
        lettersDir: () => letters?.dir ?? '',
    };
}
