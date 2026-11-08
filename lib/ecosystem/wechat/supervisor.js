import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, statSync, truncateSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
/** The adapter script ships next to the sources; this resolves from both `src/` and the built `lib/`. */
export const ADAPTER_SCRIPT = fileURLToPath(new URL('../../../src/ecosystem/wechat/windows/adapter.py', import.meta.url));
/** The adapter exits with this when a person must check WeChat and run `acknowledge`; restarting cannot help. */
export const EXIT_NEEDS_HUMAN = 2;
const MAX_LOG_BYTES = 1024 * 1024;
const HEALTHY_MS = 60_000;
/**
 * Runs the Windows WeChat adapter for as long as the world's WeChat module lives: started with the module,
 * restarted with a growing delay when it exits or cannot start (a file missing during an upgrade comes back),
 * and stopped (its whole process tree) with the module. An exit that says a person must act is not retried.
 * The adapter itself waits for the same WeChat account to log in again, so a WeChat restart needs nothing from here.
 */
export function createAdapterSupervisor(deps) {
    const script = deps.script ?? ADAPTER_SCRIPT;
    const spawnProcess = deps.spawnProcess ?? spawn;
    const minDelay = deps.minDelayMs ?? 1000, maxDelay = deps.maxDelayMs ?? 30_000;
    let child;
    let timer;
    let stopped = false, replacing = false, needsHuman = false, started = false, failures = 0, restarts = 0;
    let lastExit = null, error = null;
    let exited = Promise.resolve();
    const killTree = deps.killTree ?? ((target) => {
        // The Windows venv launcher starts a child interpreter; killing only the launcher would leave it running.
        if (process.platform === 'win32' && target.pid)
            spawn('taskkill', ['/PID', String(target.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        else
            target.kill();
    });
    function fail(message) {
        error = message;
        deps.log(`dsh-world WeChat adapter not started: ${message}`);
        schedule();
    }
    function launch() {
        if (stopped)
            return;
        for (const [what, path] of [['Python', deps.python], ['适配器配置', deps.config], ['适配器脚本', script]]) {
            if (!existsSync(path))
                return fail(`${what}不存在：${path}`);
        }
        let fd;
        try {
            if (existsSync(deps.logFile) && statSync(deps.logFile).size > MAX_LOG_BYTES)
                truncateSync(deps.logFile, 0);
            fd = openSync(deps.logFile, 'a');
        }
        catch (cause) {
            return fail(`无法写适配器日志：${String(cause)}`);
        }
        const startedAt = Date.now();
        let current;
        try {
            current = spawnProcess(deps.python, ['-X', 'utf8', '-u', script, 'watch', '--config', deps.config, '--allow-send'], { cwd: dirname(script), stdio: ['ignore', fd, fd], windowsHide: true });
        }
        catch (cause) {
            return fail(`适配器启动失败：${String(cause)}`);
        }
        finally {
            closeSync(fd);
        } // the child owns its copy of the descriptor
        error = null;
        if (started)
            restarts++;
        started = true;
        child = current;
        exited = new Promise(resolve => {
            let done = false;
            const finish = (text, code) => {
                if (done)
                    return;
                done = true;
                if (child === current)
                    child = undefined;
                lastExit = text;
                if (Date.now() - startedAt > HEALTHY_MS)
                    failures = 0;
                if (!stopped && !replacing) {
                    if (code === EXIT_NEEDS_HUMAN) {
                        needsHuman = true;
                        deps.log('dsh-world WeChat adapter stopped: a message needs checking by a person (run acknowledge, then restart it from the console)');
                    }
                    else {
                        deps.log(`dsh-world WeChat adapter exited (${text}); restarting`);
                        schedule();
                    }
                }
                resolve();
            };
            current.once('exit', (code, signal) => finish(signal ? `signal ${signal}` : `code ${code}`, signal ? null : code));
            current.once('error', cause => finish(`error ${String(cause)}`, null));
        });
    }
    function schedule() {
        if (stopped)
            return;
        const delay = Math.min(maxDelay, minDelay * 2 ** failures++);
        timer = setTimeout(() => { timer = undefined; launch(); }, delay);
        timer.unref?.();
    }
    async function halt() {
        if (timer) {
            clearTimeout(timer);
            timer = undefined;
        }
        const running = child;
        if (!running)
            return;
        killTree(running);
        await Promise.race([exited, new Promise(resolve => { setTimeout(resolve, 5000).unref?.(); })]);
    }
    return {
        start() { stopped = false; launch(); },
        /** The console's restart: also the way out of "a person must check" once the person has. */
        async restart() {
            if (stopped)
                return;
            replacing = true;
            try {
                await halt();
            }
            finally {
                replacing = false;
            }
            needsHuman = false;
            failures = 0;
            launch();
        },
        async stop() {
            stopped = true;
            await halt();
        },
        status() { return { running: child !== undefined, pid: child?.pid ?? null, restarts, lastExit, error, needsHuman }; },
    };
}
