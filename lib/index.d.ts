import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { WorldConfig } from './types.ts';
export { createWorldRuntime } from './runtime.ts';
export type { WorldConfig, ConversationRecord, ConversationTurn, ArchiveCursor } from './types.ts';
export declare const name = "dsh-world";
export declare const inject: string[];
/** What `apply` receives: the schema below fills these defaults. */
export type Config = WorldConfig & Required<Pick<WorldConfig, 'life' | 'fallbackWakeTime' | 'outlets' | 'bridge' | 'toast' | 'allowedHosts' | 'qqBridgeDir' | 'qqBridgePort' | 'qqBridgeAutoStart' | 'qqBridgeBindHomeSession'>>;
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    worldId: z<string, string, "defined">;
    agentPreset: z<string, string, "defined">;
    timeZone: z<string, string, "defined">;
    companionName: z<string, string, "plain">;
    partnerName: z<string, string, "plain">;
    archiveScope: z<"home" | "workspace" | "world", "home" | "workspace", "defined">;
    life: z<boolean, boolean, "defined">;
    diaryDir: z<string, string, "plain">;
    fallbackWakeTime: z<string, string, "defined">;
    selfFile: z<string, string, "plain">;
    worldPromptFile: z<string, string, "plain">;
    alarmTemplateFile: z<string, string, "plain">;
    personaFile: z<string, string, "plain">;
    outlets: z<({
        name?: string | null | undefined;
        url?: string | null | undefined;
        urlFile?: string | null | undefined;
        path?: string | null | undefined;
        kinds?: ("reply" | "busy" | "reach")[] | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
        name: z<string, string, "defined">;
        url: z<string, string, "plain">;
        urlFile: z<string, string, "plain">;
        path: z<string, string, "plain">;
        kinds: z<("reply" | "busy" | "reach")[], ("reply" | "busy" | "reach")[], "plain">;
    }>>[], "defined">;
    bridge: z<boolean, boolean, "defined">;
    wechat: z<boolean, boolean, "defined">;
    wechatAdapter: z<Schemastery.ObjectS<NoInfer<{
        python: z<string, string, "plain">;
        config: z<string, string, "plain">;
    }>>, Schemastery.ObjectT<NoInfer<{
        python: z<string, string, "plain">;
        config: z<string, string, "plain">;
    }>>, "plain">;
    toast: z<boolean, boolean, "defined">;
    allowedHosts: z<string[], string[], "defined">;
    qqBridgeDir: z<string, string, "defined">;
    qqBridgePort: z<number, number, "defined">;
    qqBridgeNode: z<string, string, "plain">;
    qqBridgeAutoStart: z<boolean, boolean, "defined">;
    qqBridgeBindHomeSession: z<"" | "owner" | "all" | "none", "" | "owner" | "all" | "none", "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    worldId: z<string, string, "defined">;
    agentPreset: z<string, string, "defined">;
    timeZone: z<string, string, "defined">;
    companionName: z<string, string, "plain">;
    partnerName: z<string, string, "plain">;
    archiveScope: z<"home" | "workspace" | "world", "home" | "workspace", "defined">;
    life: z<boolean, boolean, "defined">;
    diaryDir: z<string, string, "plain">;
    fallbackWakeTime: z<string, string, "defined">;
    selfFile: z<string, string, "plain">;
    worldPromptFile: z<string, string, "plain">;
    alarmTemplateFile: z<string, string, "plain">;
    personaFile: z<string, string, "plain">;
    outlets: z<({
        name?: string | null | undefined;
        url?: string | null | undefined;
        urlFile?: string | null | undefined;
        path?: string | null | undefined;
        kinds?: ("reply" | "busy" | "reach")[] | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
        name: z<string, string, "defined">;
        url: z<string, string, "plain">;
        urlFile: z<string, string, "plain">;
        path: z<string, string, "plain">;
        kinds: z<("reply" | "busy" | "reach")[], ("reply" | "busy" | "reach")[], "plain">;
    }>>[], "defined">;
    bridge: z<boolean, boolean, "defined">;
    wechat: z<boolean, boolean, "defined">;
    wechatAdapter: z<Schemastery.ObjectS<NoInfer<{
        python: z<string, string, "plain">;
        config: z<string, string, "plain">;
    }>>, Schemastery.ObjectT<NoInfer<{
        python: z<string, string, "plain">;
        config: z<string, string, "plain">;
    }>>, "plain">;
    toast: z<boolean, boolean, "defined">;
    allowedHosts: z<string[], string[], "defined">;
    qqBridgeDir: z<string, string, "defined">;
    qqBridgePort: z<number, number, "defined">;
    qqBridgeNode: z<string, string, "plain">;
    qqBridgeAutoStart: z<boolean, boolean, "defined">;
    qqBridgeBindHomeSession: z<"" | "owner" | "all" | "none", "" | "owner" | "all" | "none", "defined">;
}>>, "plain">;
/**
 * Her world runs only after her partner presses start in the world console, and stops when they press stop:
 * memory block, persona, world prompt, archive and life line come and go together. The switch is kept in
 * `<world>/world.json`, so it outlasts a restart.
 */
export declare function apply(ctx: Context, config: Config): Promise<void>;
