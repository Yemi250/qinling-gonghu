// Scenic areas on the Qinling overview map. x is a 0–1 position along the range,
// west to east. Only the demo area is live; the rest are vision placeholders and
// must read 规划展示.
export type MapSite = {
  id: string
  name: string
  x: number
  live: boolean
  drop?: number
}

export const DEMO_AREA_NAME = '太白山'

export const QINLING_SITES: MapSite[] = [
  { id: 'taibai', name: DEMO_AREA_NAME, x: 0.18, live: true },
  { id: 'zhuque', name: '朱雀', x: 0.38, live: false },
  { id: 'cuihua', name: '翠华山', x: 0.54, live: false },
  { id: 'niubeiliang', name: '牛背梁', x: 0.64, live: false, drop: 46 },
  { id: 'huashan', name: '华山', x: 0.85, live: false },
]
