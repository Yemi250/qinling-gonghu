"""backend.app.image_fingerprints 的行为测试。

约定与边界：

- 测试产物全部写入系统临时目录（``tempfile.mkdtemp``，每次运行唯一命名）。
  按任务约定，测试结束**不做递归清理**，不加入清理脚本，也不删除项目目录
  内的任何文件；临时目录保留供事后核对。
- 断言的是可复现的行为事实。不声称"所有不同照片必有不同 dHash"，
  不把汉明距离换算为模型置信度或事件真实性概率。
- 全部样例由 Pillow 确定性构造，无随机、无网络、无模型调用。
"""

import hashlib
import tempfile
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageOps

from backend.app.image_fingerprints import (
    ImageUnreadableError,
    compute_fingerprint,
    hamming_distance,
)


@pytest.fixture(scope="module")
def image_dir() -> Path:
    """模块内唯一的临时目录，每个测试用不同文件名写入其中。

    刻意不清理：任务明确要求测试结束后不递归删除目录，
    mkdtemp 的系统临时位置保证多次运行互不干扰。
    """
    return Path(tempfile.mkdtemp(prefix="qinling-fingerprint-tests-"))


def _save_pattern(image_dir: Path, name: str, pixel_fn, size=(9, 8)) -> Path:
    """按 pixel_fn(row, col) 构造灰度图并存为无损 PNG。"""
    img = Image.new("L", size)
    img.putdata([pixel_fn(row, col) for row in range(size[1]) for col in range(size[0])])
    path = image_dir / name
    img.save(path, "PNG")
    return path


