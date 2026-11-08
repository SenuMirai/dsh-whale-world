import { type ContentBlock } from '@deepseek-ai/dsh-llm';
import { type SessionEvent } from '@deepseek-ai/dsh-session';
import type { ArchiveScope, ConversationRecord } from './types.ts';
export declare const conversationRecordId: (worldId: string, sessionId: string, messageId: string) => string;
export declare function visibleText(content: readonly ContentBlock[]): string;
export declare function extractConversationRecords(event: SessionEvent, scope: ArchiveScope): ConversationRecord[];
