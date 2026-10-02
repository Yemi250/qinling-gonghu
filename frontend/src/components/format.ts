// Display helpers shared by visitor and admin views. The API sends UTC ISO 8601;
// the scenic area runs on Beijing time.
const TIME = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function formatTime(iso: string | null | undefined) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const part = Object.fromEntries(TIME.formatToParts(date).map((p) => [p.type, p.value]))
  return `${part.month}-${part.day} ${part.hour}:${part.minute}`
}

// Short, readable reference for an event id (32 hex chars from the API).
export function eventCode(id: string) {
  return `QL-${id.slice(0, 8).toUpperCase()}`
}
