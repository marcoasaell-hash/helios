/**
 * Continuous watch — runs on a short interval (systemd timer). Asks JARVIS
 * whether anything NEW and urgent has appeared; only fires a notification when
 * it has. Silence = nothing to report.
 */
import WebSocket from 'ws'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
function tgPush(text) {
  try {
    const env = readFileSync('/home/zwanski/.config/jarvis-telegram.env', 'utf8')
    const tok = (env.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m) || [])[1]
    const chat = (env.match(/^TELEGRAM_ALLOWED_CHAT_ID=(.+)$/m) || [])[1]
    if (!tok || !chat || !text) return Promise.resolve()
    return fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: Number(chat), text: text.slice(0, 4000) }),
    }).then(() => {}).catch(() => {})
  } catch { return Promise.resolve() }
}


const PORT = process.env.JARVIS_BRIDGE_PORT ?? '8795'
const PROMPT =
  'Silent watch check. Using your tools, look only for things that are NEW and ' +
  'genuinely urgent since the last hour: security or login events, account ' +
  'alerts, or mail that truly needs me now. If there is nothing urgent, reply ' +
  'with exactly the single word NONE and nothing else. Otherwise give one short ' +
  'line per item, no preamble.'

const notify = (title, body, urgency) =>
  new Promise((res) => execFile('notify-send', ['-a', 'JARVIS', '-u', urgency, title, body], () => res()))

const ws = new WebSocket(`ws://localhost:${PORT}`, { headers: { Origin: 'http://localhost:5173' } })
let asked = false, done = false, t = ''
const finish = async () => {
  if (done) return; done = true
  const body = (t || '').trim()
  // Only alert when there's a real item — not on NONE / empty.
  if (body && !/^none[.!]?$/i.test(body)) await notify('JARVIS — Alert', body, 'critical'); await tgPush('🚨 Alert\n'+body)
  try { ws.close() } catch {}
  process.exit(0)
}
setTimeout(finish, 90000)
let idle; const bump = () => { clearTimeout(idle); idle = setTimeout(finish, 20000) }
ws.on('message', (raw) => {
  let m; try { m = JSON.parse(raw.toString()) } catch { return }
  bump()
  if (m.type === 'ready' && !asked && Array.isArray(m.servers) && m.servers.length) {
    asked = true; ws.send(JSON.stringify({ type: 'ask', id: 'watch', text: PROMPT }))
  }
  if (m.type === 'text' && typeof m.delta === 'string') t += m.delta
  if (['done', 'error', 'message_stop', 'result'].includes(m.type)) { if (m.text) t = m.text; finish() }
})
ws.on('error', () => process.exit(1))
