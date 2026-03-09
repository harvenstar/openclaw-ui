# AgentClick

<p align="center">
  <img src="https://raw.githubusercontent.com/agentlayer-io/AgentClick/main/icon.png" alt="AgentClick icon" width="180" />
</p>

<p align="center">
  🧠 Human-in-the-loop review UI for autonomous AI agents
</p>

<p align="center">
  AgentClick is a <b>skill-based plugin</b> that adds a browser review layer to terminal agents.<br/>
  Agents propose actions, users inspect and edit in a browser UI, then the agent continues.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harvenstar/agentclick"><img src="https://img.shields.io/npm/v/%40harvenstar%2fagentclick" alt="npm version"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/%40harvenstar%2fagentclick" alt="license"></a>
  <a href="https://www.npmjs.com/package/@harvenstar/agentclick"><img src="https://img.shields.io/npm/dm/%40harvenstar%2fagentclick" alt="npm downloads"></a>
  <a href="https://github.com/agentlayer-io/AgentClick"><img src="https://img.shields.io/github/stars/agentlayer-io/AgentClick?style=social" alt="GitHub stars"></a>
</p>

---

## ⚙️ How It Works

Most agents still interact like this:

```
User → Terminal → Agent → Action
```

AgentClick adds a review step:

```
Agent proposes → Browser UI opens → User inspects and edits → Agent executes
```

This keeps the speed of autonomous agents while adding a human-in-the-loop safeguard before irreversible work.

---

## 🤖 Supported Agents

AgentClick works as a **skill / plugin** for modern AI agents. Any agent that can run local tools, send HTTP requests, and follow skill instructions can integrate with it.

- Claude Code
- Codex
- OpenClaw
- Custom tool-calling agents

---

## 🧩 What It's For

AgentClick extends the agent interaction into a browser UI for tasks like:

- 📧 email drafting and inbox triage
- 🖥️ shell commands and risky actions
- 📋 plans and execution trajectories
- 🧠 memory review and updates

The goal: keep the speed of terminal agents, but add a real review layer before the agent commits to irreversible work.

---

## ✨ Why It Helps

- **Edit before execution** — change the draft, command, or payload instead of only approve/reject.
- **Shared visual context** — move from raw terminal text to a purpose-built UI.
- **Preference learning** — feedback from review is persisted so the agent improves over time.
- **Framework-agnostic** — anything that can `POST` JSON and poll an HTTP endpoint can use it.

---

## 🚀 Quick Start

```bash
npm install -g @harvenstar/agentclick
agentclick
```

Then open `http://localhost:38173` in your browser.

For remote access from another device:

```bash
agentclick --remote
```

`--remote` automatically downloads and starts a [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/). It prints a public HTTPS URL you can open on your phone or another machine.

---

## 🧠 Use It With An Agent

**Option A — npm global install (AgentClick already running)**

Start AgentClick first (`agentclick`), then tell your agent:

```text
AgentClick is running at http://localhost:38173. Use it whenever you need a browser review UI — for email triage, risky commands, plans, or memory review.
```

**Option B — working inside the AgentClick repo**

If your agent can read local files, point it at the skill router:

```text
Load SKILL.md from this repo, start AgentClick locally, and use it whenever you need a browser review UI instead of only terminal output.
```

The root [`SKILL.md`](./SKILL.md) routes to the right sub-skill automatically.

For OpenClaw in particular, use a stronger model with solid instruction-following, since the workflow is skill-based and depends on the agent following routing instructions reliably.

---

## 🧱 Skill Layout

AgentClick is built around a **skill-based architecture**. The root [`SKILL.md`](./SKILL.md) acts as a router that directs the agent to the appropriate sub-skill.

| Skill | Path | Purpose | How to Use |
|---|---|---|---|
| Router | `SKILL.md` | Entry point that routes the agent to the right review workflow. | `Load SKILL.md and use AgentClick UI for review.` |
| Action Approval | `skills/clickui-approve/` | Approve or reject risky actions before execution. | `Before deleting those files, show me an approval review in AgentClick UI.` |
| Code Review | `skills/clickui-code/` | Review shell commands, diffs, and code-related actions. | `Show me a code review in AgentClick UI before running that command.` |
| Email Review | `skills/clickui-email/` | Review inbox items, drafts, replies, and live email sessions. | `Open my inbox in AgentClick UI and let me triage emails.` |
| Plan Review | `skills/clickui-plan/` | Inspect and revise proposed plans before the agent runs them. | `Show me the plan in AgentClick UI before you start.` |
| Trajectory Review | `skills/clickui-trajectory/` | Review multi-step runs, mistakes, and resume points. | `Show me what you just did in AgentClick UI so I can review the steps.` |
| Memory Review | `skills/clickui-memory/` | Review memory files and memory-management changes. | `Open memory management in AgentClick UI and let me pick which files to include.` |

In most cases, telling the agent to load the root skill is enough.

---

## 🛠️ Development

```bash
git clone https://github.com/agentlayer-io/AgentClick.git
cd AgentClick
npm install
npm run dev
```

Development mode:

- server: `http://localhost:38173`
- web: `http://localhost:5173`

Production-style single-port serving:

```bash
npm run build
npm start
```

---

## 📜 License

[MIT](./LICENSE)
