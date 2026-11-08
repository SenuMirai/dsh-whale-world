import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const stock = /^(\s*name:\s*)(['"]?)@deepseek-ai\/dsh-compaction-basic\2([ \t]*(?:#.*)?\r?)$/gm;
const ours = /^\s*name:\s*['"]?dsh-world\/compaction['"]?\s*$/m;
/**
 * Replaces the profile's stock compaction row with `dsh-world/compaction`, the same edit as
 * `scripts/enable-tool-free-compaction.ps1`: a bundle patch cannot do it, because the stock row is written out in the
 * profile's own `cordis.patch.yml`, which sits above every plugin's patch. It changes the file only when exactly one
 * stock row is there, keeps a backup beside it and swaps atomically; DSH has to be restarted to load the new backend.
 */
export function swapStockCompaction(profileDir) {
    const file = join(profileDir, 'cordis.patch.yml');
    if (!existsSync(file))
        return { status: 'unchanged', reason: 'profile 里没有 cordis.patch.yml' };
    const text = readFileSync(file, 'utf8');
    if (ours.test(text))
        return { status: 'already' };
    const rows = [...text.matchAll(stock)];
    if (rows.length !== 1)
        return { status: 'unchanged', reason: rows.length ? `找到 ${rows.length} 条原版压缩配置，无法确定改哪一条` : '没有找到原版压缩那一行（可能已换成别的压缩，或写法不同）' };
    const backup = `${file}.dsh-world.${randomBytes(16).toString('hex')}.bak`;
    const temporary = `${file}.${randomBytes(16).toString('hex')}.tmp`;
    copyFileSync(file, backup);
    try {
        writeFileSync(temporary, text.replace(stock, "$1'dsh-world/compaction'$3"), 'utf8');
        renameSync(temporary, file);
    }
    catch (error) {
        rmSync(temporary, { force: true });
        throw error;
    }
    return { status: 'swapped', backup };
}
/**
 * Once per world, when the plugin first runs in a profile: make the profile use the tool-free compaction. The attempt is
 * remembered only when it succeeded or was already done, so a partner who later puts the stock one back is left alone,
 * while a profile this could not read is looked at again next start.
 */
export function swapCompactionOnce(deps) {
    if (!deps.enabled || deps.done() || !deps.profileDir)
        return;
    let result;
    try {
        result = (deps.swap ?? swapStockCompaction)(deps.profileDir);
    }
    catch (error) {
        deps.report(`没能把压缩换成 dsh-world 的“只留对话”压缩：${error instanceof Error ? error.message : String(error)}`);
        return;
    }
    if (result.status === 'unchanged')
        return;
    deps.markDone();
    if (result.status === 'swapped')
        deps.report(`已把 profile 的压缩换成 dsh-world 的“只留对话”压缩，重启 DSH 后生效（原文件备份在 ${result.backup}）。不想换：恢复备份，并在 dsh-world 配置里写 replaceCompaction: false。`);
}
