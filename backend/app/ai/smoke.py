"""冒烟脚本（在 backend/ 目录下运行，需环境变量 AI_API_KEY）：
  python -m app.ai.smoke report <图> [点位] [描述]
  python -m app.ai.smoke review <原图> <整改图> [点位] [说明]"""
import sys

from .schemas import ImageInput
from .service import analyze_report, review_resolution


def main() -> int:
    a = sys.argv[1:]
    if len(a) >= 2 and a[0] == "report":
        r = analyze_report(ImageInput(path=a[1]), *a[2:4])
    elif len(a) >= 3 and a[0] == "review":
        r = review_resolution(ImageInput(path=a[1]), ImageInput(path=a[2]), *a[3:5])
    else:
        print(__doc__)
        return 2
    print(r.model_dump_json(indent=2))
    return 0 if r.status.value == "success" else 1


if __name__ == "__main__":
    sys.exit(main())
