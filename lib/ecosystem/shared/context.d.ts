import { type SpeakerIdentity } from './identity.ts';
export interface ChannelImage {
    file: string;
    quality: 'original' | 'cached' | 'thumbnail';
}
export interface ChannelContextMessage {
    id: string;
    occurredAt: string;
    text: string;
    identity: SpeakerIdentity;
    image?: ChannelImage;
}
export declare function channelContext(value: unknown, current: SpeakerIdentity, limit?: number): ChannelContextMessage[];
export declare function channelMedia(value: unknown, current: SpeakerIdentity): ChannelContextMessage[];
