# HANDOFF：EcoProof 管理端展示组件

交付人：管理端展示组件（B 席）。接收人：总工程师（负责 API、业务规则、最终集成）。
分支：`feat/upgrade-admin`（基于 `4d89e753f58e2fd3c3374f3c73c5367e5ed5fc0b`）。
本目录所有文件均为新增，未改动 Workbench.tsx、Records.tsx、Atlas.tsx、公共 API/types、公共样式、后端、依赖清单或任何其他智能体目录。

## 一、交付物清单

```
frontend/src/features/ecoproof-admin/
├── index.ts                   桶导出（组件 + 全部类型）
├── types.ts                   两个面板的全部 props 与数据类型
├── CaseMergePanel.tsx         任务一：线索归并面板
├── ResolutionReviewPanel.tsx  任务二：整改核验面板
├── ecoproof-admin.css         面板样式，全部类名以 .ecoproof- 为前缀
└── HANDOFF.md                 本文件
```

两个组件都是纯展示组件（React 19 函数组件 + TypeScript strict 通过）。它们不 import 任何 API 模块、不发请求、不持有业务规则；所有异步由父组件执行后把结果经 props 传回。

## 二、CaseMergePanel（线索归并）

### 用法

```tsx
import { CaseMergePanel } from "../ecoproof-admin";

<CaseMergePanel
  candidates={candidates}                 // MergeCandidate[]
  currentSummary={summary}                // MergeSummary | null
  relationshipVersion={rv}                // number，撤销时原样回传
  busy={busy} stale={stale} error={err}   // 父组件的异步状态
  onMerge={(targetEventId, targetVersion) => ...}
  onUndo={(relationshipVersion) => ...}
/>
```

### props（类型在 `types.ts`，均导出）

| prop | 类型 | 说明 |
|---|---|---|
| `candidates` | `MergeCandidate[]` | 模型提出的归并候选。每个候选项含 `id`（候选事件编号，原样回传给 onMerge）、`title`、`pointName`、`createdAt`（ISO 8601）、`version`（合并时供后端做版本校验）、`relation`、`reasons`、`uncertainties`、`submissionCount`、`uniqueImageCount` |
| `currentSummary` | `MergeSummary \| null` | 当前线索已有归并的摘要；null 表示未归并。字段全部可选除 `targetEventId` |
| `relationshipVersion` | `number` | 当前关系数据版本；面板只显示并原样回传，不做计算 |
| `busy` | `boolean` | 父组件异步进行中；期间单选、确认、撤销全部禁用，面板根节点带 `aria-busy` |
| `error` | `string \| null` | 最近一次异步错误；以 `role="alert"` 展示在面板顶部 |
| `stale` | `boolean` | 候选/关系已过期；显示琥珀色提示条，且归并、撤销全部禁用（与 busy 同规则） |
| `onMerge` | `(targetEventId: string, targetVersion: number) => void` | 管理员先选中候选、再点击「确认归并」后触发；参数即候选的 `id`、`version` |
| `onUndo` | `(relationshipVersion: number) => void` | 点击「撤销这次归并」后触发，仅在 `currentSummary` 非空时渲染 |

### 交互与状态设计

- **两步确认，无默认选中**：候选是原生 radio（`role="radiogroup"` 包裹），面板加载后没有任何候选被选中；选中后底部出现确认区，显示所选标题、关系提示语、拟并入事件编号（`QL-XXXXXXXX` 短码）与该事件当前版本，管理员点击「确认归并」才调用 `onMerge`。面板从不把选中当成已执行，异步结果完全由父组件传回（成功后候选集合变化会自动清空选择）。
- **关系徽章**：`same_issue` 绿底「同一问题」、`uncertain` 琥珀虚线「无法确定」、`different` 中性灰「不同问题」。确认区对三种关系分别给出提示语（different/uncertain 明确要求人工复核）。
- **关联依据 / 不确定项**：每张候选卡完整列出 `reasons`（关联依据）与 `uncertainties`（不确定项）；空数组自动省略对应区块。
- **仅有不确定候选**：列表上方出现提示「本轮没有判定为『同一问题』的候选，以下都需要人工判断」，候选仍可正常选择合并（判断权在管理员）。
- **没有候选**：虚线空态「暂无归并候选……」。
- **已有合并**：`currentSummary` 非空时显示「已有归并」区——目标事件短码与标题、归并依据列表、`关系版本 v{n} · 归并时间`，以及「撤销这次归并」按钮（busy/stale 时禁用）。
- **业务边界（供理解，未在组件内实现）**：同点位完全重复图片的后端自动归并不经过本面板；已结案事件不能自动重新打开——这类校验在父组件与后端完成，面板只转述 `error` 里的结果。

