# AgentClick — Claude Code Context

## What This Project Is

AgentClick is a human-in-the-loop UI layer for AI agents. Agents POST structured data here; users review/approve/edit in the browser; results callback to the agent. AgentClick never connects directly to email or external services — all data flows through the agent.

GitHub: https://github.com/agentlayer-io/AgentClick

---

## Start the Dev Server

```bash
npm run dev
# Server: http://localhost:3001
# UI:     http://localhost:5173
```

To test without a live agent, POST a mock session:

```bash
curl -s -X POST http://localhost:3001/api/review \
  -H "Content-Type: application/json" \
  -d '{
    "type": "email_review",
    "sessionKey": "test-key",
    "payload": {
      "inbox": [
        { "id": "e1", "from": "john@example.com", "subject": "Q1 Follow-up",
          "preview": "Hi, just wanted to follow up...", "category": "Work",
          "isRead": false, "timestamp": 1771747653333 }
      ],
      "draft": {
        "replyTo": "e1", "to": "john@example.com",
        "subject": "Re: Q1 Follow-up",
        "paragraphs": [
          { "id": "p1", "content": "Hi John, thanks for following up." },
          { "id": "p2", "content": "We are aligned on the timeline." },
          { "id": "p3", "content": "Let me know if anything else is needed." }
        ]
      }
    }
  }'
# Browser opens automatically to the review session
```

---

## Key Files

| File | Purpose |
|------|---------|
| `packages/server/src/index.ts` | Express API: `/api/review`, `/api/sessions`, `/api/sessions/:id/complete` |
| `packages/server/src/preference.ts` | Writes AVOID rules to `~/.openclaw/workspace/MEMORY.md` |
| `packages/web/src/pages/ReviewPage.tsx` | Main UI — two-column inbox + draft review (Format B) and legacy single-column (Format A) |
| `packages/web/src/pages/ApprovalPage.tsx` | Action approval UI |
| `packages/web/src/pages/CodeReviewPage.tsx` | Shell command review UI |
| `packages/web/src/pages/HomePage.tsx` | Session history list |
| `skills/` | OpenClaw SKILL.md files that trigger AgentClick |

---

## API Shape

**POST /api/review** — agent creates a session
**GET /api/sessions** — list sessions (max 20, sorted by createdAt desc)
**GET /api/sessions/:id** — get single session
**POST /api/sessions/:id/complete** — user submits decision, triggers OpenClaw callback

OpenClaw webhook: `POST http://localhost:18789/hooks/agent`
Body: `{ message: string, sessionKey: string, deliver: true }`

---

## Two Payload Formats

**Format A (legacy):** `{ to, subject, paragraphs[] }`
**Format B (v2):** `{ inbox[], draft: { replyTo, to, subject, paragraphs[], ccSuggestions? } }`

`ReviewPage.tsx` auto-detects via `'inbox' in payload`.

---

## Rules

Read `docs/dev-rules.md` before writing any code. Key rules:
- TypeScript only, no `any`
- Tailwind only, no inline styles
- Linear/Vercel aesthetic: zinc/gray palette, `shadow-sm` max, no gradients
- Commit format: `type: short description` (no emoji, no Claude attribution)
- No over-abstraction — if one file handles it, keep it in one file

---

## What's Done / What's Pending

**Done:** ReviewPage v2 (two-column), ApprovalPage, CodeReviewPage, HomePage, preference learning, risk color grading
**Pending:** SQLite session persistence, Express unified serving (eliminate 3001/5173 split), npm global package, OpenClaw real integration test
