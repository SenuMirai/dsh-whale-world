import { existsSync, readFileSync, rmSync } from 'node:fs';
import { durableWrite } from "./life/lifeStore.js";

/**
 * 她的人设：`<world>/persona.md` 里的一整段文本。
 *
 * ── 2026-10-28 改成纯文本 ────────────────────────────────────────────────
 * 原来这里是「六层结构」：文件里写 `## 名字` / `## 她是谁` / `## 性格` …
 * 每一层单独解析、单独编辑、再拼回一段话给提示词。
 *
 * 问题出在 QQ 插件那边：它同步进来的是**整段纯文本角色卡**（254 行、带自己的层级）。
 * 两边格式不同，就成了「两边都能改同一份真相」的经典冲突：
 *   · 世界控制台按六层解析 → 读到的全是空
 *   · 谁在那页点保存 → writePersona 把整段角色卡改写成只有层头的空壳
 *   · QQ 插件下次同步又写回去 → 来回踩，角色卡随时会丢
 *
 * 现在统一成整段纯文本：
 *   · 文件里存什么，就原样给她看
 *   · 世界控制台也改成一个大文本框，编辑的就是这段原文
 *   · QQ 插件写进来什么，这边读到的就是什么，不会再被格式化搞坏
 *
 * 保留 PERSONA_LAYERS 只是为了让旧调用方不炸；它现在只用于「旧格式识别」。
 */

/** @deprecated 六层结构已废弃，仅为兼容旧数据保留名单。 */
export const PERSONA_LAYERS = ['名字', '她是谁', '性格', '说话方式', '愿景', '补充'];

/**
 * 读她的整段人设原文。
 * 文件不存在、读不了，都当「还没写」，返回空串。
 */
export function readPersonaText(file) {
  try {
    if (!existsSync(file)) return '';
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * 写她的整段人设原文。
 * 空文本视为「清空人设」——删掉文件，让她回到宿主默认。
 */
export function writePersonaText(file, text) {
  const body = typeof text === 'string' ? text : '';
  if (body.trim() === '') {
    rmSync(file, { force: true });
    return;
  }
  // 保证以换行结尾，避免和后续拼接粘在一行
  durableWrite(file, body.endsWith('\n') ? body : `${body}\n`);
}

/**
 * 兼容层：老代码按层调用。
 * 现在整段文本放在 `全文` 这一层里；其余层永远是空。
 */
export function readPersona(file) {
  const text = readPersonaText(file);
  const out = Object.fromEntries(PERSONA_LAYERS.map((layer) => [layer, '']));
  out['全文'] = text;
  return out;
}

/**
 * 兼容层：老代码按层写入。
 *
 * ⚠️ 这里以前是 `writePersonaText(file, persona?.全文 ?? '')` ——
 * 只要调用方没带 `全文`（比如还没刷新的旧控制台发来的六层对象），
 * 就会把文件写成空串，等于**把整套角色卡删掉**。
 *
 * 现在改成：没有 `全文` 就当作「什么都不改」，绝不删除已有内容。
 * 想清空只能显式传 `全文: ''`（新控制台走的是 savePersonaText，不受影响）。
 */
export function writePersona(file, persona) {
  if (persona === null || persona === undefined) return;
  if (!('全文' in persona)) return; // 没有全文层 = 不认识的旧格式，不写
  writePersonaText(file, persona['全文'] ?? '');
}

/**
 * 她读到的样子。改成纯文本之后就是原文本身 —— 不再拼层。
 * 空的时候返回空串，调用方自己去用宿主默认。
 */
export function renderPersona(personaOrText) {
  if (typeof personaOrText === 'string') return personaOrText;
  if (personaOrText === null || personaOrText === undefined) return '';
  return personaOrText['全文'] ?? '';
}
