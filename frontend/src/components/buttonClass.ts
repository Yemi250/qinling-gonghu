export type ButtonVariant = 'primary' | 'secondary' | 'quiet'
export type ButtonTone = 'light' | 'night'

export type ButtonOptions = {
  variant?: ButtonVariant
  tone?: ButtonTone
  block?: boolean
}

// Shared by <Button> and by links styled as buttons.
export function buttonClass({ variant = 'primary', tone = 'light', block = false }: ButtonOptions = {}) {
  return ['btn', `btn--${variant}`, `btn--${tone}`, block ? 'btn--block' : ''].filter(Boolean).join(' ')
}
