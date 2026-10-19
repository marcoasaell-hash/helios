import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import WebSocket from 'ws'
import { z } from 'zod'

/**
 * A small Windows-friendly browser link.
 *
 * The reference project talks to the Claude Chrome extension through a Unix
 * native-messaging socket. That is useful on macOS and Linux, but Windows users
 * need a different local path. This adapter starts a separate Chrome profile
 * with a localhost DevTools port, so the user can sign into Gmail or WhatsApp
 * Web once and JARVIS can then read that same session without embedding secrets
 * in the renderer.
 */
const PORT = Number(process.env.JARVIS_BROWSER_DEBUG_PORT ?? 9222)
const DATA_DIR = process.env.JARVIS_DATA_DIR ?? join(homedir(), '.jarvis')
const PROFILE = join(DATA_DIR, 'browser-profile')
let browserProcess = null
let activeTarget = null

function browserCandidates() {
  if (process.env.JARVIS_BROWSER_PATH) return [process.env.JARVIS_BROWSER_PATH]
  if (process.platform !== 'win32') return ['google-chrome', 'chromium', 'chromium-browser']
  return [
    join(process.env.PROGRAMFILES ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env['PROGRAMFILES(X86)'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.PROGRAMFILES ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]
}

function findBrowser() {
  return browserCandidates().find((candidate) => existsSync(candidate)) ?? browserCandidates()[0]
}

async function targets() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  if (!response.ok) throw new Error(`browser debug endpoint returned ${response.status}`)
  return await response.json()
}

function launchBrowser() {
  if (browserProcess && !browserProcess.killed) return
  const command = findBrowser()
  if (!command) throw new Error('Chrome or Edge was not found. Set JARVIS_BROWSER_PATH to its executable.')
  browserProcess = spawn(
    command,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { detached: true, stdio: 'ignore', windowsHide: true },
  )
  browserProcess.unref()
}

async function waitForTarget() {
  for (let i = 0; i < 20; i++) {
    try {
      const pages = (await targets()).filter((item) => item.type === 'page' && item.webSocketDebuggerUrl)
      if (pages.length) return pages[0]
    } catch {
      // The browser is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('The browser did not expose a debuggable page.')
}

async function getTarget() {
  try {
    const pages = (await targets()).filter((item) => item.type === 'page' && item.webSocketDebuggerUrl)
    if (pages.length) return pages[0]
  } catch {
    // Start the dedicated profile below.
  }
  launchBrowser()
  return waitForTarget()
}

class BrowserLink {
  constructor() {
    this.socket = null
    this.nextId = 0
    this.pending = new Map()
  }

  close() {
    for (const pending of this.pending.values()) pending.reject(new Error('browser connection closed'))
    this.pending.clear()
    this.socket?.close()
    this.socket = null
  }

  async connect(target) {
    if (this.socket?.readyState === WebSocket.OPEN && activeTarget === target.id) return
    this.close()
    activeTarget = target.id
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(target.webSocketDebuggerUrl)
      const timer = setTimeout(() => {
        socket.close()
        reject(new Error('browser DevTools did not accept a connection'))
      }, 5000)
      socket.once('open', () => {
        clearTimeout(timer)
        this.socket = socket
        resolve()
      })
      socket.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      socket.on('close', () => {
        if (this.socket === socket) this.close()
      })
      socket.on('message', (raw) => {
        let message
        try {
          message = JSON.parse(raw.toString())
        } catch {
          return
        }
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message ?? 'browser command failed'))
        else pending.resolve(message.result)
      })
    })
  }

  async request(method, params = {}) {
    const target = await getTarget()
    await this.connect(target)
    return await new Promise((resolve, reject) => {
      const id = ++this.nextId
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('browser command timed out'))
      }, 20_000)
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const response = await this.request('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (response?.exceptionDetails) throw new Error('The page rejected the browser expression.')
    return response?.result?.value
  }
}

const link = new BrowserLink()

async function navigate(url) {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http and https pages can be opened.')
  await link.request('Page.navigate', { url: parsed.href })
  await new Promise((resolve) => setTimeout(resolve, 900))
}

async function readPage(maxChars = 12_000) {
  return await link.evaluate(`(() => {
    const visible = (el) => {
      const style = getComputedStyle(el)
      const box = el.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
    }
    const nodes = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]')]
      .filter(visible)
      .slice(0, 160)
    window.__jarvisRefs = {}
    const interactive = nodes.map((el, index) => {
      const ref = 'ref_' + (index + 1)
      window.__jarvisRefs[ref] = el
      const label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || el.value || el.title || el.tagName).trim().replace(/\\s+/g, ' ').slice(0, 160)
      return { ref, tag: el.tagName.toLowerCase(), label }
    })
    return {
      url: location.href,
      title: document.title,
      text: (document.body?.innerText || '').slice(0, ${Math.max(1000, Math.min(30000, Number(maxChars) || 12000))}),
      interactive,
    }
  })()`)
}

