/** Her persona in layers, each a `## 名字` section of `<world>/persona.md`, filled in the world console. */
export declare const PERSONA_LAYERS: readonly ["名字", "她是谁", "性格", "说话方式", "愿景", "补充"];
export type PersonaLayer = typeof PERSONA_LAYERS[number];
export type Persona = Record<PersonaLayer, string>;
/** Missing or unreadable means not written yet: every layer empty. */
export declare function readPersona(file: string): Persona;
/** Only layers with text are kept; a persona with none removes the file. */
export declare function writePersona(file: string, persona: Partial<Persona>): void;
/** The persona as she reads it at the top of her system prompt, in her own voice; empty when nothing is written. */
export declare function renderPersona(persona: Persona): string;
