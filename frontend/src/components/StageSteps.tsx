import { Check } from 'lucide-react'

type StageStepsProps = {
  steps: string[]
  current: number
  busy?: boolean
}

// Real processing stages (上传中 → 已保存 → AI 分析中 → 待审核). Only the current
// step animates, and only while work is actually in flight.
export function StageSteps({ steps, current, busy = false }: StageStepsProps) {
  return (
    <ol className="steps">
      {steps.map((label, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'upcoming'
        return (
          <li key={label} className={`steps__item steps__item--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="steps__marker" aria-hidden="true">
              {state === 'done' ? <Check size={12} strokeWidth={2.25} /> : null}
            </span>
            <span className="steps__label">{label}</span>
            {state === 'current' && busy && <span className="steps__progress" aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}