## 三、ResolutionReviewPanel（整改核验）

### 用法

```tsx
import { ResolutionReviewPanel } from "../ecoproof-admin";

<ResolutionReviewPanel
  beforeImages={[{ id, url, alt }]}       // ReviewImage[]
  afterImages={[{ id, url, alt }]}        // ReviewImage[]
  beforeTotal={3}                         // 事件完整的整改前照片数
  review={review}                         // ResolutionReview | null
  sameImage={false} stale={false} busy={false} error={null}
  model="Qwen/Qwen3-VL-30B-A3B-Instruct" finishedAt="2026-10-03T10:30:00Z"
  onAnalyze={() => ...}
  onClose={(note) => ...}                 // 只提交意图
  onReturn={(note) => ...}                // 只提交意图
/>
```

建议父组件用 `key={event.id}` 挂载，切换线索时面板（含未发送的处理说明草稿）整体重置。

### props

| prop | 类型 | 说明 |
|---|---|---|
| `beforeImages` / `afterImages` | `ReviewImage[]`（`{ id, url, alt }`） | 展示并（由父组件决定）送入核验的前后照片 |
| `beforeTotal` | `number` | 事件完整的整改前照片数。`beforeImages.length < beforeTotal` 时显示雾蓝范围警告「未包含的照片不在本次核验范围内」 |
| `review` | `ResolutionReview \| null` | 模型结果：`suggestion` + `visibleChanges` / `remainingIssues` / `uncertainties` 三个列表 + 可选 `reviewedImageIds`。null 时显示「还没有模型核验结果」与「发起 AI 核验」入口 |
| `review.reviewedImageIds` | `string[]`（可选） | 模型实际读取的图片 id。提供时：核验范围行给出「送入模型 X / 展示 Y 张」计数，并且未送入的图片左下角出现深色「未送入核验」角标；缺省时视为传入的前后图片全部送入 |
| `sameImage` | `boolean` | true 时显示醒目红棕色横条「未提供新的整改证据」，**完全不渲染**「建议通过/建议退回」结论徽章和模型意见列表；若有旧 review，仅以一行等宽小字说明其基于相同照片、不作为整改证据 |
| `stale` | `boolean` | true 时显示琥珀提示「材料已变化，需要重新核验」，旧结论仅供对照 |
| `busy` | `boolean` | 全部按钮与说明输入禁用，根节点 `aria-busy` |
| `error` | `string \| null` | `role="alert"` 展示 |
| `model` / `finishedAt` | `string \| null` | 模型意见页脚等宽字体展示；缺省时显示「模型未记录 / 完成时间未记录」，不编造 |
| `onAnalyze` | `() => void` | 「发起 AI 核验」（无结果时）或「重新核验」（有结果时）触发 |
| `onClose` / `onReturn` | `(note: string) => void` | 人工验收结案 / 退回意图，参数为 trim 后的处理说明。两个按钮在说明为空时禁用（与现有 Workbench 行为一致）；面板只回传意图，权限与状态校验在后端 |

### 展示与文案设计

- **前后并列**：桌面两列（左「照看前」右「照看后」，列头有 `n/total 张` 计数），≤768px 上下单列。图片 4:3、`object-fit: cover`，多图时 2 列网格、≤420px 退化为单列，永不拉伸。
- **核验范围始终可见**：对比图下方有一行范围说明——有结果时给出「本次核验材料：整改前照片 X 张、整改后照片 Y 张」；`beforeTotal` 不全时追加雾蓝警告条，明确结论不能代表未包含的照片。
- **AI 建议与人工验收严格分开**：模型意见是雾蓝纸面区块，标题旁挂「模型意见 · 仅供参考」标签，结论徽章三态——绿「建议通过」、红「建议退回」、琥珀「无法确认，需要人工判断」；模型的具体依据（可见变化 / 仍需照看 / 还不确定）全部保留，页脚显示模型名与完成时间。人工验收是独立的陶土区块，标题旁挂「最终决定」标签，含说明输入与「人工验收并结案」「退回继续照看」两个按钮。全文没有「自动结案」字样，没有任何编造的数量、完成度或百分比。
- **没有模型结果时**：人工验收入口照常可用（允许无 AI 参与的人工闭环），但结案与退回都必须填写说明。

