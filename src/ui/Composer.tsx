import { useState } from 'react'

/**
 * Text access to JARVIS — the same turn the voice path runs, typed.
 *
 * Sending dispatches through App's `respond`, so a typed line behaves exactly
 * like a spoken one: it barges in on an answer in flight, shows on the
 * transcript, streams back, and speaks. Voice stays; this is a second door in.
 */
export function Composer({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('')
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
  }
  return (
    <form className="composer" onSubmit={submit}>
      <input
        className="composer-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type to JARVIS…"
        autoComplete="off"
        spellCheck={false}
        aria-label="Message JARVIS"
      />
      <button className="composer-send" type="submit" aria-label="Send">
        ↵
      </button>
    </form>
  )
}
