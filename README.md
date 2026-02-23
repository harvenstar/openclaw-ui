# AgentClick (openclaw-ui)

**Rich web UI for AI agent interactions — click to edit, human-in-the-loop, preference learning.**

AgentClick is the product name. `openclaw-ui` is the current repo / package naming used in this codebase.

[![GitHub stars](https://img.shields.io/github/stars/harvenstar/openclaw-ui?style=flat-square)](https://github.com/harvenstar/openclaw-ui/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](https://github.com/harvenstar/openclaw-ui/pulls)

---

## The Problem

Every OpenClaw user interacts with their agent through text chat (WhatsApp / Telegram). Text is a degraded interface:

- You can't click a paragraph and say "rewrite this"
- You can't drag steps to reorder them
- Every correction requires typing out instructions again
- The agent never remembers your preferences

## The Solution

When your agent finishes a task that needs your input, it opens a browser page — a purpose-built interaction UI. You click, choose, drag. No typing.

```
Agent finishes email draft
  → Browser opens automatically
  → You click paragraph → choose: Delete / Rewrite / Keep
  → You confirm
  → Agent continues, remembers your choices for next time
```

Every interaction teaches the agent your preferences. The more you use it, the less you need to explain.

---

## Current Status

This project is already in a working prototype stage and supports multiple review flows end-to-end.

Implemented:

- Email review UI (legacy single-column + v2 inbox + draft layout)
- Action approval UI (approve/reject + note)
- Code/shell command review UI
- Session history homepage with recent sessions
- SQLite session persistence (`~/.openclaw/clawui-sessions.db`)
- Long-poll wait endpoint for agent integration (`/api/sessions/:id/wait`)
- Preference learning from paragraph deletions (writes rules to `MEMORY.md`)
- Keyboard shortcuts (`Cmd/Ctrl+Enter` submit, `Escape` handling)
- Browser auto-open on session creation

---

## Quick Start

```bash
git clone https://github.com/harvenstar/openclaw-ui.git
cd openclaw-ui
npm install
npm run dev        # starts on localhost:3001
```

Optional server config (defaults shown in `.env.example`):

```bash
PORT=3001
OPENCLAW_WEBHOOK=http://localhost:18789/hooks/agent
```

Copy the skill to your OpenClaw workspace:

```bash
cp -r skills/clawui-email ~/.openclaw/skills/
```

Restart OpenClaw. Ask it to write an email — the review page will open automatically.

---

## Project Structure

```
openclaw-ui/
├── packages/
│   ├── server/          # Node.js + Express — receives agent data, handles callbacks
│   └── web/             # React + Vite + Tailwind — the interaction UI
├── skills/
│   └── clawui-email/
│       └── SKILL.md     # OpenClaw skill definition
└── docs/
    └── research.md      # Market & technical research notes
```

---

## Roadmap

- [x] **M0** — Email draft review (click to delete/rewrite paragraphs)
- [x] **M1** — Preference learning (auto-save rules to MEMORY.md)
- [x] **M2 (partial)** — Agent integration loop (`/review` create session + `/wait` long-poll + callback)
- [ ] **Next** — Unified serving (single port; no separate Vite port in production)
- [ ] **Next** — npm global package (`openclaw-ui`)
- [ ] **Next** — Remote mode UX + link delivery polish
- [ ] **Later** — Agent task visualization (Mission Control view)
- [ ] **Later** — Multi-framework support (beyond OpenClaw)

---

## Why Not ClawX?

[ClawX](https://github.com/ValueCell-ai/ClawX) is a desktop app for *managing* OpenClaw (installing skills, configuring channels, running the gateway). openclaw-ui is for *working with* your agent — reviewing its output, making decisions, teaching it your preferences. They're complementary.

---

## Contributing

This is an early-stage open source project. All contributions welcome — UI components, new interaction patterns, OpenClaw integration improvements, documentation.

Open an issue to discuss before submitting large PRs.

---

## License

MIT
