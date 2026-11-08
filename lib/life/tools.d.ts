import type { Notifier } from './notify.ts';
import type { WorldNames } from '../worldPrompt.ts';
export interface AlarmDescriptions {
    plan: string;
    check: string;
    cancel: string;
}
export interface LifeToolHost {
    planNext(input: {
        at?: string;
        after_minutes?: number;
    }, note: string): string;
    /** With both, check_alarm and cancel_alarm are offered too. */
    checkAlarm?(): string;
    cancelAlarm?(): string;
    notifier: Notifier;
    names?: WorldNames;
    /** The DSH origin, for sticker URLs in her words. */
    origin?(): string | undefined;
    /** From the alarm template; the shipped wording otherwise. */
    descriptions?: AlarmDescriptions;
}
export declare function alarmDescriptions(messages?: import("./messages.ts").AlarmMessages, values?: Record<string, string>): AlarmDescriptions;
export declare function lifeTools(host: LifeToolHost): readonly [import("@deepseek-ai/dsh-tools").ToolDefinition, import("@deepseek-ai/dsh-tools").ToolDefinition] | readonly [import("@deepseek-ai/dsh-tools").ToolDefinition, import("@deepseek-ai/dsh-tools").ToolDefinition, import("@deepseek-ai/dsh-tools").ToolDefinition, import("@deepseek-ai/dsh-tools").ToolDefinition];
