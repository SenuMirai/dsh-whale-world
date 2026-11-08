/** One piece of a QQ message: text, @, an image or a QQ face (the segments `snowluma.ts` builds). */
export type QqPart = {
    type: 'text';
    text: string;
} | {
    type: 'at';
    qq: string;
} | {
    type: 'image';
    file: string;
} | {
    type: 'face';
    id: string;
};
/** What one of her answers becomes on QQ. */
export interface ReplyPlan {
    /** Messages to send in order, a pause apart: plain text is split at blank lines, like a person sending a few. */
    messages: (string | QqPart[])[];
    /** Saved stickers (`send_custom_face`): not segments, each goes out on its own. */
    stickers: string[];
    /** QQ Zone posts: not chat at all, published separately. */
    qzone: string[];
}
/**
 * Reads her answer. `[[img:路径]]`, `[[face:id]]` and `[[at:qq]]` become segments of the message, `[[sticker:…]]`
 * (an emoji id, a number or a meaning such as 开心) and `[[qzone:…]]` are taken out to go on their own. Most
 * answers have no marks and stay one plain string per paragraph; doubled brackets leave markdown links alone.
 */
export declare function planReply(text: string): ReplyPlan;
