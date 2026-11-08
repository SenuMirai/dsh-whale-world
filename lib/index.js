import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { createBridge } from "./ecosystem/bridge/bridge.js";
import { bridgeRoute } from "./ecosystem/bridge/route.js";
import { consoleRoute } from "./console/routes.js";
import { consoleSources } from "./console/snapshot.js";
import { errorText, Faults } from "./faults.js";
import { hostLife } from "./life/host.js";
import { createLifeStore, durableWrite } from "./life/lifeStore.js";
import { toastSupported, windowsToast } from "./life/notify.js";
import { createLifeRuntime } from "./life/runtime.js";
import { createOutlet } from "./ecosystem/shared/outlets.js";
import { readPersona, readPersonaText, writePersona, writePersonaText } from "./persona.js";
import { createQqBridge, syncBridgeSessionMode } from "./ecosystem/qq/bridge.js";
import { createQqSupervisor } from "./ecosystem/qq/supervisor.js";
import { qqRoute } from "./ecosystem/qq/route.js";
import { createConsoleDoors } from "./ecosystem/qq/panel.js";
import { createWorldRuntime } from "./runtime.js";
import { createArchiveStore } from "./store.js";
import { DEFAULT_TEMPLATE_FILE, roomTitle, worldNames } from "./worldPrompt.js";
import { createWorldSwitch } from "./worldSwitch.js";
import { createRecallIndex, recall, renderRecallBlock, rememberTurn } from "./memoryRecall.js";
import { createMemoryHub } from "./memoryHub.js";
import { createDouyinBridge, createHerActionLog } from "./douyinBridge.js";
import { createBiliBridge } from "./biliBridge.js";
import { createFileLog, createStarKeyServer } from "./starkey/server.js";
import { createVtsClient } from "./body/vts.js";
import { createPetLauncher } from "./body/petWindow.js";
import { createReplyWaiter } from "./starkey/replies.js";
import { createMediaStore } from "./outbound/media.js";
import { createFileTokens, loadOrCreateSecret, secretFileIn } from "./outbound/fileToken.js";
import { fileUrl, mediaRoute } from "./outbound/fileRoute.js";
import { createWechatModule } from "./ecosystem/wechat/index.js";
import { createWechatRecorder } from "./ecosystem/wechat/archive.js";
import { createAdapterSupervisor } from "./ecosystem/wechat/supervisor.js";
import { createChannelSessions } from "./ecosystem/shared/sessions.js";
import { createArchiveSelection } from "./archiveSelection.js";
import { belongsToWorld, inRoom } from "./sourceArchive.js";
export { createWorldRuntime } from "./runtime.js";
export const name = 'dsh-world';
/** 一条 assistant 消息里真正说出口的文字（合成块、图片、工具调用都不算）。 */
function assistantText(content) {
    return (Array.isArray(content) ? content : [])
        .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join(' ')
        .trim();
}
export const inject = ['agents', 'sessions', 'sessionPersistence', 'llm'];
// One companion per profile is the usual case, so it works as installed: the standard preset, a world named
// default and the system time zone, with the life line on (it needs the desktop host's services and stays off without them).
const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export const Config = z.object({
    worldId: z.string().default('default'), agentPreset: z.string().default('standard'), timeZone: z.string().default(systemTimeZone),
    /** 抖音插件的数据目录（含 memory/shared.sqlite）。配了就开「观看记录→记忆」桥。 */
    douyinDbDir: z.string().default(''),
    /**
     * 抖音插件的状态目录（里面有 video-sessions.json）。
     *
     * 为什么需要它：那个插件自带一个 AI 会自己刷视频，观看记录里
     * 分辨不出是谁刷的。video-sessions.json 记着自主观看循环的起止时间，
     * 落在这段时间里的记录才判给「抖音入口那个 AI」，剩下的不写成她的记忆。
     * 没配就一条都不写（宁可少记，也不替她认领别人的经历）。
     */
    douyinStateDir: z.string().default(''),
    /**
     * B站 那个插件（「刷B站」）的活动账本。留空 = <DSH_HOME>/bili-fishman/ledger.sqlite。
     * 它的观看/评论记录由 biliBridge 读成世界记忆 —— 世界是记忆中心，
     * 那些插件只出手，不自己写日记也不自己存记忆。
     */
    biliDbPath: z.string().default(''),
    companionName: z.string(), partnerName: z.string(),
    archiveScope: z.union([z.const('home').description('仅家会话'), z.const('workspace').description('家所在工作区'), z.transform(z.const('world').hidden(), () => 'workspace').hidden()]).default('workspace').description('记忆归档范围，修改后重启生效'),
    life: z.boolean().default(true), diaryDir: z.string(),
    // 她写给主人的信落在这儿。默认是同级的 letters/，和 diary/ 一样一天一份可以很多封。
    lettersDir: z.string(),
    fallbackWakeTime: z.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).default('09:00'),
    selfFile: z.string(), worldPromptFile: z.string(), alarmTemplateFile: z.string(), personaFile: z.string(),
    // 她的房间放在哪。默认是世界目录下的 room/；填别的目录可以让「家」挂在别的工作区上，
    // 这样就能把已有的会话接过来当家（会话的 cwd 必须和这个目录一致）。
    roomDir: z.string(),
    // Where her words go outside DSH; no app is known by name (see README for the push body).
    outlets: z.array(z.object({ name: z.string().required(), url: z.string(), urlFile: z.string(), path: z.string(), kinds: z.array(z.union([z.const('reply'), z.const('busy'), z.const('reach')])) })).default([]),
    // A local app may hand her partner's words to her home through POST /dsh-world/bridge/say.
    bridge: z.boolean().default(false),
    /**
     * star-key 网关端口（0 = 关）。开了以后，任何愿意说 OpenAI 协议的本地程序
     * （桌宠就是）都能把对话交给她的家会话：话进家、她的回复包成 chat.completion 回去。
     * 只绑 127.0.0.1。需要同时开着 bridge。
     */
    starKeyPort: z.number().min(0).max(65535).default(0),
    /** 等她说一句的上限（毫秒）。要比桌宠那边的客户端超时（60 秒）短，否则它先断，回来就是「出错了」。 */
    starKeyTimeoutMs: z.number().min(5000).max(600_000).default(55_000),
    /**
     * 媒体库链接的有效期（小时）。平台从 /dsh-world/file/<令牌> 取她的图/文件；
     * 令牌带过期，删掉 <world>/file-token.key 重启即可一次作废全部旧链接。
     */
    mediaTokenTtlHours: z.number().min(1).max(24 * 365).default(168),
    /**
     * 她的身体：VTube Studio 的 API 端口（0 = 不接）。
     * 接上以后她能用 make_face / gesture / body_tilt 做表情和动作；
     * VTS 没开时那三个工具会 7ms 失败并返回一句人话，不影响任何别的功能。
     */
    vtsPort: z.number().min(0).max(65535).default(8001),
    /** 她平时更常用的表情（只影响工具描述里的一句提示）。 */
    preferredFace: z.string().default(''),
    wechat: z.boolean().default(false),
    wechatAdapter: z.object({ python: z.string(), config: z.string() }).description('随微信模块启动和停止 Windows 适配器；写上即视为允许它发送消息'),
    toast: z.boolean().default(true),
    // The console and the bridge answer only this machine by name, plus these (a LAN address or domain behind a proxy).
    allowedHosts: z.array(z.string()).default([]),
    // QQ: her home is reachable from outside DSH through a separate `qq-bridge` process. Empty qqBridgeDir leaves
    // this whole module off; the bridge is started by hand from the console unless qqBridgeAutoStart says otherwise.
    qqBridgeDir: z.string().default(''), qqBridgePort: z.number().default(3100), qqBridgeNode: z.string(),
    qqBridgeAutoStart: z.boolean().default(false),
    // 谁和谁共用一个会话。空着就不碰桥的 config.json（尊重人自己填的）；'owner' 让每个群各自一份会话、
    // 只有主人私聊用她的家会话——这是装上之后最想要的那个，人在插件配置里说一次就够了。
    qqBridgeBindHomeSession: z.union([z.const('owner').description('群各自独立，主人私聊用她的家会话'), z.const('all').description('所有入口都用她的家会话'), z.const('none').description('谁都不绑，每个入口各建一个'), z.const('')]).default(''),
});
/**
 * Her world runs only after her partner presses start in the world console, and stops when they press stop:
 * memory block, persona, world prompt, archive and life line come and go together. The switch is kept in
 * `<world>/world.json`, so it outlasts a restart.
 */
