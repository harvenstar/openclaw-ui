# AgentClick Skill - Human-in-the-Loop Reviews

Use AgentClick to gate risky or high-value actions behind explicit human review.

## Prerequisites

Start AgentClick:

```bash
cd /Users/hm/.openclaw/workspace/AgentClick
npm start
```

Default server: `http://localhost:38173`

Containerized clients may use `http://host.docker.internal:38173` (or `AGENTCLICK_PORT` / `AGENTCLICK_URL` overrides).

## Port Pipeline

Use this runtime pipeline before review calls:

1. Read `AGENTCLICK_URL` (if set) and use it directly.
2. Else read `AGENTCLICK_PORT` (fallback `PORT`, then `38173`) and target `http://localhost:<port>`.
3. Verify identity with `GET /api/identity`.
4. If identity check fails, start `agentclick` and set `AGENTCLICK_PORT` for the running process chain.
5. Then create review sessions and keep an active `/wait` loop.

## Supported Review Types

Canonical types accepted by `POST /api/review`:

- `action_approval`
- `code_review`
- `email_review`
- `memory_review`
- `plan_review`
- `trajectory_review`
- `form_review` (UI-routed, schema depends on caller)
- `selection_review` (UI-routed, schema depends on caller)

Related (non-`/api/review` utility flow):

- `memory_management` via `GET /api/memory/files` + `GET /api/memory/file`

## Trigger Routing

Main trigger keyword: `UI review`.

When user intent contains `UI review ...`, route to the corresponding review flow:

- `UI review command|shell|script|diff|code` -> `code_review`
- `UI review email|draft|reply` -> `email_review`
- `UI review plan|steps|execution strategy` -> `plan_review`
- `UI review trajectory|run log|what happened` -> `trajectory_review`
- `UI review memory|memory update|memory changes` -> `memory_review`
- `UI review memory files|browse memory|open memory file` -> `memory_management`
- `UI review action|approval|risky action` -> `action_approval`

If ambiguous, ask a short disambiguation question before creating a session.

## Shared API Flow

### 1) Create session

```bash
curl -s -X POST "${AGENTCLICK_URL:-http://localhost:${AGENTCLICK_PORT:-38173}}/api/review" \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "action_approval",
    "sessionKey": "your-openclaw-session-key",
    "payload": { "action": "..." }
  }'
```

Response:

```json
{ "sessionId": "session_...", "url": "http://localhost:5173/..." }
```

Browser behavior by default (unless `noOpen: true`):
- Opens the session review page.

Optional:
- Set `openHome: true` in `POST /api/review` to also open the default home page (`/`).

### 2) Wait for human decision (required active polling)

```bash
curl -s "${AGENTCLICK_URL:-http://localhost:${AGENTCLICK_PORT:-38173}}/api/sessions/<sessionId>/wait"
```

`/wait` blocks up to 5 minutes. Returns the session when status becomes `completed` or `rewriting`.

Important:

- AgentClick does not push approval directly into your running agent process.
- After creating a review session, your agent must actively poll/block on `/api/sessions/:id/wait`.
- If you do not keep an active `/wait` loop, approval will not trigger execution automatically.

### 3) Act on status

- `status: "completed"`: read `result` and proceed/stop accordingly.
- `status: "rewriting"`: revise payload and `PUT /api/sessions/:id/payload`, then wait again.

### 4) Rewrite payload (when requested)

```bash
curl -s -X PUT "${AGENTCLICK_URL:-http://localhost:${AGENTCLICK_PORT:-38173}}/api/sessions/<sessionId>/payload" \
  -H 'Content-Type: application/json' \
  -d '{ "payload": { "...": "updated" } }'
```

## Type Schemas and Decisions

### Action Approval (`action_approval`)

Use for consequential actions (deletes, external side effects, irreversible changes).

Payload:

```json
{
  "action": "Delete production database",
  "description": "Drops all tables in prod-db",
  "risk": "low|medium|high"
}
```

Result (`completed`):

```json
{ "approved": true, "note": "optional" }
```

Execution rule:

- `approved: true` -> execute immediately (incorporate `note` if present)
- `approved: false` -> stop

### Code Review (`code_review`)

