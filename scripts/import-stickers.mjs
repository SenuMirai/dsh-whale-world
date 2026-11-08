// One-time import of the older sticker plugin's library (catalog.json + assets/) into the world's own sticker library.
// Usage: node scripts/import-stickers.mjs <older library folder, e.g. ~/.dsh/memes> <world folder, e.g. ~/.dsh/worlds/<id>>
// Ids, names and tags carry over; packs and long meanings do not. Running it again adds nothing. The older folder is only read.
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const [legacy, world] = process.argv.slice(2);
if (!legacy || !world) {
  console.error('用法：node scripts/import-stickers.mjs <旧表情包目录> <世界目录>');
  process.exit(2);
}
const modulePath = join(fileURLToPath(new URL('..', import.meta.url)), 'lib', 'ecosystem', 'wechat', 'stickerLibrary.js');
const { createStickerLibrary, importLegacyStickers } = await import(pathToFileURL(modulePath).href);
const library = createStickerLibrary(join(resolve(world), 'stickers'));
const report = await importLegacyStickers(resolve(legacy), library);
console.log(`导入 ${report.imported} 张，已在库里的 ${report.duplicates} 张，跳过 ${report.skipped.length} 张；表情库现有 ${(await library.list()).length} 张。`);
for (const line of report.skipped) console.log(`  跳过 ${line}`);
