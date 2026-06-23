/** "<name> is typing" with three softly-bouncing dots. */
export function TypingIndicator({ name }: { name: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2 px-5 py-1.5">
      <span className="flex items-end gap-0.5">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="typing-dot h-1.5 w-1.5 rounded-full bg-fg-faint"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      <span className="text-[11px] text-fg-muted">{name} is typing</span>
    </div>
  )
}
