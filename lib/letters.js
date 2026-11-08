/**
 * letters —— 她写给主人的信（2026-11-08 从「鱼与人」搬回世界）
 *
 * 为什么搬：
 *   原来写信这件事长在 B站 那个插件里（bili_fishman_letter）。可写信跟刷 B站 没有关系 ——
 *   它是她**过日子**的一部分。主人说得对：世界是记忆中心，信也该在世界这边，
 *   由她自己写、由主人单独一页读。
 *
 * 落点：<world>/letters/YYYY-MM-DD[-HHMMSS].md —— 一天可以写多封，
 *   文件名带时间就不会互相覆盖；只有这个形状的文件名才认，
 *   所以日期/文件名永远爬不出 letters 目录。
 *
 * 一封信长这样：
 *
 *   # 2026-11-08 21:20
 *
 *   正文……
 *
 * 头一行只是抬头，读的时候可以给她看；没写标题就按时间。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// 一秒里写第二封时文件名会补一个 -2 的后缀，正则必须认它，
// 否则第二封写得出来、列表里却看不见（2026-11-08 smoke 时踩到）。
const FILE = /^(\d{4}-\d{2}-\d{2})(?:-(\d{6}))(?:-(\d{1,3}))?\.md$/;
const MAX_BODY_CHARS = 20000;

/** 北京时间的 YYYY / MM / DD / HH / MM / SS 分量。她的日子按 Asia/Shanghai 算。 */
function stampParts(when, timeZone) {
    const format = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const parts = {};
    for (const part of format.formatToParts(when)) if (part.type !== 'literal') parts[part.type] = part.value;
    return parts;
}

export function createLetterStore(dir, { timeZone = 'Asia/Shanghai' } = {}) {
    const names = () => {
        try {
            return existsSync(dir) ? readdirSync(dir).filter((name) => FILE.test(name)).sort().reverse() : [];
        }
        catch {
            return [];
        }
    };
    /** 抬头之后的第一段正文，给列表当预览用。 */
    const preview = (text) =>
        text
            .replace(/^#\s.*$/mu, '')
            .replace(/\s+/gu, ' ')
            .trim()
            .slice(0, 90);

    return {
        dir,
        names,
        /** 列表：新在前。at 是能排序的本地时间串。 */
        list() {
            return names().map((name) => {
                const match = FILE.exec(name);
                let text = '';
                try {
                    text = readFileSync(join(dir, name), 'utf8');
                }
                catch { /* 读不到就只留文件名 */ }
                const clock = match[2] ? match[2] : '000000';
                return {
                    name,
                    date: match[1],
                    at: match[1] + 'T' + clock.slice(0, 2) + ':' + clock.slice(2, 4) + ':' + clock.slice(4, 6),
                    preview: preview(text),
                };
            });
        },
        /** 读一封。只认 letters 目录里那个形状的文件名。 */
        read(name) {
            const wanted = String(name ?? '');
            if (!FILE.test(wanted)) return undefined;
            const file = join(dir, wanted);
            return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
        },
        /**
         * 写一封。同一天同一秒写两次才会重名，那时补一个 -2 的后缀，绝不覆盖上一封。
         * 返回 { name, path }。
         */
        write({ body, title = '' } = {}, when = new Date()) {
            const text = String(body ?? '').trim();
            if (text === '') throw new Error('信是空的 —— 想说什么，写下来再存。');
            if ([...text].length > MAX_BODY_CHARS) throw new Error('这封信太长了（上限 ' + MAX_BODY_CHARS + ' 字）。');
            mkdirSync(dir, { recursive: true });
            const parts = stampParts(when, timeZone);
            const head = (String(title ?? '').trim() || parts.hour + ':' + parts.minute + ':' + parts.second).slice(0, 60);
            const day = parts.year + '-' + parts.month + '-' + parts.day;
            const clock = parts.hour + parts.minute + parts.second;
            let name = day + '-' + clock + '.md';
            for (let i = 2; existsSync(join(dir, name)) && i < 100; i += 1) name = day + '-' + clock + '-' + i + '.md';
            const file = join(dir, name);
            writeFileSync(file, '# ' + day + ' ' + head + '\n\n' + text + '\n', 'utf8');
            return { name, path: file };
        },
    };
}
