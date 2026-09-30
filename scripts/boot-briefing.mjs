/**
 * Boot briefing — runs once after JARVIS starts (systemd).
 * Connects to the local bridge, asks for a short situational briefing, and
 * fires it as a desktop notification. No face required.
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
const URL = `ws://localhost:${PORT}`
const PROMPT =
  'Boot briefing. Using your tools, in at most four short lines: unread email ' +
  'count and anything that actually needs me, today\'s calendar, and any alerts ' +
  'or overnight changes worth knowing. If a source is unavailable, skip it silently.'

const notify = (title, body, urgency = 'normal') =>
  new Promise((res) =>
    execFile('notify-send', ['-a', 'JARVIS', '-u', urgency, title, body], () => res()),
  )

function run() {
  const ws = new WebSocket(URL, { headers: { Origin: `http://localhost:5173` } })
  let asked = false
  let done = false
  let text = ''
  const finish = async (why) => {
    if (done) return
    done = true
    const body = (text || '').trim() || 'Briefing unavailable.'
    await notify('JARVIS — Boot Briefing', body); await tgPush('🧠 Briefing\n'+body)
    try { ws.close() } catch {}
    process.exit(0)
  }
  const hard = setTimeout(() => finish('cap'), 90000)
  let idle
  const bump = () => { clearTimeout(idle); idle = setTimeout(() => finish('idle'), 20000) }

  ws.on('open', () => {})
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()) } catch { return }
    bump()
    // wait for the init 'ready' that lists the connected MCP servers
    if (m.type === 'ready' && !asked && Array.isArray(m.servers) && m.servers.length) {
      asked = true
      ws.send(JSON.stringify({ type: 'ask', id: 'boot-briefing', text: PROMPT }))
    }
    if (m.type === 'text' && typeof m.delta === 'string') text += m.delta
    if (['done', 'error', 'message_stop', 'result'].includes(m.type)) {
      if (m.text) text = m.text
      finish('evt:' + m.type)
    }
  })
  ws.on('error', async () => { clearTimeout(hard); await notify('JARVIS', 'Bridge not reachable for briefing.', 'low'); process.exit(1) })
}
run()
