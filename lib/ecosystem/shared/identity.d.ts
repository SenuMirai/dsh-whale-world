export interface SpeakerIdentity {
    channel: string;
    accountId: string;
    conversationId: string;
    speakerId: string;
    speakerName?: string;
    conversationType?: 'private' | 'group';
    conversationName?: string;
    platformMessageId?: string;
    mentionIds?: string[];
}
/** Structured adapter metadata only; message text is never an identity source. */
export declare function speakerIdentity(value: unknown): SpeakerIdentity;
export declare function conversationKey(identity: SpeakerIdentity): string;
export declare function identityPrefix(identity: SpeakerIdentity): string;
