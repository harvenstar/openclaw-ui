import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const samplePayload = {
  inbox: [
    {
      id: 'mail_1',
      from: 'Acme Cloud',
      to: 'hm@example.com',
      subject: 'Your March usage report is ready',
      preview: 'Your monthly usage summary is available. Review compute, storage, and overage details before billing closes on Friday.',
      body: `Hi Hanwen,

Your monthly usage summary is now ready for review.

- Compute spend increased by 12%
- Storage spend remained stable
- Two projects crossed their forecast threshold

Please review the attached billing dashboard before Friday at 5 PM PT.

Thanks,
Acme Cloud Billing`,
      headers: [
        { label: 'Message-ID', value: '<billing-032026@acmecloud.test>' },
        { label: 'Thread', value: 'March Billing Summary' },
      ],
      category: 'Updates',
      timestamp: Date.now() - 1000 * 60 * 45,
    },
    {
      id: 'mail_2',
      from: 'Design Weekly',
      to: 'hm@example.com',
      subject: 'Ten landing pages worth stealing from',
      preview: 'A curated set of experiments in motion, copy structure, and pricing-page hierarchy from recent SaaS launches.',
      body: `This week:

1. Stripe-style enterprise pricing comparison blocks
2. Editorial product storytelling from three AI-native apps
3. Lightweight motion systems that clarify hierarchy instead of decorating it

Open the issue for screenshots and teardown notes.`,
      category: 'Promotions',
      timestamp: Date.now() - 1000 * 60 * 180,
    },
    {
      id: 'mail_3',
      from: 'Mina Chen',
      to: 'hm@example.com',
      cc: ['ops@example.com'],
      subject: 'Can you review the rollout note?',
      preview: 'Need a tighter reply that agrees to the rollout timing, keeps it warm, and asks for the final changelog before send.',
      body: `Hey,

Can you review the rollout note before I send it to the external list?

I want the response to:
- agree to the rollout timing,
- stay warm and brief,
- ask for the final changelog before anything goes out.

If you have edits, send them back today and I can ship the final version tonight.

Thanks,
Mina`,
      headers: [
        { label: 'Message-ID', value: '<mina-rollout-note@example.test>' },
        { label: 'Priority', value: 'High' },
      ],
      category: 'Primary',
      timestamp: Date.now() - 1000 * 60 * 15,
    },
  ],
  draft: {
    replyTo: 'mina@example.com',
    to: 'mina@example.com',
    subject: 'Re: Can you review the rollout note?',
    paragraphs: [
      {
        id: 'p1',
        content: 'Thanks for sending this over. I reviewed the rollout note and overall it looks solid.',
      },
      {
        id: 'p2',
        content: 'I agree with the proposed timing, but I would like to see the final changelog before we send anything externally.',
      },
      {
        id: 'p3',
        content: 'If you send the updated version today, I can turn around feedback quickly.',
      },
    ],
    ccSuggestions: [
      { name: 'Hanwen', email: 'hanwen@example.com' },
      { name: 'Ops Lead', email: 'ops@example.com' },
    ],
    intentSuggestions: [
      { id: 'intent_1', text: 'Agree to the timing' },
      { id: 'intent_2', text: 'Ask for changelog before send' },
      { id: 'intent_3', text: 'Keep reply concise and warm' },
    ],
  },
}

export default function EmailTestPage() {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const createSession = async () => {
    setCreating(true)
    setError('')
    try {
      const response = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'email_review',
          sessionKey: 'email-review-test',
          noOpen: true,
          payload: samplePayload,
        }),
      })
      if (!response.ok) throw new Error(`Create session failed: ${response.status}`)
      const data = await response.json() as { sessionId: string }
      navigate(`/review/${data.sessionId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      <div className="max-w-3xl mx-auto py-16 px-4">
        <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase tracking-wider mb-1">Email Test</p>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-slate-100">Email Review Test Page</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-slate-400">
          Creates a sample inbox plus draft session using Gmail-style categories and opens the standard email review UI.
        </p>

        <div className="mt-6 p-4 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
          <button
            onClick={createSession}
            disabled={creating}
            className="px-4 py-2 text-sm rounded-lg font-medium bg-zinc-900 dark:bg-slate-100 text-white dark:text-slate-900 disabled:opacity-50"
          >
            {creating ? 'Creating Session...' : 'Open Email Review'}
          </button>
          {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
        </div>
      </div>
    </div>
  )
}
