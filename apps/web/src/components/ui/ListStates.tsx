/** Shared loading / empty / error placeholders for sidebar lists. */

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="flex flex-col gap-0.5" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-3 py-2.5">
          <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-panel-2" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="h-3 w-2/5 animate-pulse rounded bg-panel-2" />
            <span className="h-2.5 w-4/5 animate-pulse rounded bg-panel-2/60" />
          </span>
        </li>
      ))}
    </ul>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <p className="text-[13px] font-medium text-fg">{title}</p>
      {hint && <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">{hint}</p>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <p className="text-[13px] font-medium text-fg">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-lg bg-panel-2 px-3 py-1.5 text-[12.5px] text-fg-muted transition-colors hover:bg-panel-3 hover:text-fg"
      >
        Retry
      </button>
    </div>
  )
}
