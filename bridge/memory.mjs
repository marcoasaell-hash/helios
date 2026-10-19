import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { mkdir, readFile, appendFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

const DATA_DIR = process.env.JARVIS_DATA_DIR ?? join(homedir(), '.jarvis')
const MEMORY_FILE = join(DATA_DIR, 'memory.jsonl')
const ENABLED = process.env.JARVIS_MEMORY_ENABLED !== '0'
const MAX_RECORD_CHARS = 12_000
let writeChain = Promise.resolve()

const stopWords = new Set(
  'a an and are as at be been but by can could did do does for from had has have he her him his how i if in is it its me my no of on or our she so than that the their them there they this to was we were what when where which who will with would you your'.split(' '),
)

function tokens(value) {
  return new Set(
    String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2 && !stopWords.has(token)),
  )
}

function clip(value, max = MAX_RECORD_CHARS) {
  const text = String(value ?? '').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

async function records() {
  try {
    const raw = await readFile(MEMORY_FILE, 'utf8')
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

/** Persist one completed exchange without allowing two turns to interleave. */
export function rememberTurn(user, assistant) {
  if (!ENABLED) return Promise.resolve()
  const record = {
    at: new Date().toISOString(),
    user: clip(user),
    assistant: clip(assistant),
  }
  writeChain = writeChain
    .catch(() => {})
    .then(async () => {
      await mkdir(DATA_DIR, { recursive: true })
      await appendFile(MEMORY_FILE, `${JSON.stringify(record)}\n`, 'utf8')
    })
  return writeChain
}

export async function searchMemory(query, limit = 8) {
  if (!ENABLED) return []
  const all = await records()
  if (!all.length) return []
  const wanted = tokens(query)
  const ranked = all
    .map((record, index) => {
      const haystack = tokens(`${record.user} ${record.assistant}`)
      let score = wanted.size === 0 ? 1 : 0
      for (const token of wanted) if (haystack.has(token)) score += 1
      // Recent context wins ties, which makes "what did we just discuss" useful.
      score += index / Math.max(1, all.length) * 0.2
      return { record, score }
    })
    .filter((entry) => wanted.size === 0 || entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(20, Number(limit) || 8)))
  return ranked.map(({ record }) => record)
}

export function memoryServer() {
  return createSdkMcpServer({
    name: 'jarvis_memory',
    version: '1.0.0',
    alwaysLoad: true,
    instructions:
      'Persistent local conversation memory. Search it when the user refers to ' +
      'an earlier conversation, preference, decision, person, or task. It survives ' +
      'restarts and is stored only on this computer.',
    tools: [
      tool(
        'memory_search',
        'Search previous JARVIS conversations for relevant context. Use an empty ' +
          'query for the most recent exchanges. Do not claim to remember something ' +
          'unless this tool returns it.',
        {
          query: z.string().optional().catch('').describe('Words or topic to look for.'),
          limit: z.union([z.number(), z.string()]).optional().catch(8),
        },
        async (args) => {
          const found = await searchMemory(args.query ?? '', args.limit ?? 8)
          if (!found.length) return { content: [{ type: 'text', text: 'No matching memories.' }] }
          return {
            content: [
              {
                type: 'text',
                text: found
                  .map((item) => `[${item.at}] User: ${item.user}\nJARVIS: ${item.assistant}`)
                  .join('\n\n'),
              },
            ],
          }
        },
      ),
    ],
  })
}