def _photo_like(width: int = 800, height: int = 600) -> Image.Image:
    """构造确定性的"照片感"样例：渐变背景加几何形状，用作近似图实验。"""
    small = Image.new("RGB", (80, 60))
    px = small.load()
    for y in range(small.height):
        for x in range(small.width):
            px[x, y] = ((x * 3) % 256, (y * 4) % 256, ((x + y) * 2) % 256)
    photo = small.resize((width, height), Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(photo)
    draw.ellipse((100, 100, 300, 300), fill=(200, 80, 40))
    draw.rectangle((450, 250, 700, 500), fill=(30, 120, 90))
    return photo


# --- 1. 相同文件计算结果一致 ---------------------------------------------------


def test_same_file_computes_identical_fingerprint(image_dir):
    path = image_dir / "consistent.jpg"
    _photo_like().save(path, "JPEG", quality=90)
    first = compute_fingerprint(path)
    second = compute_fingerprint(path)
    assert first == second
    with pytest.raises(FrozenInstanceError):
        first.dhash = "ffffffffffffffff"


# --- 2. SHA-256 与标准库直接计算一致 -------------------------------------------


def test_sha256_matches_stdlib_direct_hash(image_dir):
    path = image_dir / "sha-vs-stdlib.jpg"
    _photo_like(320, 240).save(path, "JPEG", quality=90)
    fingerprint = compute_fingerprint(path)
    with path.open("rb") as handle:
        expected = hashlib.file_digest(handle, "sha256").hexdigest()
    assert fingerprint.sha256 == expected
    assert len(fingerprint.sha256) == 64
    assert fingerprint.sha256 == fingerprint.sha256.lower()


# --- 3. 文件内容变化后 SHA-256 变化 --------------------------------------------


def test_sha256_changes_when_file_content_changes(image_dir):
    path = image_dir / "sha-change.jpg"
    Image.new("RGB", (32, 32), (255, 255, 255)).save(path, "JPEG", quality=90)
    bytes_before = path.read_bytes()
    before = compute_fingerprint(path)

    changed = Image.new("RGB", (32, 32), (255, 255, 255))
    changed.putpixel((5, 5), (0, 0, 0))
    changed.save(path, "JPEG", quality=90)
    assert path.read_bytes() != bytes_before
    after = compute_fingerprint(path)

    assert before.sha256 != after.sha256


# --- 4. 固定构造图片的 dHash 位序符合约定 ---------------------------------------
# 位序约定：8 行 x 每行 8 次相邻比较，行优先；每行 8 位按从左到右的顺序、
# 首行首位为最高有效位打包成 64 位整数，再编码为 16 位小写十六进制。
# 下列预期值均为按该约定手工推导（9x8 灰度图上 LANCZOS 同尺寸缩放为恒等），
# 不依赖被测实现生成。


@pytest.mark.parametrize(
    ("name", "pixel_fn", "expected_dhash"),
    [
        # 偶数列 255、奇数列 0：每行比较结果 10101010 -> 0xAA，共 8 行。
        ("vertical", lambda r, c: 255 if c % 2 == 0 else 0, "aaaaaaaaaaaaaaaa"),
        # 降阶对角线 c<=r 为亮：第 r 行仅在 c==r 处左亮右暗 -> 行值 0x80>>r。
        ("diagonal", lambda r, c: 255 if c <= r else 0, "8040201008040201"),
        # 前 4 行竖条纹、后 4 行全黑：上半 0xAA、下半 0x00，同时验证行序自上而下。
        (
            "top-bright",
            lambda r, c: (255 if c % 2 == 0 else 0) if r < 4 else 0,
            "aaaaaaaa00000000",
        ),
        # 前 4 列 255、其余 0：每行仅 c==3 处 1 -> 行值 0x10，验证列方向比较。
        ("left-bright", lambda r, c: 255 if c < 4 else 0, "1010101010101010"),
    ],
)
def test_dhash_bit_order_matches_convention(image_dir, name, pixel_fn, expected_dhash):
    path = _save_pattern(image_dir, f"bitorder-{name}.png", pixel_fn)
    fingerprint = compute_fingerprint(path)
    assert fingerprint.dhash == expected_dhash
    assert fingerprint.dhash == fingerprint.dhash.lower()
    assert len(fingerprint.dhash) == 16
    assert (fingerprint.width, fingerprint.height) == (9, 8)


# --- 5. 汉明距离 0、64 和已知中间值 ---------------------------------------------


@pytest.mark.parametrize(
    ("left", "right", "expected"),
    [
        ("a" * 16, "a" * 16, 0),  # 完全相同
        ("A" * 16, "a" * 16, 0),  # 大小写视为相同
        ("ABCDEF0123456789", "abcdef0123456789", 0),  # 混合大小写逐位同值
        ("0" * 16, "f" * 16, 64),  # 逐位相反
        ("a" * 16, "5" * 16, 64),  # 0xAA ^ 0x55 = 0xFF
        ("0" * 16, "a" * 16, 32),  # 每字节 0xAA 有 4 个 1
        ("8040201008040201", "0" * 16, 8),  # 每字节恰 1 个 1
        ("0" * 15 + "f", "0" * 16, 4),  # 低位半字节
        ("0" * 15 + "1", "0" * 16, 1),  # 单比特
    ],
)
def test_hamming_distance_known_values(left, right, expected):
    assert hamming_distance(left, right) == expected


# --- 6. 非法长度、非法字符及大小写 ----------------------------------------------


@pytest.mark.parametrize(
    "value",
    ["", "a" * 15, "a" * 17, "aa", "0" * 16 + "0", "g" * 16, "0x00000000000000", "z" * 8 + "0" * 8],
)
def test_hamming_distance_rejects_bad_length_or_chars(value):
    with pytest.raises(ValueError):
        hamming_distance(value, "0" * 16)
    with pytest.raises(ValueError):
        hamming_distance("0" * 16, value)


@pytest.mark.parametrize("value", [0, None, b"aaaaaaaaaaaaaaaa", 3.14])
def test_hamming_distance_rejects_non_string(value):
    with pytest.raises(TypeError):
        hamming_distance(value, "0" * 16)


def test_hamming_distance_accepts_uppercase():
    assert hamming_distance("AAAAAAAAAAAAAAAA", "aaaaaaaaaaaaaaaa") == 0
    assert hamming_distance("ABCDEF0123456789", "abcdef0123456789") == 0


# --- 7. 压缩、缩放样例的实际指纹距离 --------------------------------------------


def test_recompression_and_rescale_stay_close(image_dir):
    reference_path = image_dir / "photo-reference.png"
    photo = _photo_like()
    photo.save(reference_path, "PNG")
    reference = compute_fingerprint(reference_path)
    assert (reference.width, reference.height) == (800, 600)

    recompressed_path = image_dir / "photo-q85.jpg"
    photo.save(recompressed_path, "JPEG", quality=85)
    recompressed = compute_fingerprint(recompressed_path)

    scaled_path = image_dir / "photo-scaled-q80.jpg"
    photo.resize((400, 300), Image.Resampling.LANCZOS).save(scaled_path, "JPEG", quality=80)
    scaled = compute_fingerprint(scaled_path)
    assert (scaled.width, scaled.height) == (400, 300)

    inverted_path = image_dir / "photo-inverted-q85.jpg"
    ImageOps.invert(photo).save(inverted_path, "JPEG", quality=85)
    inverted = compute_fingerprint(inverted_path)

    rotated_path = image_dir / "photo-rot180-q90.jpg"
    photo.rotate(180).save(rotated_path, "JPEG", quality=90)
    rotated = compute_fingerprint(rotated_path)

    d_recompressed = hamming_distance(reference.dhash, recompressed.dhash)
    d_scaled = hamming_distance(reference.dhash, scaled.dhash)
    d_inverted = hamming_distance(reference.dhash, inverted.dhash)
    d_rotated = hamming_distance(reference.dhash, rotated.dhash)
    # 近似样例（同图重压缩、同图缩小）距离应小；实际值记录在交接文档。
    assert d_recompressed <= 12, f"重压缩样例实际距离 {d_recompressed}"
    assert d_scaled <= 12, f"缩放样例实际距离 {d_scaled}"
    # 本组样例中，差异明显的图片距离应大于同图变体；这是样例结论，
    # 不推广为"所有不同照片距离都大"。
    assert d_inverted > d_recompressed, f"反色样例实际距离 {d_inverted}"
    assert d_inverted > d_scaled
    # 记录局限：同一张图旋转 180 度后 dHash 反转，距离很大。
    # 内容相同而距离大，说明距离小只是近似的必要信号，绝不能单独当合并依据。
    assert d_rotated >= 40, f"旋转 180 度样例实际距离 {d_rotated}"


# --- 8. 不同图案产生可区分结果 --------------------------------------------------


def test_different_patterns_are_distinguishable(image_dir):
    patterns = {
        "vertical": _save_pattern(
            image_dir, "diff-vertical.png", lambda r, c: 255 if c % 2 == 0 else 0
        ),
        "diagonal": _save_pattern(
            image_dir, "diff-diagonal.png", lambda r, c: 255 if c <= r else 0
        ),
        "top-bright": _save_pattern(
            image_dir, "diff-top.png", lambda r, c: (255 if c % 2 == 0 else 0) if r < 4 else 0
        ),
        "left-bright": _save_pattern(image_dir, "diff-left.png", lambda r, c: 255 if c < 4 else 0),
    }
    hashes = {name: compute_fingerprint(path).dhash for name, path in patterns.items()}
    assert len(set(hashes.values())) == len(hashes)
    names = sorted(hashes)
    for i, left in enumerate(names):
        for right in names[i + 1 :]:
            distance = hamming_distance(hashes[left], hashes[right])
            assert distance >= 8, f"{left} 与 {right} 距离仅 {distance}"


# --- 9. 纯色图可能产生相同 dHash：明确证明该局限 ---------------------------------


def test_solid_colors_and_uniform_rows_share_dhash(image_dir):
    colors = {
        "white": (255, 255, 255),
        "black": (0, 0, 0),
        "red": (255, 0, 0),
        "gray": (128, 128, 128),
    }
    fingerprints = {}
    for name, color in colors.items():
        path = image_dir / f"solid-{name}.jpg"
        Image.new("RGB", (96, 64), color).save(path, "JPEG", quality=90)
        fingerprints[name] = compute_fingerprint(path)

    # 四种完全不同颜色的纯色图共享同一个 dHash，而 SHA-256 各不相同：
    # 证明 dHash 无法区分纯色图，不能把相同 dHash 当作相同照片。
    zero_hash = "0" * 16
    for name, fingerprint in fingerprints.items():
        assert fingerprint.dhash == zero_hash, f"{name} 的 dHash 为 {fingerprint.dhash}"
    shas = {f.sha256 for f in fingerprints.values()}
    assert len(shas) == len(colors)
    assert hamming_distance(
        fingerprints["white"].dhash, fingerprints["black"].dhash
    ) == 0

    # 按行均匀的黑白条纹与纯色图同样碰撞：比较方向上无变化则全为 0。
    striped_path = _save_pattern(
        image_dir, "solid-horizontal-stripes.png", lambda r, c: 255 if r < 4 else 0
    )
    assert compute_fingerprint(striped_path).dhash == zero_hash


# --- 10. 缺失文件和损坏图片不会返回正常结果 ---------------------------------------


def test_missing_file_raises_file_not_found(image_dir):
    missing = image_dir / "does-not-exist.jpg"
    assert not missing.exists()
    with pytest.raises(FileNotFoundError):
        compute_fingerprint(missing)


@pytest.mark.parametrize(
    ("name", "content"),
    [
        ("empty.jpg", b""),
        ("garbage.jpg", b"this is definitely not an image" * 8),
    ],
)
def test_unreadable_content_raises_image_unreadable(image_dir, name, content):
    path = image_dir / name
    path.write_bytes(content)
    with pytest.raises(ImageUnreadableError):
        compute_fingerprint(path)


def test_truncated_images_raise_image_unreadable(image_dir):
    png_path = image_dir / "trunc-src.png"
    jpg_path = image_dir / "trunc-src.jpg"
    _photo_like(240, 160).save(png_path, "PNG")
    _photo_like(240, 160).save(jpg_path, "JPEG", quality=90)
    for source in (png_path, jpg_path):
        truncated = image_dir / f"truncated-{source.stem}.bin"
        data = source.read_bytes()
        truncated.write_bytes(data[: len(data) // 2])
        with pytest.raises(ImageUnreadableError) as excinfo:
            compute_fingerprint(truncated)
        # 明确异常：原始解码错误保留在 __cause__，不返回伪造指纹。
        assert excinfo.value.__cause__ is not None
