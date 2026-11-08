import { jsonObject, knownHost, readBody, sendJson } from "../../http.js";
import { HomeUnavailable } from "./bridge.js";
export const BRIDGE_PATH = '/dsh-world/bridge/say';
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const MAX_TEXT = 2000;
const bad = { status: 400, body: { error: 'bad request' } };
const unavailable = { status: 503, body: { error: 'home unavailable' } };
async function handleSay(bridge, req, allowedHosts) {
    if (req.method !== 'POST')
        return { status: 405, body: { error: 'method not allowed' }, headers: { allow: 'POST' } };
    const token = req.headers['x-dsh-world-token'];
    if (req.headers['sec-fetch-site'] === 'cross-site' || !knownHost(req.headers.host, allowedHosts))
        return { status: 403, body: { error: 'forbidden' } };
    // While her world is stopped there is no bridge and no token to check against.
    if (!bridge)
        return unavailable;
    if (!bridge.checkToken(Array.isArray(token) ? undefined : token))
        return { status: 403, body: { error: 'forbidden' } };
    const body = jsonObject(await readBody(req, MAX_BODY_BYTES));
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    /**
     * 2026-11-02 修：空文字检查要放在「解析图片之后」。
     *
     * 原来这里是 length < 1 就 400，而图片解析在下面几行 —— 于是纯图片消息
     * （只发图、不打字）永远走不到图片那一步，直接被挡在门口。
     * 主人今晚问的就是这个：以前能只发图，现在不能了。
     *
     * 现在的规则：
     *   · 超长（> MAX_TEXT）→ 400，这条不变
     *   · 空文字 + 有图      → 放行，正文空着送，图片照进
     *   · 空文字 + 没图      → 400，确实没什么可送的
     * 所以下面先把 images 解析出来，再一起判断。
     */
    if ([...text].length > MAX_TEXT)
        return bad;
    // bridge-images-patched
    // 图片：QQ 插件发来的是 data URL；转成 saveImages 认识的形状再交给桥。
    const images = [];
    if (Array.isArray(body?.images)) {
        for (const url of body.images.slice(0, 4)) {
            if (typeof url !== 'string') continue;
            const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(url);
            if (m === null) continue;
            try {
                const data = Buffer.from(m[2], 'base64');
                if (data.byteLength === 0) continue;
                images.push({ data: new Uint8Array(data), mediaType: m[1], name: `bridge-${Date.now()}-${images.length}` });
            }
            catch {
                /* 单张坏掉不影响其他 */
            }
        }
    }
    // 图片解析完了，现在才知道「空文字」是不是真的空：有图就不算空。
    if ([...text].length < 1 && images.length === 0)
        return bad;
    try {
        // 桌宠这类调用方会带 ticket；QQ 插件不传，就是空串，行为不变。
        const ticket = typeof body?.ticket === 'string' ? body.ticket.slice(0, 120) : '';
        const accepted = await bridge.say(text, images, ticket);
        return { status: 202, body: { accepted: true, id: accepted.id } };
    }
    catch (error) {
        return error instanceof HomeUnavailable ? unavailable : { status: 500, body: { error: 'internal error' } };
    }
}
/** The one outside route that changes something: a local app hands her partner's words to her home. */
export function bridgeRoute(bridge, allowedHosts = []) {
    return {
        kind: 'exact', path: BRIDGE_PATH,
        handler: async (req, res) => {
            let result;
            try {
                result = await handleSay(bridge(), req, allowedHosts);
            }
            catch {
                result = { status: 500, body: { error: 'internal error' } };
            }
            sendJson(res, result);
        },
    };
}
