"""独立图片指纹工具：为已规范化图片计算 SHA-256 与 64 位 dHash。

定位与边界：

- 本模块是"秦岭共护"重复/近似图片识别的**候选筛选工具**，只提供指纹计算与
  汉明距离度量。指纹不能证明照片真实性、不能证明图片属于同一事件，
  也不能区分不同游客身份；最终判断必须由人工复核和真实视觉模型完成。
- 只使用 Pillow 与 Python 标准库；不访问网络、不读取 .env、不调用模型、
  不读取或修改数据库、不修改原图文件。
- ``compute_fingerprint`` 的输入是已经由 ``uploads.normalize_image`` 规范化并
  落盘的图片（EXIF 方向已校正、RGB、JPEG quality=90）。本函数不重复规范化，
  也不补做 EXIF 转正；喂入其他图片时按"当前文件字节"如实计算。

dHash 算法（固定 64 位；发布后不得变动，否则历史指纹之间不可比较）：

1. 用 Pillow 转灰度（mode ``"L"``，ITU-R 601-2 亮度：L = 299R/1000 + 587G/1000 + 114B/1000）。
2. 用 LANCZOS 重采样缩放到 9 列 x 8 行。
3. 每一行自左向右比较相邻像素：左像素 > 右像素记 1，否则记 0；共 8 行 x 8 位 = 64 位。
4. 按行优先顺序、首个比较结果作为最高有效位打包成 64 位整数，
   编码为 16 位小写十六进制字符串。

``sha256`` 对文件当前实际字节计算，不做任何重新编码，因此与 ``uploads`` 表
对同一文件字节存储的 ``sha256`` 同源同值。
"""

import hashlib
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from PIL import Image, UnidentifiedImageError

__all__ = [
    "ImageFingerprint",
    "ImageUnreadableError",
    "compute_fingerprint",
    "hamming_distance",
]

#: dHash 十六进制串的固定长度（64 位 = 16 个十六进制字符）。
DHASH_HEX_LENGTH = 16
#: dHash 汉明距离的理论上限。
DHASH_MAX_DISTANCE = 64

_GRID_WIDTH = 9
_GRID_HEIGHT = 8
_HEX_DIGITS = frozenset("0123456789abcdefABCDEF")


class ImageUnreadableError(Exception):
    """文件存在但 Pillow 无法将其解码为图像时抛出（非图片内容、损坏、截断）。

    原始解码异常保留在 ``__cause__`` 中，便于排查具体原因。
    """


@dataclass(frozen=True)
class ImageFingerprint:
    """一张图片的指纹快照（不可变值对象）。

    Attributes:
        sha256: 文件当前实际字节的 SHA-256，64 位小写十六进制。与 uploads 表
            存储值同源同算法，可直接用于等值比对；它只证明字节相同，
            不证明拍摄内容或来源相同。
        dhash: 64 位差异哈希，16 位小写十六进制。仅作近似重复的候选筛选信号：
            结构相近或纯色的不同图片可能得到相同 dHash。
        width: 解码后图片的实际宽度（像素），取自原始尺寸而非缩放后的网格。
        height: 解码后图片的实际高度（像素）。
    """

    sha256: str
    dhash: str
    width: int
    height: int


def compute_fingerprint(path: Path) -> ImageFingerprint:
    """计算单个图片文件的指纹，不修改该文件。

    输入：
        path: 已由现有系统规范化并保存的图片文件路径（``pathlib.Path``）。
        指向目录或不存在时不会得到指纹，而是抛出下述异常。

    返回：
        :class:`ImageFingerprint`。``sha256`` 基于文件当前实际字节
        （一次读入，SHA 与 dHash 保证来自同一份字节），不重新编码，
        因此与 ``uploads.sha256`` 对同一文件的值一致；``width``/``height``
        为图片解码后的实际尺寸。

    异常：
        FileNotFoundError: path 不存在（由字节读取自然抛出）。
        ImageUnreadableError: 文件存在但无法解码（空文件、非图片内容、损坏或截断）。
        IsADirectoryError / OSError: path 是目录或其他读取 I/O 错误。

    限制：
        dHash 是候选筛选信号。纯色图、按行均匀的图案可能得到相同 dHash；
        相同或相近 dHash 不代表图片相同、同一事件或同一游客。
        本函数不做 EXIF 转正等二次规范化，输入必须是已规范化文件。
    """
    data = path.read_bytes()
    sha256 = hashlib.sha256(data).hexdigest()
    try:
        with Image.open(BytesIO(data)) as img:
            img.load()  # 立即完整解码：截断/损坏在此处报错，而不是调用方使用时
            width, height = img.size
            gray = img.convert("L").resize(
                (_GRID_WIDTH, _GRID_HEIGHT), Image.Resampling.LANCZOS
            )
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ImageUnreadableError(f"图片无法解码：{path}") from exc
    pixels = gray.tobytes()  # mode "L"：每像素 1 字节，行优先，左上角起始
    bits = 0
    for row in range(_GRID_HEIGHT):
        base = row * _GRID_WIDTH
        for col in range(_GRID_WIDTH - 1):
            bits <<= 1
            if pixels[base + col] > pixels[base + col + 1]:
                bits |= 1
    return ImageFingerprint(
        sha256=sha256,
        dhash=format(bits, "016x"),
        width=width,
        height=height,
    )


def hamming_distance(left: str, right: str) -> int:
    """计算两个 dHash 十六进制串的汉明距离。

    输入：
        left/right: 恰好 16 个字符的十六进制字符串，大小写均可
        （``"A1B2C3D4E5F60718"`` 与小写形式视为相同）。

    返回：
        0 到 64 的整数：两串按位异或后 1 的个数。0 表示 64 位全部相同，
        64 表示全部相反。

    异常：
        TypeError: 参数不是字符串。
        ValueError: 长度不是 16，或含有十六进制之外的字符（含 ``0x`` 前缀、
        下划线、空白）。绝不静默按 0 距离处理。

    限制：
        汉明距离只是位差异度量。不得把它换算为模型置信度、重复概率或
        事件真实性概率；是否合并等业务决策不在本模块职责内。
    """
    for label, value in (("left", left), ("right", right)):
        if not isinstance(value, str):
            raise TypeError(
                f"{label} 必须是字符串，实际类型 {type(value).__name__}"
            )
        if len(value) != DHASH_HEX_LENGTH:
            raise ValueError(
                f"{label} 必须是恰好 {DHASH_HEX_LENGTH} 位十六进制字符串，"
                f"实际长度 {len(value)}：{value!r}"
            )
        if not _HEX_DIGITS.issuperset(value):
            raise ValueError(f"{label} 含非十六进制字符：{value!r}")
    return (int(left, 16) ^ int(right, 16)).bit_count()
