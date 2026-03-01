# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

AgentClick is a human-in-the-loop approval UI for AI agents. Agents POST structured data for review (emails, shell commands, actions), a browser tab opens for the user to review/edit/approve, and the agent receives the result via HTTP long-polling. No WebSockets.

## Commands

```bash
npm install          # install all workspace dependencies
npm run dev          # run server (tsx watch) + web (vite) concurrently
npm run build        # build server (tsc) then web (vite build)
npm start            # start production server (serves API + built frontend on one port)
```

No test framework is configured. CI only validates that the build succeeds.

## Architecture

**Monorepo** with npm workspaces: `packages/server` and `packages/web`.

### Server (`packages/server/src/`)
- **index.ts** — Express app. All API routes defined here. Serves the built React app in production. Integrates with OpenClaw via webhook callback.
- **store.ts** — SQLite session storage (`~/.openclaw/clawui-sessions.db`) using better-sqlite3. Sessions have states: `pending` → `rewriting` → `completed`.
- **preference.ts** — Preference learning. When users delete paragraphs with reasons, writes AVOID rules to `~/.openclaw/workspace/MEMORY.md`.

### Web (`packages/web/src/`)
- React 18 + React Router + Tailwind CSS, built with Vite.
- **pages/ReviewPage.tsx** — Email review (two-column inbox + draft editor, paragraph-level delete/rewrite).
- **pages/CodeReviewPage.tsx** — Shell command approval with file tree and risk badge.
- **pages/ApprovalPage.tsx** — Generic high-risk action gate.
- **pages/HomePage.tsx** — Session list dashboard.

### Client Library (`lib/agentclick.js`)
- `reviewAndWait()` function for agents to POST a session and long-poll for results.

### CLI (`bin/agentclick.mjs`)
- Entry point for `agentclick` command. Auto-builds if artifacts missing, auto-increments port if 3001 is busy.

### Skills (`skills/`)
- OpenClaw skill definitions (email, code, approve) that integrate agents with AgentClick.

## Key Patterns

- **Request flow**: Agent POSTs to `/api/review` → SQLite session created → browser opens → user reviews in React UI → UI POSTs to `/api/sessions/:id/complete` → agent's long-poll (`/api/sessions/:id/wait`, 5min timeout, 1.5s interval) resolves.
- **Rewrite cycle**: User can request a rewrite → session set to `rewriting` → agent updates payload via `PUT /api/sessions/:id/payload` → user reviews again.
- **Both packages are ESM** (`"type": "module"`). Server targets NodeNext, web uses Vite bundling.
- **Dev proxy**: Vite proxies `/api` to `http://localhost:3001` during development.
- **No auth**: Designed for local/trusted environments.

## Environment Variables

Configured in `.env` (see `.env.example`):
- `PORT` — Server port (default 3001)
- `OPENCLAW_WEBHOOK` — Callback URL for posting results to agent orchestrator
- `OPENCLAW_TOKEN` — Optional Bearer token for webhook auth
