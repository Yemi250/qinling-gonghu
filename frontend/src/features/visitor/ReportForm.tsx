import { ArrowLeft, Camera, Check, RefreshCw, Send } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import type { components } from '../../api/schema'
import { Button } from '../../components/Button'
import './visitor.css'

type Point = components['schemas']['Point']

export type ReportInput = {
  file: File
  pointId: string
  description: string
}

type ReportFormProps = {
  areaName: string
  // Points the API marks as available for reporting.
  points: Point[]
  busy?: boolean
  error?: string
  onSubmit?: (input: ReportInput) => void
}

const MAX_TEXT = 120

export function ReportForm({ areaName, points, busy = false, error, onSubmit }: ReportFormProps) {
  const fileId = useId()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [pointId, setPointId] = useState<string | null>(null)
  const [text, setText] = useState('')

  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const ready = file !== null && pointId !== null && !busy
  const missing = !file ? '先拍一张照片' : !pointId ? '再选一下位置' : null

  return (
    <div className="report">
      <header className="report__bar">
        <a className="report__back" href="#/" aria-label="返回总览">
          <ArrowLeft size={20} strokeWidth={1.5} />
        </a>
        <span className="report__title">随手拍</span>
        <span className="report__area">{areaName}示范区</span>
      </header>

      <form
        className="report__form"
        onSubmit={(e) => {
          e.preventDefault()
          if (file && pointId && !busy) onSubmit?.({ file, pointId, description: text.trim() })
        }}
      >
        <section className="report__step">
          <h2 className="report__step-title">
            <span className="mono">01</span>拍下你看到的问题
          </h2>
          <label className={`photo-drop${preview ? ' photo-drop--filled' : ''}`} htmlFor={fileId}>
            <input
              id={fileId}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/*"
              className="visually-hidden"
              disabled={busy}
              onChange={(e) => {
                const next = e.target.files?.[0]
                if (next) setFile(next)
                e.target.value = ''
              }}
            />
            {preview ? (
              <>
                <img src={preview} alt="已选择的照片" />
                <span className="photo-drop__swap">
                  <RefreshCw size={14} strokeWidth={1.75} />
                  换一张
                </span>
              </>
            ) : (
              <>
                <Camera size={28} strokeWidth={1.5} />
                <span className="photo-drop__main">拍照，或从相册选一张</span>
                <span className="photo-drop__hint">照片只用于这次处理</span>
              </>
            )}
          </label>
        </section>

        <section className="report__step">
          <h2 className="report__step-title">
            <span className="mono">02</span>在哪里
          </h2>
          {points.length > 0 ? (
            <div className="choice-list" role="group" aria-label="选择点位">
              {points.map((point, index) => {
                const selected = point.id === pointId
                return (
                  <button
                    key={point.id}
                    type="button"
                    className="choice"
                    aria-pressed={selected}
                    disabled={busy}
                    onClick={() => setPointId(point.id)}
                  >
                    <span className="choice__id mono">{String(index + 1).padStart(2, '0')}</span>
                    <span className="choice__name">{point.name}</span>
                    {selected && <Check className="choice__check" size={16} strokeWidth={2} />}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="report__empty">暂时读不到点位，请稍后刷新再试。</p>
          )}
        </section>

        <section className="report__step">
          <label className="field">
            <span className="field__label">
              <span className="report__step-title">
                <span className="mono">03</span>说两句
              </span>
              <span className="field__hint mono">
                可选 · {text.length}/{MAX_TEXT}
              </span>
            </span>
            <textarea
              className="input"
              maxLength={MAX_TEXT}
              placeholder="比如：巴士站旁边护栏外有好多塑料瓶"
              value={text}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
        </section>

        <div className="report__submit">
          {error && (
            <p className="report__error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" block disabled={!ready} icon={<Send size={18} strokeWidth={1.75} />}>
            {busy ? '正在提交…' : '提交，让景区看到'}
          </Button>
          <p className="report__fine">{missing ?? '提交后会拿到查询入口，随时查看进度。'}</p>
        </div>
      </form>
    </div>
  )
}
