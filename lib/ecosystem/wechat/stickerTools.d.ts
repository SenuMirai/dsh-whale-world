import { type ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { SpeakerIdentity } from '../shared/identity.ts';
import type { StickerLibrary } from './stickerLibrary.ts';
/**
 * The model's side of the world's own sticker library. Kept deliberately small: nothing here puts a catalog or a
 * picture in front of the model unless it asked, and sending is the ordinary `wechat_send`.
 */
export declare function createStickerTools(deps: {
    library: StickerLibrary;
    /** Where the adapter leaves a fetched original until the library has taken it. */
    stagingDir: string;
    target(chatId: string): SpeakerIdentity;
    ask(identity: SpeakerIdentity, fields: {
        chatId: string;
        limit: number;
        stickerId: string;
    }, context: ToolRunContext): Promise<string>;
}): import("@deepseek-ai/dsh-tools").ToolDefinition[];
