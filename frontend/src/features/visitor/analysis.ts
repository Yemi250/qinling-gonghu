import type { components } from '../../api/schema'
import type { Event } from '../../api/client'

type Models = components['schemas']
export type ReportResult = Models['ReportResult']
export type AnalysisView = Models['AnalysisView']

export const CATEGORY_LABELS: Record<ReportResult['category'], string> = {
  litter: '垃圾散落',
  waste_pile: '垃圾堆积',
  overflowing_bin: '垃圾桶满溢',
  suspected_smoke: '疑似烟雾',
  suspected_fire: '疑似火点',
  water_appearance: '水体外观异常',
  no_obvious_issue: '没有明显问题',
  unrelated: '与环境问题无关',
  uncertain: '暂时无法判断',
}

function isReportResult(result: AnalysisView['result']): result is ReportResult {
  return result !== null && 'visible_observations' in result
}

// Per C's contract: show the newest non-stale analysis of a kind. A failed newest
// attempt does not hide an earlier success; the card marks it instead.
export function latestReport(event: Event) {
  const reports = event.analyses
    .filter((a) => a.kind === 'report' && !a.stale)
    .sort((a, b) => b.version - a.version)
  const newest = reports[0] ?? null
  const success = reports.find((a) => a.status === 'succeeded' && isReportResult(a.result)) ?? null
  return {
    newest,
    success,
    result: success && isReportResult(success.result) ? success.result : null,
  }
}
