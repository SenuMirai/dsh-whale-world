import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type SpeakerIdentity } from '../shared/identity.ts';
import type { PreparedReply, WechatReceipt } from './archive.ts';
export declare const WECHAT_PATH = "/dsh-world/wechat/ask";
export declare function createWechatModule(deps: {
    ctx: Context;
    home(identity: SpeakerIdentity): Promise<Agent>;
    file: string;
    worldId?: string;
    acceptAgent?(agent: Agent): boolean;
    incomingDir?: string;
    origin(): string;
    allowedHosts: readonly string[];
    settings?(): {
        contextMessages: number;
        bufferSeconds: number;
    };
    record?(reply: PreparedReply): Promise<string>;
    receipt?(receipt: WechatReceipt): Promise<void>;
}): {
    status(): {
        contextMessages: number;
        bufferSeconds: number;
        lastContactAt: string | null;
        account: "online" | "offline" | null;
        accountId: string | null;
        chats: number;
        pending: number;
        uncertain: number;
    };
    start(): void;
    stop(): Promise<void> | undefined;
    route: {
        kind: "exact";
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
    };
};
export type WechatModule = ReturnType<typeof createWechatModule>;
