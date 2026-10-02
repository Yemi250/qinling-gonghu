# 演示照片素材

`*.png` 等原始照片默认不进仓库（见根目录 `.gitignore`），只在本地测试使用。

## 来源要求

每张纳入演示的照片都要能说明来源或授权。新闻媒体、社交平台的截图带水印或未授权，不进仓库、不用于路演。

## 需要的清单

| 文件名建议 | 内容 | 用途 |
|---|---|---|
| `litter_01.jpg` | 步道旁垃圾散落 | 主场景，正常路径 |
| `waste_pile_01.jpg` | 垃圾成堆 | 主场景，类别区分 |
| `bin_overflow_01.jpg` | 垃圾桶满溢 | 主场景，类别区分 |
| `after_01.jpg` | 同一角度清理后 | 整改对比，可验收 |
| `after_diff_angle.jpg` | 角度明显不同的清理照 | 整改对比，无法确认分支 |
| `unrelated_01.jpg` | 人像或风景 | 无关图片分支 |
| `blurry_01.jpg` | 模糊或过暗 | 材料不足分支 |
| `smoke_01.jpg` | 疑似烟雾 | 扩展类别，主流程跑通后再加 |
| `water_01.jpg` | 水体颜色异常 | 扩展类别，主流程跑通后再加 |

## 本地测试

```bash
# 仓库根目录，先配好 .env 里的 AI_API_KEY / AI_BASE_URL / AI_MODEL
python scripts/smoke_ai_local.py
python scripts/smoke_ai_local.py fire_01.png
```

未把照片放入本目录时，脚本会提示跳过。
