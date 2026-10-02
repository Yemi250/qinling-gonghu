import { Image, LoaderCircle, RotateCcw, TriangleAlert } from 'lucide-react'
import type { Event } from '../../api/client'
import { Button } from '../../components/Button'
import { EvidenceFigure } from '../../components/EvidenceFigure'
import { eventCode, formatTime } from '../../components/format'
import { MetaStrip } from '../../components/MetaStrip'
import { DemoTag, StatusStamp } from '../../components/StatusStamp'
import { CATEGORY_LABELS, latestReport } from './analysis'
import './visitor.css'

type AiEventCardProps = {
  event: Event
  pointName?: string
  onRetry?: () => void
  retrying?: boolean
}

// The record sheet: one event, its photo evidence, what the AI saw, what is still
// unconfirmed, and the suggested next step. Visitor and admin views share it.
export function AiEventCard({ event, pointName, onRetry, retrying = false }: AiEventCardProps) {
  const { newest, success, result } = latestReport(event)
  const photo = event.original_images[0]
  const running = newest?.status === 'running' || retrying
  const failed = newest?.status === 'failed' && !running
  const facts = [pointName ?? event.point_id, `${formatTime(event.created_at)} 上报`]

  return (
    <article className="record">
      <header className="record__head">
        <span className="record__code mono">{eventCode(event.id)}</span>
        <span className="record__tags">
          <StatusStamp status={event.status} />
          {event.is_demo && <DemoTag />}
        </span>
      </header>

      <EvidenceFigure
        number="图 01"
        ratio="4/3"
        src={photo?.url}
        alt={event.description ? `游客上传的照片：${event.description}` : '游客上传的照片'}
        facts={facts}
        placeholder={
          <span className="record__placeholder">
            <Image size={22} strokeWidth={1.5} />
            游客上传的照片
          </span>
        }
      />

      <div className="record__lead">
        {result ? (
          <>
            <p className="record__category">{CATEGORY_LABELS[result.category]}</p>
            <h3 className="record__title display">{result.title}</h3>
            <p className="record__summary">{result.summary}</p>
          </>
        ) : (
          <h3 className="record__title display">{pointName ? `${pointName}的线索` : '游客线索'}</h3>
        )}
        {event.description && (
          <blockquote className="record__quote">
            “{event.description}”
            <cite>游客描述</cite>
          </blockquote>
        )}
      </div>

      {running && (
        <p className="record__state record__state--running" role="status">
          <LoaderCircle className="spin" size={16} strokeWidth={1.75} />
          AI 正在看这张照片，通常需要十几秒。照片和描述已经保存。
        </p>
      )}

      {failed && (
        <div className="record__state record__state--failed" role="alert">
          <TriangleAlert size={16} strokeWidth={1.75} />
          <span>
            {success ? '最近一次重新分析没有完成，下面是上一次的结果。' : 'AI 这次没能完成分析，线索已经保存，景区仍会人工查看。'}
          </span>
          {onRetry && (
            <Button variant="quiet" icon={<RotateCcw size={14} strokeWidth={1.75} />} onClick={onRetry}>
              重新分析
            </Button>
          )}
        </div>
      )}

      {!newest && !running && (
        <p className="record__state" role="status">
          等待 AI 分析。照片和描述已经保存。
        </p>
      )}

      {result && (
        <>
          <section className="record__section">
            <h4 className="record__label">AI 看到了什么</h4>
            <ul className="record__list">
              {result.visible_observations.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>

          {result.missing_information.length > 0 && (
            <section className="record__section record__section--unsure">
              <h4 className="record__label">还不确定</h4>
              <ul className="record__list">
                {result.missing_information.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          )}

          {result.recommendations.length > 0 && (
            <section className="record__section">
              <h4 className="record__label">建议下一步</h4>
              <ul className="record__list record__list--plain">
                {result.recommendations.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {result.suggested_department && (
                <MetaStrip items={[{ label: '建议部门', value: result.suggested_department }]} />
              )}
            </section>
          )}
        </>
      )}

      <footer className="record__foot">
        <span>AI 辅助整理，派单和结案由景区管理员确认</span>
        {success && (
          <span className="mono">
            {success.model} · {formatTime(success.finished_at)}
          </span>
        )}
      </footer>
    </article>
  )
}
