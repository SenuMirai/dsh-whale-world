import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
export function createDiaryReader(diaryDir) {
    const dates = () => existsSync(diaryDir) ? readdirSync(diaryDir).filter(name => /^\d{4}-\d{2}-\d{2}\.md$/.test(name)).map(name => name.slice(0, 10)).sort().reverse() : [];
    /** Only YYYY-MM-DD names are accepted, so a date can never escape the diary directory. */
    const read = (date) => { const file = join(diaryDir, `${date}.md`); return datePattern.test(date) && existsSync(file) ? readFileSync(file, 'utf8') : undefined; };
    return { dates, read };
}
