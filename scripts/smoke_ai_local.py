"""真实调用冒烟脚本：对 samples/ 下的图片逐张跑 analyze_report。
用法（仓库根目录）：python scripts/smoke_ai_local.py [图片名...]
密钥只从环境变量或 .env 读取，不打印。"""
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

from backend.app.ai import ImageInput, analyze_report  # noqa: E402

CASES = [
    ("fire_01.png", "示范步道1", "看到山上冒烟，好像有火"),
    ("fallen_tree_01.png", "示范步道2", "这棵树倒了，挡路"),
    ("trail_crowd_01.png", "示范步道1", "步道上人很多"),
    ("mountain_view_01.png", "示范山脊观景点", "风景照"),
]


def main() -> int:
    names = sys.argv[1:]
    cases = [c for c in CASES if not names or c[0] in names]
    for name, spot, desc in cases:
        p = ROOT / "samples" / name
        print(f"\n===== {name} | 点位={spot} | 描述={desc}")
        if not p.is_file():
            print("跳过：文件不存在")
            continue
        t0 = time.monotonic()
        r = analyze_report(ImageInput(path=str(p)), spot, desc)
        print(f"status={r.status.value} model={r.model} 耗时={int((time.monotonic()-t0)*1000)}ms")
        if r.status.value != "success":
            print(f"error_code={r.error_code} message={r.error_message}")
            continue
        rep = r.report
        print(f"verdict={rep.verdict.value} category={rep.category.value} title={rep.title}")
        print(f"summary={rep.summary}")
        print(f"observations={rep.visible_observations}")
        print(f"missing={rep.missing_info} follow_up={rep.follow_up_questions}")
        print(f"action={rep.suggested_action} dept={rep.suggested_department}")
        print(f"caveats={rep.caveats}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