export async function apply(ctx, config) {
    const dshHome = resolveDshHome();
    const worldDir = join(dshHome, 'worlds', config.worldId);
    /**
     * 动态记忆召回（2026-11-02 加）
     *
     * 每轮按「他刚说的这句话」从 3882 条记忆里召回几条相关的，
     * 只给摘要 + id。要原文她自己按 id 去翻。
     *
     * 为什么需要它：原来的 47 条记忆块是按重要度排的固定名单，
     * 跟正在聊什么无关——她问「我们改过记忆系统吗」，那 47 条里没有，
     * 就答不上来。她自己说过这个感受：「得先想起来才能想起来」。
     *
     * 关键约束（都是别处踩过的坑）：
     *   · 命中 0 条时什么都不插——world 刻意"中间不插内容"以保 provider 缓存前缀，
     *     闲聊时插一堆无关记忆既费钱又打断节奏
     *   · 查询词必须跳过合成消息——注入的召回块本身也是 role=user，
     *     盲取最后一条会让下次查询词变成上次注入的块自己，形成自我循环
     *   · 幂等——热重载时旧的 agent/pre-step 监听可能没清掉，
     *     两个注入器会各插一条逐字相同的块
     */
    const recallIndex = createRecallIndex(worldDir);

    /**
     * 「她的房间」这个目录本身（2026-11-02 深夜加）。
     *
     * 为什么要多加一层判断：`belongsToWorld()` 只看 header.agentPreset 相等，
     * 而这台机器上主人有好几个会话跟家会话用同一个预设（无限制模式）。
     * 只靠预设判断，我在 C:\DSHwork 改代码的那个窗口也会被当成「她的会话」——
     * 今天那个窗口里就冒出过她的记忆块，白花 token，还容易被当成当前上下文。
     *
     * 所以家会话的记忆写入、动态召回，两条都再要求一件事：
     * 这个会话的 cwd 就在她的房间里。房间之外一律不写、不召回。
     * 判决依据是 header.cwd（宿主保证是绝对路径），不是猜。
     */
    const roomRoot = config.roomDir || join(worldDir, 'room');
    const inHerRoom = (session) => inRoom(session, roomRoot);

    /**
     * 家会话 → 记忆中枢（2026-11-02 加）
     *
     * 为什么需要这一段：
     *   她在 DSH 家会话里和主人聊天，那些话原来只进「会话记录」，
     *   不进「记忆痕迹」。所以她在家里说过的事，不会变成她记得的事。
     *
     *   如果没有外接平台（QQ/抖音/B站都关了），家会话就是唯一的窗口——
     *   那时这个缺口是致命的：她能和主人说话，但什么都不会记住。
     *
     * 怎么做的：
     *   监听 session/event 的 turn/end，攒一轮完整的对话，
     *   提炼成记忆写进 hub。提炼规则见 memoryRecall.js 的 distillTurn。
     *
     * 为什么不在每条消息上写：
     *   会产生海量碎片（一句话一条），而且多半是寒暄。
     *   一轮一提炼，信息密度高得多。
     */
    const memoryHub = createMemoryHub(worldDir);

    /*
     * 把中枢挂到宿主服务表上（M1 第一步，2026-11-03 00:52）。
     *
     * 为什么要有这一步：
     *   现在记忆的写入口有两个——世界这边用 memoryHub（read-modify-write 整份文件），
     *   QQ 插件那边用 memory-traces.ts 的 saveTraces（也整份写）。同一份文件两个写者，
     *   撞上就是「后写的赢，先写的那条消失」。
     *
     *   做法照 dsh-purge 的 `ctx.provide('redteam', store)`：谁提供、谁卸载时释放。
     *   消费者用 `ctx.get('memoryHub')` 拿，拿不到就退回自己那条老路，
     *   所以中枢没起来的时候她也不会哑。
     *
     * 现在已经没有消费者（QQ 侧接入是下一步，要重编那个插件）。
     * 这一步单独上线是安全的：只声明服务，不改任何现有行为。
     */
    try {
        ctx.provide('memoryHub', memoryHub);
        ctx.logger?.info?.('dsh-world: 记忆中枢已挂到 memoryHub 服务上');
    } catch (error) {
        // 已经被别人提供过 / 这个宿主不认 provide —— 都不该拦住她的世界起来
        ctx.logger?.warn?.('dsh-world: memoryHub 服务没挂上（不影响家会话）：', error);
    }

    /*
     * 抖音观看记录 → 记忆中枢（2026-11-03 加，2026-11-04 补归属）
     *
     * 第一版把每条观看记录都写成「看了《标题》」，一律当成她刷的。
     * 主人当场指出不对：那个插件自带的 AI 会自己刷，她根本没参与。
     * 所以现在先读抖音插件的 video-sessions.json 判归属，再决定写不写：
     *
     *   · 落在自主观看时段里 → 是那个 AI 看的：写进中枢，但 actor='douyin-plugin'，
     *     text 用第三人称，召回时会带〔抖音入口 AI 看的，不是你〕的标记
     *   · 落在外面的 → 没有证据说是她，不写记忆，只在活动流留一条记录
     *     （她自己刷了、自己说了，会由家会话的写入通道以她自己的话记下来）
     *
     * 没配 douyinDbDir 时静默跳过；配了 douyinDbDir 却没配 douyinStateDir 时
     * 判不出归属，只记活动不写记忆，并在日志里说一句，不让它悄悄失效。
     */
    if (config.douyinDbDir) {
        const douyinStateDir = config.douyinStateDir || '';
        if (!douyinStateDir) {
            ctx.logger?.warn?.('dsh-world: 没配 douyinStateDir，抖音观看记录判不出归属，只进活动流不进记忆');
        }
        /*
         * 2026-11-08：抖音插件自带的那个 AI 已经拆掉了。
         *
         * 以前要靠 video-sessions.json 区分「她刷的」和「那个 AI 刷的」；
         * 现在插件里没有第二个 AI 了，落进库里的观看记录只可能来自两个地方：
         *   · 她在自己会话里调 douyin_*（她的动作有记账，判给她）
         *   · 主人在那个窗口里自己点（判不出，就是判不出）
         * 所以在「那个 AI 的会话区间」这条判据失效以后，不能默认把它当成她 ——
         * 仍然只认她自己按过的那条线，其余照旧只进活动流。
         * 这一条不改行为，只是把注释和依据说清楚：没有第二个人替她刷了。
         */
        /*
         * 她自己的抖音动作记账（2026-11-04）。
         *
         * 只按「自主观看时段」分归属会把结论弄反：时段外那一条正是她亲手刷的，
         * 一律不写记忆，她真看过的就全落进了唯一不产生记忆的出口。
         * 所以这里在 tool/call 上记一笔她的动作，让桥能回答「这一次是不是她按的」。
         * 只认她的世界会话（预设相等 + cwd 在她房间），别的会话调抖音工具不算。
         */
        const herActions = createHerActionLog(worldDir);
        ctx.on('session/event', (session, event) => {
            try {
                if (!belongsToWorld(session, config) || !inHerRoom(session)) return;
                if (event?.type !== 'tool/call') return;
                herActions.add(Number(event.time) || Date.now(), String(event.data?.name ?? ''));
            } catch { /* 记账失败不影响任何事 */ }
        });
        const douyin = createDouyinBridge(memoryHub, worldDir, {
            dbPath: join(config.douyinDbDir, 'memory', 'shared.sqlite'),
            stateDir: douyinStateDir,
            herAction: (at) => herActions.has(at),
            logger: (m) => ctx.logger?.warn?.('dsh-world: ' + m),
            /** 抖音那个 AI 看的：记忆已经写了，这里补一条活动，让人一眼看得出主体。 */
            onSynced(rows) {
                for (const row of rows) {
                    try {
                        lifeStore?.appendActivity({
                            time: new Date(row.at ?? Date.now()).toISOString(),
                            sessionId: '',
                            callId: 'douyin-ai-' + row.rowId,
                            tool: 'douyin',
                            actor: 'douyin-plugin',
                            summary: '《' + String(row.title ?? '').slice(0, 120) + '》',
                            outside: true,
                            status: 'ok',
                        });
                    } catch { /* 活动流写不进去不影响记忆 */ }
                }
            },
            /** 她自己刷的：活动里按她的来，不跟那个 AI 的混。 */
            onSyncedMine(rows) {
                for (const row of rows) {
                    try {
                        lifeStore?.appendActivity({
                            time: new Date(row.at ?? Date.now()).toISOString(),
                            sessionId: '',
                            callId: 'douyin-mine-' + row.rowId,
                            tool: 'douyin',
                            actor: 'self',
                            summary: '《' + String(row.title ?? '').slice(0, 120) + '》',
                            outside: true,
                            status: 'ok',
                        });
                    } catch { /* 同上 */ }
                }
            },
            /** 判不出归属的那些：不写记忆，只让它在活动流里可查。 */
            onObserved(rows) {
                for (const row of rows) {
                    try {
                        lifeStore?.appendActivity({
                            time: new Date(row.at ?? Date.now()).toISOString(),
                            sessionId: '',
                            callId: 'douyin-seen-' + row.rowId,
                            tool: 'douyin',
                            actor: 'unattributed',
                            summary: String(row.text ?? '').slice(0, 160),
                            outside: true,
                            status: 'ok',
                        });
                    } catch { /* 同上 */ }
                }
            },
        });
        const douyinTimer = setInterval(() => {
            void douyin.syncOnce().then((r) => {
                if (r?.written > 0) ctx.logger?.info?.('dsh-world: 抖音观看记录已并入记忆 ' + r.written + ' 条（她自己的 ' + (r.mine ?? 0) + ' 条）');
            }).catch(() => {});
        }, 120_000);
        // 第一次先跑一遍，把存量补进来
        void douyin.syncOnce().then((r) => {
            if (r?.written > 0) ctx.logger?.info?.('dsh-world: 抖音存量观看记录已并入 ' + r.written + ' 条（她自己的 ' + (r.mine ?? 0) + ' 条）');
            if (r?.observed > 0) ctx.logger?.info?.('dsh-world: 抖音有 ' + r.observed + ' 条判不出归属，只记了活动');
        });
        ctx.effect(() => async () => clearInterval(douyinTimer), 'dsh-world douyin bridge');
        ctx.logger?.info?.('dsh-world: 抖音观看记录桥已启用（每 2 分钟读一次增量）');
    }

    /*
     * B站 → 世界记忆（2026-11-08 加）。
     *
     * 「刷B站」插件已经把自带的日记、信、记忆全拆了 —— 那些是世界的活。
     * 它只留活动账本；这里把账本读成记忆，她晚上写日记时就有素材。
     * 账本不存在就静默跳过（没装那个插件的人不该看到一条报错）。
     */
    if (memoryHub) {
        const biliDbPath = config.biliDbPath || join(dshHome, 'bili-fishman', 'ledger.sqlite');
        if (existsSync(biliDbPath)) {
            const bili = createBiliBridge(memoryHub, worldDir, {
                dbPath: biliDbPath,
                logger: (m) => ctx.logger?.warn?.('dsh-world: ' + m),
                /** 她的活动流也记一笔：世界控制台里能看出今天刷了什么。 */
                onSynced(rows) {
                    for (const row of rows) {
                        try {
                            lifeStore?.appendActivity({
                                time: new Date(row.at ?? Date.now()).toISOString(),
                                sessionId: '',
                                callId: 'bili-' + row.rowId,
                                tool: 'bilibili',
                                actor: 'self',
                                summary: '《' + String(row.title ?? '').slice(0, 120) + '》',
                                outside: true,
                                status: 'ok',
                            });
                        }
                        catch { /* 活动流写不进去不影响记忆 */ }
                    }
                },
            });
            const biliTimer = setInterval(() => {
                void bili.syncOnce();
            }, 120_000);
            void bili.syncOnce().then((r) => {
                if (r?.written > 0) ctx.logger?.info?.('dsh-world: B站活动已并入记忆 ' + r.written + ' 条');
            });
            ctx.effect(() => async () => clearInterval(biliTimer), 'dsh-world bili bridge');
            ctx.logger?.info?.('dsh-world: B站活动桥已启用（每 2 分钟读一次增量）');
        }
    }

    const pendingTurn = new Map();   // session.id → { user, reply }

    /*
     * 「在她的房间里，但预设对不上」是这条链唯一会静默死掉的方式。
     * 2026-11-08 就是这么断的：会话头写的是 wish，而这里 config.agentPreset
     * 漏写、取了默认值 standard，于是家会话一条记忆都没写过，
     * 星图里 source=world 永远是 0 —— 六天没人发现。
     * 现在这种情况会在 <world>/记忆写入状态.log 留一行，能一眼看见。
     */
    const warnedPreset = new Set();
    const noteIdentitySkip = (session) => {
        try {
            const sid = String(session?.id ?? '');
            if (sid === '' || warnedPreset.has(sid)) return;
            const roomRoot = config.roomDir || join(worldDir, 'room');
            if (!inRoom(session, roomRoot)) return;   // 不在她房间的会话本来就该跳过，不用记
            warnedPreset.add(sid);
            appendFileSync(join(worldDir, '记忆写入状态.log'), JSON.stringify({
                at: new Date().toISOString(),
                session: sid,
                headerPreset: session?.header?.agentPreset ?? null,
                configPreset: config.agentPreset ?? null,
                message: '会话在她的房间里，但预设对不上：家会话记忆不会写入',
            }) + '\n', 'utf8');
        } catch { /* 诊断失败不影响任何事 */ }
    };

    if (config.dynamicRecall !== false) {
        ctx.on('session/event', (session, event) => {
            try {
                // 只处理她的世界会话，而且必须在她房间里（见上面 inHerRoom 的说明）
                if (!belongsToWorld(session, config) || !inHerRoom(session)) {
                    noteIdentitySkip(session);
                    return;
                }
                const sid = session?.id;
                if (typeof sid !== 'string' || sid === '') return;

                /*
                 * 两个事件的形状不一样，2026-11-03 00:20 实测（解压她的会话日志看的）：
                 *
                 *   user/message      的 data 就是那条消息本身：{content, source, role, id}
                 *                     —— 没有 data.message 这一层
                 *   assistant/message 的 data 是 {turn, step, message, usage, stream}
                 *                     —— 正文在 data.message.content
                 *
                 * 原来两处都按 data.message.content 取，于是主人说的话永远是空字符串，
                 * 「一轮结束就提炼」从来没触发过一次（source: world 一直是 0 的原因就在这里）。
                 */
                const textOf = (content) => (Array.isArray(content) ? content : [])
                    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
                    .map((b) => b.text)
                    .join(' ')
                    .trim();

                // 记下主人说了什么（合成消息——召回块、runtime-context——不算）
                if (event.type === 'user/message' && event.data?.source?.kind === 'user') {
                    const text = textOf(event.data?.content);
                    if (text !== '') {
                        const prev = pendingTurn.get(sid) ?? {};
                        pendingTurn.set(sid, { ...prev, user: text });
                    }
                    return;
                }

                // 记下她回了什么
                if (event.type === 'assistant/message') {
                    const text = textOf(event.data?.message?.content);
                    if (text !== '') {
                        const prev = pendingTurn.get(sid) ?? {};
                        pendingTurn.set(sid, { ...prev, reply: text });
                    }
                    return;
                }

                // 一轮结束 → 提炼并写入
                if (event.type === 'turn/end') {
                    const turn = pendingTurn.get(sid);
                    pendingTurn.delete(sid);
                    if (!turn || typeof turn.user !== 'string') return;
                    const written = rememberTurn(memoryHub, turn.user, turn.reply ?? '', 'home');
                    if (written !== null) {
                        ctx.logger?.debug?.(
                            'dsh-world: 家会话记忆已写入 ' + written.id + (written.merged ? '（并入旧条目）' : ''),
                        );
                    }
                }
            } catch (error) {
                ctx.logger?.warn?.('dsh-world: 家会话记忆写入失败：', error);
            }
        }, 'dsh-world: home memory writer');
        ctx.logger?.info?.('dsh-world: 家会话记忆写入已启用');
    }

    const RECALL_TOP_K = 5;
    const RECALL_ENABLED = config.dynamicRecall !== false;

    /** 从这一步的消息里挑出「人说的话」。 */
    const pickQueryText = (messages) => {
        for (let i = messages.length - 1; i >= 0; i -= 1) {
            const m = messages[i];
            if (!m || m.role !== 'user') continue;
            const kind = m.source?.kind;
            // 跳过所有合成消息：recall / runtime / skill-catalog / file-notice……
            // 只有 kind 为空或 'user' 才算真人说的（部分老宿主不带 source）
            if (kind !== undefined && kind !== null && kind !== '' && kind !== 'user') continue;
            const text = (m.content ?? [])
                .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
                .map((b) => b.text)
                .join(' ')
                .trim();
            if (text !== '') return text;
        }
        return '';
    };

    /** 这一步里是不是已经有一条完全相同的召回块。 */
    const hasRecallBlock = (messages, text) => {
        for (const m of messages) {
            if (!m || m.role !== 'user') continue;
            for (const b of m.content ?? []) {
                if (b && b.type === 'text' && b.text === text) return true;
            }
        }
        return false;
    };

    if (RECALL_ENABLED) {
        ctx.on('agent/pre-step', async (input, next) => {
            const decision = await next();
            // 被拒绝的步骤原样放过，绝不重建
            if (!decision || decision.kind === 'reject' || input?.signal?.aborted) return decision;

            /**
             * 只对她的世界会话召回——预设相等 + 会话在她房间里，两条都要。
             *
             * 这一段是 2026-11-02 深夜补的：原来这个钩子没有任何归属判断，
             * 于是这台机器上**任何一个**会话都会被她注入记忆块——
             * 我今天改代码那个窗口里就冒出来过「主人中途余额不小心用完了」。
             * 那是白花的 token，更麻烦的是她自己会把无关的旧事当成当前上下文。
             *
             * 预设这一条跟 runtime.js 的记忆注入、promptSection.js 的世界提示词
             * 用的是同一条标准（belongsToWorld）；
             * 房间这一条是本插件自己的补充，因为同一个预设不止她一个会话在用。
             */
            const session = input?.agent?.session;
            if (!session || !belongsToWorld(session, config) || !inHerRoom(session)) return decision;

            try {
                const query = pickQueryText(decision.messages ?? []);
                if (query === '') return decision;

                const hits = recall(recallIndex, query, Date.now(), { topK: RECALL_TOP_K });
                if (hits.length === 0) return decision;   // 没命中就不插，保缓存

                const text = renderRecallBlock(hits);
                if (text === '') return decision;
                if (hasRecallBlock(decision.messages ?? [], text)) return decision;   // 幂等

                /**
                 * 用宿主的 createUserMessage 造这条消息，不手工拼对象。
                 *
                 * 2026-11-02 踩过两次：
                 *   第一次：完全没带 id → 会话文件写坏（三条坏事件
                 *            seq 100962 / 101100 / 101172），表现是
                 *            「会话加载失败 + 无法新建会话」
                 *   第二次：手工补 id: randomUUID() → 能跑，但那是模仿
                 *
                 * 正规做法就是 world 自己 runtime.js 用的那个：
                 * createUserMessage 内部会补 id、会 deepFreeze，
                 * 宿主以后加字段也能跟上。
                 */
                return {
                    ...decision,
                    messages: [
                        ...decision.messages,
                        createUserMessage({
                            content: [{ type: 'text', text }],
                            source: { kind: 'recall', form: 'recall' },
                        }),
                    ],
                };
            } catch (error) {
                // 召回失败不该让这一轮走不下去
                ctx.logger?.warn?.('dsh-world: 记忆召回失败，本轮跳过：', error);
                return decision;
            }
        }, 'dsh-world: dynamic recall');
        ctx.logger?.info?.('dsh-world: 动态记忆召回已启用（每轮最多 ' + RECALL_TOP_K + ' 条）');
    }

    const store = createArchiveStore({ ...config, root: dshHome });
    const power = createWorldSwitch(worldDir, config.archiveScope ?? 'workspace');
    const memoryConfig = { ...config, archiveScope: power.archiveScope() };
    const faults = new Faults();
    // Her self-description lives in her room whether or not the life line runs; she writes it with her file tools.
    const selfFile = config.selfFile || join(worldDir, 'room', '我是谁.md');
    const personaFile = config.personaFile || join(worldDir, 'persona.md');
    const worldPromptFile = config.worldPromptFile || join(worldDir, 'world-prompt.md');
    const options = { worldDir, roomDir: config.roomDir || join(worldDir, 'room'), diaryDir: config.diaryDir || join(worldDir, 'diary'), lettersDir: config.lettersDir || join(worldDir, 'letters'), selfFile, fallbackWakeTime: config.fallbackWakeTime, timeZone: config.timeZone, alarmFile: config.alarmTemplateFile || join(worldDir, 'alarm.md') };
    // 人设改成整段纯文本之后没有「名字」这一层了，名字只来自配置。
    const names = () => worldNames(config);
    const lifeStore = (() => {
        if (!config.life)
            return undefined;
        try {
            const current = createLifeStore(worldDir, config.timeZone);
            current.read();
            return current;
        }
        catch (error) {
            faults.set('life', `生活线没能启动：${errorText(error)}`);
            ctx.logger.error(error);
            return undefined;
        }
    })();
    const storedHome = () => lifeStore?.read().homeSessionId;
    let isHome = id => id === storedHome();
    const includesSession = createArchiveSelection(ctx, power.archiveScope(), id => isHome(id), options.roomDir);
    let memory;
    let stopLifeLine;
    async function startMemory(fresh) {
        if (memory)
            return;
        const prompt = { file: worldPromptFile, persona: personaFile, conversationsDir: join(worldDir, 'conversations'), names: names(), ...(config.life ? { life: options } : {}) };
        memory = createWorldRuntime(ctx, { ...memoryConfig, selfFile }, store, { prompt, isHome: id => isHome(id), archiveSession: includesSession, room: options.roomDir }, power.memoryTurns);
        await memory.start({ fresh });
    }
    async function stopMemory() {
        const running = memory;
        memory = undefined;
        await running?.stop();
    }
    ctx.effect(() => async () => {
        try {
            await stopLifeLine?.();
        }
        finally {
            await stopMemory().finally(() => store.close());
        }
    }, 'dsh-world memory line');
    if (power.running())
        await startMemory(false);
    // The host's workspace service may come up after this plugin; what the first catch-up could not place is read then.
    ctx.inject(['workspaceRegistry'], injected => { void memory?.retryCatchUp().catch(error => injected.logger.error(error)); });
    // The console and the life line need the desktop host.
    ctx.inject(['sessionController', 'permissionPresets', 'webServer'], async (lifeCtx) => {
        const webServer = lifeCtx.webServer;
        const host = hostLife(lifeCtx);
        // QQ: one more door into her home, managed here rather than by a launcher script. The endpoint is aligned
        // on every start whether or not the bridge runs — DSH picks a new port each restart, and a stale baseUrl
        // looks exactly like a dead bridge (a dead event stream, no error, for hours). The console switch starts
        // and stops this management at any time; it does not stop a bridge that is already running.
        let qq;
        let qqSupervisor;
        let unregisterQq;
        function startQq() {
            if (qq || !config.qqBridgeDir || !power.qqEnabled())
                return;
            const service = createQqBridge({ dir: config.qqBridgeDir, port: config.qqBridgePort, nodePath: config.qqBridgeNode || process.execPath, origin: () => host.origin(), logger: lifeCtx.logger });
            qq = service;
            // 会话绑定先写：桥是启动时才读 config.json 的，这条必须在 ensureRunning/syncEndpoint 之前。
            syncBridgeSessionMode(config.qqBridgeDir, config.qqBridgeBindHomeSession, lifeCtx.logger);
            // 两个控制台的门：qq-bridge 的令牌是文件，SnowLuma 的会话令牌得用面板密码现换。
            const doors = createConsoleDoors({ worldDir, bridgeDir: config.qqBridgeDir, port: config.qqBridgePort });
            unregisterQq = webServer.register(qqRoute(service, config.allowedHosts, doors));
            void (config.qqBridgeAutoStart ? service.ensureRunning() : service.syncEndpoint()).catch(error => lifeCtx.logger.warn(error));
            // QQ 巡检：桥是独立进程，崩了、被结束、连不上 DSH 都不会有人知道——上一版只有启动时那一次
            // ensureRunning，之后再无人过问。2026-10-26 那条链路死了四个小时，就是这么来的。
            // 这里只负责「什么时候该拉」，怎么拉仍然是 bridge.ts 的事。
            qqSupervisor = createQqSupervisor({ dir: config.qqBridgeDir, port: config.qqBridgePort, bridge: service, logger: lifeCtx.logger });
            qqSupervisor.start();
        }
        function stopQq() {
            qqSupervisor?.stop();
            qqSupervisor = undefined;
            unregisterQq?.();
            unregisterQq = undefined;
            qq = undefined;
        }
        startQq();
        lifeCtx.effect(() => () => stopQq(), 'dsh-world qq');
        let life;
        let bridge;
        /** star-key 网关（桌宠那条对话链路）与它的等待队列 */
        let starKey;
        let starKeyWaiter;
        let starKeyOff;
        /** 媒体库与文件令牌（阶段 1）；后面接平台适配器时从这里取 URL */
        let mediaKit;
        /**
         * 她的身体：VTS 客户端。**构造时不连接**——只有她真的调工具时才连，
         * 所以 VTS 平时不开也不会有任何后台连接或报错。
         */
        let vtsClient;
        // 2026-11-04：启动时把关键配置打一行，排查"配置写了没生效"时不用猜
        ctx.logger?.info?.('dsh-world: 身体配置 vtsPort=' + String(config.vtsPort) + ' preferredFace=' + JSON.stringify(config.preferredFace ?? ''));
        if (config.vtsPort > 0) {
            vtsClient = createVtsClient({
                port: config.vtsPort,
                token: (() => { try { return readFileSync(join(worldDir, 'vts-token.txt'), 'utf8').trim(); } catch { return ''; } })(),
                onToken: (token) => { try { durableWrite(join(worldDir, 'vts-token.txt'), token + '\n'); } catch { /* 存不下就下次重新授权 */ } },
                pluginName: 'StarKeyBridge',
                pluginDeveloper: 'StarKey',
            });
        }
        // 透明窗启动器：设置页一个按钮，宿主进程 spawn Electron（避开 bash 会话的 RUN_AS_NODE 毒）
        const petWindow = createPetLauncher({
            appDir: 'C:/DSHwork/plugins-src/star-key-pet',
            mainCjs: 'main.cjs',
            logger: (m) => ctx.logger?.info?.(m),
        });
        let wechat;
        let adapter;
        let channels;
        let unregisterWechat;
        let lifeStop;
        let wechatClosing = Promise.resolve();
        /** Starts the WeChat module (its tools, route and, when configured, the adapter) against the running life line. */
        async function startWechat(current) {
            if (wechat || !config.wechat)
                return;
            await wechatClosing;
            const groupSessions = createChannelSessions({ ctx: lifeCtx, host, store, roomDir: options.roomDir, roomTitle: roomTitle(names()), agentPreset: config.agentPreset });
            channels = groupSessions;
            wechat = createWechatModule({ ctx: lifeCtx, worldId: config.worldId, acceptAgent: agent => belongsToWorld(agent.session, config), home: identity => identity.conversationType === 'group' ? groupSessions.open(identity) : current.home(), origin: () => host.origin(), file: join(worldDir, 'wechat.json'), incomingDir: join(worldDir, 'wechat-incoming'), allowedHosts: config.allowedHosts, settings: () => ({ contextMessages: power.wechatContext(), bufferSeconds: power.wechatBufferSeconds() }),
                ...createWechatRecorder(store, config.worldId, includesSession) });
            wechat.start();
            unregisterWechat = webServer.register(wechat.route);
            if (config.wechatAdapter?.python && config.wechatAdapter.config) {
                adapter = createAdapterSupervisor({ python: config.wechatAdapter.python, config: config.wechatAdapter.config, logFile: join(worldDir, 'wechat-adapter.log'), log: message => lifeCtx.logger.warn(message) });
                adapter.start();
            }
        }
        /** Takes the WeChat tools, route and adapter down; the adapter goes first because it exits when the module's connection file disappears. */
        function stopWechat() {
            unregisterWechat?.();
            unregisterWechat = undefined;
            const closingAdapter = adapter?.stop();
            adapter = undefined;
            const closing = Promise.all([closingAdapter, wechat?.stop()]).then(() => { });
            wechat = undefined;
            channels?.stop();
            channels = undefined;
            return wechatClosing = closing;
        }
        async function startLife(resumed) {
            if (!lifeStore || life)
                return;
            try {
                await lifeStop;
                const outlets = config.outlets.map(outlet => createOutlet(outlet, () => host.origin()));
                const notifier = { ...(config.toast && toastSupported() ? { toast: windowsToast() } : {}), outlets };
                const current = createLifeRuntime({ ctx: lifeCtx, config: { ...config, companionName: names().companion }, options, store: lifeStore, host, notifier, dailyBudget: power.dailyBudget, memoryHub, ...(vtsClient ? { vtsClient, preferredFace: config.preferredFace } : {}) });
                life = current;
                isHome = current.isHome;
                if (config.bridge) {
                    bridge = createBridge({ ctx: lifeCtx, home: () => current.home(), outlets, origin: () => host.origin(), file: join(worldDir, 'bridge.json'), name: names().companion, 
                        /**
                         * 语音合成：交给 QQ 插件那套（GPT-SoVITS 七音色 + 情绪）。
                         *
                         * 为什么不在这里做：她说话的声音只有一套，配在 QQ 插件里。
                         * 世界只负责「让谁来说」，不重复维护一份音色表。
                         * 失败就返回 undefined —— 桥那边会退回纯文字，不影响投递。
                         */
                        synthesize: async (text) => {
                            try {
                                const base = (host.origin() ?? '').replace(/\/$/, '');
                                if (base === '') return undefined;
                                const response = await fetch(`${base}/dsh-qq-group/tts`, {
                                    method: 'POST',
                                    headers: { 'content-type': 'application/json' },
                                    body: JSON.stringify({ text }),
                                    signal: AbortSignal.timeout(60_000),
                                });
                                if (!response.ok) return undefined;
                                const body = await response.json();
                                if (body?.ok !== true || typeof body.audio !== 'string') return undefined;
                                return { data: body.audio, mime: typeof body.mime === 'string' ? body.mime : 'audio/wav' };
                            }
                            catch {
                                return undefined;
                            }
                        } });
                    bridge.start();
                    /*
                     * star-key 网关（2026-11-03 夜）：把「说话」这件事交回她本人。
                     *
                     * 桌宠那边的对话入口是 ctx.llm.stream()，而 DSH 的 LLM 层认 OpenAI 兼容路由。
                     * 这边开一个小服务说 OpenAI 的话，桌宠把 chatModel 指过来就行——
                     * 不用改桌宠一行代码，也不用重新构建它。
                     *
                     * 话从她家走：bridge.say()，和主人自己打字进来是同一条路。
                     * 她的第一段可见正文包成 OpenAI 响应回去，桌宠用气泡和语音说出来。
                     */
                    if (config.starKeyPort > 0) {
                        starKeyWaiter = createReplyWaiter({ timeoutMs: config.starKeyTimeoutMs });
                        /*
                         * 2026-11-03 夜：这条链路一开始静默失败——桌宠还是用自带人格回话，
                         * 家里一条新消息都没有，而 DSH 的 console 我这边看不到。
                         * 所以它自己往 <world>/starkey.log 记证据：DSH 里到底认不认 star-key
                         * 这个 provider、请求有没有进来、有没有卡在 say 或等回复上。
                         */
                        const starKeyTrace = createFileLog(join(worldDir, 'starkey.log'));
                        try {
                            const listed = ctx.llm?.listProviders?.() ?? [];
                            starKeyTrace('boot', {
                                providers: listed.map((p) => p?.id ?? String(p)),
                                hasStarKey: listed.some((p) => (p?.id ?? p) === 'star-key'),
                                speechToText: ctx.get?.('speechToText', false) !== undefined,
                                port: config.starKeyPort,
                            });
                        }
                        catch (error) {
                            starKeyTrace('boot-failed', { message: String(error?.message ?? error) });
                        }
                        starKey = createStarKeyServer({
                            trace: starKeyTrace,
                            say: (text, images, ticket) => bridge.say(text, images, ticket),
                            wait: (ticket, ms) => starKeyWaiter.wait(ticket, ms),
                            logger: (m) => lifeCtx.logger?.info?.(m),
                            homeName: names().companion,
                            timeoutMs: config.starKeyTimeoutMs,
                        });
                        /**
                         * 她在自己房间说的正文 → 交给等待队列。
                         * 只认她房间里的会话，和世界提示词/写记忆用的是同一条归属标准。
                         */
                        starKeyOff = ctx.on('session/event', (session, event) => {
                            if (event?.type !== 'assistant/message')
                                return;
                            if (!belongsToWorld(session, config) || !inHerRoom(session))
                                return;
                            const text = assistantText(event.data?.message?.content);
                            if (text !== '')
                                starKeyWaiter.note(text);
                        });
                        try {
                            await starKey.start(config.starKeyPort);
                            faults.clear('starkey');
                        }
                        catch (error) {
                            faults.set('starkey', `star-key 网关没起来（端口 ${config.starKeyPort}）：${errorText(error)}`);
                            lifeCtx.logger.error(error);
                        }
                    }
                }
                if (config.wechat && power.wechatEnabled())
                    await startWechat(current);
                faults.clear('life');
                await current.start({ resumed });
            }
            catch (error) {
                // The console still opens and says why, instead of looking as if the life line were simply off.
                await stopLife();
                faults.set('life', `生活线没能启动：${errorText(error)}`);
                lifeCtx.logger.error(error);
            }
        }
        function stopLife() {
            isHome = id => id === storedHome();
            try {
                starKeyOff?.();
            }
            catch { /* 卸载顺序不保证，失败就算了 */ }
            starKeyOff = undefined;
            void starKey?.stop();
            starKey = undefined;
            starKeyWaiter?.close();
            starKeyWaiter = undefined;
            bridge?.stop();
            life?.stop();
            const closingWechat = stopWechat();
            bridge = undefined;
            life = undefined;
            return lifeStop = Promise.all([lifeStop, closingWechat]).then(() => { });
        }
        stopLifeLine = stopLife;
        lifeCtx.effect(() => () => stopLife(), 'dsh-world life line');
        // The host matches exact routes before the longest prefix, so this path never reaches the console.
        if (config.bridge)
            lifeCtx.effect(() => webServer.register(bridgeRoute(() => bridge, config.allowedHosts)), 'dsh-world bridge route');
        // Her album lives in her room, so the console shows it whether or not the life line is running.
        const sources = consoleSources({ ctx: lifeCtx, config: memoryConfig, archive: store, names, personaFile, worldPromptFile, ...(lifeStore ? { lifeStore } : {}), life: () => life, diaryDir: options.diaryDir, lettersDir: options.lettersDir, running: power.running, dailyBudget: power.dailyBudget, memoryTurns: power.memoryTurns, selectedArchiveScope: power.selectedArchiveScope, wechat: () => wechat ? { ...wechat.status(), adapter: adapter?.status() ?? null } : undefined, includesSession, ...(config.qqBridgeDir ? { qq: async () => qq ? { ...(await qq.status()), ...(qqSupervisor ? { supervisor: qqSupervisor.snapshot() } : {}) } : null } : {}),
            modules: () => ({ wechat: { available: config.wechat, enabled: power.wechatEnabled(), running: wechat !== undefined }, qq: { available: Boolean(config.qqBridgeDir), enabled: power.qqEnabled(), running: qq !== undefined } }),
            /*
             * 她的身体：给设置页看的实时状态。
             *
             * 每次调用**真去连一次 VTS**（连完就断），因为"它开着没"只有问它才知道。
             * 连不上不是错误：返回 connected:false + 人话原因，设置页显示"VTS 没开"。
             */
            body: vtsClient === undefined ? undefined : async () => {
                try {
                    /*
                     * 用 probe 而不是 connect：**绝不申请新 token**。
                     *
                     * 2026-11-04 踩过：设置页读一次状态，结果走到"申请新 token"，
                     * VTS 弹窗等一个没人点的确认，接口挂住 40 秒以上，
                     * 界面永远停在"读取中"。
                     * 读状态只该做"连上 + 拿现有 token 认证"，2.5 秒连不上就如实报。
                     */
                    await vtsClient.probe();
                    const model = await vtsClient.currentModel();
                    const [faces, hotkeys] = await Promise.all([vtsClient.expressions(), vtsClient.hotkeys()]);
                    return {
                        connected: true,
                        port: config.vtsPort,
                        model: model.name,
                        loaded: model.loaded,
                        faces: faces.map((f) => f.name).filter(Boolean),
                        activeFaces: faces.filter((f) => f.active).map((f) => f.name),
                        gestures: hotkeys.filter((h) => h.type === 'TriggerAnimation').map((h) => h.name),
                        hotkeyCount: hotkeys.length,
                    };
                } catch (error) {
                    const code = error?.code ?? '';
                    let reason;
                    if (code === 'vts/no-token') reason = '还没授权过：第一次要在 VTS 弹出的窗口里点一次「允许」（可以让她做个表情来触发）';
                    else if (code === 'vts/denied') reason = 'VTS 说这个 token 无效了——可能是它重装过或撤消过授权，需要重新允许一次';
                    else if (code === 'vts/51') reason = 'VTS 正在等授权：它弹了一个窗口，得有人在电脑前点「允许」';
                    else if (code === 'vts/timeout') reason = 'VTS 连上了但没回话（可能卡在授权弹窗上）';
                    else reason = 'VTS 没开（VTube Studio 没启动，或者它的 API 没打开）';
                    return { connected: false, port: config.vtsPort, reason, code };
                } finally {
                    try {
                        vtsClient.close();
                    } catch { /* 关不掉也没什么可做的 */ }
                }
            }, faults: () => [...faults.list(), ...(memory?.faults() ?? []), ...(bridge?.faults() ?? []), ...(qq?.faults() ?? [])] });
        const actions = {
            async startPet() {
                return petWindow.start();
            },
            async start() {
                if (power.running())
                    return;
                power.set(true);
                try {
                    await startMemory(true);
                    await startLife(true);
                }
                finally {
                    sources.invalidate();
                }
            },
            async stop() {
                if (!power.running())
                    return;
                power.set(false);
                await stopLife();
                try {
                    await stopMemory();
                }
                finally {
                    sources.invalidate();
                }
            },
            prompts: () => ({
                // 人设现在是一整段原文；persona 保留旧的按层形状只为兼容老客户端
                persona: readPersona(personaFile),
                personaText: readPersonaText(personaFile),
                worldPrompt: existsSync(worldPromptFile) ? { text: readFileSync(worldPromptFile, 'utf8'), custom: true } : { text: readFileSync(DEFAULT_TEMPLATE_FILE, 'utf8'), custom: false },
            }),
            savePersona: persona => { writePersona(personaFile, { ...readPersona(personaFile), ...persona }); sources.invalidate(); },
            savePersonaText: text => { writePersonaText(personaFile, text); sources.invalidate(); },
            setDailyBudget: yuan => { power.setDailyBudget(yuan); sources.invalidate(); },
            setMemoryTurns: turns => { power.setMemoryTurns(turns); sources.invalidate(); },
            async setModules(patch) {
                if (patch.wechat !== undefined && !config.wechat)
                    return '没有配置微信模块（配置里 wechat: true）';
                if (patch.qq !== undefined && !config.qqBridgeDir)
                    return '没有配置 QQ 桥目录（配置里 qqBridgeDir）';
                power.setModules(patch);
                try {
                    if (patch.wechat === false)
                        await stopWechat();
                    if (patch.wechat === true && life)
                        await startWechat(life);
                    if (patch.qq === false)
                        stopQq();
                    if (patch.qq === true)
                        startQq();
                }
                catch (error) {
                    faults.set('wechat', `微信模块没能切换：${errorText(error)}`);
                    lifeCtx.logger.error(error);
                    return `切换失败：${errorText(error)}`;
                }
                finally {
                    sources.invalidate();
                }
                faults.clear('wechat');
                return undefined;
            },
            restartWechatAdapter: async () => { if (!adapter)
                return false; try {
                await adapter.restart();
            }
            finally {
                sources.invalidate();
            } return true; },
            /** 房间工作区里能当家的会话清单（当前的排最前）。 */
            homes: async () => {
                if (!life)
                    return [];
                try {
                    return await life.homeCandidates();
                }
                catch (error) {
                    lifeCtx.logger.error(error);
                    return [];
                }
            },
            /** 把家换成另一个已有会话。 */
            switchHome: async (sessionId) => {
                if (!life)
                    throw new Error('世界还没开始，先按「开始」');
                const id = await life.switchHome(sessionId);
                sources.invalidate();
                return id;
            },
            setWechatSettings: next => { power.setWechat(next); sources.invalidate(); },
            setArchiveScope: scope => { power.setArchiveScope(scope); sources.invalidate(); return power.restartRequired(); },
            saveWorldPrompt: text => { if (text.trim())
                durableWrite(worldPromptFile, text);
            else
                rmSync(worldPromptFile, { force: true }); },
        };
        /*
         * 媒体库 + 文件端点（阶段 1 · 2026-11-04）
         *
         * 她截的图、要发的文件，得先能变成一个平台取得到的 URL —— 否则
         * "她发截图给我"永远是空话（world 以前只有 bridge/say、qq、wechat/ask 三个路由）。
         *
         * 路径是签过名的：`/<过期毫秒>.<base64url(相对路径)>.<HMAC 前 32 位>`，
         * 所以随手拼 `../memory-traces.json` 会被 403 挡掉；过期给 410。
         */
        let media;
        let fileTokens;
        try {
            media = createMediaStore(join(worldDir, 'media'));
            fileTokens = createFileTokens(loadOrCreateSecret(secretFileIn(worldDir)), { ttlMs: config.mediaTokenTtlHours * 3600_000 });
            faults.clear('media');
        }
        catch (error) {
            // 媒体库起不来只影响"发本地图/文件"，不影响她说话——所以记一笔就算了
            faults.set('media', `媒体库没起来（发不了本地图/文件）：${errorText(error)}`);
            lifeCtx.logger.error(error);
        }
        mediaKit = media !== undefined && fileTokens !== undefined ? {
            store: media,
            tokens: fileTokens,
            /** 相对路径 → 平台能取的绝对地址（origin 每次重启都可能变，所以现问） */
            urlFor: (rel) => fileUrl(host.origin(), fileTokens.issue(rel)),
            /** 本地文件一步到位：入库 → 给地址 */
            putLocalFile: (file, options) => {
                const put = media.putFile(file, options);
                if (put.ok !== true) return put;
                return { ...put, url: fileUrl(host.origin(), fileTokens.issue(put.rel)) };
            },
        } : undefined;
        if (media !== undefined && fileTokens !== undefined)
            lifeCtx.effect(() => webServer.register(mediaRoute(media, fileTokens, config.allowedHosts)), 'dsh-world media file route');
        lifeCtx.effect(() => webServer.register(consoleRoute(sources, actions, config.allowedHosts)), 'dsh-world console routes');
        if (power.running())
            await startLife(false);
    });
}