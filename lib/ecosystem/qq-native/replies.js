const MARK = /\[\[(img|face|at|sticker|qzone):([^[\]]+)\]\]/g;
/**
 * Reads her answer. `[[img:路径]]`, `[[face:id]]` and `[[at:qq]]` become segments of the message, `[[sticker:…]]`
 * (an emoji id, a number or a meaning such as 开心) and `[[qzone:…]]` are taken out to go on their own. Most
 * answers have no marks and stay one plain string per paragraph; doubled brackets leave markdown links alone.
 */
export function planReply(text) {
    const parts = [], stickers = [], qzone = [];
    let last = 0, marked = false;
    for (const match of text.matchAll(MARK)) {
        if (match.index > last)
            parts.push({ type: 'text', text: text.slice(last, match.index) });
        last = match.index + match[0].length;
        const [, kind, raw] = match, value = raw.trim();
        if (kind === 'sticker')
            stickers.push(value);
        else if (kind === 'qzone')
            qzone.push(value);
        else {
            marked = true;
            parts.push(kind === 'img' ? { type: 'image', file: value } : kind === 'face' ? { type: 'face', id: value } : { type: 'at', qq: value });
        }
    }
    if (last < text.length)
        parts.push({ type: 'text', text: text.slice(last) });
    const plain = parts.map(part => part.type === 'text' ? part.text : '').join('');
    const messages = marked ? [parts.filter(part => part.type !== 'text' || part.text.trim())] : plain.split(/\n{2,}/).map(chunk => chunk.trim()).filter(Boolean);
    return { messages, stickers, qzone };
}
