# A 所有

共享视觉组件与样式由 A 维护，公共 API 类型由 C 维护。设计依据与色板见 `docs/视觉规范.md`。

全局样式已在 `main.tsx` 引入（`styles/tokens.css`、`styles/base.css`、本目录 `components.css`），页面里直接用 CSS 变量和下面的组件，不要写死色值。

| 组件 | 用途 |
|---|---|
| `Button` / `buttonClass()` | 主要、次要、文字按钮；`tone="night"` 用在深色总览上。链接要长得像按钮时用 `buttonClass()` |
| `StatusStamp` | 业务状态章，直接传 C 的 `EventStatus` |
| `DemoTag` | “演示数据”标记，`event.is_demo` 为真时必须显示 |
| `EvidenceFigure` | 所有照片都走它：直角、细框、图注只写事实（点位、时间）。前后对比用两张同比例的并排 |
| `MetaStrip` | 少量“标签 + 值”，如建议部门、责任人 |
| `StageSteps` | 真实处理阶段的步骤条，只有正在进行的那一步有动画 |
| `Wordmark` / `Mark` | 产品字标与图形标 |
| `format.ts` | `formatTime()` 把接口的 UTC 时间转成北京时间 `10-02 14:32`；`eventCode()` 生成短编号 |

样式类：`.choice-list` + `.choice`（单选列表，点位和责任人都能用）、`.field` + `.input`（表单）、`.record__state`（AI 进行中 / 失败提示条）。
