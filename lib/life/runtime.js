import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import "../hostContract.js";
import { errorText, Faults } from "../faults.js";
import { keepSelfCopy } from "../self.js";
import { formatLocalTime } from "../timeContext.js";
import { belongsToWorld, inRoom } from "../sourceArchive.js";
import { homeTitle, roomTitle, worldNames } from "../worldPrompt.js";
import { budgetText, cancelReply, greetingText, checkReply, earlyStopText, nextLocalTime, nextReview, planReply, resolveAlarmTime, reviewText, wakeText } from "./alarm.js";
import { summarizeSince } from "./activity.js";
import { createAlarmTimer, realTimers } from "./alarmTimer.js";
import { createEarlyStopWatch } from "./earlyStop.js";
import { createHome } from "./home.js";
import { createJournal } from "./journal.js";
import { stepCost } from "./pricing.js";
import { exampleTime, readAlarmMessages } from "./messages.js";
import { createToolRegistry } from "./toolRegistry.js";
import { createLetterStore } from "../letters.js";
import { alarmDescriptions, lifeTools } from "./tools.js";
import { memoryTools } from "../memoryTools.js";
import { bodyTools } from "../body/tools.js";
const withValue = (key, value) => (value === undefined ? {} : { [key]: value });
/**
 * Her life line: one pending alarm, kept in life.json and delivered into her home with `agent.steer`, the
 * tools she sets it with, the home itself, a new home's greeting and the evening look back. The parts live in
 * their own modules; this wires them.
 */
