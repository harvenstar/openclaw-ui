# AgentClick

AI agents fail silently and take irreversible actions. AgentClick puts a human review step between your agent and the world.

[![npm version](https://img.shields.io/npm/v/agentclick)](https://www.npmjs.com/package/agentclick)
[![license](https://img.shields.io/npm/l/agentclick)](LICENSE)
[![npm downloads](https://img.shields.io/npm/dm/agentclick)](https://www.npmjs.com/package/agentclick)

---

## Why AgentClick

- **Not just approve/deny** -- edit the email subject, change the command, modify the payload before it sends.
- **Preference learning** -- delete a paragraph and tell AgentClick why. It writes the rule to disk so your agent never makes the same mistake again.
- **Framework-agnostic** -- works with OpenAI, Anthropic, LangChain, or any HTTP-capable agent. Just POST and long-poll.

---

## Quick Start

```bash
npm install -g @harvenstar/agentclick
agentclick
```

Then test it with a mock session:

```bash
curl -X POST http://localhost:3001/api/review \
  -H "Content-Type: application/json" \
  -d '{"type":"code_review","sessionKey":"test","payload":{"command":"rm -rf /tmp/old-cache","cwd":"/home/user","explanation":"Clean up stale cache directory","risk":"medium"}}'
```

A browser tab opens automatically. Review, approve or reject, and close the tab.

---

## How It Works

1. **Agent POSTs structured data** to `http://localhost:3001/api/review` with a session key.
2. **User reviews, edits, and approves** in the browser -- paragraph-level delete/rewrite for emails, approve/reject for commands and actions.
3. **Agent receives the result** via long-poll (`GET /api/sessions/:id/wait`) and continues execution.

No WebSockets, no framework plugins. One HTTP endpoint in, one HTTP endpoint out.

---

## Comparison

| Feature | AgentClick | AgentGate | LangGraph interrupt() | Vercel AI SDK |
|---|---|---|---|---|
| Pre-built review UI | Yes | No | No | No |
| Edit before approve | Yes | No | No | No |
| Preference learning | Yes | No | No | No |
| Framework-agnostic | Yes | Yes | LangGraph only | Vercel only |
| Self-hosted | Yes | Yes | Yes | Cloud |

---

## Session Types

- **email_review** -- two-column inbox and draft editor. Users can delete paragraphs with reasons, request rewrites, toggle intent suggestions, and confirm or regenerate.
- **code_review** -- displays the shell command, working directory, affected files as a collapsible tree, and risk level. Approve or reject with an optional note.
- **action_approval** -- generic high-risk action gate. Shows action description, detail, and risk badge. Approve or reject with an optional note.
- **trajectory_review** -- DAG visualization of a multi-step agent execution. Users can mark incorrect steps, provide per-step guidance, set a resume point, and request a retry. Guidance with "Remember this" checked is persisted to `MEMORY.md` for future runs.

---

## API

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/review` | Agent creates a review session. Returns `{ sessionId, url }`. Browser opens automatically unless `noOpen: true` is passed. |
| POST | `/api/review/batch` | Create multiple sessions at once. Pass `{ sessions: [...] }`. Returns `{ sessions: [{ sessionId, url }] }`. All sessions are silent (no browser open). |
| GET | `/api/sessions/:id` | Fetch session data (payload, status, result). |
| GET | `/api/sessions/:id/wait` | Long-poll. Blocks up to 5 minutes until the user completes the review. |
| POST | `/api/sessions/:id/complete` | UI submits the user's decision. Triggers preference learning and agent callback. |
| PUT | `/api/sessions/:id/payload` | Agent updates payload after a rewrite cycle. Only valid when session status is `rewriting`. |

---

## Development

```bash
git clone https://github.com/agentlayer-io/AgentClick.git
cd AgentClick
npm install
npm run dev
```

Server runs on `http://localhost:3001`, UI on `http://localhost:5173`.

For production-style single-port serving:

```bash
npm run build
npm start
```

---

## License

MIT
