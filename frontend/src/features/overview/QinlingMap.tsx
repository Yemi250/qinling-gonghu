import { useEffect, useState } from 'react'
import { QINLING_SITES, type MapSite } from './sites'

// Schematic Qinling map: three layered ridges, contour lines on the front ridge,
// and the sites. Not to scale; the caption on the overview says so.

const W = 1440
const H = 520

type Ridge = {
  base: number
  amp: number
  seed: number
  peaks: { x: number; height: number; width: number }[]
}

const FAR: Ridge = {
  base: 300,
  amp: 46,
  seed: 2.3,
  peaks: [
    { x: 0.3, height: 40, width: 0.12 },
    { x: 0.7, height: 30, width: 0.1 },
  ],
}

const MID: Ridge = {
  base: 362,
  amp: 52,
  seed: 4.1,
  peaks: [
    { x: 0.23, height: 70, width: 0.09 },
    { x: 0.6, height: 42, width: 0.08 },
  ],
}

// Front ridge peaks at 太白山 (west, the range's highest point) and 华山 (east, sharp).
const FRONT: Ridge = {
  base: 442,
  amp: 44,
  seed: 0.7,
  peaks: [
    { x: 0.18, height: 175, width: 0.075 },
    { x: 0.85, height: 118, width: 0.028 },
  ],
}

const CONTOURS = 10

function wave(t: number, seed: number) {
  return (
    0.5 * Math.sin(t * 6.1 + seed) +
    0.27 * Math.sin(t * 13.7 + seed * 1.9) +
    0.14 * Math.sin(t * 31.3 + seed * 3.1) +
    0.07 * Math.sin(t * 71.9 + seed * 5.3)
  )
}

function ridgeY(ridge: Ridge, x: number) {
  const t = x / W
  let y = ridge.base - ridge.amp * (0.5 + 0.5 * wave(t, ridge.seed))
  for (const peak of ridge.peaks) {
    const d = (t - peak.x) / peak.width
    y -= peak.height * Math.exp(-d * d)
  }
  return y
}

function ridgePath(ridge: Ridge) {
  let d = `M0 ${H} L0 ${ridgeY(ridge, 0).toFixed(1)}`
  for (let x = 8; x <= W; x += 8) d += ` L${x} ${ridgeY(ridge, x).toFixed(1)}`
  return `${d} L${W} ${H} Z`
}

// Lines that hug the ridge near the top and flatten toward the valley floor.
function contourPath(ridge: Ridge, k: number) {
  const f = k / CONTOURS
  let d = ''
  for (let x = 0; x <= W; x += 8) {
    const top = ridgeY(ridge, x)
    const y = top + (H + 24 - top) * f
    d += `${x === 0 ? 'M' : ' L'}${x} ${y.toFixed(1)}`
  }
  return d
}

function useNarrow(query = '(max-width: 700px)') {
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setNarrow(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  return narrow
}

function Site({ site }: { site: MapSite }) {
  const x = site.x * W
  const y = ridgeY(FRONT, x) + (site.drop ?? 0)
  const lead = site.live ? 46 : 30
  return (
    <g className={`site ${site.live ? 'site--live' : 'site--planned'}`} transform={`translate(${x} ${y.toFixed(1)})`}>
      <g className="site__inner">
        <line className="site__lead" x1={0} y1={0} x2={0} y2={-lead} />
        {site.live && <circle className="site__ring" r={5} />}
        <circle className="site__dot" r={site.live ? 5 : 3.5} />
        <text className="site__name" y={-lead - (site.live ? 24 : 20)}>
          {site.name}
        </text>
        <text className="site__sub" y={-lead - 7}>
          {site.live ? '已接入 · 示范区' : '规划展示'}
        </text>
      </g>
    </g>
  )
}

export function QinlingMap() {
  const narrow = useNarrow()
  return (
    <svg
      className="qinling-map"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio={narrow ? 'xMinYMax slice' : 'xMidYMax slice'}
      role="img"
      aria-label="秦岭示意图：太白山示范区已接入，朱雀、翠华山、牛背梁、华山为规划展示"
    >
      <path className="ridge ridge--far" d={ridgePath(FAR)} />
      <path className="ridge ridge--mid" d={ridgePath(MID)} />
      <path className="ridge ridge--front" d={ridgePath(FRONT)} />
      <g className="contours">
        {Array.from({ length: CONTOURS - 1 }, (_, i) => (
          <path key={i} className="contour" d={contourPath(FRONT, i + 1)} style={{ opacity: 0.2 - i * 0.017 }} />
        ))}
      </g>
      {QINLING_SITES.map((site) => (
        <Site key={site.id} site={site} />
      ))}
    </svg>
  )
}
