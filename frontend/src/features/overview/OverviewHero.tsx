import { Camera } from 'lucide-react'
import { buttonClass } from '../../components/buttonClass'
import { MetaStrip } from '../../components/MetaStrip'
import { Wordmark } from '../../components/Wordmark'
import { QinlingMap } from './QinlingMap'
import { DEMO_AREA_NAME } from './sites'
import './overview.css'

export type OverviewStats = {
  reported: number
  processing: number
  closed: number
  demo: number
}

type OverviewHeroProps = {
  // null while loading or when the API is unreachable; the hero still reads well.
  stats: OverviewStats | null
}

export function OverviewHero({ stats }: OverviewHeroProps) {
  return (
    <section className="overview">
      <header className="overview__nav">
        <a href="#/" className="overview__home" aria-label="秦岭共护 总览">
          <Wordmark tone="night" />
        </a>
        <nav className="overview__links" aria-label="主导航">
          <a href="#/report">随手拍</a>
          <a href="#/track">查进度</a>
        </nav>
      </header>

      <div className="overview__body">
        <div className="overview__intro">
          <p className="overview__eyebrow mono">QINLING · 秦岭生态共治</p>
          <h1 className="overview__title display">
            让每一次发现，
            <br />
            都有一个回应。
          </h1>
          <p className="overview__lede">
            游客随手拍下环境问题，AI 把它整理成能处理的事件，景区派人处置，结果回到发现它的人手里。从{DEMO_AREA_NAME}的一条步道开始。
          </p>
          <div className="overview__actions">
            <a className={buttonClass({ tone: 'night' })} href="#/report">
              <Camera size={18} strokeWidth={1.75} />
              随手拍，上报一个问题
            </a>
            <a className={buttonClass({ variant: 'secondary', tone: 'night' })} href="#/track">
              查看处理进度
            </a>
          </div>
        </div>

        {stats && (
          <aside className="overview__ledger" aria-label={`${DEMO_AREA_NAME}示范区记录`}>
            <p className="overview__ledger-head">
              <span>{DEMO_AREA_NAME}示范区</span>
              <span className="overview__ledger-note">
                {stats.demo > 0 ? `含演示数据 ${stats.demo} 条` : '实际记录'}
              </span>
            </p>
            <MetaStrip
              tone="night"
              items={[
                { label: '已上报', value: String(stats.reported), mono: true },
                { label: '处理中', value: String(stats.processing), mono: true },
                { label: '已结案', value: String(stats.closed), mono: true },
              ]}
            />
          </aside>
        )}
      </div>

      <div className="overview__map">
        <QinlingMap />
        <p className="overview__mapnote mono">秦岭 · 示意图 · 非实际比例</p>
      </div>
    </section>
  )
}
