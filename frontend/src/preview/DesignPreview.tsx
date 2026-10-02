import { LoaderCircle, TriangleAlert } from 'lucide-react'
import type { EventStatus } from '../api/client'
import { Button } from '../components/Button'
import { StatusStamp } from '../components/StatusStamp'
import { OverviewHero } from '../features/overview/OverviewHero'
import { AiEventCard } from '../features/visitor/AiEventCard'
import { ReportForm } from '../features/visitor/ReportForm'
import { DEMO_AREA, DEMO_EVENT, DEMO_POINTS, DEMO_STATS } from './demo'
import './preview.css'

const STATUSES: EventStatus[] = ['needs_info', 'pending_review', 'processing', 'pending_acceptance', 'closed', 'rejected']

// Design proposal page for A to review on a phone: overview hero, AI record
// sheet, visitor report form and the shared parts. Everything here is 演示数据.
export function DesignPreview() {
  const point = DEMO_POINTS.find((p) => p.id === DEMO_EVENT.point_id)
  return (
    <div className="preview">
      <OverviewHero stats={DEMO_STATS} />

      <main className="preview__main">
        <header className="preview__intro">
          <p className="preview__kicker mono">视觉测试稿 · PROPOSAL · 10-02</p>
          <p className="preview__note">
            上面是总览首屏，下面依次是 AI 事件卡、手机上报页和公共组件。这一页的数字和事件都是演示数据，不连后端。
          </p>
        </header>

        <section className="preview__block">
          <div className="preview__label">
            <span className="mono">02</span>
            <h2>AI 事件卡</h2>
            <p>游客上传后，AI 整理出的记录单。管理端复用同一张。照片位等 D 的演示照片到了再换。</p>
          </div>
          <AiEventCard event={DEMO_EVENT} pointName={point?.name} />
        </section>

        <section className="preview__block">
          <div className="preview__label">
            <span className="mono">03</span>
            <h2>手机上报页</h2>
            <p>拍照、选点位、说两句。可以真的选一张照片试试预览，这一页不会提交。</p>
          </div>
          <div className="phone">
            <ReportForm areaName={DEMO_AREA} points={DEMO_POINTS} />
          </div>
        </section>

        <section className="preview__block">
          <div className="preview__label">
            <span className="mono">04</span>
            <h2>状态与按钮</h2>
            <p>琥珀表示等人处理，青绿表示正在处理，深墨绿表示已结案。</p>
          </div>
          <div className="specimen">
            <div className="specimen__row">
              {STATUSES.map((status) => (
                <StatusStamp key={status} status={status} />
              ))}
            </div>
            <div className="specimen__row">
              <Button>派单</Button>
              <Button variant="secondary">要求补充</Button>
              <Button variant="quiet">查看原图</Button>
            </div>
            <div className="specimen__stack">
              <p className="record__state record__state--running">
                <LoaderCircle className="spin" size={16} strokeWidth={1.75} />
                AI 正在看这张照片，通常需要十几秒。照片和描述已经保存。
              </p>
              <p className="record__state record__state--failed">
                <TriangleAlert size={16} strokeWidth={1.75} />
                <span>AI 这次没能完成分析，线索已经保存，景区仍会人工查看。</span>
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
