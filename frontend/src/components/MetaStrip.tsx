type MetaItem = {
  label: string
  value: string
  mono?: boolean
}

export function MetaStrip({ items, tone = 'light' }: { items: MetaItem[]; tone?: 'light' | 'night' }) {
  return (
    <dl className={`meta-strip meta-strip--${tone}`}>
      {items.map((item) => (
        <div key={item.label} className="meta-strip__item">
          <dt>{item.label}</dt>
          <dd className={item.mono ? 'mono' : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
