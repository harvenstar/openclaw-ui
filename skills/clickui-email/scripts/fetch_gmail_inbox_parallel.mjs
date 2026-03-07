#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function usage() {
  console.error(
    'Usage: node skills/clickui-email/scripts/fetch_gmail_inbox_parallel.mjs ' +
      '--query "is:unread" --max 10 --out /tmp/clickui_inbox.json [--account you@gmail.com] [--concurrency 5]'
  )
}

function parseArgs(argv) {
  const args = {
    query: 'is:unread',
    max: 10,
    out: '/tmp/clickui_inbox.json',
    account: '',
    concurrency: 5,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]

    if (arg === '--query' && next) {
      args.query = next
      i += 1
      continue
    }
    if (arg === '--max' && next) {
      args.max = Number(next)
      i += 1
      continue
    }
    if (arg === '--out' && next) {
      args.out = next
      i += 1
      continue
    }
    if (arg === '--account' && next) {
      args.account = next
      i += 1
      continue
    }
    if (arg === '--concurrency' && next) {
      args.concurrency = Number(next)
      i += 1
      continue
    }
    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    }

    throw new Error(`Unknown or incomplete argument: ${arg}`)
  }

  if (!Number.isFinite(args.max) || args.max <= 0) {
    throw new Error('--max must be a positive number')
  }
  if (!Number.isFinite(args.concurrency) || args.concurrency <= 0) {
    throw new Error('--concurrency must be a positive number')
  }

  return args
}

function normalizeCategory(labels = []) {
  if (labels.includes('CATEGORY_PRIMARY')) return 'Primary'
  if (labels.includes('CATEGORY_SOCIAL')) return 'Social'
  if (labels.includes('CATEGORY_PROMOTIONS')) return 'Promotions'
  if (labels.includes('CATEGORY_UPDATES')) return 'Updates'
  if (labels.includes('CATEGORY_FORUMS')) return 'Forums'
  return 'Updates'
}

function headerValue(headers, name) {
  return headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value || ''
}

async function gogJson(args) {
  const { stdout } = await execFileAsync('gog', args, { maxBuffer: 20 * 1024 * 1024 })
  return JSON.parse(stdout)
}

async function fetchSearchResults({ query, max, account }) {
  const args = ['gmail', 'search', query, '--max', String(max), '--json', '--results-only', '--no-input']
  if (account) args.push('--account', account)
  return gogJson(args)
}

async function fetchMessage(id, account) {
  const args = ['gmail', 'get', id, '--json', '--results-only', '--no-input']
  if (account) args.push('--account', account)
  return gogJson(args)
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length)
  let cursor = 0

  async function worker() {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await mapper(items[index], index)
    }
  }

  const workerCount = Math.min(limit, items.length || 1)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

function toInboxItem(item, detail) {
  const payloadHeaders = detail.message?.payload?.headers || []
  const body = detail.body || detail.message?.snippet || ''
  const preview = (detail.message?.snippet || body || '').replace(/\s+/g, ' ').trim().slice(0, 160)
  const labels = detail.message?.labelIds || item.labels || []

  return {
    id: item.id,
    from: detail.headers?.from || item.from || '',
    to: detail.headers?.to || '',
    subject: detail.headers?.subject || item.subject || '',
    preview,
    body,
    headers: [
      { label: 'Message-ID', value: headerValue(payloadHeaders, 'Message-ID') },
      { label: 'Thread', value: detail.message?.threadId || item.id },
      { label: 'Date', value: detail.headers?.date || item.date || '' },
    ].filter((header) => header.value),
    category: normalizeCategory(labels),
    unread: labels.includes('UNREAD'),
    timestamp: Number(detail.message?.internalDate || Date.now()),
    gmailThreadId: detail.message?.threadId || item.id,
    gmailMessageId: detail.message?.id || item.id,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const searchResults = await fetchSearchResults(args)
  const inbox = await mapWithConcurrency(searchResults, args.concurrency, async (item) => {
    const detail = await fetchMessage(item.id, args.account)
    return toInboxItem(item, detail)
  })

  await writeFile(args.out, JSON.stringify(inbox, null, 2))
  console.log(JSON.stringify({ out: args.out, count: inbox.length }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
