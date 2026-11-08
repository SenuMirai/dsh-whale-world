/**
 * 她的身体 · 工具层（2026-11-04）
 *
 * 三个工具：
 *   · make_face   做表情（爱心眼、脸红、圈圈眼、流泪……）
 *   · gesture     双手动作（抚胸、竖指、狗尾草，打开/收起）
 *   · body_tilt   歪头、点头、前倾、转头（连续调）
 *
 * ── 三条设计口径 ──
 *
 * ① **VTS 没开不是错误，是事实。** 失败信息写成给人看的中文
 *    （"VTS 没开，我现在动不了"），不把 `ECONNREFUSED` 这种漏给她。
 *    她可以照实跟主人说，也可以干脆不提。
 *
 * ② **7ms 快速失败。** 实测连一个没人听的端口 7ms 就返回，
 *    所以代价几乎为零，不需要"启动时探测再决定挂不挂"。
 *
 * ③ **表情名要防错。** VTS 里的名字是中文（爱心眼/圈圈眼/＞＜），
 *    她可能说"开心"、"害羞"这种情绪词。这里做一层映射，
 *    映射不到就**如实说"没有这个表情，现有的是…"**，不瞎猜。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { FACE_PARAMETERS } from './vts.js';

/** 情绪词 → VTS 表情名。她按情绪想，不必记 21 个中文名。 */
const MOOD_ALIASES = Object.freeze({
  开心: '爱心眼',
  高兴: '爱心眼',
  喜欢: '爱心眼',
  爱: '爱心眼',
  心动: '爱心眼',
  害羞: '脸红',
  脸红: '脸红',
  不好意思: '脸红',
  窘: '脸红',
  // 2026-11-04：这个表情在 VTS 里实际叫「流泪」，不是「落泪」。
  // 名字写错不会报错，只会让"难过"变成"没有这个表情"——必须对着真实清单写。
  难过: '流泪',
  伤心: '流泪',
  哭: '流泪',
  委屈: '流泪',
  生气: '黑脸',
  不高兴: '黑脸',
  无语: '屑屑眼',
  嫌弃: '屑屑眼',
  疑惑: '圈圈眼',
  晕: '圈圈眼',
  懵: '圈圈眼',
  紧张: '流冷汗',
  尴尬: '流冷汗',
  害怕: '流冷汗',
  震惊: '＞＜',
  惊讶: '＞＜',
  无语额: '＞＜',
  得意: '大牙',
  开心笑: '大牙',
  思考: '单片眼镜',
  认真: '黑框眼镜',
  装傻: '钢盆',
  大钢盆: '钢盆',
});

/** 双手动作：一组两个热键（打开/收起）。 */
const GESTURES = Object.freeze({
  抚胸: { open: '抚胸手打开', close: '抚胸手关闭' },
  竖指: { open: '竖手指打开', close: '竖手指关闭' },
  狗尾草: { open: '狗尾巴草打开', close: '狗尾巴草关闭' },
});

/** 她可能说的别名 */
const GESTURE_ALIASES = Object.freeze({
  抚胸: '抚胸',
  抚胸致意: '抚胸',
  手放胸口: '抚胸',
  竖指: '竖指',
  竖手指: '竖指',
  指: '竖指',
  食指: '竖指',
  狗尾草: '狗尾草',
  狗尾巴草: '狗尾草',
  草: '狗尾草',
});

/** body_tilt 的动作 → VTS 控制器参数与角度 */
const POSE_PRESETS = Object.freeze({
  歪头左: { [FACE_PARAMETERS.angleZ]: -14 },
  歪头右: { [FACE_PARAMETERS.angleZ]: 14 },
  点头: { [FACE_PARAMETERS.angleX]: 10 },
  抬头: { [FACE_PARAMETERS.angleX]: -10 },
  转头左: { [FACE_PARAMETERS.angleY]: -18 },
  转头右: { [FACE_PARAMETERS.angleY]: 18 },
  前倾: { [FACE_PARAMETERS.positionZ]: 6 },
  后退: { [FACE_PARAMETERS.positionZ]: -6 },
  回正: {
    [FACE_PARAMETERS.angleX]: 0,
    [FACE_PARAMETERS.angleY]: 0,
    [FACE_PARAMETERS.angleZ]: 0,
    [FACE_PARAMETERS.positionX]: 0,
    [FACE_PARAMETERS.positionY]: 0,
    [FACE_PARAMETERS.positionZ]: 0,
  },
});

const textOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
};

/** VTS 没开时，她看到的那句话。给人看，不像报错。 */
const offlineText = (detail) =>
  `VTS 没开，我现在动不了。\n（VTube Studio 没启动，或者它的 API 没打开。${detail ?? ''}）`.trim();

/**
 * @param deps.client  createVtsClient() 的返回值（懒连接，用的时候才连）
 */
export function bodyTools(deps = {}) {
  const getClient = typeof deps.client === 'function' ? deps.client : () => deps.client;
  const preferredFace = typeof deps.preferredFace === 'string' ? deps.preferredFace : '';

  /** 执行一次身体操作：连上 → 跑 → 断开。失败统一转成人话。 */
  async function withBody(work) {
    const client = getClient();
    if (client === undefined || client === null) return { ok: false, text: offlineText('没有配置 VTS 连接') };
    let connected = false;
    try {
      await client.connect();
      connected = true;
      return await work(client);
    } catch (error) {
      const code = error?.code ?? '';
      if (code === 'ws/closed' || code === 'ws/timeout' || code === 'vts/timeout') {
        return { ok: false, text: offlineText('连接不上 127.0.0.1:8001') };
      }
      if (code === 'vts/51') {
        return {
          ok: false,
          text: 'VTS 正在等授权：它弹了一个窗口问我能不能用，得有人在电脑前点一下「允许」。',
        };
      }
      return { ok: false, text: `想动一下没成功：${error?.message ?? error}` };
    } finally {
      if (connected) {
        try {
          client.close();
        } catch {
          /* 关不掉也没什么可做的 */
        }
      }
    }
  }

  /** 名字 → 真实存在的表情。返回 { name, file } 或 { error } */
  async function resolveFace(client, wanted) {
    const list = await client.expressions();
    const raw = String(wanted ?? '').trim();
    if (raw === '') return { error: '没说要哪个表情' };
    const byName = new Map(list.map((e) => [e.name, e]));
    // ① 直接命中中文名
    if (byName.has(raw)) return byName.get(raw);
    // ② 情绪词映射
    const mapped = MOOD_ALIASES[raw];
    if (mapped !== undefined && byName.has(mapped)) return byName.get(mapped);
    // ③ 包含关系（"爱心" → "爱心眼"）
    const partial = list.find((e) => e.name.includes(raw) || raw.includes(e.name));
    if (partial !== undefined) return partial;
    const names = list.map((e) => e.name).filter(Boolean);
    return { error: `没有「${raw}」这个表情。现有的是：${names.join('、')}` };
  }

  const makeFace = defineTool({
    name: 'make_face',
    description:
      `做个表情。可以直接给表情名（爱心眼、圈圈眼、脸红、落泪、流冷汗、＞＜、屑屑眼、大牙、黑脸、钢盆、单片眼镜、黑框眼镜），` +
      `也可以给情绪词（开心、害羞、难过、生气、疑惑、紧张、震惊、得意……会自动找一个合适的）。` +
      `off=true 是把这个表情收回去，off=true 且不给名字是把所有表情都清掉。` +
      (preferredFace !== '' ? `平时更常用「${preferredFace}」。` : ''),
    parameters: {
      name: { type: 'string' },
      off: { type: 'boolean' },
    },
    output: textOutput,
    execute: async ({ name, off }) => {
      const wanted = typeof name === 'string' ? name.trim() : '';
      if (off === true) {
        const result = await withBody(async (client) => {
          if (wanted === '') {
            // 全清：走「移除所有按键」那个热键
            const hotkeys = await client.hotkeys();
            const clear = hotkeys.find((h) => h.type === 'RemoveAllExpressions') ?? hotkeys.find((h) => h.name.includes('移除'));
            if (clear === undefined) {
              const list = await client.expressions();
              for (const e of list) if (e.active) await client.setExpression(e.file, false);
              return { ok: true, text: '表情都收起来了。' };
            }
            await client.trigger(clear.id);
            return { ok: true, text: '表情都收起来了。' };
          }
          const face = await resolveFace(client, wanted);
          if (face.error !== undefined) return { ok: false, text: face.error };
          await client.setExpression(face.file, false);
          return { ok: true, text: `把「${face.name}」收起来了。` };
        });
        return result.text;
      }

      if (wanted === '') return '要说做哪个表情（比如「脸红」「爱心眼」），或者说 off=true 收起来。';
      const result = await withBody(async (client) => {
        const face = await resolveFace(client, wanted);
        if (face.error !== undefined) return { ok: false, text: face.error };
        await client.setExpression(face.file, true);
        return { ok: true, text: `做了个「${face.name}」。` };
      });
      return result.text;
    },
  });

  const gesture = defineTool({
    name: 'gesture',
    description:
      `做个手上的动作。可选：抚胸（手放在胸口）、竖指（竖起食指）、狗尾草（拿起狗尾草）。` +
      `off=true 是收回去。这些是模型自带的原生动作，会真的动起来。`,
    parameters: {
      name: { type: 'string' },
      off: { type: 'boolean' },
    },
    output: textOutput,
    execute: async ({ name, off }) => {
      const raw = String(name ?? '').trim();
      const key = GESTURE_ALIASES[raw] ?? (GESTURES[raw] !== undefined ? raw : undefined);
      if (key === undefined) return `没有「${raw || '(空)'}」这个动作。能做的是：抚胸、竖指、狗尾草。`;
      const group = GESTURES[key];
      const target = off === true ? group.close : group.open;
      const result = await withBody(async (client) => {
        const hotkeys = await client.hotkeys();
        const found = hotkeys.find((h) => h.name === target);
        if (found === undefined) {
          const have = hotkeys.filter((h) => h.type === 'TriggerAnimation').map((h) => h.name);
          return { ok: false, text: `模型里没有「${target}」这个动作。现在能做的：${have.join('、')}` };
        }
        await client.trigger(found.id);
        return { ok: true, text: off === true ? `把「${key}」收回去了。` : `做了个「${key}」。` };
      });
      return result.text;
    },
  });

  const bodyTilt = defineTool({
    name: 'body_tilt',
    description:
      `动一下头或者身体。可选：歪头左、歪头右、点头、抬头、转头左、转头右、前倾、后退、回正。` +
      `也可以给自定义角度：pitch（上下，正数低头）、yaw（左右转头）、roll（歪头）、lean（前后）。角度单位是度。`,
    parameters: {
      pose: { type: 'string' },
      pitch: { type: 'number' },
      yaw: { type: 'number' },
      roll: { type: 'number' },
      lean: { type: 'number' },
      hold: { type: 'number' },
    },
    output: textOutput,
    execute: async ({ pose, pitch, yaw, roll, lean, hold }) => {
      const values = {};
      const preset = POSE_PRESETS[String(pose ?? '').trim()];
      if (preset !== undefined) Object.assign(values, preset);
      if (Number.isFinite(pitch)) values[FACE_PARAMETERS.angleX] = Math.max(-30, Math.min(30, pitch));
      if (Number.isFinite(yaw)) values[FACE_PARAMETERS.angleY] = Math.max(-30, Math.min(30, yaw));
      if (Number.isFinite(roll)) values[FACE_PARAMETERS.angleZ] = Math.max(-90, Math.min(90, roll));
      if (Number.isFinite(lean)) values[FACE_PARAMETERS.positionZ] = Math.max(-10, Math.min(10, lean));
      if (Object.keys(values).length === 0) {
        return `要给一个姿势（歪头左/点头/前倾/回正…），或者给角度（pitch/yaw/roll/lean）。`;
      }
      const holdMs = Number.isFinite(hold) ? Math.max(0, Math.min(10_000, hold)) : 0;
      const result = await withBody(async (client) => {
        await client.inject(values);
        if (holdMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, holdMs));
          await client.inject(POSE_PRESETS['回正']);
          return { ok: true, text: `动了一下，${(holdMs / 1000).toFixed(1)} 秒后回正了。` };
        }
        return { ok: true, text: '动了一下。' };
      });
      return result.text;
    },
  });

  return [makeFace, gesture, bodyTilt];
}

export { MOOD_ALIASES, GESTURES, POSE_PRESETS };
