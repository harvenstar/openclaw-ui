#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import net from 'node:net'

const __filename = fileURLToPath(import.meta.url)
const rootDir = dirname(dirname(__filename))
const webDistIndex = join(rootDir, 'packages', 'web', 'dist', 'index.html')
const serverDistEntry = join(rootDir, 'packages', 'server', 'dist', 'index.js')
const args = process.argv.slice(2)

function printHelp() {
  console.log(`AgentClick CLI

Usage:
  agentclick
  agentclick --help

Options:
  --help, -h   Show this help message
`)
}

function parseArgs(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
    console.error(`[agentclick] Unknown argument: ${arg}`)
    console.error('[agentclick] Run "agentclick --help" for usage.')
    process.exit(1)
  }
  return {}
}

function run(command, args) {
  const result = spawnSync(command, args, {
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
  run(npmCmd, ['run', 'build'])
}

if (!existsSync(serverDistEntry)) {
  console.error('[agentclick] Server build output missing after build. Expected packages/server/dist/index.js')
  process.exit(1)
}

async function canListen(port) {
  return await new Promise(resolve => {
    const server = net.createServer()
    server.once('error', err => {
      if ((err).code === 'EADDRINUSE') {
        resolve(false)
        return
      }
      console.error(`[agentclick] Port check failed for ${port}: ${err.message}`)
      process.exit(1)
    })
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port)
  })
}

async function resolvePort() {
  if (process.env.PORT) return process.env.PORT

  let port = 3001
  while (true) {
    const available = await canListen(port)
    if (available) return String(port)
    console.log(`[agentclick] Port ${port} in use, trying ${port + 1}...`)
    port += 1
  }
}

const childEnv = { ...process.env }
childEnv.PORT = await resolvePort()

const result = spawnSync(process.execPath, [serverDistEntry], {
  cwd: rootDir,
  stdio: 'inherit',
  env: childEnv,
})
if (result.error) {
  console.error('[agentclick] Failed to start server:', result.error.message)
  process.exit(1)
}
if (typeof result.status === 'number' && result.status !== 0) {
  process.exit(result.status)
}
