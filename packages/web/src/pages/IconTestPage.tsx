export default function IconTestPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 px-6 py-12">
      <div className="max-w-3xl mx-auto">
        <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase tracking-[0.3em] mb-3">AgentClick</p>
        <h1 className="text-3xl font-semibold text-zinc-900 dark:text-slate-100 mb-3">Icon Test</h1>
        <p className="text-sm text-zinc-500 dark:text-slate-400 mb-8">
          Use this page to verify the favicon in the browser tab and the shipped PNG asset in the app.
        </p>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-3xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-400 dark:text-slate-500 mb-4">In Page</p>
            <div className="rounded-[28px] bg-zinc-100 dark:bg-zinc-950 p-6 flex items-center justify-center">
              <img
                src="/icon.png"
                alt="AgentClick icon"
                className="w-40 h-40 rounded-[28px] shadow-[0_18px_40px_rgba(0,0,0,0.12)]"
              />
            </div>
          </section>

          <section className="rounded-3xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-400 dark:text-slate-500 mb-4">Checks</p>
            <div className="space-y-4 text-sm text-zinc-700 dark:text-slate-300">
              <div>
                <p className="font-medium text-zinc-900 dark:text-slate-100">Favicon path</p>
                <code className="text-xs text-zinc-500 dark:text-slate-400">/icon.png</code>
              </div>
              <div>
                <p className="font-medium text-zinc-900 dark:text-slate-100">Repo asset</p>
                <code className="text-xs text-zinc-500 dark:text-slate-400">./icon.png</code>
              </div>
              <div>
                <p className="font-medium text-zinc-900 dark:text-slate-100">What to verify</p>
                <p className="text-zinc-500 dark:text-slate-400">
                  The browser tab should show the same icon shown on this page and in the README.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
