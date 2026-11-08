import { type ContentBlock } from '@deepseek-ai/dsh-llm';
import { type ToolRunContext } from '@deepseek-ai/dsh-tools';
import { type ChannelContextMessage } from '../shared/context.ts';
import type { SpeakerIdentity } from '../shared/identity.ts';
interface ReadRequest {
    id: string;
    accountId: string;
    chatId: string;
    limit: number;
    cursor?: string;
    imageId?: string;
    stickerId?: string;
}
/** Reads use the existing adapter poll; cancellation drops only the request, never a receive cursor. */
export declare function createWechatReading(deps: {
    target(chatId: string): SpeakerIdentity;
    images?(identity: SpeakerIdentity, context: ChannelContextMessage[]): Promise<ContentBlock[]>;
}): {
    tool: import("@deepseek-ai/dsh-tools").ToolDefinition;
    imageTool: import("@deepseek-ai/dsh-tools").ToolDefinition;
    /** Lets another tool put a request to the adapter through the same queue, timeout and cancellation. */
    ask: (identity: SpeakerIdentity, fields: Omit<ReadRequest, "id" | "accountId">, context: ToolRunContext) => Promise<string>;
    poll(): ReadRequest | undefined;
    accept(value: unknown): boolean;
    stop(): void;
};
export {};
