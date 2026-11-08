/** Characters of her self-description read per session; she is asked to keep it to what matters. */
export declare const SELF_CAP = 4000;
/**
 * Her 我是谁 file as it goes into `{{self}}`: only what she wrote, tagged so her own headings do not read as
 * sections of the world prompt. What the file is and that she may rewrite it is the template's to say.
 * Empty when she has not written it. Never throws: an unreadable file becomes a short note.
 */
export declare function renderSelf(selfFile: string): string;
/** Keeps her 我是谁 as it is today beside it, in `<name>.history/<day><ext>`, so every change she makes can be seen and undone. Undefined when she has not written one. */
export declare function keepSelfCopy(selfFile: string, day: string): string | undefined;
