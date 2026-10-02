import type { ReactNode } from 'react'

type Ratio = '4/3' | '3/2' | '1/1' | '3/4'

type EvidenceFigureProps = {
  number?: string
  ratio?: Ratio
  src?: string
  alt: string
  facts?: string[]
  placeholder?: ReactNode
}

// Every photograph passes through here: square corners, 1px inset frame,
// and a caption that carries facts rather than restating the title.
export function EvidenceFigure({ number, ratio = '4/3', src, alt, facts = [], placeholder }: EvidenceFigureProps) {
  return (
    <figure className="evidence">
      <div className="plate" style={{ aspectRatio: ratio.replace('/', ' / ') }}>
        {src ? (
          <img src={src} alt={alt} loading="lazy" />
        ) : (
          <div className="plate__placeholder" role="img" aria-label={alt}>
            {placeholder ?? <span>照片位</span>}
          </div>
        )}
      </div>
      {(number || facts.length > 0) && (
        <figcaption className="evidence__caption">
          {number && <span className="evidence__number mono">{number}</span>}
          {facts.map((fact) => (
            <span key={fact} className="evidence__fact">
              {fact}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  )
}
