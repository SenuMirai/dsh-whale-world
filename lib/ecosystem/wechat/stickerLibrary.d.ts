export type StickerMediaType = 'image/gif' | 'image/png' | 'image/webp' | 'image/jpeg';
/** `file` lives under `files/` beside the index; the adapter reads both when it sends. */
export interface Sticker {
    id: string;
    name: string;
    tags: string[];
    file: string;
    mediaType: StickerMediaType;
    md5: string;
    bytes: number;
    addedAt: number;
}
export interface StickerLabels {
    name?: string;
    tags?: string[];
}
export declare const MAX_STICKERS = 500;
export declare const MAX_STICKER_BYTES: number;
/** The world's own sticker library: a folder with `index.json` and the image files, written atomically and one change at a time. */
export declare function createStickerLibrary(dir: string): {
    dir: string;
    list: () => Promise<Sticker[]>;
    has(id: string): Promise<boolean>;
    /** `existing`: the same image was already in the library, so nothing changed. `id` is only for importing an older library. */
    add: (data: Buffer, labels: StickerLabels & {
        id?: string;
    }, options?: {
        expectedMd5?: string;
    }) => Promise<{
        sticker: Sticker;
        existing: boolean;
    }>;
    edit: (id: string, labels: StickerLabels) => Promise<Sticker>;
    remove: (id: string) => Promise<void>;
    /** A few best matches, newest first among equals; a query matches the name and tags, any word counting once. */
    search(input: {
        query?: string;
        limit?: number;
    }): Promise<{
        total: number;
        items: Sticker[];
    }>;
};
export type StickerLibrary = ReturnType<typeof createStickerLibrary>;
/** One-time import of the older sticker plugin's folder (`catalog.json` + `assets/`): ids, names and tags carry over, packs and long meanings do not. */
export declare function importLegacyStickers(legacyDir: string, library: StickerLibrary): Promise<{
    imported: number;
    duplicates: number;
    skipped: string[];
}>;
