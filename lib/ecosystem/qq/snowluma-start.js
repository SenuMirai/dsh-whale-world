import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
/**
 * 把 SnowLuma 拉起来一次（面板上的按钮和看门狗共用）。
 *
 * 优先借本机的 `SnowLuma-watchdog` 计划任务跑：DSH 把子进程放进一个关句柄即杀的 job，从 DSH 里 spawn
 * 出来的 SnowLuma 会跟着 DSH 一起退出；计划任务跑在 job 之外，能活过 DSH 重启。没有任务（或任务被禁用）
 * 才退回直接 spawn，并如实说明这条线只活到 DSH 退出。
 */
const TASK = 'SnowLuma-watchdog';
/** SnowLuma 的入口：完整版自带 node.exe，Lite 版用本机 node 跑 index.mjs，再不然是 launcher.bat。 */
function entry(homeDir) {
    const index = join(homeDir, 'index.mjs');
    if (existsSync(index))
        return { exe: existsSync(join(homeDir, 'node.exe')) ? join(homeDir, 'node.exe') : 'node', args: [index] };
    const launcher = join(homeDir, 'launcher.bat');
    return existsSync(launcher) ? { exe: launcher, args: [] } : undefined;
}
const schtasks = (...args) => process.platform === 'win32' && spawnSync('schtasks', args, { windowsHide: true, stdio: 'ignore' }).status === 0;
export function startSnowluma(homeDir) {
    if (!homeDir || !existsSync(homeDir))
        return { started: false, error: '不知道 SnowLuma 装在哪（填 qqNative.snowlumaHome）' };
    const hasTask = schtasks('/query', '/tn', TASK);
    if (hasTask && schtasks('/run', '/tn', TASK))
        return { started: true, how: 'task' };
    const target = entry(homeDir);
    if (!target)
        return { started: false, error: '这个目录里没有 node.exe / index.mjs / launcher.bat' };
    try {
        spawn(target.exe, target.args, { cwd: homeDir, detached: true, stdio: 'ignore', windowsHide: true }).unref();
        return { started: true, how: 'spawn', ...(hasTask ? { error: '计划任务没跑起来（可能被禁用了），改为直接起；这条线只活到 DSH 退出' } : {}) };
    }
    catch (error) {
        return { started: false, error: error instanceof Error ? error.message : String(error) };
    }
}
