#!/usr/bin/env node

import { existsSync, readFileSync, createWriteStream, chmodSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync, spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { homedir } from 'node:os'
import net from 'node:net'

const DEFAULT_PORT = 38173
const __filename = fileURLToPath(import.meta.url)
const rootDir = dirname(dirname(__filename))
const webDistIndex = join(rootDir, 'packages', 'web', 'dist', 'index.html')
const serverDistEntry = join(rootDir, 'packages', 'server', 'dist', 'index.js')
const packageJsonPath = join(rootDir, 'package.json')
const args = process.argv.slice(2)

let tunnelEnabled = false

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
    return typeof pkg.version === 'string' ? pkg.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

function printHelp() {
  console.log(`AgentClick CLI

Usage:
  agentclick [options]

Options:
  --tunnel        Start a cloudflared tunnel for phone/remote access (no account needed)
  --no-tunnel     Skip tunnel
  --version, -v   Show version number
  --help, -h      Show this help message

Examples:
  agentclick                Start the server (local only)
  agentclick --tunnel       Start with a public tunnel URL for phone access
  AGENTCLICK_PORT=4000 agentclick    Start on a specific port

Environment:
  AGENTCLICK_PORT         Preferred server port (default: 38173)
  PORT                    Backward-compatible server port override
  OPENCLAW_WEBHOOK        Webhook URL for agent callbacks
  WEB_ORIGIN              Override the public URL used in generated session links
`)
}

function parseArgs(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0) }
    if (arg === '--version' || arg === '-v') { console.log(readVersion()); process.exit(0) }
    if (arg === '--tunnel') { tunnelEnabled = true; continue }
    if (arg === '--no-tunnel') { tunnelEnabled = false; continue }
    console.error(`[agentclick] Unknown argument: ${arg}`)
    console.error('[agentclick] Run "agentclick --help" for usage.')
    process.exit(1)
  }
}

function runSync(command, cmdArgs) {
  const result = spawnSync(command, cmdArgs, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.error) {
    console.error(`[agentclick] Failed to run ${command}:`, result.error.message)
    process.exit(1)
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status)
  }
}

parseArgs(args)

if (!existsSync(webDistIndex) || !existsSync(serverDistEntry)) {
  console.log('[agentclick] Build artifacts not found, running npm run build...')
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  runSync(npmCmd, ['run', 'build'])
}

if (!existsSync(serverDistEntry)) {
  console.error('[agentclick] Server build output missing after build. Expected packages/server/dist/index.js')
  process.exit(1)
}

async function canListen(port) {
  return await new Promise(resolve => {
    const server = net.createServer()
    server.once('error', err => {
      if (err.code === 'EADDRINUSE') { resolve(false); return }
      console.error(`[agentclick] Port check failed for ${port}: ${err.message}`)
      process.exit(1)
    })
    server.once('listening', () => { server.close(() => resolve(true)) })
    server.listen(port)
  })
}

async function getClosestAvailablePort(preferredPort) {
  const nextPort = preferredPort + 1
  if (await canListen(nextPort)) return nextPort
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to resolve ephemeral port')))
        return
      }
      const freePort = address.port
      server.close(err => { if (err) reject(err); else resolve(freePort) })
    })
  })
}

async function isAgentClickServer(port) {
  const url = `http://localhost:${port}/api/identity`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1200)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return false
    const data = await response.json()
    return data && data.service === 'agentclick' && data.ok === true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function resolvePort() {
  const configuredPort = Number(process.env.AGENTCLICK_PORT || process.env.PORT || DEFAULT_PORT)
  if (!Number.isFinite(configuredPort) || configuredPort <= 0) {
    console.error('[agentclick] Invalid AGENTCLICK_PORT/PORT configuration.')
    process.exit(1)
  }
  const free = await canListen(configuredPort)
  if (free) return String(configuredPort)
  if (await isAgentClickServer(configuredPort)) {
    console.log(`[agentclick] AgentClick already running at http://localhost:${configuredPort}; reusing existing server.`)
    return null
  }
  const fallbackPort = await getClosestAvailablePort(configuredPort)
  console.log(`[agentclick] Port ${configuredPort} is occupied by another service. Starting AgentClick on ${fallbackPort}.`)
  return String(fallbackPort)
}

// ── cloudflared ───────────────────────────────────────────────────────────────

