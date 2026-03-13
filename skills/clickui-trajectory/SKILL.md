---
name: clickui-trajectory
description: Submit an agent execution trajectory for human review, correction, and learning
---

# Trajectory Review Skill

Submit a multi-step agent execution trajectory to AgentClick for human review. The human can inspect each step, mark incorrect steps, provide guidance, and teach the agent reusable patterns.

## When to Use

- Agent completed a multi-step task and wants human validation
- Agent encountered an error and needs human help to diagnose which step went wrong
- Agent wants to teach the human what it did so they can provide corrections
- Post-mortem review of agent execution before continuing

## Payload Schema

```json
{
  "type": "trajectory_review",
  "sessionKey": "<your-session-key>",
  "payload": {
    "title": "Deploying to staging",
    "description": "Attempted to deploy the latest build to staging environment",
    "steps": [
      {
        "id": "s1",
        "type": "tool_call",
        "label": "Called grep on src/",
        "detail": "grep -r 'config' src/",
        "status": "success",
        "duration": 120,
        "children": [
          {
            "id": "s1.1",
            "type": "observation",
            "label": "Found 3 config files",
            "status": "success"
          }
        ]
      },
      {
        "id": "s2",
        "type": "decision",
        "label": "Use config.yaml for deployment",
        "status": "success"
      },
      {
        "id": "s3",
        "type": "tool_call",
        "label": "SSH to staging server",
        "detail": "ssh deploy@staging.example.com",
        "status": "failure",
        "error": {
          "message": "Connection refused",
          "code": "ECONNREFUSED",
          "stackTrace": "Error: connect ECONNREFUSED 10.0.0.5:22\n    at TCPConnectWrap..."
        },
        "children": [
          {
            "id": "s3.1",
            "type": "retry",
            "label": "Retry SSH with VPN check",
            "status": "success",
            "duration": 3400
          }
        ]
      }
    ],
    "context": {
      "model": "claude-sonnet-4-20250514",
      "taskId": "deploy-123"
    }
  }
}
```

## Step Types

| Type          | Description                        |
|---------------|------------------------------------|
| `tool_call`   | External tool or API invocation    |
| `decision`    | Agent reasoning / choice point     |
| `observation` | Data observed or returned          |
| `error`       | An error that occurred             |
| `retry`       | A retry of a previous step         |

## Step Statuses

| Status    | Meaning                          |
|-----------|----------------------------------|
| `success` | Step completed successfully      |
| `failure` | Step failed                      |
| `pending` | Step not yet executed            |
| `skipped` | Step was skipped                 |

## Step 1: Health check

```bash
if curl -s --max-time 1 http://localhost:38173/api/health > /dev/null 2>&1; then
  AGENTCLICK_BASE="http://localhost:38173"
else
  AGENTCLICK_BASE="http://host.docker.internal:38173"
fi
```

## Step 2: Create the session

```bash
RESPONSE=$(curl -s -X POST "$AGENTCLICK_BASE/api/review" \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "trajectory_review",
    "sessionKey": "my-session",
    "payload": {
      "title": "Test trajectory",
      "steps": [
        { "id": "s1", "type": "tool_call", "label": "Read file", "status": "success" },
        { "id": "s2", "type": "error", "label": "Parse failed", "status": "failure", "error": { "message": "Invalid JSON" } }
      ]
    }
  }')
SESSION_ID=$(echo "$RESPONSE" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
```

## Step 3: Monitor the session

After creating the session, stay attached and respond to user actions.

```bash
# Detect environment: GOG_ACCOUNT is set in Docker, absent elsewhere
if [ -n "$GOG_ACCOUNT" ]; then
  curl -s "$AGENTCLICK_BASE/api/sessions/${SESSION_ID}"
else
  curl -s --max-time 310 "$AGENTCLICK_BASE/api/sessions/${SESSION_ID}/wait"
fi
```

After each poll result:
- If `pageStatus.stopMonitoring` is `true` → **stop immediately** (user clicked Stop Monitoring)
- If `status` is `"completed"` → read result and stop
- If `status` is `"rewriting"` → handle the retry request (see Step 4), then poll again
- Otherwise → wait 1 second, then poll again

## Step 4: Handle retry requests

When `/wait` returns `status: "rewriting"`, the user clicked "Request Retry". The result contains:

```json
{
  "approved": false,
  "revisions": [
    {
      "stepId": "s3",
      "action": "mark_wrong",
      "correction": "Should check VPN before SSH",
      "guidance": "Always verify VPN is connected before attempting SSH to staging",
      "shouldLearn": true
    }
  ],
  "globalNote": "Good overall, just fix the SSH issue",
  "resumeFromStep": "s3"
}
```

Agent must:
1. Read `revisions` — for each, apply corrections to the affected steps
2. Read `globalNote` — treat as an overarching instruction
3. Read `resumeFromStep` — re-execute from that step if instructed
4. PUT the updated trajectory payload back so the page reflects the new steps:

```bash
curl -s -X PUT "$AGENTCLICK_BASE/api/sessions/${SESSION_ID}/payload" \
  -H 'Content-Type: application/json' \
  -d '{"payload": {"title": "...", "steps": [...updated steps...]}}'
```

5. Poll again — the page will show the updated trajectory for the next review round.

## Result Schema (on completion)

```json
{
  "approved": true,
  "revisions": [...],
  "globalNote": "...",
  "resumeFromStep": "s3"
}
```

## Learning

When a human marks a step wrong with "Remember this for future runs" checked, a rule is written to `~/.openclaw/workspace/MEMORY.md`:

```markdown
## Trajectory Guidance (ClickUI Auto-Learned)
- AVOID: Should check VPN before SSH (step: s3, context: SSH to staging server) - SCOPE: trajectory
- PREFER: Always verify VPN is connected before attempting SSH (step: s3, context: SSH to staging server) - SCOPE: trajectory
```

Agents should read MEMORY.md on startup and apply these rules.
