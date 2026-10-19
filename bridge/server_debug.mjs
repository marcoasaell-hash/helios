/**
 * Debug version of bridge server to check environment variables
 */

import { WebSocketServer } from 'ws'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { displayServer } from './panels.mjs'
import { uiServer } from './ui.mjs'
import { chromeAvailable, chromeServer } from './chrome.mjs'
import { visionServer } from './vision.mjs'
import { desktopServer } from './desktop.mjs'
import { memoryServer, rememberTurn } from './memory.mjs'
import { browserServer } from './browser.mjs'
import { homedir, tmpdir } from 'node:os'
import { readFileSync, realpathSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import { openRemote, proxyError, vetTarget, PROXY_UA } from './net.mjs'
import { probeUrl, renderPage } from './page.mjs'

console.log('[jarvis debug] process.env.JARVIS_BRIDGE_PORT:', process.env.JARVIS_BRIDGE_PORT)
console.log('[jarvis debug] process.env:', JSON.stringify(process.env, null, 2))

const PORT = Number(process.env.JARVIS_BRIDGE_PORT ?? 8787)
console.log('[jarvis debug] PORT constant:', PORT)

// Just exit early for debugging
process.exit(0)