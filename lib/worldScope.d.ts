import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Session } from '@deepseek-ai/dsh-session';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
/**
 * Her world reaches only the sessions of her room's workspace (plus her persona, which follows the preset). A
 * session can join or leave the workspace at any time, so every way in checks again where it matters: before an
 * injection, after every wait, and when a tool runs.
 */
export type InWorld = (session: Session) => boolean;
export declare class OutsideWorldError extends Error {
    constructor();
}
/** The agent, if it is (still) in her world; without a predicate every agent is. */
export declare function admit(inWorld: InWorld | undefined, agent: Agent): Agent;
/** The tool, refusing to run once its agent has left her world; `left` lets the owner take it away. */
export declare function scopedTool(tool: ToolDefinition, inside: () => boolean, left?: () => void): ToolDefinition;
/**
 * Membership can change after `agent/created`, so whatever a session's world providers depend on is synced as its
 * system prompt is assembled; when `sync` changed something, the prompt is assembled again to include it.
 */
export declare function reassembleOnChange(ctx: Context, sync: (agent: Agent) => boolean): () => void;
