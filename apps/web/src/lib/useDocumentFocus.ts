import { useEffect, useState } from 'react'

const isFocused = () => document.visibilityState === 'visible' && document.hasFocus()

/** Whether the tab is focused — `seen` requires focus + view (REQUIREMENTS §4.3). */
export function useDocumentFocus(): boolean {
  const [focused, setFocused] = useState(isFocused)

  useEffect(() => {
    const update = () => setFocused(isFocused())
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    return () => {
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
    }
  }, [])

  return focused
}
