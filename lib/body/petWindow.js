/**
 * 她的透明窗 · 启动器（2026-11-04）
 *
 * 为什么由插件来起：透明窗是一个 Electron 应用，**直接从 DSH 的 bash 会话里
 * 启动会被 `ELECTRON_RUN_AS_NODE=1` 毒到**——DSH 主进程把这个变量注入所有子进程，
 * electron.exe 一跑就退化成纯 Node，`require('electron')` 报 MODULE_NOT_FOUND。
 * 而**由 DSH 宿主进程 spawn**（它是 Electron 应用本身，启动时会自己清掉这个变量，
 * 桌宠插件就是这么起来的），窗口正常。
 *
 * 流程：
 *   设置页「她的身体」点「启动桌面形象」
 *     → POST /console/body/start
 *     → spawn electron.exe main.cjs（detached，DSH 重启不影响它）
 *     → 已在跑就不再起第二个（端口 61949 探测）
 *
 * 退出：窗内右下角「退出」按钮，或 ESC。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/** 本地控制口（pet-app.mjs 监听的），用来探测窗口是否已经在跑 */
const PET_HEALTH_PORT = 61949;

/** VTS 没开时给用户看的提示（错误码对照表在 lib/body/vts.js 同一套口径） */
const ELECTRON_PATHS = [
  // 优先：桌宠已经在用的那份（已确认存在）
  process.env.DSH_WHALE_ELECTRON_PATH ?? '',
  // 默认安装位置
  'C:/Users/demo/.dsh/electron/electron.exe',
].filter(Boolean);

export function createPetLauncher(deps = {}) {
  /** electron.exe 路径与 main.cjs 所在目录 */
  const appDir = deps.appDir ?? '';
  const logger = deps.logger ?? (() => {});
  /** 每次启动最多等这么久确认它起来了 */
  const spawnTimeoutMs = Number(deps.spawnTimeoutMs ?? 8000);

  let child = null;

  async function petAlreadyRunning() {
    try {
      const r = await fetch(`http://127.0.0.1:${PET_HEALTH_PORT}/health`, { signal: AbortSignal.timeout(1500) });
      return r.ok === true;
    } catch {
      return false;
    }
  }

  function resolveElectron() {
    for (const p of ELECTRON_PATHS) {
      if (p && existsSync(p)) return p;
    }
    return undefined;
  }

  return {
    /** 启动透明窗。已运行则返回 already:true；失败返回原因。 */
    async start() {
      if (appDir === '' || !existsSync(appDir)) {
        return { ok: false, reason: `窗口应用目录不存在：${appDir}` };
      }
      const electron = resolveElectron();
      if (electron === undefined) {
        return { ok: false, reason: '找不到 electron.exe（DSH_WHALE_ELECTRON_PATH 或默认位置都没有）' };
      }
      if (await petAlreadyRunning()) {
        return { ok: true, already: true };
      }
      if (child !== null) {
        try {
          child.kill();
        } catch {
          /* 上一次没起来，杀了也无妨 */
        }
        child = null;
      }
      try {
        // detached + unref：DSH 重启/退出不带走这个窗口
        child = spawn(electron, [deps.mainCjs ?? 'main.cjs'], {
          cwd: appDir,
          detached: true,
          stdio: 'ignore',
          // 关键：显式清掉 RUN_AS_NODE。虽然宿主 spawn 的子进程应该已经没有它，
          // 但保险起见（上层环境变化时不会被毒到）。
          env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')),
          windowsHide: false,
        });
        child.unref();
        child.on('error', (e) => logger(`star-key-pet 启动失败：${e.message}`));
      } catch (error) {
        return { ok: false, reason: `启动失败：${error?.message ?? error}` };
      }
      // 给窗口一点时间起来，再探测一次控制口
      const deadline = Date.now() + spawnTimeoutMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 600));
        if (await petAlreadyRunning()) return { ok: true };
      }
      // 起了但健康口还没响应——窗口可能正在加载模型，不算失败
      return { ok: true, slow: true };
    },

    async status() {
      const running = await petAlreadyRunning();
      return { running };
    },
  };
}
