import type { Event } from '../api/client'
import type { components } from '../api/schema'

type Point = components['schemas']['Point']

// Static sample for the design proposal page only (no backend needed). Every
// record here is 演示数据 and carries is_demo: true.
export const DEMO_AREA = '太白山'

// Proposed demo points for 太白山 汤峪线; C owns the real list in the backend.
export const DEMO_POINTS: Point[] = [
  { id: 'tangyu-center', name: '汤峪游客服务中心' },
  { id: 'lianhua-falls', name: '莲花峰瀑布' },
  { id: 'honghuaping', name: '红桦坪' },
  { id: 'xiabansi', name: '下板寺' },
  { id: 'tianyuandifang', name: '天圆地方' },
  { id: 'daye-lake', name: '大爷海' },
].map((p) => ({
  ...p,
  scenic_id: 'taibai-demo',
  availability: 'demo' as const,
  label: '示范点位（非真实运营接入）',
  event_count: 0,
  pending_count: 0,
}))

export const DEMO_STATS = { reported: 12, processing: 3, closed: 8, demo: 12 }

export const DEMO_EVENT: Event = {
  revision: 1,
  relationship_version: 1,
  id: 'a3f29c1b7e4d4c0b9f1e2d3c4b5a6978',
  scenic_id: 'taibai-demo',
  point_id: 'xiabansi',
  description: '巴士站旁边护栏外有好多塑料瓶和零食袋',
  original_images: [],
  status: 'pending_review',
  assignee: null,
  resolution_images: [],
  resolution_note: '',
  review_note: '',
  is_demo: true,
  material_version: 1,
  created_at: '2026-10-02T06:32:00Z',
  updated_at: '2026-10-02T06:33:10Z',
  timeline: [],
  ai_status: { report: 'succeeded', resolution: 'not_started' },
  analyses: [
    {
      id: 'demo-analysis-1',
      version: 1,
      kind: 'report',
      material_version: 1,
      status: 'succeeded',
      model: 'qwen3-vl-plus',
      started_at: '2026-10-02T06:32:58Z',
      finished_at: '2026-10-02T06:33:10Z',
      stale: false,
      input_snapshot: {},
      error: null,
      result: {
        title: '下板寺巴士站旁塑料垃圾散落',
        summary: '护栏外坡面上散落着塑料瓶和零食包装袋，集中在靠近步道的一侧。',
        category: 'litter',
        visible_observations: [
          '护栏外坡面上约有 6 个塑料瓶、3–4 个零食包装袋',
          '垃圾集中在靠近步道一侧约 2 米的范围内',
          '照片里没有看到垃圾桶',
        ],
        missing_information: ['无法判断垃圾留在这里多久了', '坡下被灌木挡住的地方可能还有，照片里看不到'],
        follow_up_questions: [],
        recommendations: ['安排保洁组清理护栏外坡面', '顺带检查巴士站附近的垃圾桶是否满溢'],
        suggested_department: '保洁组',
      },
    },
  ],
}
