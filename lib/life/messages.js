import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatLocalTime } from "../timeContext.js";
import { renderTemplate } from "../worldPrompt.js";
/** The alarm wording shipped with the plugin; a world's own `alarm.md` replaces it section by section. */
export const DEFAULT_ALARM_FILE = fileURLToPath(new URL('../../templates/alarm.md', import.meta.url));
/**
 * 允许出现在 alarm.md 里的段落名。
 *
 * ⚠ 2026-11-03 补的：原来这张表里**没有「白天兜底」**，而 alarm.js 的 wakeText
 * 在 alarm.source === 'daylight' 时正是去取这一段。于是：
 *   sections['白天兜底'] === undefined → renderTemplate(undefined) → text.replace 抛
 *   → deliver() 挂在 catch 里 → 故障栏「闹钟送达失败，60 分钟后重试」
 *
 * 表现是:她白天那次兜底唤醒**永远叫不醒**，每小时重试一次，一直失败。
 * 而她的 alarm.md 里其实写着这一段——只是表里没登记，读的时候被丢掉了。
 *
 * 加一个名字就修好了。以后往模板里加段落，记得同步这里。
 */
export const MESSAGE_KEYS = ['第一次到家', '重新开始', '早上兜底', '白天兜底', '闹钟响了', '晚到说明', '提前停下', '每日回顾', '额度用完', '结尾提醒', 'plan_next 说明', 'check_alarm 说明', 'cancel_alarm 说明'];
/** Marks her own alarm messages (in her own voice); the compaction instruction relies on it, so a template cannot drop it. Before 0.5 it read 【你的时间】. */
export const ALARM_MARK = '【我的时间】';
/** `## name` sections; anything before the first heading (the explanatory comment) is ignored. */
export function parseSections(text) {
    const sections = new Map();
    let key;
    let lines = [];
    const close = () => { if (key !== undefined)
        sections.set(key, lines.join('\n').trim()); };
    for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
        const heading = /^## (.+?)\s*$/.exec(line);
        if (heading) {
            close();
            key = heading[1];
            lines = [];
        }
        else if (key !== undefined)
            lines.push(line);
    }
    close();
    return sections;
}
/** Never throws: an unreadable world file falls back to the shipped wording and says why. Missing sections use the shipped ones. */
export function readAlarmMessages(file) {
    const shipped = parseSections(readFileSync(DEFAULT_ALARM_FILE, 'utf8'));
    let own = new Map();
    let error;
    if (file && existsSync(file)) {
        try {
            own = parseSections(readFileSync(file, 'utf8'));
        }
        catch (cause) {
            error = `闹钟模板 ${file} 读不了，先用默认的：${cause instanceof Error ? cause.message : String(cause)}`;
        }
    }
    const sections = Object.fromEntries(MESSAGE_KEYS.map(key => [key, own.get(key) ?? shipped.get(key) ?? '']));
    return error ? { sections, error } : { sections };
}
export function fillMessage(messages, key, values, flags = {}) {
    // 段落缺失不该让整次送达崩掉：宁可少一句话，也不能叫她醒不过来。
    const section = messages?.sections?.[key];
    if (typeof section !== 'string') {
        return '';
    }
    return renderTemplate(section, flags, values);
}
/** A fixed example time with the offset of the configured zone, so the description never changes between runs. */
export function exampleTime(timeZone) {
    const offset = formatLocalTime(new Date('2026-10-23T12:00:00Z'), timeZone).slice(-6);
    return `2026-10-23T21:00:00${offset}`;
}
