import type { Context } from '@deepseek-ai/cordis';
import { replyMessages } from './messages.ts';
import type { PreparedReply, WechatReceipt } from './archive.ts';
interface Job {
    id: string;
    accountId: string;
    chatId: string;
    messages: ReturnType<typeof replyMessages>;
}
/** The existing adapter owns all sending; a claim survives disconnects until its receipt is recorded. */
export declare function createWechatSending(deps: {
    ctx: Context;
    file: string;
    worldId: string;
    record?(reply: PreparedReply): Promise<string>;
    receipt?(receipt: WechatReceipt): Promise<void>;
}): {
    tools: import("@deepseek-ai/dsh-tools").ToolDefinition[];
    /** Bound account, chats the adapter reported, and jobs waiting to go out or needing a human check. */
    status(): {
        accountId: string | null;
        chats: number;
        pending: number;
        uncertain: number;
    };
    poll(value: unknown): Promise<Job | undefined>;
    receipt(receipt: WechatReceipt): Promise<void>;
    stop(): Promise<void>;
};
export {};
