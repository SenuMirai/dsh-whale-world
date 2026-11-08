/**
 * VTS 客户端（她的身体 · 2026-11-04）
 *
 * 一条极简的 VTube Studio WebSocket 客户端：连上、认证、发请求、收发消息。
 * 不引第三方包——Node 24 自带 `WebSocket`，够用。
 *
 * 为什么不用鲸语那套：它的 `vts_client.py` 要 Python + DPAPI + 往
 * `Program Files` 写模型副本；我们要的只是"让她做个表情/动一下手"，
 * 用 VTS 自己的 28 个热键就够了，不需要热部署任何文件。
 *
 * 三条硬规矩：
 *   1. **本机回环**：VTS 的 API 只在本机，`ws://127.0.0.1:8001`
 *   2. **热键 id 必须完整 32 位**：用短 id 会报 `errorID 202`（踩过）
 *   3. **失败不装成功**：VTS 没开、没授权、模型没加载，都要如实报错
 */

/** VTS 的默认端口。用户可能在设置里改，所以可覆盖。 */
export const DEFAULT_VTS_PORT = 8001;

/** 这些是"控制器"级别的参数（VTS 允许注入），不是 Live2D 内部参数。 */
export const FACE_PARAMETERS = Object.freeze({
  angleX: 'FaceAngleX',
  angleY: 'FaceAngleY',
  angleZ: 'FaceAngleZ',
  positionX: 'FacePositionX',
  positionY: 'FacePositionY',
  positionZ: 'FacePositionZ',
  eyeOpenLeft: 'EyeOpenLeft',
  eyeOpenRight: 'EyeOpenRight',
});

import { createWebSocket } from './ws.js';

const API = 'VTubeStudioPublicAPI';
const VERSION = '1.0';

/** 把一坨 JSON 变成一条 VTS 请求。 */
function frame(type, data, extra = {}) {
  // 2026-11-04：`data` 为空时**完全不要带这个字段**。
  // 带上 `data: {}` 会让 VTS 对某些请求（CurrentModelRequest 等）返回一条**空消息**，
  // 客户端如果再把空串 parse 掉，就变成"请求发出去了、回复永远等不到"。
  const body = data === undefined || data === null ? {} : { data };
  return JSON.stringify({ apiName: API, apiVersion: VERSION, messageType: type, ...body, ...extra });
}

/**
 * @param deps.port       VTS 端口，默认 8001
 * @param deps.pluginName 插件名（首次会弹窗让你允许）
 * @param deps.token      已保存的 token（有就直接认证，不弹窗）
 * @param deps.onToken    拿到新 token 时的回调（落盘用）
 */
