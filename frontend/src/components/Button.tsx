import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { buttonClass, type ButtonOptions } from './buttonClass'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonOptions & {
    icon?: ReactNode
  }

export function Button({ variant, tone, block, icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={[buttonClass({ variant, tone, block }), className].filter(Boolean).join(' ')}
      {...rest}
    >
      {icon}
      <span>{children}</span>
    </button>
  )
}
