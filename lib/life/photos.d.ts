import type { StoredImageAttachment } from '@deepseek-ai/dsh-attachment';
export interface PhotoSummary {
    id: string;
    savedAt: string;
    attachmentId: string;
    mediaType: string;
    bytes: number;
    width: number;
    height: number;
    description: string;
    tags: string[];
}
/** Image bytes and their index share one transaction; earlier JSON albums remain intact. */
export declare function createPhotoStore(worldDir: string, clock?: () => Date): {
    list(limit?: number, offset?: number): {
        photos: PhotoSummary[];
        total: number;
        hasMore: boolean;
        limit: number;
        offset: number;
    };
    keep(image: StoredImageAttachment, description?: string, tags?: readonly string[]): PhotoSummary;
    image(id: string): StoredImageAttachment | undefined;
    forget(id: string): void;
    close(): void;
};
export type PhotoStore = ReturnType<typeof createPhotoStore>;
