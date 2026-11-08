import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
export const MAX_STICKERS = 500;
export const MAX_STICKER_BYTES = 10 * 1024 * 1024;
const EXTENSION = { 'image/gif': 'gif', 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' };
const idPattern = /^st_[A-Za-z0-9_-]{4,40}$/;
const control = /[\u0000-\u001f\u007f]/;
const length = (text) => [...text].length;
function mediaTypeOf(data) {
    if (data.length > 12) {
        if (data.subarray(0, 6).toString('latin1') === 'GIF87a' || data.subarray(0, 6).toString('latin1') === 'GIF89a')
            return 'image/gif';
        if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
            return 'image/png';
        if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP')
            return 'image/webp';
        if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
            return 'image/jpeg';
    }
    throw new Error('表情包需要是 GIF、PNG、WebP 或 JPEG 图片');
}
function cleanName(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string' || !value.trim() || length(value.trim()) > 30 || control.test(value))
        throw new Error('名称最长 30 字，不能含控制字符');
    return value.trim();
}
function cleanTags(value) {
    const tags = Array.isArray(value) ? value : [];
    const clean = [...new Set(tags.map(tag => typeof tag === 'string' ? tag.trim() : tag))];
    if (!clean.length || clean.length > 8 || clean.some(tag => typeof tag !== 'string' || !tag || length(tag) > 16 || control.test(tag)))
        throw new Error('标签需要 1–8 个，每个 1–16 字');
    return clean;
}
function parseIndex(text) {
    const value = JSON.parse(text);
    if (value.version !== 1 || !Array.isArray(value.stickers))
        throw new Error('结构不正确');
    for (const entry of value.stickers) {
        if (!entry || typeof entry.id !== 'string' || !idPattern.test(entry.id) || typeof entry.name !== 'string' || !Array.isArray(entry.tags)
            || typeof entry.file !== 'string' || basename(entry.file) !== entry.file || !(entry.mediaType in EXTENSION)
            || typeof entry.md5 !== 'string' || !/^[a-f0-9]{32}$/.test(entry.md5) || !Number.isSafeInteger(entry.bytes) || !Number.isFinite(entry.addedAt))
            throw new Error(`条目 ${String(entry?.id)} 不正确`);
    }
    return value.stickers;
}
/** The world's own sticker library: a folder with `index.json` and the image files, written atomically and one change at a time. */
export function createStickerLibrary(dir) {
    const indexFile = join(dir, 'index.json'), filesDir = join(dir, 'files');
    let chain = Promise.resolve();
    const serial = (job) => { const next = chain.then(job); chain = next.catch(() => undefined); return next; };
    async function read() {
        let text;
        try {
            text = await readFile(indexFile, 'utf8');
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return [];
            throw error;
        }
        try {
            return parseIndex(text);
        }
        catch (error) {
            throw new Error(`表情库索引 index.json 无法读取（${error.message}），已保留原文件等待人工修复`);
        }
    }
    async function write(stickers) {
        await mkdir(dir, { recursive: true });
        const temporary = `${indexFile}.tmp`;
        await writeFile(temporary, JSON.stringify({ version: 1, stickers }, null, 2), 'utf8');
        await rename(temporary, indexFile);
    }
    const find = (stickers, id) => {
        const sticker = stickers.find(entry => entry.id === id);
        if (!sticker)
            throw new Error(`没有这个表情：${id}`);
        return sticker;
    };
    return {
        dir,
        list: () => serial(read),
        async has(id) { return (await serial(read)).some(sticker => sticker.id === id); },
        /** `existing`: the same image was already in the library, so nothing changed. `id` is only for importing an older library. */
        add: (data, labels, options = {}) => serial(async () => {
            if (data.length > MAX_STICKER_BYTES)
                throw new Error('表情包超过 10MB，过大');
            const mediaType = mediaTypeOf(data);
            const md5 = createHash('md5').update(data).digest('hex');
            if (options.expectedMd5 !== undefined && options.expectedMd5 !== md5)
                throw new Error('下载内容的 md5 与核对时不一致，已丢弃');
            const tags = cleanTags(labels.tags), name = cleanName(labels.name) ?? tags[0];
            const stickers = await read();
            const same = stickers.find(entry => entry.md5 === md5);
            if (same)
                return { sticker: same, existing: true };
            if (stickers.length >= MAX_STICKERS)
                throw new Error(`表情库已满（最多 ${MAX_STICKERS} 张），先移除一些再收`);
            const id = labels.id ?? `st_${md5.slice(0, stickers.some(entry => entry.id === `st_${md5.slice(0, 12)}`) ? 20 : 12)}`;
            if (!idPattern.test(id) || stickers.some(entry => entry.id === id))
                throw new Error(`表情 ID 无效或已被另一张图片使用：${id}`);
            const sticker = { id, name, tags, file: `${id}.${EXTENSION[mediaType]}`, mediaType, md5, bytes: data.length, addedAt: Date.now() };
            await mkdir(filesDir, { recursive: true });
            await writeFile(join(filesDir, sticker.file), data);
            try {
                await write([...stickers, sticker]);
            }
            catch (error) {
                await rm(join(filesDir, sticker.file), { force: true });
                throw error;
            }
            return { sticker, existing: false };
        }),
        edit: (id, labels) => serial(async () => {
            const stickers = await read();
            const sticker = find(stickers, id);
            const next = { ...sticker, ...(labels.name === undefined ? {} : { name: cleanName(labels.name) }), ...(labels.tags === undefined ? {} : { tags: cleanTags(labels.tags) }) };
            await write(stickers.map(entry => entry === sticker ? next : entry));
            return next;
        }),
        remove: (id) => serial(async () => {
            const stickers = await read();
            const sticker = find(stickers, id);
            await write(stickers.filter(entry => entry !== sticker));
            await rm(join(filesDir, sticker.file), { force: true });
        }),
        /** A few best matches, newest first among equals; a query matches the name and tags, any word counting once. */
        async search(input) {
            const stickers = await serial(read);
            const words = (input.query ?? '').toLowerCase().split(/[\s,，、/;；]+/).filter(Boolean);
            const limit = Math.min(Math.max(Number.isSafeInteger(input.limit) ? input.limit : 8, 1), 20);
            const scored = [...stickers].reverse().map(sticker => {
                const text = [sticker.name, ...sticker.tags].join('\n').toLowerCase();
                return { sticker, score: words.filter(word => text.includes(word)).length };
            }).filter(entry => !words.length || entry.score > 0);
            scored.sort((a, b) => b.score - a.score);
            return { total: stickers.length, items: scored.slice(0, limit).map(entry => entry.sticker) };
        },
    };
}
/** One-time import of the older sticker plugin's folder (`catalog.json` + `assets/`): ids, names and tags carry over, packs and long meanings do not. */
export async function importLegacyStickers(legacyDir, library) {
    const catalog = JSON.parse(await readFile(join(legacyDir, 'catalog.json'), 'utf8'));
    const report = { imported: 0, duplicates: 0, skipped: [] };
    for (const pack of catalog.packs ?? [])
        for (const entry of pack.stickers ?? []) {
            try {
                if (typeof entry.id !== 'string' || typeof entry.file !== 'string' || basename(entry.file) !== entry.file)
                    throw new Error('条目不完整');
                const name = [...String(entry.name ?? '').trim()].slice(0, 30).join('') || undefined;
                const tags = [...new Set((entry.tags ?? []).map(tag => [...String(tag).trim()].slice(0, 16).join('')).filter(Boolean))].slice(0, 8);
                const data = await readFile(join(legacyDir, 'assets', entry.file));
                const result = await library.add(data, { id: entry.id, ...(name ? { name } : {}), tags: tags.length ? tags : [name ?? '表情'] });
                if (result.existing)
                    report.duplicates++;
                else
                    report.imported++;
            }
            catch (error) {
                report.skipped.push(`${String(entry?.id)}：${error.message}`);
            }
        }
    return report;
}
