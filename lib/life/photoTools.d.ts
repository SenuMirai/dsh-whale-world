import type { Agent } from '@deepseek-ai/dsh-agent';
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment';
import type { PhotoStore } from './photos.ts';
export declare function photoTools(deps: {
    agent: Agent;
    store(): PhotoStore;
    attachments(): AttachmentStore | undefined;
    inside(): boolean;
}): import("@deepseek-ai/dsh-tools").ToolDefinition[];
