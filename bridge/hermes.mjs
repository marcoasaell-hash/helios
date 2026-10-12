/**
 * Hermes Agent as the brain, in place of Claude Code.
 *
 * Hermes (Nous Research) exposes an OpenAI-compatible API server, by default on
 * http://localhost:8642/v1. This wraps it in the same shape the bridge already
 * consumes from the Agent SDK's query(): an async iterable of SDK-like messages
 * plus interrupt() and close(). So the rest of server.mjs — turn ids, barge-in,
 * the pump to the browser — does not need to know which brain is answering.
 *
 * What it does NOT carry over: the in-process tools (HUD blades, ui_*, chrome,
 * camera) and the decideTool gate. Hermes runs its own tools under its own
 * permission settings; JARVIS_ALLOW_WRITES has no say over them.
 */

/** One text delta, shaped like the SDK's partial stream event. */
const textEvent = (text) => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
})

/**
 * @param {AsyncIterable<{message: {content: string}}>} prompt  user messages
 * @param {{url: string, apiKey?: string, model: string, systemPrompt: string}} opts
 */
export function hermesSession(prompt, { url, apiKey, model, systemPrompt }) {
  // Kept here rather than relying on server-side sessions, so it works with
  // any OpenAI-compatible endpoint. Trimmed so a long evening stays cheap.
  const history = []
  const MAX_HISTORY = 20
  let controller = null

  async function* run() {
    yield { type: 'system', subtype: 'init', mcp_servers: [] }

    for await (const user of prompt) {
      const text = user.message.content
      history.push({ role: 'user', content: text })
      controller = new AbortController()
      let answer = ''

      try {
        const res = await fetch(`${url.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model,
            stream: true,
            messages: [
              { role: 'system', content: systemPrompt },
              ...history.slice(-MAX_HISTORY),
            ],
          }),
          signal: controller.signal,
        })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
        }

        // Server-sent events: `data: {...}` lines, ending with `data: [DONE]`.
        const decoder = new TextDecoder()
        let buf = ''
        for await (const chunk of res.body) {
          buf += decoder.decode(chunk, { stream: true })
          let nl
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (!data || data === '[DONE]') continue
            let json
            try {
              json = JSON.parse(data)
            } catch {
              continue
            }
            const delta = json.choices?.[0]?.delta?.content
            if (delta) {
              answer += delta
              yield textEvent(delta)
            }
          }
        }

        history.push({ role: 'assistant', content: answer || '…' })
        yield { type: 'result', subtype: 'success', result: answer }
      } catch (err) {
        // Keep whatever was said before an interruption, so the next question
        // has the context; drop the question entirely if nothing came back.
        if (answer) history.push({ role: 'assistant', content: answer })
        else history.pop()

        if (controller.signal.aborted) {
          yield { type: 'result', subtype: 'error_during_execution', errors: ['interrupted'] }
        } else {
          console.error(`[jarvis] hermes request failed: ${err?.message ?? err}`)
          yield { type: 'result', subtype: 'error_hermes', errors: [String(err?.message ?? err)] }
        }
      } finally {
        controller = null
      }
    }
  }

  const it = run()
  return {
    [Symbol.asyncIterator]: () => it,
    interrupt: async () => controller?.abort(),
    close: () => {
      controller?.abort()
      void it.return?.()
    },
  }
}
