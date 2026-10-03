# EcoProof 游客端展示组件 · 交接说明（HANDOFF）

交付人：游客端展示组件负责人（A 席位执行者）
交付分支：`feat/upgrade-visitor`（基于 main `4d89e75`，独立 worktree `F:\陕西天眼\worktrees\upgrade-visitor`）
交付范围：**仅** `frontend/src/features/ecoproof/` 下的六个文件。未修改任何现有页面、公共接口、样式、依赖与后端。

> 状态声明：以下是**独立展示组件完成并按验收项自测通过**，不是业务已接通。
> 组件尚未被任何页面导入，尚未消费真实业务数据；接入由总工程师统一完成。

## 一、交付文件

| 文件 | 内容 |
|---|---|
| `types.ts` | 全部展示类型定义与导出（唯一的类型来源） |
| `VisitorProofCard.tsx` | 任务一：EcoProof 生态线索证据分析展示卡 |
| `SharedCaseFeedback.tsx` | 任务二：关联治理回音（共同治理事件摘要）卡 |
| `ecoproof.css` | 两个组件的全部样式，类名前缀 `ecoproof` / `ecoproof-share` |
| `index.ts` | 桶式导出（组件 + 类型） |
| `HANDOFF.md` | 本文件 |

## 二、导入方式

```tsx
import { VisitorProofCard, SharedCaseFeedback } from '../features/ecoproof'
// 或按类型导入：
import type {
  VisitorProofCardProps,
  SharedCaseFeedbackProps,
  ProofRunState,
  ProofStep,
  ProofConclusion,
  SharedCaseMilestone,
} from '../features/ecoproof'
```

无新增依赖：只使用 `react`、现有 `lucide-react`、现有 `components/format` 的 `formatTime`。
样式随组件自动引入（组件文件内 `import './ecoproof.css'`），无需页面额外引入。

## 三、VisitorProofCard

### 用法

```tsx
<VisitorProofCard
  runState={run.state}          // 'idle' | 'running' | 'succeeded' | 'partial' | 'failed'
  stale={run.stale}             // 布尔；最新一次完成的分析是否已过期
  steps={run.steps}             // ProofStep[]，按 key 匹配四个固定阶段
  conclusion={run.conclusion}   // { kind, reason } | null
  model={run.model}             // string | null，服务端返回的模型标识
  startedAt={run.startedAt}     // string | null，ISO 时间
  finishedAt={run.finishedAt}   // string | null，ISO 时间
  busy={busy}                   // 父组件是否正在发起请求
  error={errorMessage}          // string | null，最近一次失败的可读原因
  onStart={startAnalysis}       // 可选；runState === 'idle' 且非 busy 时显示「开始分析」
  onRetry={retryAnalysis}       // 可选；failed / partial / stale+已完成 时显示「重新分析」
/>
```

### 固定阶段与 steps 匹配规则

阶段顺序与中文标题固定在组件内，父组件通过 `steps` 按 `key` 提供各阶段结果：

| 顺序 | key | 标题 | props 缺失时的展示 |
|---|---|---|---|
| 1 | `material` | 材料检查 | 「等待检查材料是否完整」，状态记为 idle |
| 2 | `content` | 内容分析 | 「等待整理照片和描述里的线索」 |
| 3 | `association` | 关联线索比对 | 「等待与其他线索比对」 |
| 4 | `decision` | 处置建议 | 「等待形成处置建议」 |

- `steps` 中 key 不属于以上四个的条目**被忽略**（不渲染、不报错）；同一 key 出现多次时取第一条。
- 每个阶段 `state`：`idle / running / pass / attention / failed / skipped`，显示为「未开始 / 进行中 / 已通过 / 需注意 / 未通过 / 已跳过」。
- 每阶段 `message` 一行短句直接显示；`evidence` 数组进入默认折叠的「详细依据」。

### 各状态展示（已逐项验证）

| 场景 | 表现 |
|---|---|
| 未开始 idle | 头部「未开始」章；四阶段均为未开始；有 `onStart` 时显示「开始分析」 |
| 运行中 running 或 busy | `aria-busy="true"`；「分析中」章与运行中阶段标记带克制的呼吸/旋转动画；隐藏开始/重试按钮 |
| 部分完成 partial | 完成阶段的标记、消息、证据全部保留；显示错误条；有 `onRetry` 时显示「重新分析」 |
| 失败 failed | `role="alert"` 错误条（`error` 为空时显示兜底文案「这次分析没有完成，已经完成的检查结果仍然保留。」）；已完成证据不隐藏；重试可用 |
| 成功 succeeded | 结论区（见下）置顶一眼可见；四阶段结果与证据可展开 |
| 过期 stale | 顶部琥珀色提示「这份分析已经过期，现场情况可能已有变化。」；stale + 已完成时提供「重新分析」 |

### 结论区

`conclusion.kind` 与中文一一对应（固定在组件内，`reason` 原样展示）：
`process`→建议审核处置，`supplement`→需要补充，`merge`→建议合并，`no_issue`→未见明显问题，`human_review`→人工复核。
仅当 `runState` 为 `succeeded` 或 `partial` 且 `conclusion` 非空时渲染；色调随结论类型（处置/合并=青绿、补充/复核=琥珀、无问题=松绿）。

### 组件不做的事（契约）

