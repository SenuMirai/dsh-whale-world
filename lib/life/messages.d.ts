/** The alarm wording shipped with the plugin; a world's own `alarm.md` replaces it section by section. */
export declare const DEFAULT_ALARM_FILE: string;
export declare const MESSAGE_KEYS: readonly ["第一次到家", "重新开始", "早上兜底", "闹钟响了", "晚到说明", "提前停下", "每日回顾", "额度用完", "结尾提醒", "plan_next 说明", "check_alarm 说明", "cancel_alarm 说明"];
export type MessageKey = typeof MESSAGE_KEYS[number];
/** Marks her own alarm messages (in her own voice); the compaction instruction relies on it, so a template cannot drop it. Before 0.5 it read 【你的时间】. */
export declare const ALARM_MARK = "\u3010\u6211\u7684\u65F6\u95F4\u3011";
/** `## name` sections; anything before the first heading (the explanatory comment) is ignored. */
export declare function parseSections(text: string): Map<string, string>;
export interface AlarmMessages {
    sections: Record<MessageKey, string>;
    error?: string;
}
/** Never throws: an unreadable world file falls back to the shipped wording and says why. Missing sections use the shipped ones. */
export declare function readAlarmMessages(file: string | undefined): AlarmMessages;
export declare function fillMessage(messages: AlarmMessages, key: MessageKey, values: Record<string, string>, flags?: Record<string, boolean>): string;
/** A fixed example time with the offset of the configured zone, so the description never changes between runs. */
export declare function exampleTime(timeZone: string): string;
