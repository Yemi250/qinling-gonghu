/**
 * EcoProof 管理端两个展示面板的类型。
 * 面板只做展示与意图回传；所有请求、状态校验和业务规则由父组件与后端完成。
 */

/* ------------------------------------------------------------------ */
/* 任务一：CaseMergePanel 线索归并                                       */
/* ------------------------------------------------------------------ */

/** 模型对两条线索关系的判断。 */
export type MergeRelation = "same_issue" | "different" | "uncertain";

/** 一条待管理员确认的归并候选，由父组件从后端读取后传入。 */
export type MergeCandidate = {
  /** 候选事件编号；确认归并时作为 targetEventId 原样回传给 onMerge */
  id: string;
  /** 候选线索标题 */
  title: string;
  /** 候选线索所在点位名称 */
  pointName: string;
  /** 候选线索上报时间，ISO 8601 */
  createdAt: string;
  /** 候选事件当前版本，归并时用于后端并发校验 */
  version: number;
  relation: MergeRelation;
  /** 模型给出的关联依据 */
  reasons: string[];
  /** 模型声明的不确定项 */
  uncertainties: string[];
  /** 同一问题下的游客提交次数 */
  submissionCount: number;
  /** 去重后的独立照片数 */
  uniqueImageCount: number;
};

/** 当前线索已有的归并摘要；没有归并时传 null。 */
export type MergeSummary = {
  /** 已并入的目标事件编号 */
  targetEventId: string;
  /** 目标事件标题，可空 */
  targetTitle?: string;
  /** 目标事件点位名称，可空 */
  targetPointName?: string;
  /** 已有归并的关系判断，可空 */
  relation?: MergeRelation;
  /** 已有的归并依据 */
  reasons?: string[];
  /** 归并时间，ISO 8601，可空 */
  mergedAt?: string | null;
};

export type CaseMergePanelProps = {
  /** 模型提出的归并候选；空数组时展示空状态 */
  candidates: MergeCandidate[];
  /** 当前线索已有的归并摘要，null 表示尚未归并 */
  currentSummary: MergeSummary | null;
  /** 当前关系数据版本，撤销归并时原样回传给 onUndo */
  relationshipVersion: number;
  /** 父组件正在执行异步操作；期间禁用一切会改变数据的操作 */
  busy: boolean;
  /** 最近一次异步操作的错误信息；null 表示无错误 */
  error: string | null;
  /** 候选与关系信息已过期；期间禁用归并与撤销 */
  stale: boolean;
  /** 确认归并；异步结果由父组件处理并传回，面板不做乐观更新 */
  onMerge: (targetEventId: string, targetVersion: number) => void;
  /** 撤销当前归并；relationshipVersion 为当前关系数据版本 */
  onUndo: (relationshipVersion: number) => void;
};

/* ------------------------------------------------------------------ */
/* 任务二：ResolutionReviewPanel 整改核验                                */
/* ------------------------------------------------------------------ */

/** 整改核验材料中的一张照片。 */
export type ReviewImage = {
  id: string;
  url: string;
  alt: string;
};

/** 模型对整改材料的建议。 */
export type ReviewSuggestion =
  | "recommend_accept"
  | "recommend_reject"
  | "need_human";

/** 模型的整改核验意见，来自后端 resolution 分析结果。 */
export type ResolutionReview = {
  suggestion: ReviewSuggestion;
  /** 模型看到的可见变化 */
  visibleChanges: string[];
  /** 模型认为仍需照看的问题 */
  remainingIssues: string[];
  /** 模型声明的不确定项 */
  uncertainties: string[];
  /**
   * 可选：模型实际读取的图片 id。
   * 提供时，面板会逐张标注“已送入核验 / 未送入核验”；
   * 缺省时视为传入的 beforeImages / afterImages 全部送入了核验。
   */
  reviewedImageIds?: string[];
};

export type ResolutionReviewPanelProps = {
  /** 展示并（按父组件决定）送入核验的整改前照片 */
  beforeImages: ReviewImage[];
  /** 展示并（按父组件决定）送入核验的整改后照片 */
  afterImages: ReviewImage[];
  /** 事件完整的整改前照片数量；少于展示数量时面板会标注核验范围 */
  beforeTotal: number;
  /** 模型核验结果；null 表示还没有结果 */
  review: ResolutionReview | null;
  /** 整改前后材料一致，即未提供新的整改证据 */
  sameImage: boolean;
  /** 材料已变化，上一次核验结论过期 */
  stale: boolean;
  /** 父组件正在执行异步操作；期间禁用全部操作 */
  busy: boolean;
  /** 最近一次异步操作的错误信息；null 表示无错误 */
  error: string | null;
  /** 发起本次核验的模型名，可空 */
  model: string | null;
  /** 核验完成时间，ISO 8601，可空 */
  finishedAt: string | null;
  /** 发起 / 重新发起 AI 核验 */
  onAnalyze: () => void;
  /** 人工验收结案意图；note 为处理说明，校验与状态流转在后端 */
  onClose: (note: string) => void;
  /** 退回继续照看意图；note 为处理说明，校验与状态流转在后端 */
  onReturn: (note: string) => void;
};
