import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
/** The template shipped with the plugin; a `world-prompt.md` in the world directory replaces it. */
export const DEFAULT_TEMPLATE_FILE = fileURLToPath(new URL('../templates/world-prompt.md', import.meta.url));
/** No name is assumed for anyone's companion: an unnamed one is the neutral TA. */
export function worldNames(config) {
    return { companion: config.companionName?.trim() || 'TA', partner: config.partnerName?.trim() || '伙伴' };
}
export const homeTitle = (names) => `${names.companion}的家`;
/** Her room as a workspace in the host's sidebar. */
export const roomTitle = (names) => `${names.companion}的房间`;
/** Never throws: a template that cannot be read falls back to the shipped one and says why. */
export function readTemplate(file) {
    if (file && existsSync(file)) {
        try {
            return { text: readFileSync(file, 'utf8').trim() };
        }
        catch (error) {
            return { text: readFileSync(DEFAULT_TEMPLATE_FILE, 'utf8'), error: `世界提示词模板 ${file} 读不了，先用默认模板：${error instanceof Error ? error.message : String(error)}` };
        }
    }
    return { text: readFileSync(DEFAULT_TEMPLATE_FILE, 'utf8') };
}
const section = /\{\{([#^])(\w+)\}\}([\s\S]*?)\{\{\/\2\}\}/;
/**
 * A small Mustache subset: `{{#flag}}…{{/flag}}` keeps its body when the flag is on, `{{^flag}}…{{/flag}}`
 * when it is off (different flags may nest), and `{{name}}` is replaced in one pass, so values such as her
 * 我是谁 are never scanned for tags themselves. Unknown names stay as written.
 */
export function renderTemplate(template, flags, values) {
    let text = template.replace(/\r\n?/g, '\n');
    for (let match = section.exec(text); match; match = section.exec(text)) {
        const [whole, kind, flag, body] = match;
        text = text.replace(whole, () => (kind === '#') === Boolean(flags[flag]) ? body : '');
    }
    return text.replace(/\{\{(\w+)\}\}/g, (tag, name) => values[name] ?? tag).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
/**
 * The one world prompt every world session carries in its system prompt. `template` and `self` are read at
 * session start and after compaction only, so the prompt does not change between compactions. The world
 * line's tools live in the home alone; the template tells other sessions where to find them.
 */
export function renderWorldPrompt(prompt, template, self, home) {
    const { life, names } = prompt;
    return renderTemplate(template, { life: Boolean(life), home, selfFile: Boolean(self), conversationsDir: Boolean(prompt.conversationsDir) }, {
        name: names.companion, partner: names.partner, homeTitle: homeTitle(names), selfFile: self?.file ?? '', self: self?.text ?? '', conversationsDir: prompt.conversationsDir ?? '',
        ...(life ? { roomDir: life.roomDir, diaryDir: life.diaryDir, fallbackWakeTime: life.fallbackWakeTime } : {}),
    });
}
