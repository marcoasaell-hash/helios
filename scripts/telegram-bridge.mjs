/**
 * JARVIS ⇄ Telegram bridge.
 *
 * Lets Mohamed command his LOCAL JARVIS from his phone: text or voice notes go
 * to the bot, get relayed to the JARVIS bridge (its full toolset + memory), and
 * the spoken-style answer comes back in the chat. Only the authorised chat id is
 * honoured — this drives a machine with write access, so it is not open to the
 * world.
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN        (required) from @BotFather
 *   TELEGRAM_ALLOWED_CHAT_ID  (required) only this chat may command JARVIS
 *   JARVIS_BRIDGE_PORT        (default 8795)
 */
import WebSocket from 'ws'

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const ALLOWED = String(process.env.TELEGRAM_ALLOWED_CHAT_ID ?? '')
const PORT = process.env.JARVIS_BRIDGE_PORT ?? '8795'
if (!TOKEN) { console.error('TELEGRAM_BOT_TOKEN not set'); process.exit(1) }
const API = `https://api.telegram.org/bot${TOKEN}`
const FILE = `https://api.telegram.org/file/bot${TOKEN}`

const tg = async (method, body) => {
  const r = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json().catch(() => ({}))
}
const send = (chat, text) => tg('sendMessage', { chat_id: chat, text: text.slice(0, 4000) })
const typing = (chat) => tg('sendChatAction', { chat_id: chat, action: 'typing' })

/** One JARVIS turn over a fresh WS. Returns the answer text. */
function askJarvis(prompt) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`, { headers: { Origin: 'http://localhost:5173' } })
    let asked = false, done = false, t = ''
    const fin = (x) => { if (done) return; done = true; try { ws.close() } catch {}; resolve(x) }
    const hard = setTimeout(() => fin((t || '').trim() || 'No answer — the turn timed out.'), 120000)
    let idle; const bump = () => { clearTimeout(idle); idle = setTimeout(() => fin((t || '').trim() || '(no response)'), 25000) }
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()) } catch { return }
      bump()
      if (m.type === 'ready' && !asked && Array.isArray(m.servers) && m.servers.length) {
        asked = true; ws.send(JSON.stringify({ type: 'ask', id: 'tg', text: prompt }))
      }
      if (m.type === 'text' && typeof m.delta === 'string') t += m.delta
      if (['done', 'error', 'message_stop', 'result'].includes(m.type)) { clearTimeout(hard); if (m.text) t = m.text; fin((t || '').trim() || '(no response)') }
    })
    ws.on('error', () => fin('JARVIS bridge is unreachable right now.'))
  })
}

/** Transcribe a Telegram voice note through the bridge's ElevenLabs Scribe. */
async function transcribe(fileId) {
  const f = await tg('getFile', { file_id: fileId }).then((j) => j?.result?.file_path).catch(() => null)
  if (!f) return null
  const audio = Buffer.from(await fetch(`${FILE}/${f}`).then((r) => r.arrayBuffer()))
  const r = await fetch(`http://localhost:${PORT}/stt`, {
    method: 'POST', headers: { 'content-type': 'audio/ogg' }, body: audio,
  })
  if (!r.ok) return null
  const txt = await r.text()
  try { return JSON.parse(txt).text ?? txt } catch { return txt }
}

async function handle(msg) {
  const chat = String(msg.chat?.id ?? '')
  if (!ALLOWED) { await send(chat, `Your chat id is ${chat}. Set TELEGRAM_ALLOWED_CHAT_ID to it and restart.`); return }
  if (chat !== ALLOWED) { await send(chat, 'Not authorised.'); return }
  let text = msg.text
  if (!text && msg.voice) { await typing(chat); text = await transcribe(msg.voice.file_id); }
  if (!text) { await send(chat, 'Send text or a voice note.'); return }
  if (text === '/start') { await send(chat, 'JARVIS online. Text or voice-note me anything.'); return }
  await typing(chat)
  const answer = await askJarvis(text)
  await send(chat, answer)
}

async function main() {
  console.log('[jarvis-tg] bridge up' + (ALLOWED ? '' : ' (no allowed chat id yet — message the bot to learn it)'))
  let offset = 0
  for (;;) {
    try {
      const r = await fetch(`${API}/getUpdates?timeout=30&offset=${offset}`).then((x) => x.json())
      for (const u of r.result ?? []) {
        offset = u.update_id + 1
        if (u.message) handle(u.message).catch((e) => console.error('[jarvis-tg]', e?.message))
      }
    } catch (e) { console.error('[jarvis-tg] poll error', e?.message); await new Promise((r) => setTimeout(r, 5000)) }
  }
}
main()
