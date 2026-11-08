import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const MAX_BYTES = 20 * 1024 * 1024;
function validate(image) {
    const ref = image.ref;
    if (!ref || typeof ref.attachmentId !== 'string' || !ref.attachmentId || ref.attachmentId.length > 200
        || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(ref.mediaType)
        || !Number.isSafeInteger(ref.width) || ref.width < 1 || !Number.isSafeInteger(ref.height) || ref.height < 1
        || !(image.data instanceof Uint8Array) || image.data.byteLength !== ref.bytes || ref.bytes < 1 || ref.bytes > MAX_BYTES)
        throw new Error('图片格式或大小校验失败（最多 20MB）');
}
function summary(row) {
    const ref = JSON.parse(row.ref);
    return { id: row.id, savedAt: row.savedAt, attachmentId: ref.attachmentId, mediaType: ref.mediaType, bytes: ref.bytes, width: ref.width, height: ref.height, description: row.description, tags: JSON.parse(row.tags) };
}
function metadata(description, tags) {
    if (typeof description !== 'string' || description.length > 500 || !Array.isArray(tags) || tags.length > 8 || tags.some(tag => typeof tag !== 'string' || tag.length > 40))
        throw new Error('照片说明最多 500 字，标签最多 8 个、每个最多 40 字');
    return { description: description.trim(), tags: [...new Set(tags.map(tag => tag.trim()).filter(Boolean))] };
}
/** Image bytes and their index share one transaction; earlier JSON albums remain intact. */
export function createPhotoStore(worldDir, clock = () => new Date()) {
    const directory = join(worldDir, 'photos');
    mkdirSync(directory, { recursive: true });
    const db = new DatabaseSync(join(directory, 'album.sqlite'));
    const transaction = (run) => {
        db.exec('BEGIN IMMEDIATE');
        try {
            const result = run();
            db.exec('COMMIT');
            return result;
        }
        catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    };
    const insert = (id, savedAt, image, description, tags) => {
        validate(image);
        const meta = metadata(description, tags);
        db.prepare('INSERT INTO photos VALUES (?,?,?,?,?,?,?)').run(id, savedAt, image.ref.attachmentId, JSON.stringify(image.ref), meta.description, JSON.stringify(meta.tags), image.data);
    };
    try {
        transaction(() => {
            db.exec('CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,savedAt TEXT NOT NULL,attachmentId TEXT UNIQUE NOT NULL,ref TEXT NOT NULL,description TEXT NOT NULL,tags TEXT NOT NULL,data BLOB NOT NULL)');
            const version = db.prepare('PRAGMA user_version').get()?.user_version;
            if (version !== 0 && version !== 1)
                throw new Error('相册版本不受支持，原数据未修改');
            if (version !== 0)
                return;
            const legacy = join(directory, 'index.json');
            if (existsSync(legacy)) {
                const old = JSON.parse(readFileSync(legacy, 'utf8'));
                if (old.version !== 1 || !Array.isArray(old.photos))
                    throw new Error('旧相册索引格式无效，原文件未修改');
                for (const row of old.photos.reverse()) {
                    if (!/^photo-[a-z0-9-]+$/i.test(row.id) || !Number.isFinite(Date.parse(row.savedAt)) || !new RegExp(`^${row.id}\\.(png|jpg|webp|gif)$`).test(row.file))
                        throw new Error('旧相册包含无效图片路径，原文件未修改');
                    const file = join(directory, row.file);
                    if (lstatSync(file).isSymbolicLink() || dirname(realpathSync(file)) !== realpathSync(directory) || lstatSync(file).size > MAX_BYTES)
                        throw new Error('旧相册图片路径或大小无效');
                    insert(row.id, row.savedAt, { ref: row.attachment, data: readFileSync(file) }, row.description, row.tags);
                }
            }
            db.exec('PRAGMA user_version=1');
        });
    }
    catch (error) {
        db.close();
        throw error;
    }
    return {
        list(limit = 20, offset = 0) {
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0)
                throw new Error('相册分页参数无效');
            const rows = db.prepare('SELECT id,savedAt,ref,description,tags FROM photos ORDER BY rowid DESC LIMIT ? OFFSET ?').all(limit + 1, offset);
            const total = Number(db.prepare('SELECT count(*) AS total FROM photos').get().total);
            return { photos: rows.slice(0, limit).map(summary), total, hasMore: rows.length > limit, limit, offset };
        },
        keep(image, description = '', tags = []) {
            validate(image);
            metadata(description, tags);
            return transaction(() => {
                const existing = db.prepare('SELECT id,savedAt,ref,description,tags FROM photos WHERE attachmentId=?').get(image.ref.attachmentId);
                if (existing)
                    return summary(existing);
                const id = `photo-${randomUUID()}`;
                insert(id, clock().toISOString(), image, description, tags);
                return summary(db.prepare('SELECT id,savedAt,ref,description,tags FROM photos WHERE id=?').get(id));
            });
        },
        image(id) {
            const row = db.prepare('SELECT ref,data FROM photos WHERE id=?').get(id);
            return row ? { ref: JSON.parse(row.ref), data: row.data } : undefined;
        },
        forget(id) {
            transaction(() => { if (db.prepare('DELETE FROM photos WHERE id=?').run(id).changes !== 1)
                throw new Error('找不到这张照片'); });
        },
        close() { db.close(); },
    };
}
