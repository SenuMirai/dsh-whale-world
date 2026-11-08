import type { IncomingMessage, ServerResponse } from 'node:http';
import { type JsonResult } from '../http.ts';
import { type Persona } from '../persona.ts';
import { type MemoryArchiveScope } from '../archiveSelection.ts';
export declare const CONSOLE_PREFIX = "/dsh-world";
/** A write must carry this header; a page on another site cannot add it without a CORS preflight, which is never answered. */
export declare const WRITE_HEADER = "x-dsh-world";
export interface ConsoleSources {
    snapshot(): Promise<unknown>;
    activity(day: string, outsideOnly: boolean): unknown;
    diary(date: string): string | undefined;
}
/** What the console can change: whether her world runs, and her persona and world prompt. */
export interface ConsoleActions {
    start(): Promise<void>;
    stop(): Promise<void>;
    prompts(): {
        persona: Persona;
        worldPrompt: {
            text: string;
            custom: boolean;
        };
    };
    savePersona(persona: Partial<Persona>): void;
    /** An empty text goes back to the shipped template. */
    saveWorldPrompt(text: string): void;
    /** CNY a day for her home; undefined removes the limit. */
    setDailyBudget(yuan: number | undefined): void;
    /** Turns in her memory block; undefined goes back to the default. */
    setMemoryTurns(turns: number | undefined): void;
    setArchiveScope(scope: MemoryArchiveScope): boolean;
    /** A field left out stays as it is; null goes back to its default. */
    /** Turns the WeChat and QQ modules on or off now (their tools and routes come and go with the switch). Returns why it cannot, or nothing. */
    setModules(modules: {
        wechat?: boolean;
        qq?: boolean;
    }): Promise<string | undefined>;
    /** Restarts the adapter the plugin manages; false when it does not manage one. */
    restartWechatAdapter(): Promise<boolean>;
    setWechatSettings(settings: {
        context?: number | null;
        bufferSeconds?: number | null;
    }): void;
}
export interface ConsoleRequest {
    method: string;
    url: string;
    write: boolean;
    body?: Record<string, unknown> | undefined;
}
/** Reads are open to the console page; writes need POST, the write header and a JSON body. */
export declare function handleConsole(sources: ConsoleSources, actions: ConsoleActions, request: ConsoleRequest): Promise<JsonResult>;
export declare function consoleRoute(sources: ConsoleSources, actions: ConsoleActions, allowedHosts?: readonly string[]): {
    kind: "prefix";
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
};
