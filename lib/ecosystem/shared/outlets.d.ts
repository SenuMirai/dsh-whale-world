/**
 * Outlets: where her words go outside DSH. dsh-world knows no app by name; each outlet is a URL from the
 * config that receives the documented push below. Any local app (a desktop pet, a tray app) can be one.
 */
export type PushKind = 'reply' | 'busy' | 'reach';
/** The body every outlet receives as JSON. `images` are picture URLs from her markdown; `image` is the expression name reach_out was given. */
export interface Push {
    text: string;
    kind: PushKind;
    name: string;
    images?: string[];
    image?: string;
}
export interface OutletConfig {
    name: string;
    /** The full URL; `{origin}` is the DSH web server's own origin. */
    url?: string;
    /** A JSON file holding `baseUrl` (read before every push, so a new port is picked up), joined with `path`. */
    urlFile?: string;
    path?: string;
    /** What it receives; all kinds when absent. */
    kinds?: PushKind[];
}
export interface Outlet {
    name: string;
    kinds: readonly PushKind[];
    send(push: Push): Promise<void>;
}
export declare const busyText: (name: string) => string;
/**
 * Her markdown as an outlet shows it: sticker images apart, the text plain with its line breaks.
 * A reply that is only stickers keeps their alt text, because an outlet may drop a push without text.
 */
export declare function plainMessage(markdown: string, origin?: string): {
    text: string;
    images: string[];
};
export declare function pushOf(markdown: string, kind: PushKind, name: string, origin?: string, image?: string): Push;
export declare function readBaseUrl(file: string): string;
/** Resolved before every push: the DSH origin and an app's port can both change between runs. */
export declare function outletUrl(config: OutletConfig, origin: () => string): string;
/** A push counts as delivered on a 2xx whose JSON, if any, does not say `ok: false`. */
export declare function createOutlet(config: OutletConfig, origin: () => string, fetchImpl?: typeof fetch): Outlet;