export function createVtsClient(deps = {}) {
  const port = Number.isFinite(deps.port) ? deps.port : DEFAULT_VTS_PORT;
  /*
   * 2026-11-04 踩到：**VTS 的 token 是绑定 pluginName 的**。
   * 用 A 名字申请的 token，换 B 名字去认证会被拒——表现是"认证悄悄失败，
   * 然后退到申请新 token，等一个永远不会有人点的弹窗"。
   * 所以名字必须和当初授权时一致；默认值沿用已经授权过的那个。
   */
  const pluginName = String(deps.pluginName ?? 'StarKeyBridge');
  const pluginDeveloper = String(deps.pluginDeveloper ?? 'StarKey');
  const onToken = typeof deps.onToken === 'function' ? deps.onToken : () => {};
  /** 构造时给的 token 记住；connect() 不传参就用它（踩过：忘了传就退到弹窗流程）。 */
  let savedToken = typeof deps.token === 'string' ? deps.token.trim() : '';

  let socket;
  let connected = false;
  let authenticated = false;
  let seq = 0;
  const pending = new Map();
  let lastError;

  /** 一条请求等回复。超时用 `vts/timeout`，好区分"没连上"和"连上了不理我"。 */
  function call(type, data, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      if (socket === undefined || socket.isOpen !== true) {
        const error = new Error('VTS 没连上（它没开，或者 API 没开）');
        error.code = 'vts/closed';
        reject(error);
        return;
      }
      seq += 1;
      const requestID = `sk-${seq}`;
      const timer = setTimeout(() => {
        pending.delete(requestID);
        const error = new Error(`VTS 没回 ${type}（${timeoutMs}ms）`);
        error.code = 'vts/timeout';
        reject(error);
      }, timeoutMs);
      timer.unref?.();
      pending.set(requestID, { resolve, reject, timer });
      try {
        socket.send(frame(type, data, { requestID }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(requestID);
        reject(error);
      }
    });
  }

  function settle(message) {
    const id = message?.requestID;
    const slot = typeof id === 'string' ? pending.get(id) : undefined;
    if (slot === undefined) return false;
    pending.delete(id);
    clearTimeout(slot.timer);
    if (message.messageType === 'APIError') {
      const data = message.data ?? {};
      const error = new Error(data.message ?? 'VTS 报错');
      error.code = `vts/${data.errorID ?? 'error'}`;
      error.errorID = data.errorID;
      slot.reject(error);
      return true;
    }
    slot.resolve(message.data ?? {});
    return true;
  }

  function rejectAll(reason) {
    for (const [id, slot] of pending) {
      pending.delete(id);
      clearTimeout(slot.timer);
      const error = new Error(reason);
      error.code = 'vts/closed';
      slot.reject(error);
    }
  }

  return {
    get connected() {
      return connected && authenticated;
    },
    get lastError() {
      return lastError;
    },
    port,

    /** 连上并认证。已经认证过就直接返回。 */
    /**
     * 只试「连上 + 用现有 token 认证」，**绝不申请新 token**。
     *
     * 为什么需要它：申请新 token 会让 VTS 弹一个授权窗口，等一个可能
     * 永远没人点的确认——设置页"读一次状态"绝不能被这种事挂住 90 秒。
     * 设置页、健康检查都用这个；只有她真的要用身体时才走 connect()。
     */
    async probe(token) {
      if (connected && authenticated) return { ok: true };
      if (socket !== undefined) {
        try {
          socket.close();
        } catch {
          /* 已经关了 */
        }
        socket = undefined;
      }
      connected = false;
      authenticated = false;

      const ws = createWebSocket({ port, path: '/', timeoutMs: 2500 });
      ws.on('message', (raw) => {
        if (typeof raw !== 'string' || raw === '') return;
        let message;
        try {
          message = JSON.parse(raw);
        } catch {
          return;
        }
        settle(message);
      });
      ws.on('close', () => {
        connected = false;
        authenticated = false;
        rejectAll('VTS 连接断开了');
      });
      socket = ws;
      try {
        await ws.start();
        connected = true;
      } catch (error) {
        socket = undefined;
        throw Object.assign(new Error('连不上 VTS（它没开，或者 API 没开）'), { code: 'ws/closed', cause: error });
      }

      const useToken = typeof token === 'string' && token.trim() !== '' ? token.trim() : savedToken;
      if (useToken === '') {
        const error = new Error('还没有授权过（第一次要在 VTS 里点一次「允许」）');
        error.code = 'vts/no-token';
        throw error;
      }
      const result = await call('AuthenticationRequest', { ...pluginAuth(), authenticationToken: useToken }, 4000);
      authenticated = result.authenticated === true;
      if (!authenticated) throw Object.assign(new Error('VTS 说这个 token 无效'), { code: 'vts/denied' });
      return { ok: true };
    },

    async connect(token) {
      if (connected && authenticated) return { ok: true, reused: true };
      if (socket !== undefined) {
        try {
          socket.close();
        } catch {
          /* 已经关了 */
        }
        socket = undefined;
      }
      connected = false;
      authenticated = false;

      /*
       * 2026-11-04：不用 Node 自带的 WebSocket。
       * 它握手时带 permessage-deflate，VTS 对这种握手只回一条**空帧**——
       * 表现是"请求发出去了、回复永远等不到"，查了很久。
       * 自己的 ws.js 明确不请求压缩，VTS 就正常回 JSON 了。
       */
      const ws = createWebSocket({ port, path: '/' });
      ws.on('message', (raw) => {
        if (typeof raw !== 'string' || raw === '') return;
        let message;
        try {
          message = JSON.parse(raw);
        } catch {
          return;
        }
        settle(message);
      });
      ws.on('close', () => {
        connected = false;
        authenticated = false;
        rejectAll('VTS 连接断开了');
      });
      ws.on('error', (error) => {
        lastError = error instanceof Error ? error.message : String(error);
      });
      await new Promise((resolve, reject) => {
        ws.start().then(() => {
          connected = true;
          resolve();
        }, (error) => {
          lastError = error?.message ?? String(error);
          reject(Object.assign(new Error('连不上 VTS（它没开，或者 API 没开）'), { code: 'ws/closed', cause: error }));
        });
      });
      socket = ws;

      // 有 token 就先试认证；失败再走"申请新 token"那条
      const useToken = typeof token === 'string' && token.trim() !== '' ? token.trim() : savedToken;
      if (useToken !== '') {
        try {
          const result = await call('AuthenticationRequest', { ...pluginAuth(), authenticationToken: useToken });
          authenticated = result.authenticated === true;
          if (authenticated) return { ok: true, reused: true };
        } catch {
          /* token 过期了，往下走 */
        }
      }

      // 20 秒：够一个真人看到弹窗点「允许」，又不至于把调用方挂死
      const fresh = await call('AuthenticationTokenRequest', pluginAuth(), 20_000);
      const granted = fresh.authenticationToken;
      if (typeof granted !== 'string' || granted === '') throw Object.assign(new Error('VTS 没给 token'), { code: 'vts/no-token' });
      const confirmed = await call('AuthenticationRequest', { ...pluginAuth(), authenticationToken: granted });
      if (confirmed.authenticated !== true) throw Object.assign(new Error('VTS 拒绝了授权'), { code: 'vts/denied' });
      authenticated = true;
      savedToken = granted;
      onToken(granted);
      return { ok: true, token: granted };
    },

    close() {
      connected = false;
      authenticated = false;
      rejectAll('客户端关闭');
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      socket = undefined;
    },

    call,

    /** 当前模型的信息（名字、id、加载没）。 */
    async currentModel() {
      const data = await call('CurrentModelRequest', undefined);
      return { name: data.modelName ?? '', id: data.modelID ?? '', loaded: data.modelLoaded === true };
    },

    /** 当前模型的热键清单：`{ name, id, type }[]`。 */
    async hotkeys() {
      const data = await call('HotkeysInCurrentModelRequest');
      const list = Array.isArray(data.availableHotkeys) ? data.availableHotkeys : [];
      return list
        .filter((h) => h && typeof h.hotkeyID === 'string' && typeof h.name === 'string')
        .map((h) => ({ name: h.name, id: h.hotkeyID, type: String(h.type ?? ''), file: h.file ?? '' }));
    },

    /** 按完整 hotkeyID 触发。**不要传短 id**，VTS 会报 errorID 202。 */
    async trigger(hotkeyId) {
      if (typeof hotkeyId !== 'string' || hotkeyId.length < 32) {
        throw Object.assign(new Error('热键 id 不完整（VTS 要 32 位）'), { code: 'vts/bad-hotkey' });
      }
      const data = await call('HotkeyTriggerRequest', { hotkeyID: hotkeyId });
      return { id: data.hotkeyID ?? hotkeyId };
    },

    /** 表情清单（含文件与是否在用）。 */
    async expressions() {
      const data = await call('ExpressionStateRequest', { details: true });
      const list = Array.isArray(data.expressions) ? data.expressions : [];
      return list.map((e) => ({ name: e.name ?? '', file: e.file ?? '', active: e.active === true }));
    },

    /** 直接开关某个表情文件（不必走热键）。 */
    async setExpression(file, active) {
      await call('ExpressionActivationRequest', { expressionFile: file, active: active === true });
    },

    /**
     * 注入控制器参数：歪头、点头、前倾、睁闭眼。
     *
     * **VTS 只接受它自己的参数名**（`FaceAngleZ` 这类）；
     * 直接写 Live2D 的 `ParamAngleZ` 会报 `errorID 453`（踩过）。
     */
    async inject(values) {
      const parameterValues = Object.entries(values ?? {})
        .filter(([, value]) => Number.isFinite(value))
        .map(([id, value]) => ({ id, value }));
      if (parameterValues.length === 0) return { count: 0 };
      await call('InjectParameterDataRequest', { faceFound: false, mode: 'set', parameterValues });
      return { count: parameterValues.length };
    },
  };

  function pluginAuth() {
    return { pluginName, pluginDeveloper };
  }
}
