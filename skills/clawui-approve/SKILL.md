---
name: clawui-approve
description: Use this skill when you are about to take a consequential or irreversible action and need explicit user approval before proceeding.
---

# ClawUI Action Approval

When you are about to take an action that could have significant consequences (sending messages, deleting data, making purchases, calling external APIs), follow these steps:

## Step 1: Submit for approval

```bash
curl -s -X POST http://localhost:3001/api/review \
  -H "Content-Type: application/json" \
  -d '{
    "type": "action_approval",
    "sessionKey": "{{SESSION_KEY}}",
    "payload": {
      "action": "{{ONE_LINE_DESCRIPTION_OF_ACTION}}",
      "detail": "{{FULL_DETAIL_OF_WHAT_YOU_WILL_DO}}",
      "risk": "{{low|medium|high}}"
    }
  }'
```

## Step 2: Notify the user

> "I need your approval before proceeding. A browser window has opened — please review and decide."

## Step 3: Wait for confirmation

Do NOT proceed until you receive a system message starting with `[openclaw-ui]`.

## Step 4: Act on the decision

- If approved: proceed with the action.
- If rejected: stop and inform the user.
- If approved with note: incorporate the user's note before proceeding.
