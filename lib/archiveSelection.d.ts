import type { Context } from '@deepseek-ai/cordis';
export type MemoryArchiveScope = 'home' | 'workspace';
export declare const validArchiveScope: (value: unknown) => value is MemoryArchiveScope;
/** Workspace membership comes from the host, never a preset or a display name. */
export declare function createArchiveSelection(ctx: Context, scope: MemoryArchiveScope, isHome: (id: string) => boolean, roomDir: string): (id: string) => boolean;
