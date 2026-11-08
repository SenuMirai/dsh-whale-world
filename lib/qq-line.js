#!/usr/bin/env node
/**
 * 阳台那一头的小程序：把机器上别的程序跟这个家接起来。
 *
 * 插件那边开着一条 WebSocket（设置页「世界控制台」→ QQ 卡上能看到地址与口令），这个脚本代表
 * 对面接上去，然后：
 *
 *   标准输入（一行一条 JSON）→ 递给她       {"text":"…","from":"谁"}  /  {"kind":"ring"}  /  {"kind":"bye"}
 *   标准输出（一行一条 JSON）← 她回的话      {"kind":"reply","threadId":"…","text":"…"} / {"kind":"ready"} / {"kind":"error"}
 *   标准错误 ← 给人看的日志
 *
 * 用法（口令与地址从环境变量给，免得写进命令行历史）：
 *   DSH_QQ_BRIDGE_URL=ws://127.0.0.1:3210 DSH_QQ_BRIDGE_TOKEN=… node qq-line.js <这条线叫什么> <会话标识>
 *
 * 为什么做成「吃 stdin、吐 stdout」：对面是什么程序我们不知道，不知道就别猜 —— 会写一行 JSON、
 * 会读一行 JSON 的东西都能用它。断线会自己重连，连上之前递进来的话排在队里。
 */
import { WebSocket } from 'ws';
const url = process.env.DSH_QQ_BRIDGE_URL ?? '';
const token = process.env.DSH_QQ_BRIDGE_TOKEN ?? '';
const name = (process.argv[2] ?? '外面').trim();
const threadId = (process.argv[3] ?? name).trim();
if (!url) {
    process.stderr.write('[qq-line] 没给 DSH_QQ_BRIDGE_URL（插件面板上那条命令里有）\n');
    process.exit(2);
}
let socket;
let ready = false;
let backoff = 1_000;
const waiting = [];
function log(message) {
    process.stderr.write(`[qq-line] ${message}\n`);
}
function toBridge(frame) {
    // 对面把 kind 缺省的帧也算一句话，但补上更省事：它那边的上下文表靠 kind==='message' 记账。
    const shaped = frame.kind === undefined && typeof frame.text === 'string' ? { ...frame, kind: 'message' } : frame;
    const line = JSON.stringify({ ...shaped, threadId });
    if (ready && socket?.readyState === WebSocket.OPEN)
        socket.send(line);
    else
        waiting.push(line);
}
function connect() {
    const ws = new WebSocket(`${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`);
    socket = ws;
    ws.on('open', () => {
        log(`接上了 ${url}`);
        backoff = 1_000;
        ws.send(JSON.stringify({ kind: 'hello', threadId, token, from: name }));
        ready = true;
        while (waiting.length)
            ws.send(waiting.shift());
    });
    ws.on('message', (data) => {
        const text = String(data).trim();
        if (!text)
            return;
        let frame;
        try {
            frame = JSON.parse(text);
        }
        catch {
            log(`收到看不懂的一行：${text.slice(0, 120)}`);
            return;
        }
        if (frame.kind === 'ready') {
            log('对面认了我这条线');
            return;
        }
        if (frame.kind === 'error') {
            log(`对面退回一句：${String(frame.message ?? '')}`);
            return;
        }
        // 她说的原话，原样交出去（包括不说话的 hold 标记）。
        process.stdout.write(`${JSON.stringify(frame)}\n`);
    });
    ws.on('error', (error) => { log(`连不上：${String(error)}`); });
    ws.on('close', () => {
        if (ready)
            log('断了，等一下再连');
        ready = false;
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30_000);
    });
}
process.stdin.setEncoding('utf8');
let buffer = '';
process.stdin.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
        const line = raw.trim();
        if (!line)
            continue;
        let frame;
        try {
            frame = JSON.parse(line);
        }
        catch {
            toBridge({ kind: 'message', text: line, from: name });
            continue;
        }
        if (typeof frame === 'string')
            toBridge({ kind: 'message', text: frame, from: name });
        else if (frame && typeof frame === 'object')
            toBridge(frame);
        else
            log('这一行既不是 JSON 对象也不是字符串，跳过了');
    }
});
process.stdin.on('end', () => { toBridge({ kind: 'bye' }); setTimeout(() => process.exit(0), 200); });
process.on('SIGINT', () => { toBridge({ kind: 'bye' }); setTimeout(() => process.exit(0), 200); });
log(`这条线叫「${name}」，会话标识「${threadId}」`);
connect();
