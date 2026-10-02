import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { OverviewHero, type OverviewStats } from './OverviewHero'

// Numbers come only from saved records via /api/overview. If the API is not
// reachable the hero renders without the ledger rather than inventing figures.
export function OverviewPage() {
  const [stats, setStats] = useState<OverviewStats | null>(null)

  useEffect(() => {
    let active = true
    api
      .overview()
      .then((overview) => {
        if (!active) return
        setStats({
          reported: overview.total,
          processing: overview.by_status.processing ?? 0,
          closed: overview.closed_count,
          demo: overview.demo_count,
        })
      })
      .catch(() => {
        if (active) setStats(null)
      })
    return () => {
      active = false
    }
  }, [])

  return <OverviewHero stats={stats} />
}
