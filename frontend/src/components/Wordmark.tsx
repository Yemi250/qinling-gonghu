import type { CSSProperties } from 'react'

type MarkProps = {
  size?: number
  className?: string
  style?: CSSProperties
}

// Single-line ridge with one discovery point above the main peak.
export function Mark({ size = 28, className, style }: MarkProps) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.5 25 L10.5 14.5 L15 19.5 L21 9.5 L29.5 25"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="21" cy="4.25" r="1.9" fill="var(--mark-dot, var(--teal-500))" />
    </svg>
  )
}

type WordmarkProps = {
  tone?: 'light' | 'night'
  compact?: boolean
}

export function Wordmark({ tone = 'light', compact = false }: WordmarkProps) {
  return (
    <span className={`wordmark wordmark--${tone}`}>
      <Mark size={compact ? 24 : 28} />
      <span className="wordmark__text">
        <span className="wordmark__name">秦岭共护</span>
        {!compact && <span className="wordmark__latin">QINLING GONGHU</span>}
      </span>
    </span>
  )
}
