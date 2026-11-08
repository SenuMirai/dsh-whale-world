import type { Context } from '@deepseek-ai/cordis';
interface PermissionOption {
    value: string;
    name: string;
    description?: string;
}
/** The host seeds every session; a workspace default overrides that seed only on fresh creation. */
export declare function createWorkspacePermissions(ctx: Context, roomDir: string, settings: {
    workspacePermission(): string;
    setWorkspacePermission(value: string): void;
}): {
    snapshot: () => {
        defaultPermission: string;
        options: PermissionOption[];
    };
    set(permission: string): void;
};
export {};
