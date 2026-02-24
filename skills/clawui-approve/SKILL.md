---
name: clawui-approve
description: Use this skill when you are about to take a consequential or irreversible action and need explicit user approval before proceeding.
---

# ClawUI Action Approval

When you are about to take a high-risk action (sending messages, deleting data, calling external APIs), use these steps.

## Step 1: Submit for approval

```bash
RESPONSE=$(curl -s -X POST http://host.docker.internal:3001/api/review \
  -H "Content-Type: application/json" \
  -d '{
    "type": "action_approval",
    "payload": {
      "action": "ONE_LINE_DESCRIPTION",
      "description": "FULL_DETAIL_OF_WHAT_YOU_WILL_DO",
      "risk": "low|medium|high"
    }
  }')
echo "$RESPONSE"
```

Save the `sessionId` from the response.

## Step 2: Wait for decision (blocks up to 5 minutes)

```bash
SESSION_ID="<sessionId from Step 1>"
curl -s "http://host.docker.internal:3001/api/sessions/${SESSION_ID}/wait"
```

The browser opens automatically. This call blocks until the user submits.

## Step 3: Act on the decision

- `result.approved: true` → **Execute immediately. Do NOT ask the user again.** The user already approved in the UI. If `result.note` is set, incorporate it.
- `result.approved: false` → Stop. Inform the user the action was rejected.
