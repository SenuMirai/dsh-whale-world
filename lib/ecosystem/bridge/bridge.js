import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, rmSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { durableWrite } from "../../life/lifeStore.js";
import { errorText, Faults } from "../../faults.js";
import { realTimers } from "../../life/alarmTimer.js";
import { busyText, pushOf } from "../shared/outlets.js";
export const REPLY_TIMEOUT_MS = 3 * 60_000;
/** The words could not be handed to her home; the route answers 503. */
export class HomeUnavailable extends Error {
}
const labels = (name) => ({ reply: `${name}的回复`, busy: `「${name}在忙」`, reach: `${name}找你的话` });
/**
 * A local app's way into her home: its words arrive as her partner's own (source `user`), and the first
 * visible text she says after they are admitted goes to the outlets. Only the latest words are tracked.
 */
export function createBridge(deps) {
    const { ctx } = deps;
    const name = deps.name ?? 'TA';
    const clock = deps.clock ?? (() => new Date());
    const timers = deps.timers ?? realTimers;
    const faults = new Faults();
    const disposers = [];
    const token = randomBytes(32).toString('hex');
    let tracked;
    let stopped = false;
    /**
     * 诊断记录：桥这一路到底走到哪儿断了。
     *
     * 2026-10-30 加。起因：QQ 私聊把话送进家了、她也回话了，
     * 但 QQ 那头收不到——查不到是「没推」「推失败」还是「推了没人接」。
     * 写在 bridge.json 同目录的 bridge-debug.jsonl，一行一件事，不覆盖。
     * 只是记录，不影响任何行为；写不进去就算了。
     */
    function note(kind, data = {}) {
        try {
            appendFileSync(join(dirname(deps.file), 'bridge-debug.jsonl'), `${JSON.stringify({ at: clock().toISOString(), kind, ...data })}\n`, 'utf8');
        }
        catch { /* 记不下来不耽误正事 */ }
    }
    function send(push) {
        note('push', { kind: push.kind, chars: (push.text ?? '').length, outlets: deps.outlets.map(o => o.name) });
        for (const outlet of deps.outlets) {
            if (!outlet.kinds.includes(push.kind))
                continue;
            const key = `push:${outlet.name}`;
            void outlet.send(push).then(() => {
                note('push-ok', { outlet: outlet.name });
                faults.clear(key);
            }, error => {
                if (stopped)
                    return;
                note('push-fail', { outlet: outlet.name, error: errorText(error) });
                faults.set(key, `${outlet.name}没收到${labels(name)[push.kind]}：${errorText(error)}`);
                ctx.logger.warn(`dsh-world: the push to ${outlet.name} failed:`, error);
            });
        }
    }
    function untrack() {
        if (tracked?.timer !== undefined)
            timers.clear(tracked.timer);
        tracked = undefined;
    }
    function track(id, sessionId, ticket = '', speak = false, altSessionId = '') {
        untrack();
        // 记住两个身份：agent 自己的 id，和它真正说话的会话 id。
        // 这两个在有些版本里不是一个值，只认一个就会「她回了话但推不出去」。
        const sessionIds = [sessionId, altSessionId].filter(s => typeof s === 'string' && s !== '');
        const entry = { id, sessionId, sessionIds, admitted: false, ticket, speak, at: Date.now() };
        note('track', { id, sessionIds });
        // The reply stays tracked after "busy": it is still pushed when it comes.
        entry.timer = timers.set(() => { entry.timer = undefined; if (tracked === entry && !stopped)
            send({ text: busyText(name), kind: 'busy', name }); }, REPLY_TIMEOUT_MS);
        tracked = entry;
    }
    function start() {
        disposers.push(ctx.on('session/event', (session, event) => {
            if (!tracked)
                return;
            if (!tracked.sessionIds.includes(session.id)) {
                // 会话对不上：说明记下的身份和真正说话的会话不是一个。
                // 这是「她回了话但外面收不到」最可能的原因，记下来。
                if (event.type === 'assistant/message')
                    note('session-mismatch', { got: session.id, want: tracked.sessionIds });
                return;
            }
            if (event.type === 'user/message') {
                if (event.data.id === tracked.id) {
                    tracked.admitted = true;
                    note('admitted', { by: 'id' });
                    return;
                }
                // 兜底：话确实进了这条会话，但 id 对不上（被 steer / 重新包过一层）。
                // 只在「刚送进来 15 秒内、还没认过」时算数，
                // 免得几分钟后有人在控制台随手说的话被当成外面的这句话。
                if (tracked.admitted !== true && Date.now() - (tracked.at ?? 0) <= 15_000) {
                    tracked.admitted = true;
                    note('admitted', { by: 'window', gotId: String(event.data.id), wantId: tracked.id });
                    return;
                }
                note('user-message-mismatch', { gotId: String(event.data.id), wantId: tracked.id, admitted: tracked.admitted === true });
                return;
            }
            if (event.type !== 'assistant/message' || !tracked.admitted) {
                if (event.type === 'assistant/message')
                    note('assistant-skipped', { admitted: false });
                return;
            }
            note('assistant-caught', { session: session.id });
            const visible = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
            const reply = pushOf(visible, 'reply', name, safeOrigin());
            // 桌宠这类调用方会带 ticket 来，回推时原样带回，它才知道回的是哪一句。
            // QQ 插件不传，这里就不会有该字段，行为不变。
            if (tracked.ticket !== undefined && tracked.ticket !== '')
                reply.ticket = tracked.ticket;
            if (!reply.text && !reply.images)
                return;
            /**
             * 2026-10-30 修：这里原来先 untrack() 再读 tracked.speak，
             * 而 untrack() 会把 tracked 置空 —— 于是上一行刚读完 ticket，
             * 下一行就抛 TypeError，整个监听器静默炸掉，send(reply) 永远走不到。
             * 症状就是「她回话了，日志里 assistant-caught 有，但外面一条都收不到」。
             * 桌宠那条 speak 支路是后加的，重启之后才真正生效，所以是重启后才坏的。
             * 现在先把要用的值取出来，再清账。
             */
            const wantSpeak = tracked.speak === true;
            untrack();
            /**
             * 桌宠要语音时，世界这边合成好再一起推回去。
             *
             * 为什么由世界合成：她说话的声音只有一套（GPT-SoVITS 七音色 + 情绪），
             * 桌宠自己合成不出一样的声音。桌宠只负责播放。
             *
             * 合成失败不能影响文字投递——所以是「有就带上，没有就纯文字」，
             * 且整段包在 try 里，任何异常都退回纯文字。
             */
            if (wantSpeak && deps.synthesize !== undefined && reply.text) {
                void deps.synthesize(reply.text).then(audio => {
                    if (audio !== undefined && audio !== '') {
                        reply.audio = audio.data;
                        reply.audioMime = audio.mime;
                        reply.speak = true;
                    }
                    send(reply);
                }, () => send(reply));
                return;
            }
            send(reply);
        }));
        try {
            durableWrite(deps.file, JSON.stringify({ origin: deps.origin(), token, pid: process.pid, startedAt: clock().toISOString(), name }, null, 2));
            faults.clear('file');
        }
        catch (error) {
            faults.set('file', `bridge.json 没能写入，外面的程序找不到家：${errorText(error)}`);
            ctx.logger.error(error);
        }
    }
    function safeOrigin() { try {
        return deps.origin();
    }
    catch {
        return undefined;
    } }
    function stop() {
        if (stopped)
            return;
        stopped = true;
        untrack();
        for (const dispose of disposers.splice(0).reverse())
            dispose();
        // A newer start (a reload) may already have written its own token; that file is not ours to remove.
        try {
            if (JSON.parse(readFileSync(deps.file, 'utf8')).token === token)
                rmSync(deps.file, { force: true });
        }
        catch { /* gone or unreadable */ }
    }
    function checkToken(value) {
        if (typeof value !== 'string')
            return false;
        const given = Buffer.from(value);
        const expected = Buffer.from(token);
        return given.length === expected.length && timingSafeEqual(given, expected);
    }
    async function say(text, images = [], ticket = '', speak = false) {
        if (stopped)
            throw new HomeUnavailable('the bridge is stopped');
        let agent;
        try {
            agent = await deps.home();
        }
        catch (error) {
            faults.set('home', `从外面送来的话没进家：${errorText(error)}`);
            ctx.logger.error(error);
            throw new HomeUnavailable(errorText(error), { cause: error });
        }
        if (stopped)
            throw new HomeUnavailable('the bridge is stopped');
        const content = [{ type: 'text', text }];
        if (images.length > 0) {
            const attachments = ctx.get?.('attachments')
                ?? ctx.attachments;
            const service = attachments;
            if (service !== undefined && typeof service.saveImages === 'function') {
                const refs = await service.saveImages(images.slice(0, 4));
                for (const ref of refs)
                    content.push({ type: 'image', attachment: ref });
            }
        }
        const words = createUserMessage({ source: { kind: 'user' }, content: content });
        // Tracked first: steering can admit the words before it returns.
        track(words.id, agent.id, ticket, speak, agent.session?.id ?? '');
        try {
            // Like her partner typing in the home: into the running turn at its next step, or a new turn.
            if (agent.status === 'running')
                agent.steer(words);
            else
                agent.followup(words);
        }
        catch (error) {
            untrack();
            faults.set('home', `从外面送来的话没进家：${errorText(error)}`);
            ctx.logger.error(error);
            throw new HomeUnavailable(errorText(error), { cause: error });
        }
        faults.clear('home');
        return { id: words.id };
    }
    return { start, stop, say, checkToken, faults: () => faults.list() };
}