## 四、样式与可访问性约定

- `ecoproof-admin.css` 只定义 `.ecoproof-` 前缀类；未触碰 `:root`、`body`、`.journey-page` 或任何现有按钮/地图样式。文件可随组件按需加载，重复 import 无副作用。
- 配色沿用工作台暖纸基调：变量取 `var(--bg-raised)`、`var(--text)` 等并带同色回退值（在 `.journey-page` 内解析为暖纸主题，独立渲染时回退值一致）。陶土色（`#8b7350` 一族）用于人工动作按钮，雾蓝色（`#5f7186` 一族）用于机器信息与 AI 动作——AI 与人工在颜色语义上可区分。
- 字体复用 `--font-sans` / `--font-display` / `--font-mono`（Noto Sans/Serif SC、IBM Plex Mono），编号与事件短码走 `eventCode()`、时间走 `formatTime()`（均 import 自 `components/format`，未复制实现）。
- 焦点：面板内 `:focus-visible` 有 2px 陶土描边；radio 为原生控件，键盘方向键可切换（已实测）；所有按钮原生 `<button type="button">`。
- 错误 `role="alert"`；stale、仅有不确定候选、范围警告、sameImage 用 `role="status"`。长标题、长错误、长编号均 `overflow-wrap: anywhere`，320px 无横向溢出。

## 五、实际检查结果（2026-10-03，本机 Node v24.15.0）

1. `npm ci` 后 `npm run build`（`tsc --noEmit && vite build`）**通过**，无类型错误、无新增依赖。
2. 用临时预览页（已删除）在真实 Chrome 中渲染两个面板共 7 个状态变体，按 **320 / 390 / 768 / 1440 / 2048px** 整页截图：五个宽度 `scrollWidth - clientWidth` 均为 **0（无横向溢出）**，无任何页面脚本异常。桌面两列并列、≤768 单列、2048 面板保持克制宽度，均确认。
3. Playwright 交互验证通过：初始无确认条（无默认选中）→ 点击候选出现确认条且含「拟并入事件 QL-A1B2C3D4」→ 「确认归并」回调收到 `(候选完整 id, 2)` → radio 方向键切换成功 → 核验面板不填说明时结案/退回禁用、填写后可用 → `onClose`/`onReturn` 收到 trim 后的说明。
4. 视觉自查对照项：sameImage 面板无任何「建议通过」字样；busy 面板按钮呈半透明禁用；错误红棕、stale 琥珀虚线、三种关系徽章样式互相区分；「未送入核验」角标与雾蓝范围警告正常显示。

## 六、未验证事项与集成提醒

- **未接真实后端联调**：候选列表、归并、撤销、核验结果的真实 API 形状由总工程师定义；`types.ts` 是面板的输入契约，父组件负责把后端响应映射进来（例如后端返回 `acceptance_recommendation` 枚举时映射到 `suggestion`，`sameImage`/`stale` 由后端判定后传入）。面板对缺失字段（空列表、null 时间）都有兜底显示，但不做字段改名以外的数据加工。
- **归并方向语义**：面板把候选的 `id`/`version` 原样传给 `onMerge`，UI 文案是「拟并入事件 QL-XXXX」；如果后端语义相反（把当前事件并入候选），请父组件在传参前自行调整，面板无需改动。
- **撤销已结案**：撤销已并入已结案事件的行为由后端拒绝；面板会原样显示返回的错误文本。
- **`reviewedImageIds` 是面板的扩展可选字段**：若后端核验结果不含该字段，范围标注退化为「送入 = 展示数量」，此时请确保传给面板的 `beforeImages/afterImages` 就是实际送入模型的材料，否则范围展示会失真。
- **说明草稿不跨线索保留**：面板内部 state 在组件卸载即失；用 `key={event.id}` 挂载可避免把 A 线索的说明误带到 B 线索。
- 浏览器矩阵仅验证了本机 Chrome（Playwright chromium.launch + 系统 Chrome）；未做真机移动端与读屏软件实测。
