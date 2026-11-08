import { spawn } from 'node:child_process';
/**
 * The two consoles her partner opens from the QQ card, both reached from this machine only.
 *
 * qq-bridge writes its console token into `<bridge>/state/console-token`, so that door needs nothing from him:
 * read the file, put the token in the URL, done.
 *
 * SnowLuma's console is different. Its session token lives in the bridge process's memory (a fresh 64-hex
 * string per login, dead on restart) and the only way to get one is `POST /api/login` with the panel password.
 * So he types that password exactly once; it is kept in `<world>/panel.json` with mode 600 and used from then
 * on to trade for a token behind his back. The page itself takes `?token=` and wipes it off the address bar.
 */
export declare const PANEL_FILE = "panel.json";
export interface PanelUrl {
    url: string;
}
export interface PanelNeeds {
    needs: 'password';
    url?: string;
    username?: string;
}
export interface PanelError {
    error: string;
}
export type PanelResult = PanelUrl | PanelNeeds | PanelError;
/** Where SnowLuma's console listens, learned from its own config; undefined when it is not installed here. */
export declare function findSnowlumaConsole(homeDir: string): {
    base: string;
    username?: string;
} | undefined;
/** The panel password he typed once, kept beside her room rather than inside her world settings. */
export declare function createPanelSecrets(worldDir: string): {
    read: () => {
        username: string;
        password: string;
    } | undefined;
    remember(username: string, password: string): void;
    forget(): void;
};
export type PanelSecrets = ReturnType<typeof createPanelSecrets>;
/** Trades the panel password for a session token and hands back a URL that opens already logged in. */
export declare function loginSnowluma(base: string, username: string, password: string, fetchImpl?: typeof fetch): Promise<PanelResult>;
/** qq-bridge's console token is a file next to its state; the page takes it in the URL too. */
export declare function readBridgeToken(bridgeDir: string): string;
export declare function bridgeConsoleUrl(bridgeDir: string, port: number): PanelResult;
/** The two doors the QQ card's buttons knock on. */
export interface ConsoleDoors {
    qq(): PanelResult;
    snowluma(): Promise<PanelResult>;
    remember(username: string, password: string): Promise<PanelResult>;
    /** Hand a console URL to the desktop's own browser; neither console allows being framed. */
    open(kind: 'qq' | 'snowluma'): Promise<{
        opened: true;
    } | {
        error: string;
    }>;
}
/**
 * Both consoles send `X-Frame-Options: DENY` (SnowLuma also `frame-ancestors 'none'`), so no page of ours can
 * hold them in a frame. Opening the desktop's own browser is the honest way in: it is where these consoles were
 * meant to run, and the token rides in the URL so it lands already logged in.
 */
export declare function openInBrowser(url: string, spawnImpl?: typeof spawn): {
    opened: true;
} | {
    error: string;
};
/** Where SnowLuma itself lives, as the bridge already knows it (`snowluma.homeDir` in its config). */
export declare function readSnowlumaHome(bridgeDir: string): string;
export declare function createConsoleDoors(options: {
    worldDir: string;
    bridgeDir: string;
    port: number;
    snowlumaHome?: string;
}): ConsoleDoors;
