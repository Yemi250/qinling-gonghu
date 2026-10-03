# 环境治理流程的模拟测试图片

2026-10-03 使用会话内置 `image_gen.imagegen` 生成并编辑，保留原始工具输出。三张图片均清楚标有“模拟演示 · 非真实事件”，不能当作真实游客投稿或实际景区整改证据。用途是让真实视觉模型读取不同照片，检查流程是否执行，不提供模型预设答案。

| 图片 | 用途 |
|---|---|
| litter-before.png | 石凳、垃圾桶、护栏旁可见散落垃圾 |
| litter-after.png | 相同视角与场景，垃圾清理后的模拟照片 |
| litter-angle.png | 同一模拟垃圾问题的不同角度，用于真实模型关联比对 |

已逐张视觉检查。模型连接与结构化结果通过不等于识别准确率、照片真伪或真实整改效果通过。测试库与截图留在系统临时目录，正式演示库不自动灌入这些记录。

原始目录：`C:\Users\Administrator\.codex\generated_images\01a0fbcb-81ab-70b1-988a-503c54ab2d74\`。

## 整改前原图

原始文件 `exec-9655bfa5-f570-4cfc-af2c-ac0a3ffa1741.png`，复制为 litter-before.png。

```text
Use case: photorealistic-natural. Asset type: explicitly synthetic test fixture for environmental workflow demonstration, not a real incident. Create ONE landscape smartphone photograph of a modest rest area beside a scenic hiking trail in northern China: a weathered stone bench, a single dark metal litter bin, pale irregular stone paving, low wooden railing with pine-covered hills beyond. A plainly visible small pile of discarded plastic water bottles, food wrappers and paper cups sits on the ground beside the bin; some litter scattered around. Soft overcast daylight, natural neutral earthy colors, everyday documentary photo, not dramatic or cinematic. Static camera at human eye level about 4 meters away, bench left and bin right, trash foreground center-right. No people, brands, readable location names or signage. Small discreet but legible Chinese label at upper left: “模拟演示 · 非真实事件”. This image will be used to genuinely test a vision model detecting visible litter, not to simulate model answers. No UI, no split panel, no dashboard.
```

## 整改后编辑图

以整改前原图为 reference，原始文件 `exec-d720415c-491e-4dbd-ae59-fc58f3481784.png`，复制为 litter-after.png。

```text
Use case: precise-object-edit. Asset type: explicitly synthetic AFTER cleanup test photograph. Preserve exactly the same camera position, scene geometry, bin, stone bench, railing, pine-covered background mountains, paving, lighting, color and the label “模拟演示 · 非真实事件” in the reference. Change only one thing: remove ALL discarded plastic bottles, wrappers, paper cups, plastic bags and scattered rubbish from the paving beside and in front of the bin. Show the same intact paving now clean. Keep ordinary natural outdoor textures and leaves beyond the railing. No new people or objects, no redesign, no extra text, no split panel. This is a labeled simulated cleanup fixture for a REAL vision-model comparison, not a real incident.
```

## 不同角度编辑图

以整改前原图为 reference，原始文件 `exec-f33b84b7-ed38-427d-8da1-c33474cd79a8.png`，复制为 litter-angle.png。

```text
Use case: identity-preserve environmental scene variant. Asset type: explicitly synthetic second-report test photo of the SAME litter incident as the reference. Show the same rest area, exact recognizable weathered stone bench on left, same rectangular dark metal litter bin on right, same wooden railing, same pine hills and same small rubbish pile of bottles cups wrappers by the bin. The camera has moved about one meter to the left and rotated slightly right, giving a visibly different oblique view while ALL fixed landmarks and the litter pile remain recognizable and consistent. Keep soft overcast daylight and neutral natural smartphone documentary style. Preserve discreet upper-left Chinese label “模拟演示 · 非真实事件”. One standalone landscape photograph, no UI or split panel, no people or brands, no additional scene. Do not clean up the litter. This image will be honestly used as a labeled simulation to test genuine multimodal scene matching.
```
