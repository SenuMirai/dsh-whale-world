import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type SpeakerIdentity } from '../shared/identity.ts';
import { type InWorld } from '../../worldScope.ts';
import '../../hostContract.ts';
/** 说了 [安静] 之后，这条线多久不再敲得动门。 */
export declare const QUIET_AFTER_SILENCE_MS: number;
export interface BridgeConfig {
    port: number;
    token: string;
    title: string;
    contextMessages: number;
}
export declare const DEFAULT_BRIDGE_PORT = 0;
export interface BridgeStatus {
    serving: boolean;
    port: number;
    url: string;
    token: string;
    /** 一行现成的启动命令，粘到对面就能接上。 */
    line: string;
    /** 现在连着几条线。 */
    lines: number;
    threads: string[];
    received: number;
    relayed: number;
    /** 她说出口、那条线却已经走了（socket 不是 OPEN），没递到的次数。 */
    spoken: number;
    dropped: number;
    lastAt: string | null;
    lastError: string | null;
    quiet: {
        threadId: string;
        until: string;
    }[];
}
export declare function createNativeBridge(deps: {
    ctx: Context;
    /** 通道会话：一条线就是她的一间屋子，键里带着线名，和 QQ 那两条互不打扰。 */
    session(identity: SpeakerIdentity): Promise<Agent>;
    inWorld?: InWorld;
    config(): BridgeConfig;
    worldDir: string;
    /** 这条线那一头要跑的小程序（面板上把命令拼给人看）。 */
    script: string;
    log(message: string): void;
}): {
    start(): Promise<void>;
    stop(): void;
    status(): BridgeStatus;
};
/** 把这条线的启动命令拼出来（面板上直接复制，粘到对面就能接上）。 */
export declare function bridgeLine(port: number, token: string, script: string): string;
export type NativeBridge = ReturnType<typeof createNativeBridge>;
