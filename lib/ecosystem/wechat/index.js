import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { jsonObject, knownHost, readBody, sendJson } from "../../http.js";
import { speakerIdentity } from "../shared/identity.js";
import { durableWrite } from "../../life/lifeStore.js";
import { createWechatHome } from "./home.js";
import { channelContext, channelMedia } from "../shared/context.js";
import { admitContextImages } from "./images.js";
import { dirname, join } from 'node:path';
import { createWechatSending } from "./sending.js";
export const WECHAT_PATH = '/dsh-world/wechat/ask';
export function createWechatModule(deps) {
    const token = randomBytes(32).toString('hex');
    const sending = createWechatSending({ ...deps, file: join(dirname(deps.file), 'wechat-outbox.sqlite'), worldId: deps.worldId ?? 'default' });
    const attached = new Map();
    const requests = new Set();
    let closing;
    let stopped = false;
    let lastContactAt;
    /** What the adapter last said about the WeChat account itself; only the adapter knows whether it is logged in. */
    let accountState;
    const settings = () => deps.settings?.() ?? { contextMessages: 8, bufferSeconds: 3 };
    function attach(agent) {
        if (stopped || attached.has(agent))
            return;
        const disposers = [];
        try {
            for (const tool of sending.tools)
                disposers.push(agent.ctx.tools.register(tool));
            attached.set(agent, disposers);
        }
        catch (error) {
            for (const dispose of disposers.reverse())
                dispose();
            throw error;
        }
    }
    const detachCreate = deps.ctx.on('agent/created', ({ agent }) => { if (deps.acceptAgent?.(agent))
        attach(agent); return undefined; });
    const detachDispose = deps.ctx.on('agent/disposed', ({ agent }) => { attached.delete(agent); });
    const home = createWechatHome({ ...deps, home: async (identity) => { const agent = await deps.home(identity); attach(agent); return agent; }, images: async (identity, context) => {
            if (!context.some(message => message.image))
                return [];
            if (!deps.incomingDir)
                throw new Error('Group image directory is unavailable');
            return admitContextImages(deps.ctx, deps.incomingDir, identity, context);
        } });
    async function handle(req) {
        const given = req.headers['x-dsh-world-token'];
        if (!knownHost(req.headers.host, deps.allowedHosts) || req.headers['sec-fetch-site'] === 'cross-site' || typeof given !== 'string')
            return { status: 403, body: { error: 'forbidden' } };
        const bytes = Buffer.from(given), expected = Buffer.from(token);
        if (bytes.length !== expected.length || !timingSafeEqual(bytes, expected))
            return { status: 403, body: { error: 'forbidden' } };
        if (stopped)
            return { status: 503, body: { error: 'wechat unavailable' } };
        lastContactAt = new Date().toISOString();
        if (req.method !== 'POST')
            return { status: 405, body: { error: 'method not allowed' }, headers: { allow: 'POST' } };
        const body = jsonObject(await readBody(req, 32 * 1024));
        if (body && 'status' in body) {
            const reported = body.status?.wechat;
            if (reported !== 'online' && reported !== 'offline')
                return { status: 400, body: { error: 'bad status' } };
            accountState = reported;
            return { status: 200, body: { accepted: true } };
        }
        if (body && 'outbox' in body) {
            try {
                const job = await sending.poll(body.outbox);
                accountState = 'online';
                return { status: 200, body: { accepted: true, settings: settings(), ...(job ? { job } : {}) } };
            }
            catch (error) {
                deps.ctx.logger.warn('dsh-world WeChat outbox failed:', error);
                return { status: 400, body: { error: 'invalid WeChat outbox binding or pending job; check adapter configuration' } };
            }
        }
        if (body && 'receipt' in body) {
            const receipt = body.receipt;
            if (!receipt || typeof receipt !== 'object' || typeof receipt.id !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.id)
                || !Number.isSafeInteger(receipt.confirmed) || receipt.confirmed < 0 || receipt.confirmed > 16
                || !['sent', 'uncertain', 'failed'].includes(receipt.status ?? ''))
                return { status: 400, body: { error: 'bad receipt' } };
            try {
                await sending.receipt(receipt);
                return { status: 200, body: { accepted: true } };
            }
            catch (error) {
                deps.ctx.logger.warn('dsh-world WeChat receipt failed:', error);
                return { status: 503, body: { error: 'receipt not recorded; retry receipt only' } };
            }
        }
        const text = typeof body?.text === 'string' ? body.text.trim() : '';
        let identity;
        let context;
        let media;
        try {
            identity = speakerIdentity(body?.identity);
            context = channelContext(body?.context, identity, settings().contextMessages);
            media = channelMedia(body?.media, identity);
        }
        catch {
            return { status: 400, body: { error: 'bad identity or context' } };
        }
        if ((!text && !media.length) || [...text].length > 2000)
            return { status: 400, body: { error: 'bad request' } };
        if (identity.channel !== 'wechat')
            return { status: 400, body: { error: 'bad channel' } };
        if ((identity.conversationType === 'group') !== identity.conversationId.endsWith('@chatroom'))
            return { status: 400, body: { error: 'bad conversation type' } };
        try {
            return { status: 200, body: { accepted: true, ...(await home.ask(text, identity, context, media)) } };
        }
        catch (error) {
            deps.ctx.logger.warn('dsh-world WeChat request failed:', error);
            return { status: 503, body: { error: 'home request failed; delivery must be checked before retrying' } };
        }
    }
    return {
        status() { return { ...sending.status(), lastContactAt: lastContactAt ?? null, account: accountState ?? null, ...settings() }; },
        start() {
            durableWrite(deps.file, JSON.stringify({ origin: deps.origin(), token, path: WECHAT_PATH, pid: process.pid, protocol: 3 }, null, 2));
            for (const agent of deps.ctx.agents.list())
                if (deps.acceptAgent?.(agent))
                    attach(agent);
        },
        stop() {
            if (stopped)
                return closing;
            stopped = true;
            home.stop();
            detachCreate();
            detachDispose();
            for (const disposers of attached.values())
                for (const dispose of disposers.reverse()) {
                    try {
                        dispose();
                    }
                    catch { /* agent already disposed */ }
                }
            attached.clear();
            try {
                if (JSON.parse(readFileSync(deps.file, 'utf8')).token === token)
                    rmSync(deps.file, { force: true });
            }
            catch { /* already absent, or a newer module owns the file */ }
            return closing = Promise.allSettled([...requests]).then(() => sending.stop());
        },
        route: { kind: 'exact', path: WECHAT_PATH, handler: async (req, res) => {
                let result;
                const request = handle(req);
                requests.add(request);
                try {
                    result = await request;
                }
                catch {
                    result = { status: 500, body: { error: 'internal error' } };
                }
                finally {
                    requests.delete(request);
                }
                sendJson(res, result);
            } },
    };
}
