import type { LifeOptions } from './life/types.ts';
/** The template shipped with the plugin; a `world-prompt.md` in the world directory replaces it. */
export declare const DEFAULT_TEMPLATE_FILE: string;
export interface WorldNames {
    companion: string;
    partner: string;
}
/** No name is assumed for anyone's companion: an unnamed one is the neutral TA. */
export declare function worldNames(config: {
    companionName?: string;
    partnerName?: string;
}): WorldNames;
export declare const homeTitle: (names: WorldNames) => string;
/** Her room as a workspace in the host's sidebar. */
export declare const roomTitle: (names: WorldNames) => string;
export interface WorldPrompt {
    /** Her template, when present; the shipped default otherwise. */
    file?: string;
    /** Her layered persona (`persona.md`), placed above the world prompt when written. */
    persona?: string;
    /** Where the daily exports of her archive are (`<world>/conversations`). */
    conversationsDir?: string;
    names: WorldNames;
    /** Present when the life line runs: room, diary, world line, ask-first rules. */
    life?: LifeOptions;
}
export interface TemplateRead {
    text: string;
    error?: string;
}
/** Never throws: a template that cannot be read falls back to the shipped one and says why. */
export declare function readTemplate(file: string | undefined): TemplateRead;
/**
 * A small Mustache subset: `{{#flag}}…{{/flag}}` keeps its body when the flag is on, `{{^flag}}…{{/flag}}`
 * when it is off (different flags may nest), and `{{name}}` is replaced in one pass, so values such as her
 * 我是谁 are never scanned for tags themselves. Unknown names stay as written.
 */
export declare function renderTemplate(template: string, flags: Record<string, boolean>, values: Record<string, string>): string;
/**
 * The one world prompt every world session carries in its system prompt. `template` and `self` are read at
 * session start and after compaction only, so the prompt does not change between compactions. The world
 * line's tools live in the home alone; the template tells other sessions where to find them.
 */
export declare function renderWorldPrompt(prompt: WorldPrompt, template: string, self: {
    file: string;
    text: string;
} | undefined, home: boolean): string;
