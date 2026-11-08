export interface StartResult {
    started: boolean;
    /** `task` = 借计划任务跑的（能活过 DSH 退出）；`spawn` = 直接起的（DSH 一退出就没了）。 */
    how?: 'task' | 'spawn';
    error?: string;
}
export declare function startSnowluma(homeDir: string): StartResult;