export function createLifeRuntime(deps) {
    const { ctx, config, options, store, host } = deps;
    const { timeZone } = options;
    const names = worldNames(config);
    /*
     * 她的信（2026-11-08 从「鱼与人」搬回世界）。
     * 写进 <world>/letters/，主人自己在世界设置里读 —— 插件只负责把字存下来。
     */
    const letters = options.lettersDir ? createLetterStore(options.lettersDir, { timeZone }) : undefined;
    const clock = deps.clock ?? (() => new Date());
    const faults = new Faults();
    const disposers = [];
    const state = store.read();
    let stopped = false;
    let delivery;
    /** Bookkeeping after the fact: a failure is a fault, never a broken turn. */
    function record(work) {
        try {
            work();
            faults.clear('state');
        }
        catch (error) {
            faults.set('state', `生活状态没能保存：${errorText(error)}`);
            ctx.logger.error(error);
        }
    }
    /** Her alarm wording, read when it is used; an unreadable template is a fault and the shipped one is used. */
    function alarmMessages() {
        const messages = readAlarmMessages(options.alarmFile);
        if (messages.error)
            faults.set('alarm-template', messages.error);
        else
            faults.clear('alarm-template');
        return messages;
    }
    const templateValues = () => ({ name: names.companion, partner: names.partner, homeTitle: homeTitle(names), timeZone, fallbackWakeTime: options.fallbackWakeTime, example: exampleTime(timeZone) });
    /**
     * What she actually did between setting this alarm and hearing it, in one line.
     *
     * Read from the activity log rather than from her own account of the time, so the alarm can contradict
     * her note: "歇着" plus forty tool calls is a different sentence from "歇着" plus none. Both days the
     * alarm could straddle are read, because a plan set at 23:50 and heard at 00:30 has its work split.
     */
    const didSince = (alarm, now) => {
        const dayOf = (at) => formatLocalTime(new Date(at), timeZone).slice(0, 10);
        const days = [...new Set([dayOf(alarm.setAt), dayOf(now)])];
        const records = days.flatMap(each => store.activity(each)).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
        return summarizeSince(records, alarm.setAt, now);
    };
    const say = (agent, text) => {
        agent.steer(createUserMessage({ source: { kind: 'dsh-world-life' }, content: [{ type: 'text', text }] }));
        return ctx.sessions.flush(agent.session);
    };
    function nextJob() {
        const { greeting, review, alarm } = state;
        if (greeting)
            return { kind: 'greeting', at: greeting.at, greeting };
        if (review && (!alarm || Date.parse(review.at) <= Date.parse(alarm.at)))
            return { kind: 'review', at: review.at, review };
        return alarm && { kind: 'alarm', at: alarm.at, alarm };
    }
    const timer = createAlarmTimer({ clock, timers: deps.timers ?? realTimers, dueAlarm: () => nextJob()?.at, fire: () => void deliver() });
    /**
     * 兜底闹钟排到什么时候。
     *
     * 2026-10-30 改：以前无论几点，兜底一律排到「明早 fallbackWakeTime」。
     * 结果她 11:30 醒来一次、没定计划，下一次就是第二天 —— 一天只有一次机会，
     * 想自己过日子也没地方过。白天改成 90 分钟后再看一次，跟心跳一样；
     * 晚上十一点以后才照旧睡到明早。
     */
    const DAY_HEARTBEAT_MINUTES = 90;
    function fallbackSchedule(now) {
        const hour = Number(formatLocalTime(now, timeZone).slice(11, 13));
        const awake = Number.isFinite(hour) && hour >= 8 && hour < 23;
        return awake
            ? { at: new Date(now.getTime() + DAY_HEARTBEAT_MINUTES * 60_000).toISOString(), source: 'daylight' }
            : { at: nextLocalTime(now, options.fallbackWakeTime, timeZone).toISOString(), source: 'fallback' };
    }
    const morning = (now) => ({ ...fallbackSchedule(now), note: '', setAt: now.toISOString() });
    /** A new alarm replaces a failing one, so its backoff and fault go with it. Saved or not, it is armed. */
    function setAlarm(alarm) {
        if (stopped)
            return;
        state.alarm = alarm;
        faults.clear('delivery', 'alarm');
        try {
            store.write(state);
        }
        catch (error) {
            faults.set('alarm', `闹钟没能保存：${errorText(error)}`);
            throw error;
        }
        finally {
            timer.reset();
        }
    }
    /** Nothing pending means resting until the next morning. Unsaved, it still rings while the app keeps running. */
    function fallbackAlarm() {
        if (state.alarm || state.greeting || stopped)
            return;
        try {
            setAlarm(morning(clock()));
        }
        catch (error) {
            faults.set('alarm', `断线保护闹钟没能保存：${errorText(error)}`);
            ctx.logger.error(error);
        }
    }
    function planNext(input, note) {
        if (stopped)
            throw new Error('生活线已停止');
        const now = clock();
        const at = resolveAlarmTime(input, now, timeZone);
        const replaced = state.alarm;
        setAlarm({ at: at.toISOString(), note: note.trim(), setAt: now.toISOString(), source: 'plan' });
        return planReply(at, replaced, timeZone);
    }
    const checkAlarm = () => checkReply(state.alarm, clock(), timeZone);
    /** Back to the morning fallback, exactly as if she had set nothing. */
    function cancelAlarm() {
        if (stopped)
            throw new Error('生活线已停止');
        const cancelled = state.alarm;
        if (cancelled?.source === 'plan')
            setAlarm(morning(clock()));
        else
            fallbackAlarm();
        return cancelReply(cancelled, state.alarm, timeZone);
    }
    // Delivery: one at a time; a failure backs off, and a newer alarm keeps its own time.
    function deliver() {
        const job = nextJob();
        if (stopped || !job)
            return delivery ?? Promise.resolve();
        return delivery ??= (job.kind === 'alarm' ? send(job.alarm) : job.kind === 'review' ? lookBack(job.review) : greet(job.greeting)).finally(() => { delivery = undefined; });
    }
    const wake = (source, scheduledAt, now) => ({ scheduledAt, deliveredAt: now.toISOString(), source, lateMs: Math.max(0, now.getTime() - Date.parse(scheduledAt)) });
    /**
     * A message of the plugin's own, taken off the schedule while it is sent and put back if it fails: it backs
     * off like an alarm, and its turn is never asked about as an early stop.
     */
    async function sayOwn(what, source, scheduledAt, take, putBack, text) {
        let now = clock();
        try {
            const agent = await home.open();
            if (stopped)
                return;
            take();
            now = clock();
            earlyStop.startsOwnTurn();
            await say(agent, text(now));
        }
        catch (error) {
            ctx.logger.error(error);
            if (stopped)
                return;
            earlyStop.ownTurnFailed();
            putBack();
            faults.set('delivery', `${what}没送到，${timer.failed()} 分钟后重试：${errorText(error)}`);
            return;
        }
        if (stopped)
            return;
        faults.clear('delivery', 'home');
        record(() => { store.write(state); store.appendWake(wake(source, scheduledAt, now)); });
        timer.reset();
    }
    /**
     * A new home's first words, so it has a turn (the host lists no session without one) and she knows she moved;
     * or the word that her world has started again.
     */
    const greet = (greeting) => sayOwn(greeting.kind === 'arrival' ? '新家的第一句话' : '重新开始的那句话', greeting.kind === 'arrival' ? 'first' : 'return', greeting.at, () => { delete state.greeting; }, () => { state.greeting ??= greeting; }, () => greetingText(greeting.kind, timeZone, options.fallbackWakeTime, alarmMessages(), templateValues()));
    /** The evening look back on her day; her 我是谁 is kept as it was, so she can rewrite it freely. */
    function lookBack(review) {
        let snapshot;
        const take = () => {
            try {
                snapshot = keepSelfCopy(options.selfFile, review.day);
                faults.clear('snapshot');
            }
            catch (error) {
                faults.set('snapshot', `我是谁没能留底：${errorText(error)}`);
                ctx.logger.error(error);
            }
            state.review = nextReview(clock(), timeZone);
        };
        const existing = (dir) => { const file = join(options.worldDir, dir, `${review.day}.jsonl`); return existsSync(file) ? file : undefined; };
        return sayOwn('每日回顾', 'review', review.at, take, () => { state.review = review; }, now => reviewText(review, now, {
            ...withValue('conversations', existing('conversations')), ...withValue('activity', existing('activity')), ...withValue('snapshot', snapshot),
            diaryDir: options.diaryDir, selfFile: options.selfFile,
        }, timeZone, options.fallbackWakeTime, alarmMessages(), templateValues()));
    }
    async function send(alarm) {
        let now = clock();
        try {
            // Resolve (or rebuild) the home first: a rebuilt home must still see this alarm as pending.
            const agent = await home.open();
            if (stopped)
                return;
            if (state.alarm !== alarm) {
                timer.arm();
                return;
            }
            // Cleared before steering, so a turn that ends quickly already sees "no alarm" and gets the fallback.
            delete state.alarm;
            now = clock();
            await say(agent, wakeText(alarm, now, timeZone, options.fallbackWakeTime, alarmMessages(), { ...templateValues(), did: alarm.source === 'fallback' ? '' : didSince(alarm, now) }));
        }
        catch (error) {
            ctx.logger.error(error);
            if (stopped)
                return;
            if (state.alarm && state.alarm !== alarm) {
                faults.set('delivery', `闹钟送达失败：${errorText(error)}`);
                timer.arm();
                return;
            }
            state.alarm = alarm;
            faults.set('delivery', `闹钟送达失败，${timer.failed()} 分钟后重试：${errorText(error)}`);
            return;
        }
        if (stopped)
            return;
        // Steered and durable: the alarm is delivered. Recording it may fail, but it is never sent again.
        faults.clear('delivery', 'home');
        record(() => {
            store.write(state);
            store.appendWake({ scheduledAt: alarm.at, deliveredAt: now.toISOString(), source: alarm.source, lateMs: Math.max(0, now.getTime() - Date.parse(alarm.at)) });
        });
        timer.reset();
    }
    // Stopping early: asked once per alarm whether she is done.
    const earlyStop = createEarlyStopWatch();
    function askIfDoneEarly(completed) {
        const now = clock();
        const alarm = state.alarm;
        if (!earlyStop.turnEnded(completed, alarm, now) || stopped)
            return;
        alarm.nudged = true;
        record(() => store.write(state));
        earlyStop.startsOwnTurn();
        const text = earlyStopText(alarm, now, timeZone, alarmMessages(), templateValues());
        void home.open().then(agent => stopped ? undefined : say(agent, text)).catch(error => { earlyStop.ownTurnFailed(); ctx.logger.error(error); });
    }
    // What her home spends: each model step priced as it lands; past the daily budget she is told once that day.
    function spent(usage, model) {
        const now = clock();
        const day = formatLocalTime(now, timeZone).slice(0, 10);
        const spend = state.spend?.day === day ? state.spend : (state.spend = { day, yuan: 0 });
        spend.yuan += stepCost(usage, model, now);
        const budget = deps.dailyBudget?.();
        const remind = budget !== undefined && spend.yuan >= budget && !spend.reminded;
        if (remind)
            spend.reminded = true;
        record(() => store.write(state));
        if (!remind)
            return;
        const text = budgetText(spend.yuan, budget, alarmMessages(), templateValues());
        void home.open().then(agent => {
            if (stopped)
                return;
            // Into the running turn at its next step, or a turn of its own that is not asked about.
            if (agent.status !== 'running')
                earlyStop.startsOwnTurn();
            return say(agent, text);
        }).catch(error => { earlyStop.ownTurnFailed(); ctx.logger.error(error); });
    }
    // Her tools and her home.
    const notifier = {
        ...(deps.notifier.toast ? { toast: (title, body) => faults.track('toast', '系统通知没送到', () => deps.notifier.toast(title, body)) } : {}),
        outlets: deps.notifier.outlets.map(outlet => ({ ...outlet, send: push => faults.track(`outlet:${outlet.name}`, `${outlet.name}没送到`, () => outlet.send(push)) })),
    };
    const tools = createToolRegistry({
        faults, logger: ctx.logger,
        isHome: agent => agent.id === state.homeSessionId,
        tools: () => [
            ...lifeTools({ planNext, checkAlarm, cancelAlarm, notifier, names, ...(letters ? { writeLetter: ({ body, title }) => {
                    const written = letters.write({ body, ...(title === undefined ? {} : { title }) });
                    return '信写好了：' + written.path;
                } } : {}), origin: () => { try {
                    return host.origin();
                }
                catch {
                    return undefined;
                } }, descriptions: alarmDescriptions(alarmMessages(), templateValues()) }),
            // 翻记忆原文那只手（lib/memoryTools.js）。中枢没起来就不挂，别给个调了会报错的工具。
            ...(deps.memoryHub ? memoryTools(deps.memoryHub, { timeZone, partner: names.partner }) : []),
            /*
             * 她的身体（lib/body/tools.js）：表情、双手动作、歪头。
             *
             * 为什么照样挂、不"探测到 VTS 没开就不挂"：
             * 实测连一个没人听的端口 7ms 就失败返回，代价几乎为零；
             * 而挂着的她可以自己发现"哦，VTS 没开"，不挂的话她连试都试不了。
             * VTS 没开时工具返回的是人话（"VTS 没开，我现在动不了"），不是异常。
             */
            ...(deps.vtsClient ? bodyTools({ client: deps.vtsClient, preferredFace: deps.preferredFace }) : []),
        ],
    });
    const attach = (agent) => {
        // 归属两条都要：预设相等 + 会话就在她房间里。少了后一条，
        // 这台机器上同预设的编码会话也会拿到 plan_next / reach_out / recall_memory。
        if (!stopped && belongsToWorld(agent.session, config) && inRoom(agent.session, options.roomDir))
            tools.attach(agent);
    };
    const home = createHome({
        host, roomDir: options.roomDir, agentPreset: config.agentPreset, title: homeTitle(names), roomTitle: roomTitle(names), faults, logger: ctx.logger,
        current: () => state.homeSessionId,
        // A new home greets her at once (the pending alarm moves in too and rings at its own time).
        moveIn(sessionId) {
            state.homeSessionId = sessionId;
            state.greeting = { at: clock().toISOString(), kind: 'arrival' };
            tools.releaseOldHomes();
            store.write(state);
        },
        opened: attach,
        stopped: () => stopped,
    });
    const journal = createJournal({ store, faults, roomDir: options.roomDir, logger: ctx.logger });
    /** `resumed`: started again from the console; unless an alarm of her own is pending, she is told she is back. */
    async function start(options = {}) {
        disposers.push(ctx.on('agent/created', ({ agent }) => { attach(agent); return undefined; }), ctx.on('agent/disposed', ({ agent }) => tools.forget(agent)), ctx.on('agent/inbox/inserted', ({ agent, message: inserted }) => {
            // Her partner's words reach her at the next step, like being called while busy.
            if (agent.id !== state.homeSessionId || inserted.source.kind !== 'user' || agent.status !== 'running')
                return;
            if (!agent.inbox.nextTurn.some(queued => queued.id === inserted.id))
                return;
            agent.inbox.remove(inserted.id);
            agent.steer(inserted);
        }), ctx.on('session/event', (session, event) => {
            if (!belongsToWorld(session, config))
                return;
            journal.world(session, event);
            if (session.id !== state.homeSessionId)
                return;
            journal.home(session, event);
            if (event.type === 'assistant/message' && event.data.usage)
                spent(event.data.usage, event.data.message.source.model);
            if (event.type === 'user/message' && event.data.source.kind === 'user')
                earlyStop.partnerSpoke();
            if (event.type !== 'turn/end')
                return;
            home.turnEnded(session.id);
            fallbackAlarm();
            // A stopped or failed turn is not her deciding she is done.
            askIfDoneEarly(event.data.reason.kind === 'completed');
        }));
        for (const agent of ctx.agents.list())
            attach(agent);
        if (!state.review) {
            state.review = nextReview(clock(), timeZone);
            record(() => store.write(state));
        }
        try {
            const agent = await home.open();
            faults.clear('home');
            // The morning fallback is the plugin's, not a plan of hers: starting again wakes her rather than leaving her asleep till then.
            if (options.resumed && !state.greeting && state.alarm?.source !== 'plan') {
                state.greeting = { at: clock().toISOString(), kind: 'return' };
                record(() => store.write(state));
            }
            // A restart with nothing scheduled and no turn to end would otherwise never wake her again.
            if (agent.status !== 'running')
                fallbackAlarm();
        }
        catch (error) {
            if (!stopped) {
                faults.set('home', `家打不开：${errorText(error)}`);
                ctx.logger.error(error);
            }
        }
        timer.arm();
    }
    function stop() {
        if (stopped)
            return;
        stopped = true;
        timer.stop();
        for (const dispose of disposers.splice(0).reverse())
            dispose();
        tools.clear();
    }
    return {
        start, stop, planNext, checkAlarm, cancelAlarm, deliver,
        snapshot: () => ({ homeSessionId: state.homeSessionId, alarm: state.alarm, review: state.review, spend: state.spend, faults: faults.list() }),
        /** Resolves once no alarm delivery is in flight (its durability flush can outlast the turn it starts). */
        settled: async () => { while (delivery)
            await delivery; },
        home: () => home.open(),
        /** 把家换成另一个已有会话（cwd 必须是这个世界的房间）。 */
        switchHome: (sessionId) => home.moveIn(sessionId),
        /** 房间工作区里可以当家的会话清单。 */
        homeCandidates: async () => {
            const workspace = await host.workspace(options.roomDir, roomTitle(names));
            const ids = Array.from(workspace?.sessionIds ?? []);
            /**
             * 会话标题从宿主的投影缓存里读。
             *
             * 2026-10-29：以前用 agent.session.title，实际取不到，界面上只剩一串
             * 十六进制 id，分不清哪个是她原来的家。投影缓存里 title 是准的。
             */
            const titleOf = (id) => {
                try {
                    const file = join(homedir(), '.dsh', 'storages', 'session_projcache', 'sessions', `${id}.json`);
                    if (!existsSync(file))
                        return '';
                    const parsed = JSON.parse(readFileSync(file, 'utf8'));
                    const title = parsed?.record?.rows?.title?.val;
                    return typeof title === 'string' ? title : '';
                }
                catch {
                    return '';
                }
            };
            const out = [];
            for (const id of ids) {
                let archived = false;
                try {
                    archived = host.isArchived(id);
                }
                catch { /* 忽略 */ }
                out.push({ id, title: titleOf(id), archived, current: id === state.homeSessionId });
            }
            // 当前的排最前，其余按归档状态、名字排
            return out.sort((a, b) => (a.current === b.current ? (a.archived === b.archived ? String(a.title).localeCompare(String(b.title), 'zh') : a.archived ? 1 : -1) : a.current ? -1 : 1));
        },
        /** Whether this session is her home now; the world prompt gives the home its world line. */
        isHome: (sessionId) => !stopped && sessionId === state.homeSessionId,
    };
}
