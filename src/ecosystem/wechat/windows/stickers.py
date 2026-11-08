"""A received animated sticker is fetched from the CDN address in its own message and accepted only if its md5 matches."""
import hashlib
import urllib.error
import urllib.request
from urllib.parse import urlparse
from xml.etree import ElementTree

MAX_STICKER_BYTES = 10 * 1024 * 1024
TIMEOUT_SECONDS = 15


class StickerUnavailable(RuntimeError):
    pass


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def parseSticker(content):
    """Return (md5, url) from a sticker message body, which is zstd-compressed XML in WeChat 4.x."""
    if isinstance(content, bytes):
        if content.startswith(bytes.fromhex('28b52ffd')):
            import zstandard
            content = zstandard.ZstdDecompressor().decompress(content, max_output_size=128 * 1024)
        content = content.decode('utf-8')
    if not isinstance(content, str) or len(content.encode('utf-8')) > 128 * 1024:
        raise StickerUnavailable('表情包消息格式无效')
    try:
        emoji = ElementTree.fromstring(content[content.index('<'):]).find('emoji')
    except (ValueError, ElementTree.ParseError) as error:
        raise StickerUnavailable('表情包消息无法解析') from error
    if emoji is None: raise StickerUnavailable('消息里没有表情包信息')
    md5, url = (emoji.get('md5') or '').lower(), emoji.get('cdnurl') or ''
    if len(md5) != 32 or any(c not in '0123456789abcdef' for c in md5): raise StickerUnavailable('表情包缺少有效标识')
    if not url: raise StickerUnavailable('表情包没有下载地址')
    return md5, url


def checkUrl(url):
    parts = urlparse(url)
    host = parts.hostname or ''
    if parts.scheme not in ('http', 'https') or parts.username or parts.password or not (host == 'qq.com' or host.endswith('.qq.com')):
        raise StickerUnavailable('表情包地址不是腾讯 CDN，已拒绝')


def fetchSticker(content, *, opener=None):
    """Download one sticker; the bytes are returned only when their md5 equals the one in the message."""
    md5, url = parseSticker(content)
    checkUrl(url)
    opener = opener or urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=TIMEOUT_SECONDS) as response:
            data = response.read(MAX_STICKER_BYTES + 1)
    except (urllib.error.URLError, OSError) as error:
        raise StickerUnavailable(f'表情包下载失败：{error}') from error
    if len(data) > MAX_STICKER_BYTES: raise StickerUnavailable('表情包超过当前大小限制')
    if hashlib.md5(data).hexdigest() != md5: raise StickerUnavailable('下载内容与消息中的 md5 不符，已丢弃')
    return data
