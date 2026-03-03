---
name: clawui-plan
description: Submit an execution plan for human review and approval before executing
---

# Plan Review Skill

Submit a multi-step execution plan to AgentClick for human review. The human can inspect, edit, constrain, remove, insert, and skip steps, then approve, reject, or request regeneration.

## When to Use

- Agent has a multi-step plan that needs human approval before execution
- Agent wants to present alternative approaches for the human to choose from
- High-risk operations that require human sign-off on the execution strategy
- Complex workflows where the human should be able to modify the plan

## Payload Schema

```json
{
  "type": "plan_review",
  "sessionKey": "<your-session-key>",
  "payload": {
    "title": "Deploy new authentication system",
    "description": "Plan to migrate from session-based to JWT authentication",
    "steps": [
      {
        "id": "s1",
        "type": "research",
        "label": "Audit current auth endpoints",
        "description": "Scan all routes using session middleware",
        "risk": "low",
        "estimatedDuration": "2m",
        "files": ["src/middleware/auth.ts", "src/routes/"]
      },
      {
        "id": "s2",
        "type": "code",
        "label": "Implement JWT token service",
        "description": "Create JWT sign/verify utilities with refresh token support",
        "risk": "medium",
        "estimatedDuration": "5m",
        "files": ["src/services/jwt.ts"],
        "constraints": ["Use RS256 algorithm", "Token expiry: 15min"]
      },
      {
        "id": "s3",
        "type": "terminal",
        "label": "Install jsonwebtoken package",
        "risk": "low",
        "estimatedDuration": "30s"
      },
      {
        "id": "s4",
        "type": "agent_delegate",
        "label": "Generate migration script",
        "risk": "medium",
        "parallel": true
      },
      {
        "id": "s5",
        "type": "decision",
        "label": "Choose rollback strategy",
        "description": "Decide whether to keep dual-auth or cut over immediately",
        "optional": true
      },
      {
        "id": "s6",
        "type": "checkpoint",
        "label": "Run integration tests",
        "risk": "high",
        "estimatedDuration": "3m",
        "children": [
          {
            "id": "s6.1",
            "type": "terminal",
            "label": "npm test -- --suite=auth",
            "risk": "low"
          },
          {
            "id": "s6.2",
            "type": "action",
            "label": "Verify token refresh flow",
            "risk": "medium"
          }
        ]
      }
    ],
    "context": {
      "model": "claude-sonnet-4-20250514",
      "taskId": "auth-migration-001"
    },
    "alternatives": [
      {
        "name": "Gradual rollout",
        "description": "Migrate one route at a time with feature flags",
        "steps": [
          {
            "id": "a1",
            "type": "code",
            "label": "Add feature flag system",
            "risk": "low"
          },
          {
            "id": "a2",
            "type": "code",
            "label": "Wrap auth routes in feature flags",
            "risk": "medium"
          }
        ]
      }
    ]
  }
}
```

## Step Types

| Type              | Description                                    |
|-------------------|------------------------------------------------|
| `action`          | A general action or task to perform            |
| `research`        | Information gathering or analysis              |
| `code`            | Writing or modifying code                      |
| `terminal`        | Shell command execution                        |
| `agent_delegate`  | Delegating to a sub-agent                      |
| `decision`        | A decision point or branch                     |
| `checkpoint`      | A verification or testing milestone            |

## Risk Levels

| Level    | Description                          |
|----------|--------------------------------------|
| `low`    | Safe, easily reversible              |
| `medium` | Some risk, may need attention        |
| `high`   | Dangerous, hard to reverse           |

## Submitting a Plan

```bash
RESPONSE=$(curl -s -X POST http://localhost:3001/api/review \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "plan_review",
    "sessionKey": "my-session",
    "payload": {
      "title": "Test plan",
      "steps": [
        { "id": "s1", "type": "research", "label": "Gather requirements", "risk": "low" },
        { "id": "s2", "type": "code", "label": "Implement feature", "risk": "medium" },
        { "id": "s3", "type": "checkpoint", "label": "Run tests", "risk": "low" }
      ]
    }
  }')
SESSION_ID=$(echo "$RESPONSE" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
echo "Session: $SESSION_ID"
```

## Wait Protocol (Required)

After creating the session, immediately block on `/wait` for that same session. Do not continue execution before `/wait` returns a decision.

```bash
curl -s "http://localhost:3001/api/sessions/${SESSION_ID}/wait"
```

Rules:

- Do not ask the user for duplicate confirmation in chat while waiting.
- Do not create a second review session for the same plan unless the first one is abandoned.
- Treat `/wait` as the single source of truth for approval state.

## Result Schema

The human's response is returned via `/api/sessions/:id/wait`:

```json
{
  "approved": true,
  "selectedAlternative": null,
  "modifications": {
    "s2": { "label": "Implement feature with error handling", "description": "Updated description" }
  },
  "insertions": [
    {
      "afterId": "s2",
      "step": { "id": "inserted_1234", "type": "terminal", "label": "Run linter" }
    }
  ],
  "removals": ["s5"],
  "skipped": ["s5"],
  "constraints": {
    "s2": ["Must use TypeScript strict mode"]
  },
  "globalConstraints": ["No external API calls"],
  "globalNote": "Looks good, just add linting step"
}
```

## Rewrite Cycle

1. Human reviews plan and clicks "Regenerate"
2. Agent's `/wait` poll resolves with `status: "rewriting"` and the human's feedback
3. Agent revises the plan based on modifications, constraints, and notes
4. Agent PUTs updated payload: `PUT /api/sessions/:id/payload`
5. Human reviews again (status resets to `pending`)

## Act on Decision

- **approved**: Execute the plan as modified immediately (apply modifications, respect removals/skipped, honor constraints). Do not ask for confirmation again in chat.
- **rejected**: Stop execution, do not proceed
- **regenerate**: Revise the plan incorporating human feedback, then PUT updated payload for re-review

If `/wait` times out (HTTP 408), ask the user whether to keep waiting or cancel.
