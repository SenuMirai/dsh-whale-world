import { spawn } from 'node:child_process';
import type { Outlet } from '../ecosystem/shared/outlets.ts';
/** reach_out's channels: the system notification where there is one, then every outlet that takes `reach`. */
export interface Notifier {
    toast?(title: string, body: string): Promise<void>;
    outlets: readonly Outlet[];
}
/** System notifications exist on Windows only (WinRT through PowerShell); elsewhere the channel is simply absent. */
export declare const toastSupported: () => boolean;
/**
 * The host runs as plain Node (no Electron Notification), so toasts go through WinRT from PowerShell.
 * PowerShell treats U+2018/2019/201A/201B as single quotes, so no text is ever interpolated: it travels as base64.
 */
export declare function toastScript(appId: string, title: string, body: string): string;
export declare function windowsToast(appId?: string, spawnImpl?: typeof spawn, timeoutMs?: number): (title: string, body: string) => Promise<void>;