function getCloudflaredDownloadInfo() {
  const { platform, arch } = process
  if (platform === 'darwin') {
    const file = arch === 'arm64' ? 'cloudflared-darwin-arm64.tgz' : 'cloudflared-darwin-amd64.tgz'
    return { url: `https://github.com/cloudflare/cloudflared/releases/latest/download/${file}`, tgz: true }
  }
  if (platform === 'linux') {
    const file = arch === 'arm64' ? 'cloudflared-linux-arm64' : 'cloudflared-linux-amd64'
    return { url: `https://github.com/cloudflare/cloudflared/releases/latest/download/${file}`, tgz: false }
  }
  if (platform === 'win32') {
    return { url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe', tgz: false }
  }
  throw new Error(`Unsupported platform: ${platform}`)
}

async function ensureCloudflared() {
  // Check PATH first
  const whichResult = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['cloudflared'], { encoding: 'utf-8' })
  if (whichResult.status === 0) return whichResult.stdout.trim().split('\n')[0]

  // Check cached binary
  const cacheDir = join(homedir(), '.agentclick')
  const binaryName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
  const binaryPath = join(cacheDir, binaryName)
  if (existsSync(binaryPath)) return binaryPath

  // Download
  console.log('[agentclick] Downloading cloudflared (one-time, ~20MB)...')
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true })
  const { url, tgz } = getCloudflaredDownloadInfo()
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`Failed to download cloudflared: ${response.status} ${response.statusText}`)

  if (tgz) {
    // macOS: download .tgz then extract with system tar
    const tgzPath = binaryPath + '.tgz'
    const fileStream = createWriteStream(tgzPath)
    await pipeline(response.body, fileStream)
    const result = spawnSync('tar', ['-xzf', tgzPath, '-C', cacheDir], { encoding: 'utf-8' })
    if (result.status !== 0) throw new Error(`Failed to extract cloudflared: ${result.stderr}`)
    // tar extracts 'cloudflared' binary into cacheDir
  } else {
    const fileStream = createWriteStream(binaryPath)
    await pipeline(response.body, fileStream)
  }

  if (process.platform !== 'win32') chmodSync(binaryPath, 0o755)
  console.log('[agentclick] cloudflared ready.')
  return binaryPath
}

function startTunnel(binaryPath, port) {
  return new Promise((resolve, reject) => {
    const cf = spawn(binaryPath, ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timeout = setTimeout(() => { cf.kill(); reject(new Error('cloudflared did not return a URL within 30s')) }, 30_000)
    function onData(data) {
      const match = data.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (match) { clearTimeout(timeout); resolve({ url: match[0], process: cf }) }
    }
    cf.stdout.on('data', onData)
    cf.stderr.on('data', onData)
    cf.on('error', err => { clearTimeout(timeout); reject(err) })
    cf.on('exit', code => { if (code !== 0 && code !== null) { clearTimeout(timeout); reject(new Error(`cloudflared exited with code ${code}`)) } })
  })
}

function printTunnelBanner(url) {
  const bar = '─'.repeat(url.length + 4)
  console.log(`\n  ┌${bar}┐`)
  console.log(`  │  ${url}  │`)
  console.log(`  └${bar}┘`)
  console.log('  Open this URL on your phone. Valid while this terminal is open.\n')
}

// ── main ─────────────────────────────────────────────────────────────────────

const resolvedPort = await resolvePort()
if (!resolvedPort) process.exit(0)

const childEnv = { ...process.env, PORT: resolvedPort, AGENTCLICK_PORT: resolvedPort }
console.log(`[agentclick] Using AGENTCLICK_PORT=${resolvedPort}`)

let tunnelProcess = null
let cloudflaredBinaryPath = null

async function spawnTunnel(port) {
  try {
    const { url, process: cf } = await startTunnel(cloudflaredBinaryPath, port)
    tunnelProcess = cf
    printTunnelBanner(url)
    cf.on('exit', code => {
      tunnelProcess = null
      if (cloudflaredBinaryPath && serverProcess && !serverProcess.killed) {
        console.warn(`\n[agentclick] Tunnel exited (code ${code}), reconnecting in 3s...`)
        setTimeout(() => spawnTunnel(port), 3000)
      }
    })
  } catch (err) {
    console.warn(`[agentclick] Tunnel failed: ${err.message}, retrying in 10s...`)
    setTimeout(() => spawnTunnel(port), 10_000)
  }
}

if (tunnelEnabled) {
  try {
    cloudflaredBinaryPath = await ensureCloudflared()
    console.log('[agentclick] Starting tunnel...')
    await spawnTunnel(Number(resolvedPort))
  } catch (err) {
    console.warn(`[agentclick] Tunnel setup failed: ${err.message}`)
    console.warn('[agentclick] Continuing without tunnel (local only).')
  }
}

const serverProcess = spawn(process.execPath, [serverDistEntry], {
  cwd: rootDir,
  stdio: 'inherit',
  env: childEnv,
})

serverProcess.on('error', err => {
  console.error('[agentclick] Failed to start server:', err.message)
  process.exit(1)
})

serverProcess.on('exit', code => {
  if (tunnelProcess && !tunnelProcess.killed) try { tunnelProcess.kill('SIGTERM') } catch {}
  process.exit(code ?? 0)
})

function shutdown() {
  if (serverProcess && !serverProcess.killed) try { serverProcess.kill('SIGTERM') } catch {}
  if (tunnelProcess && !tunnelProcess.killed) try { tunnelProcess.kill('SIGTERM') } catch {}
  cloudflaredBinaryPath = null // prevent reconnect loop after intentional shutdown
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
