import { STATUS_LABELS, type EventStatus } from '../api/client'

export function StatusStamp({ status }: { status: EventStatus }) {
  return (
    <span className={`stamp stamp--${status}`}>
      <span className="stamp__dot" aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  )
}

export function DemoTag({ tone = 'light' }: { tone?: 'light' | 'night' }) {
  return <span className={`demo-tag demo-tag--${tone}`}>演示数据</span>
}
