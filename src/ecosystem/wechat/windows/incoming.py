"""Read pictures from the explicitly selected account/chat cache, without UI downloads."""
import hashlib
import io
import json
import os
import struct
import tempfile
from pathlib import Path
from wechatauto.media import MediaDownloader, V2_MAGIC, aligned_aes_block_size
from snapshot import fileStamp, SnapshotBusy
from stickers import StickerUnavailable, fetchSticker

MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 32_000_000


class ImageUnavailable(RuntimeError):
    pass


def saveImage(source, root, selfId, chatId, quality):
    from PIL import Image, ImageOps, UnidentifiedImageError
    if Path(source).stat().st_size > MAX_IMAGE_BYTES:
        raise ImageUnavailable('图片超过当前大小限制')
    try:
        with Image.open(source) as image:
            if image.format not in ('PNG', 'JPEG', 'WEBP', 'GIF') or image.width * image.height > MAX_IMAGE_PIXELS:
                raise ImageUnavailable('图片格式或像素数量暂不支持')
            output = io.BytesIO()
            ImageOps.exif_transpose(image).convert('RGBA').save(output, format='PNG')
            data = output.getvalue()
    except (UnidentifiedImageError, Image.DecompressionBombError) as error:
        raise ImageUnavailable('微信缓存尚未形成可解码图片') from error
    if len(data) > MAX_IMAGE_BYTES:
        raise ImageUnavailable('转换后的图片超过当前大小限制')
    key = hashlib.sha256(json.dumps(['wechat', selfId, 'group' if chatId.endswith('@chatroom') else 'private', chatId], ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    directory = Path(root) / key
    directory.mkdir(parents=True, exist_ok=True)
    name = hashlib.sha256(data).hexdigest() + '.png'
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=directory, suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, directory / name)
    finally:
        if temporary and temporary.exists(): temporary.unlink()
    return dict(file=name, quality=quality)


class ScopedMedia(MediaDownloader):
    def __init__(self, database, checkProcess):
        super().__init__(database)
        self.checkProcess = checkProcess
        self.probeFile = None
        self.templates = []
        self.cfgAttempted = False

    def _derive_cfg_key(self):
        if not self.cfgAttempted:
            self.cfgAttempted = True
            self.checkProcess()
            config = self.db.extract_master_key()
            self.checkProcess()
            if config:
                if config[2] != self.db.wxid: raise RuntimeError('图片配置与绑定账号不符')
                self._cfg_dword = config[1]
        return super()._derive_cfg_key()

    def _probe_ct(self, dat_path=None):
        if not self.probeFile:
            raise ImageUnavailable('没有选中图片缓存')
        return super()._probe_ct(str(self.probeFile))

    def _collect_templates(self, limit=32, keep=16):
        return self.templates

    def _scan_aes_key(self, monitor=False, monitor_timeout=120):
        self.checkProcess()
        return super()._scan_aes_key(monitor=False)

    def _install_xor_key(self):
        if self._xor_key is not None: return self._xor_key
        derived = self._derive_cfg_key()
        key = derived[1] if derived else self._get_xor_key(self.templates)
        if key is None: raise ImageUnavailable('这张图片的缓存解密参数尚不可用')
        self._xor_key = key
        return key


class IncomingImages:
    def __init__(self, database, config, checkProcess):
        self.database, self.config, self.checkProcess = database, config, checkProcess
        self.media = None

    def read(self, chatId, row):
        if not any(chat['id'] == chatId for chat in self.config['chats']):
            raise ValueError('图片必须来自已配置的聊天')
        self.checkProcess()
        if self.media is None: self.media = ScopedMedia(self.database, self.checkProcess)
        raw = self.database.get_message_row(chatId, row['local_id'], local_type=3, shard=row['shard'])
        if not raw or raw.get('local_type') != 3 or raw.get('sender_username') != row.get('sender_username'):
            raise ImageUnavailable('图片的消息来源无法核对')
        digest = self.media._img_md5(raw)
        if not digest: raise ImageUnavailable('图片缺少有效缓存标识')
        files = self.media._image_files(chatId, digest)
        tier = next((tier for tier in ('original', 'mid', 'thumb') if tier in files and
                     (self.media.original_ready(files[tier][1]) if tier == 'original' else files[tier][1] > 0)), None)
        if not tier: raise ImageUnavailable('图片尚未下载到这台电脑')
        path = Path(files[tier][0]).resolve()
        allowed = Path(self.database.account_dir).resolve() / 'msg' / 'attach' / self.media._chat_md5(chatId)
        if not path.is_relative_to(allowed): raise ValueError('图片缓存越过当前聊天目录')
        if path.stat().st_size > MAX_IMAGE_BYTES: raise ImageUnavailable('微信图片缓存超过当前大小限制')
        self.media.probeFile = path
        self.media._key_probe = None
        self.media.templates = [entry[0] for kind, entry in files.items() if kind in ('thumb', tier)]
        stamp = fileStamp(path)
        with path.open('rb') as stream: header = stream.read(15)
        xorKey = None
        aesKey = None
        if header.startswith(V2_MAGIC):
            if len(header) < 15: raise ImageUnavailable('图片加密缓存尚未写完整')
            aesSize, xorSize = struct.unpack_from('<LL', header, 6)
            if 15 + aligned_aes_block_size(aesSize) + xorSize > stamp[1]:
                raise ImageUnavailable('图片加密缓存尚未写完整')
            xorKey = 0 if xorSize == 0 else None
            aesKey = self.media._resolve_aes_key()
            if not aesKey: raise ImageUnavailable('当前登录进程尚未提供有效图片解密密钥')
        target = Path(self.config['moduleFile']).parent / 'wechat-incoming'
        scratch = target / '.decoded' / self.media._chat_md5(chatId)
        result = self.media.download_image(chatId, row['local_id'], save_dir=str(scratch), aes_key=aesKey, xor_key=xorKey, tier=tier, shard=row['shard'])
        self.checkProcess()
        if stamp != fileStamp(path): raise SnapshotBusy('读取期间图片缓存变化，稍后重读')
        if not result: raise ImageUnavailable('图片缓存尚不可用')
        return saveImage(result, target, self.config['selfId'], chatId, {'original': 'original', 'mid': 'cached', 'thumb': 'thumbnail'}[tier])

    def readSticker(self, chatId, row):
        if not any(chat['id'] == chatId for chat in self.config['chats']):
            raise ValueError('表情包必须来自已配置的聊天')
        if not self.config.get('fetchStickers', True): raise ImageUnavailable('未开启表情包下载')
        self.checkProcess()
        raw = self.database.get_message_row(chatId, row['local_id'], shard=row['shard'])
        if not raw or raw.get('sender_username') != row.get('sender_username'):
            raise ImageUnavailable('表情包的消息来源无法核对')
        try: data = fetchSticker(raw['content'])
        except StickerUnavailable as error: raise ImageUnavailable(str(error)) from error
        self.checkProcess()
        target = Path(self.config['moduleFile']).parent / 'wechat-incoming'
        scratch = target / '.decoded'
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=scratch, suffix='.sticker', delete=False) as stream:
            path = Path(stream.name)
            stream.write(data)
        try: return saveImage(path, target, self.config['selfId'], chatId, 'original')
        finally: path.unlink(missing_ok=True)
