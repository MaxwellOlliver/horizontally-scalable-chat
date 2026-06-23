import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

/** Centered auth card shared by the sign-in and sign-up screens. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <Link to="/" className="text-gradient text-lg font-semibold tracking-[0.22em]">
            RELAY
          </Link>
        </div>
        <div className="card mt-6 p-6">
          <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
          <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>
          <div className="mt-5">{children}</div>
        </div>
        <p className="mt-5 text-center text-sm text-fg-muted">{footer}</p>
      </div>
    </div>
  )
}

/** Inline form-level error in the danger tone. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger"
    >
      {children}
    </div>
  )
}
