import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { channelContext, channelMedia } from "../shared/context.js";
import { conversationKey } from "../shared/identity.js";
export async function admitContextImages(ctx, incomingDir, identity, context) {
    const images = (identity.conversationType === 'private' ? channelMedia(context, identity) : channelContext(context, identity)).filter(message => message.image);
    if (!images.length)
        return [];
    const attachments = ctx.get('attachments');
    if (!attachments)
        throw new Error('Host image attachment storage is unavailable');
    const root = await realpath(incomingDir);
    const key = createHash('sha256').update(conversationKey(identity)).digest('hex');
    const directory = await realpath(join(root, key));
    if (relative(root, directory) !== key)
        throw new Error('Image directory escapes its conversation');
    const inputs = [];
    for (const [index, message] of images.entries()) {
        const file = message.image.file;
        const path = await realpath(join(directory, file));
        if (relative(directory, path) !== file)
            throw new Error('Image file escapes its conversation');
        const handle = await open(path, 'r');
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size < 1 || stat.size > attachments.imageLimits.maxImageBytes)
                throw new Error('Image exceeds attachment limits');
            const data = await handle.readFile();
            if (createHash('sha256').update(data).digest('hex') + '.png' !== file)
                throw new Error('Image digest changed');
            inputs.push({ data, mediaType: 'image/png', name: `微信图片-${index + 1}-${message.image.quality}.png` });
        }
        finally {
            await handle.close();
        }
    }
    const refs = await attachments.saveImages(inputs);
    return refs.flatMap((attachment, index) => [
        { type: 'text', text: `下面这张微信图片的来源：${JSON.stringify({ id: images[index].id, identity: images[index].identity, occurredAt: images[index].occurredAt, quality: images[index].image.quality })}。thumbnail 为缩略图，cached 为微信本机缓存版本，original 为原图档。` },
        { type: 'image', attachment },
    ]);
}
