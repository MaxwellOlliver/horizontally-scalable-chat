import { useState, type KeyboardEvent } from 'react'
import { useTypingSignal } from '../../features/conversation/useTyping'
import { Button } from '../ui/Button'

/** Message input. Enter sends, Shift+Enter newlines. Emits typing signals. */
export function Composer({
  friendId,
  onSend,
}: {
  friendId: string
  onSend: (body: string) => void
}) {
  const [text, setText] = useState('')
  const { onInput, stop } = useTypingSignal(friendId)

  function submit() {
    const value = text.trim()
    if (!value) return
    onSend(value)
    setText('')
    stop()
  }

  function onChange(value: string) {
    setText(value)
    if (value.trim()) onInput()
    else stop()
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="shrink-0 bg-surface p-3">
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Message…"
          className="max-h-32 min-h-10 flex-1 resize-none rounded-xl bg-ink px-3 py-2.5 text-[13.5px] text-fg placeholder:text-fg-faint transition-shadow focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <Button onClick={submit} disabled={!text.trim()} className="max-h-10 px-4">
          Send
        </Button>
      </div>
    </div>
  )
}