export function browserServer({ allowWrites = false } = {}) {
  const tools = [
    tool(
      'browser_status',
      'Check the dedicated JARVIS Chrome or Edge session. It can be used for logged-in Gmail, WhatsApp Web, and other sites after the user signs in once.',
      {},
      async () => {
        try {
          const page = await getTarget()
          return { content: [{ type: 'text', text: `Browser ready on ${page.url || 'a blank page'}.` }] }
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: `Browser unavailable: ${error.message}` }] }
        }
      },
    ),
    tool(
      'browser_read_page',
      'Read the current signed-in browser page. Returns visible text and refs for links, buttons, and fields.',
      { max_chars: z.union([z.number(), z.string()]).optional().catch(12000) },
      async (args) => {
        try {
          const page = await readPage(args.max_chars)
          return { content: [{ type: 'text', text: JSON.stringify(page) }] }
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: `Could not read the browser page: ${error.message}` }] }
        }
      },
    ),
    tool(
      'browser_page_text',
      'Read only the visible text of the current browser page.',
      { max_chars: z.union([z.number(), z.string()]).optional().catch(12000) },
      async (args) => {
        try {
          const page = await readPage(args.max_chars)
          return { content: [{ type: 'text', text: page.text }] }
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: `Could not read the browser page: ${error.message}` }] }
        }
      },
    ),
    tool(
      'browser_search',
      'Search the web in the dedicated browser and return the visible result page.',
      { query: z.string() },
      async (args) => {
        try {
          await navigate(`https://www.google.com/search?q=${encodeURIComponent(args.query)}`)
          const page = await readPage(14000)
          return { content: [{ type: 'text', text: JSON.stringify(page) }] }
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: `Could not search in the browser: ${error.message}` }] }
        }
      },
    ),
    tool(
      'browser_find',
      'Find visible interactive elements on the current page by label or nearby text.',
      { query: z.string() },
      async (args) => {
        try {
          const result = await link.evaluate(`(() => {
            const q = ${JSON.stringify(String(args.query).toLowerCase())}
            return [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]')]
              .filter((el) => (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.value || '').toLowerCase().includes(q))
              .slice(0, 30)
              .map((el) => ({ tag: el.tagName.toLowerCase(), text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.value || '').trim().slice(0, 160) }))
          })()`)
          return { content: [{ type: 'text', text: JSON.stringify(result ?? []) }] }
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: `Could not search the page: ${error.message}` }] }
        }
      },
    ),
    tool(
      'browser_screenshot',
      'Capture the current browser page as an image when the user asks what it looks like.',
      {},
      async () => {
        try {
          const image = await link.request('Page.captureScreenshot', { format: 'png', fromSurface: true })
          return { content: [{ type: 'image', data: image.data, mimeType: 'image/png' }] }
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: `Could not capture the page: ${error.message}` }] }
        }
      },
    ),
  ]

  if (allowWrites) {
    tools.push(
      tool(
        'browser_open',
        'Open a URL in the dedicated signed-in browser session.',
        { url: z.string() },
        async (args) => {
          try {
            await navigate(args.url)
            return { content: [{ type: 'text', text: 'The page is open.' }] }
          } catch (error) {
            return { isError: true, content: [{ type: 'text', text: `Could not open the page: ${error.message}` }] }
          }
        },
      ),
      tool(
        'browser_click',
        'Click a ref returned by browser_read_page. Read the page first and use the exact ref.',
        { ref: z.string() },
        async (args) => {
          try {
            const clicked = await link.evaluate(`(() => { const el = window.__jarvisRefs?.[${JSON.stringify(args.ref)}]; if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true })()`)
            if (!clicked) return { isError: true, content: [{ type: 'text', text: 'That page ref is stale. Read the page again.' }] }
            await new Promise((resolve) => setTimeout(resolve, 700))
            return { content: [{ type: 'text', text: 'Clicked.' }] }
          } catch (error) {
            return { isError: true, content: [{ type: 'text', text: `Could not click that ref: ${error.message}` }] }
          }
        },
      ),
      tool(
        'browser_type',
        'Type into a ref returned by browser_read_page. Read the page first and use the exact ref.',
        { ref: z.string(), text: z.string() },
        async (args) => {
          try {
            const typed = await link.evaluate(`(() => {
              const el = window.__jarvisRefs?.[${JSON.stringify(args.ref)}]
              if (!el) return false
              el.focus()
              const value = ${JSON.stringify(args.text)}
              if ('value' in el) {
                const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
                if (setter) setter.call(el, value); else el.value = value
              } else el.textContent = value
              el.dispatchEvent(new Event('input', { bubbles: true }))
              el.dispatchEvent(new Event('change', { bubbles: true }))
              return true
            })()`)
            if (!typed) return { isError: true, content: [{ type: 'text', text: 'That page ref is stale. Read the page again.' }] }
            return { content: [{ type: 'text', text: 'Text entered.' }] }
          } catch (error) {
            return { isError: true, content: [{ type: 'text', text: `Could not enter that text: ${error.message}` }] }
          }
        },
      ),
    )
  }

  return createSdkMcpServer({
    name: 'jarvis_browser',
    version: '1.0.0',
    alwaysLoad: true,
    instructions:
      'A local signed-in Chrome or Edge profile for Gmail, WhatsApp Web, and web research. ' +
      'Always read the page before clicking. Before sending a message or submitting a form, say exactly what will be sent and to whom.',
    tools,
  })
}
