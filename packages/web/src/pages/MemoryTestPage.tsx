import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const DEFAULT_CONTEXT_FILES = ['SKILL.md', 'README.md']
const DEFAULT_MARKDOWN_INPUT = ['README.md', 'SKILL.md', 'docs'].join('\n')
const DEFAULT_SEARCH_DIRS = ['docs']
const DEFAULT_SEARCH_QUERY = 'memory'

export default function MemoryTestPage() {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [contextFiles, setContextFiles] = useState(DEFAULT_CONTEXT_FILES.join('\n'))
  const [markdownInput, setMarkdownInput] = useState(DEFAULT_MARKDOWN_INPUT)
  const [searchDirs, setSearchDirs] = useState(DEFAULT_SEARCH_DIRS.join('\n'))
  const [searchQuery, setSearchQuery] = useState(DEFAULT_SEARCH_QUERY)

  const createSession = async () => {
    setCreating(true)
    setError('')
    try {
      const resolveResponse = await fetch('/api/memory/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: markdownInput }),
      })
      if (!resolveResponse.ok) throw new Error(`Resolve failed: HTTP ${resolveResponse.status}`)
      const resolved = await resolveResponse.json() as {
        files: Array<{ path: string }>
        directories: string[]
      }

      const response = await fetch('/api/memory/review/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noOpen: true,
          currentContextFiles: contextFiles.split('\n').map(line => line.trim()).filter(Boolean),
          extraFilePaths: resolved.files.map(file => file.path),
          extraMarkdownDirs: [
            ...resolved.directories,
            ...searchDirs.split('\n').map(line => line.trim()).filter(Boolean),
          ],
          searchQuery: searchQuery.trim() || undefined,
        }),
      })
      if (!response.ok) throw new Error(`Create failed: HTTP ${response.status}`)
      const data = await response.json() as { sessionId: string }
      navigate(`/memory/${data.sessionId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      <div className="max-w-4xl mx-auto py-14 px-4">
        <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase tracking-wider mb-1">Memory Test</p>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-slate-100">Memory Review Test Launcher</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-slate-400">
          Creates a memory review session with preloaded markdown input, searchable directories, and current-context files.
        </p>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
            <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase tracking-wider">Current Context Files</p>
            <textarea
              className="mt-3 w-full min-h-32 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-slate-300"
              value={contextFiles}
              onChange={e => setContextFiles(e.target.value)}
            />
          </div>

          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
            <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase tracking-wider">Markdown Input To Resolve</p>
            <textarea
              className="mt-3 w-full min-h-32 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-slate-300"
              value={markdownInput}
              onChange={e => setMarkdownInput(e.target.value)}
            />
          </div>

          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
            <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase tracking-wider">Search Directories</p>
            <textarea
              className="mt-3 w-full min-h-28 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-slate-300"
              value={searchDirs}
              onChange={e => setSearchDirs(e.target.value)}
            />
          </div>

          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
            <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase tracking-wider">Search Query</p>
            <input
              className="mt-3 w-full text-sm border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-slate-300"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="memory"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={createSession}
            disabled={creating}
            className="px-4 py-2 text-sm rounded-lg font-medium bg-zinc-900 dark:bg-slate-100 text-white dark:text-slate-900 disabled:opacity-50"
          >
            {creating ? 'Creating Session...' : 'Open Memory Review'}
          </button>
          <button
            onClick={() => {
              setContextFiles(DEFAULT_CONTEXT_FILES.join('\n'))
              setMarkdownInput(DEFAULT_MARKDOWN_INPUT)
              setSearchDirs(DEFAULT_SEARCH_DIRS.join('\n'))
              setSearchQuery(DEFAULT_SEARCH_QUERY)
            }}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-zinc-700 text-zinc-700 dark:text-slate-300"
          >
            Reset Defaults
          </button>
        </div>

        {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
      </div>
    </div>
  )
}
