import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type SpeakerIdentity } from './identity.ts';
import type { LifeHost } from '../../life/host.ts';
import type { ArchiveStore } from '../../store.ts';
export declare function createChannelSessions(deps: {
    ctx: Context;
    host: LifeHost;
    store: Pick<ArchiveStore, 'channelSession' | 'bindChannelSession'>;
    roomDir: string;
    roomTitle: string;
    agentPreset: string;
}): {
    open(identity: SpeakerIdentity): Promise<Agent>;
    stop(): void;
};