Use before risky shell commands. Include concrete file impact and diffs when available.

Payload:

```json
{
  "command": "rm -rf /data",
  "cwd": "/current/working/dir",
  "explanation": "Cleanup obsolete cache directory",
  "risk": "low|medium|high",
  "affectedFiles": [
    {
      "path": "src/file.ts",
      "status": "added|modified|deleted|renamed",
      "oldPath": "src/old.ts",
      "diff": "@@ -1,2 +1,3 @@\\n..."
    }
  ],
  "files": ["legacy/fallback/path.ts"]
}
```

Notes:

- `affectedFiles` is preferred.
- `files` is a legacy fallback when diffs are unavailable.

Result (`completed`):

```json
{ "approved": true, "note": "optional" }
```

Execution rule:

- `approved: true` -> run the command
- `approved: false` -> do not run

### Email Review (`email_review`)

Use for draft review before send.

Payload (current UI pattern):

```json
{
  "inbox": [
    {
      "id": "e1",
      "from": "sender@example.com",
      "subject": "Original subject",
      "preview": "Original preview",
      "category": "Work",
      "isRead": false,
      "timestamp": 1700000000000
    }
  ],
  "draft": {
    "replyTo": "e1",
    "to": "client@example.com",
    "subject": "Re: Original subject",
    "paragraphs": [
      { "id": "p1", "content": "Paragraph 1" },
      { "id": "p2", "content": "Paragraph 2" }
    ],
    "intentSuggestions": [
      { "id": "i1", "text": "Acknowledge and confirm" }
    ]
  }
}
```

Rewrite cycle:

- User can request rewrite (`status: "rewriting"` on `/wait`)
- Agent revises draft and `PUT /api/sessions/:id/payload`
- Session returns to `pending` for another review round

Result (`completed`) typically contains:

```json
{
  "confirmed": true,
  "actions": [
    { "type": "delete|rewrite", "paragraphId": "p2", "reason": "...", "instruction": "..." }
  ],
  "selectedIntents": [
    { "id": "i1", "accepted": true }
  ]
}
```

Execution rule:

- `confirmed: true` -> send using final reviewed draft
- otherwise stop or continue rewrite loop

### Plan Review (`plan_review`)

Use when execution strategy needs human approval/editing before implementation.

Payload:

```json
{
  "title": "Deploy new authentication system",
  "description": "Migrate session auth to JWT",
  "steps": [
    {
      "id": "s1",
      "type": "research|code|terminal|action|agent_delegate|decision|checkpoint",
      "label": "Audit current auth endpoints",
      "description": "...",
      "risk": "low|medium|high",
      "estimatedDuration": "2m",
      "optional": false,
      "parallel": false,
      "files": ["src/routes/"],
      "constraints": ["Use strict mode"],
      "children": []
    }
  ],
  "context": { "taskId": "auth-migration-001" },
  "alternatives": [
    {
      "name": "Gradual rollout",
      "description": "Migrate behind feature flags",
      "steps": []
    }
  ]
}
```

Result (`completed`):

```json
{
  "approved": true,
  "selectedAlternative": null,
  "modifications": {
    "s2": { "label": "Updated label", "description": "Updated description" }
  },
  "insertions": [
    { "afterId": "s2", "step": { "id": "inserted_1", "type": "terminal", "label": "Run linter" } }
  ],
  "removals": ["s5"],
  "skipped": ["s5"],
  "constraints": { "s2": ["Use TypeScript strict mode"] },
  "globalConstraints": ["No external API calls"],
  "globalNote": "Looks good"
}
```

Rewrite cycle:

- Human can request regenerate (`status: "rewriting"`)
- Agent updates plan and `PUT /api/sessions/:id/payload`
- Human re-reviews updated plan

Execution rule:

- `approved: true` -> execute the modified plan
- `approved: false` -> stop
- `rewriting` -> revise and resubmit payload

### Memory Review (`memory_review`)

Use when memory inclusion, memory-file updates, or compression keep/disregard decisions need human review.

Payload (current flow):

