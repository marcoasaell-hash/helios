/**
 * Phone ingest — JARVIS's eyes on the phone.
 * Phones (Android Termux daemon / iOS Shortcut) POST their state here; the
 * latest snapshot is written to ~/jarvis-phone/state.json for JARVIS to read,
 * and anything marked urgent is forwarded to Telegram.
 * Auth: Bearer PHONE_INGEST_TOKEN. Reach it from the phone over Tailscale.
 */
import { createServer } from 'node:http'
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const TOKEN = process.env.PHONE_INGEST_TOKEN
const PORT = Number(process.env.PHONE_INGEST_PORT ?? 8799)
const DIR = join(homedir(), 'jarvis-phone')
mkdirSync(DIR, { recursive: true })
const STATE = join(DIR, 'state.json')
if (!TOKEN) { console.error('PHONE_INGEST_TOKEN not set'); process.exit(1) }

const tgUrgent = (text) => {
  try {
    const env = readFileSync(join(homedir(), '.config/jarvis-phone.env'), 'utf8')
    const tok = (env.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m) || [])[1]
    const chat = (env.match(/^TELEGRAM_ALLOWED_CHAT_ID=(.+)$/m) || [])[1]
    if (tok && chat && text)
      fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: Number(chat), text: ('📱 ' + text).slice(0, 4000) }),
      }).catch(() => {})
  } catch {}
}

createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/phone') { res.writeHead(404); return res.end('no') }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401); return res.end('unauthorized') }
  let body = ''
  req.on('data', (c) => { body += c; if (body.length > 512 * 1024) req.destroy() })
  req.on('end', () => {
    let data; try { data = JSON.parse(body || '{}') } catch { res.writeHead(400); return res.end('bad json') }
    data.received_at = new Date().toISOString()
    try { writeFileSync(STATE, JSON.stringify(data, null, 1)) } catch {}
    if (data.urgent) tgUrgent(String(data.urgent))
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}')
  })
}).listen(PORT, '0.0.0.0', () => console.log(`[phone-ingest] listening on :${PORT} -> ${STATE}`))
