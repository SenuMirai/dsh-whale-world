import { isAbsolute, relative, resolve } from 'node:path';
const shells = new Set(['pwsh', 'bash', 'powershell', 'shell']);
const pathKeys = new Set(['path', 'file_path', 'filePath', 'paths', 'cwd', 'directory', 'dir', 'target', 'source', 'destination', 'root', 'folder']);
const clip = (text) => Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, 160).join('');
/** Path strings under pathKeys at any depth, so nested operation arrays are covered. */
function collectPaths(value, keyed, out) {
    if (typeof value === 'string') {
        if (keyed)
            out.push(value);
    }
    else if (Array.isArray(value))
        for (const item of value)
            collectPaths(item, keyed, out);
    else if (value && typeof value === 'object')
        for (const [key, item] of Object.entries(value))
            collectPaths(item, keyed || pathKeys.has(key), out);
    return out;
}
/** Shell commands cannot be reliably scoped, so they always count as outside the room. The path check is lexical: symlinks/junctions, `~` and `%VAR%` are not resolved. */
export function summarizeCall(tool, argumentsJson, roomDir) {
    let parsed;
    try {
        parsed = JSON.parse(argumentsJson);
    }
    catch {
        parsed = undefined;
    }
    const args = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    if (shells.has(tool.toLowerCase()))
        return { summary: clip(typeof args.command === 'string' ? args.command : argumentsJson), outside: true };
    const paths = collectPaths(args, false, []);
    const inside = (path) => { const rel = relative(roomDir, resolve(roomDir, path)); return rel === '' || (!/^\.\.(?:[\\/]|$)/.test(rel) && !isAbsolute(rel)); };
    return { summary: clip(paths.length ? paths.join(', ') : argumentsJson), outside: paths.some(path => !inside(path)) };
}
/**
 * What she actually did between `since` and `now`, in one line she can hold against the note she wrote.
 *
 * She asked for this (2026-10-26): an alarm that only repeats her own promise lets her believe she kept
 * it. Counting her calls and naming the last thing she touched turns "歇着" into a claim that can fail.
 * Empty string means "nothing to say" — the caller drops the sentence rather than print an empty one.
 */
export function summarizeSince(records, sinceIso, now) {
    const from = Date.parse(sinceIso);
    const until = now.getTime();
    if (!Number.isFinite(from))
        return '';
    const mine = records.filter(record => {
        const at = Date.parse(record.time);
        return Number.isFinite(at) && at >= from && at <= until;
    });
    if (!mine.length)
        return '这段时间我没动过手。';
    const tools = [...new Set(mine.map(record => record.tool))];
    const shown = tools.slice(0, 3).join('、') + (tools.length > 3 ? ` 等 ${tools.length} 种` : '');
    const last = mine[mine.length - 1];
    const touched = Array.from(last.summary).slice(0, 40).join('').trim();
    return `这段时间我动了 ${mine.length} 次手（${shown}）${touched ? `，最后一次是：${touched}` : ''}。`;
}