```json
{
  "title": "Memory Review",
  "groups": [{ "id": "group_project", "label": "In This Project", "fileIds": ["mem_a"] }],
  "files": [
    {
      "id": "mem_a",
      "path": "/abs/path/MEMORY.md",
      "relativePath": "MEMORY.md",
      "categories": ["project", "related_markdown"],
      "preview": "..."
    }
  ],
  "defaultIncludedFileIds": ["mem_a"],
  "modifications": [
    {
      "id": "mod_1",
      "fileId": "mem_a",
      "filePath": "/abs/path/MEMORY.md",
      "location": "MEMORY.md",
      "oldContent": "...",
      "newContent": "...",
      "generatedContent": "..."
    }
  ],
  "compressionRecommendations": [
    { "fileId": "mem_a", "recommendation": "include|disregard", "reason": "..." }
  ]
}
```

Result (`completed`) typically contains:

```json
{
  "approved": true,
  "includedFileIds": ["mem_a"],
  "disregardedFileIds": [],
  "compressionDecisions": { "mem_a": "include" },
  "modificationReview": { "mod_1": true },
  "globalNote": "optional"
}
```

Execution rule:

- `approved: true` -> apply selected memory modifications and inclusion set
- `approved: false` -> do not apply memory changes

### Memory Management (`memory_management`)

Use for browsing full memory files (not a session-complete review type).

- List files: `GET /api/memory/files`
- Open full file: `GET /api/memory/file?path=<absolute-path>`
- UI route: `/memory-management`

### Trajectory Review (`trajectory_review`)

Use for post-execution review, diagnosis, and reusable learning.

Payload:

```json
{
  "title": "Deploying to staging",
  "description": "Attempted staging deploy",
  "steps": [
    {
      "id": "s1",
      "type": "tool_call|decision|observation|error|retry",
      "label": "SSH to staging",
      "detail": "ssh deploy@staging.example.com",
      "status": "success|failure|pending|skipped",
      "duration": 120,
      "error": { "message": "Connection refused", "code": "ECONNREFUSED" },
      "children": []
    }
  ],
  "context": { "taskId": "deploy-123" }
}
```

Result (`completed`):

```json
{
  "approved": true,
  "revisions": [
    {
      "stepId": "s3",
      "action": "mark_wrong|provide_guidance|skip",
      "correction": "Check VPN first",
      "guidance": "Always verify VPN before SSH",
      "shouldLearn": true
    }
  ],
  "globalNote": "Good overall",
  "resumeFromStep": "s3"
}
```

Rewrite cycle:

- Human requests retry (`status: "rewriting"`)
- Agent applies corrections, resumes from indicated step, updates payload via `PUT`

Learning behavior:

- If `shouldLearn` is set on revisions, rules are written to `~/.openclaw/workspace/MEMORY.md`.

### Form and Selection Review (`form_review`, `selection_review`)

These types are routed by server/UI and sessioned like other types.

- They are supported transport types in `/api/review`.
- Root schema is caller-defined; no canonical payload/result contract is documented in this repo.
- Use only with a matching UI client that defines payload and completion semantics.

## Session Object Reference

`GET /api/sessions/:id` or `/wait` returns:

```json
{
  "id": "session_...",
  "type": "plan_review",
  "payload": {},
  "status": "pending|rewriting|completed",
  "result": {},
  "sessionKey": "optional",
  "createdAt": 1700000000000,
  "updatedAt": 1700000000500,
  "revision": 0
}
```

## Minimal JS Helper Usage

`lib/agentclick.js` provides `reviewAndWait({ type, sessionKey, payload })` and works with any review type accepted by `/api/review`.

```javascript
const { reviewAndWait } = require('./lib/agentclick')

const decision = await reviewAndWait({
  type: 'plan_review',
  sessionKey: context.sessionKey,
  payload: {
    title: 'Release plan',
    steps: [{ id: 's1', type: 'checkpoint', label: 'Run tests' }]
  }
})

if (!decision.approved) throw new Error('Plan rejected')
```

## Operational Notes

- `/api/sessions/:id/wait` timeout is 5 minutes (HTTP 408 on timeout).
- Session status transitions: `pending -> rewriting -> pending` (via PUT) or `pending -> completed`.
- If `sessionKey` is present, completion and rewrite progress can be sent to OpenClaw webhook.