- 不发起请求、不设定时器、不自行生成任何识别结果或百分比；
- 不虚构「照片真实性 / AI 准确率 / 整改完成度」数值；
- 点位与时间字样完全来自父组件的 evidence 文案。**接入方约定**：上报点位一律表述为「游客选择的点位」，上报时间一律表述为「提交时间」（组件内分析开始/完成时间仅标注「分析开始 / 分析完成」）。

## 四、SharedCaseFeedback

### 用法

```tsx
<SharedCaseFeedback
  caseCode="QL-3F9A2C41"        // 关联治理事件编号
  statusLabel="景区已派单"       // 父组件自己的状态措辞
  pointName="太白山 · 下板寺步道" // 游客本人投稿的点位名
  submissionCount={4}           // 关联投稿数
  uniqueImageCount={3}          // 不同图片数
  duplicateImageCount={1}       // 重复照片数
  milestones={[{ label, createdAt, note }]}
  closedAt={closedAt}           // string | null
  closingNote={closingNote}     // string | null
/>
```

- 所有 props 均可选；**没有任何摘要内容时组件返回 `null`，不渲染空卡**（已验证）。父组件可直接 `summary ? <SharedCaseFeedback {...summary} /> : null`，或全量传空值由组件兜底。
- 计数固定使用「关联投稿 / 不同图片 / 重复照片」，不会出现「人数」表述；只渲染父组件给的文字摘要，不读取、不展示其他游客的照片与描述。
- 未结案：导语显示「目前进展：{statusLabel}。」；已结案（`closedAt` 或 `closingNote` 存在）：导语为「这份共同的关注，已经有了回音。」，并展示结案说明与「结案于 {时间}」。
- `milestones` 以左侧时间线呈现，时间用现有 `formatTime`（北京时间 MM-DD HH:mm）。

## 五、视觉与工程说明（给总工程师）

- **调色板自适应**：样式只引用 `tokens.css` 的语义变量（`--bg-raised`、`--text*`、`--rule-*`、`--teal-*`、`--amber-*`、`--red-*`、`--pine-*` 等）。组件放进 `.journey-page` 内自动继承暖纸/陶土配色，放在其他页面则是冷纸配色，无需改样式（已在两种环境下实测）。
- **样式隔离**：全部规则限定在 `.ecoproof` / `.ecoproof-share` 前缀下，未触碰 `:root`、`body`、全局按钮；keyframes 也带 `ecoproof-` 前缀。与 `.record`（AiEventCard）可并排使用不互相干扰。
- **建议接入位置**（供参考，由总工程师定夺）：
  - `VisitorProofCard`：`Records.tsx` 的 `CarePage` 主列（现有 `AiEventCard` 旁或其后），或足迹页共护记录卡展开处；运行数据来自现有 `POST /api/events/{id}/analysis` 与事件回读。
  - `SharedCaseFeedback`：`CarePage` 侧栏时间线下方，或记录详情页，数据来自后续「共同治理事件」摘要接口。
  - 两个组件均为纯展示，无路由、无状态管理依赖，可直接放进现有 `care-layout` 栅格（`minmax(0, 1fr)` 已处理窄列）。
- **本地构建注意**：worktree 的 `frontend/node_modules` 是指向主仓库 `qinling-gonghu/frontend/node_modules` 的 NTFS junction（未提交、被 gitignore）。若在别的机器检出本分支，请正常 `npm --prefix frontend ci`。

## 六、实际检查结果

| 检查项 | 结果 |
|---|---|
| `npm --prefix frontend run build`（tsc --noEmit + vite build） | 通过 |
| 横向溢出：12 个案例 × 320/390/768/1440/2048px，逐元素右边界断言 | 60 组全部通过，无横向溢出 |
| 六种展示情况（未开始/运行中/部分完成/失败/成功/过期） | 全部按第三节表格表现，程序断言通过 |
| 失败/部分完成时已完成阶段与证据保留（含展开「详细依据」后可见「游客选择的点位」） | 通过 |
| 键盘可达：`details` summary 聚焦 + Enter 展开；按钮 Enter 触发回调 | 通过 |
| reduced-motion：运行态动画计算值变为 `none` | 通过 |
| `aria-busy`、`role="alert"`、空摘要不渲染、控制台零报错（12 案例） | 通过 |
| `.journey-page` 暖纸配色继承（卡片背景 `rgb(251, 247, 237)`） | 通过 |
| 长中文 / 长 32 位编号 / 长模型名 / 长错误文案在 320px | 无溢出，正常换行 |

检查方式：仓库外临时 Vite + Playwright 环境（真实 Chrome 渲染，未接入现有页面，未改动仓库文件；临时环境已删除）。截图与 `report.md` 证据保留在 `data/browser-evidence/ecoproof-check-1791013423219/`（该目录被 gitignore，不入库）。

## 七、未验证事项（如实声明）

1. **未接入现有页面**：组件未被 `Records.tsx` / `Journey.tsx` 等导入，现有页面的回归不受影响，但也未在正式路由里走查。
2. **未消费真实业务数据**：检查用的是构造的展示输入；真实模型返回、共同治理事件接口的字段映射由接入方完成。
3. **未做读屏软件人工走查**：仅做了 `aria-busy` / `role` / 键盘操作的程序断言。
4. **真实浏览器范围**：本轮验证使用本机 Chrome（Chromium 内核）；Firefox/Safari 未测。
5. **业务语义**：「关联治理事件的合并规则」「结论 kind 与后端处置动作的映射」属总工程师职责范围，组件只保证按本文件第三、四节的映射展示。
