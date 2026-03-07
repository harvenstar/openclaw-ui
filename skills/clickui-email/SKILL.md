---
name: clickui-email
description: Use this skill when the user needs to triage, read, or reply to email in an AgentClick live session before anything is sent.
---

# ClickUI Email Live Session

## Trigger Conditions

Use this skill when the user wants email handled in an AgentClick live session instead of chat.

Common triggers:
- "write the email and let me review first"
- "before sending, let me review"
- "draft it and I will approve"
- "review my inbox in UI"
- "reply in live session"
- "email live session"

If the task is email work plus live session handling in UI, use this skill over generic chat drafting.

## Core Rules

- Always create an AgentClick live session with `type: "email_review"`.
- Treat the AgentClick page as the active email client for this task.
- The same agent that creates the session must monitor and update it.
- Do not start a helper process, fake monitor, server-side monitor, or detached subagent monitor.
- If a true subagent exists in the caller environment and the user explicitly wants one, it may help fetch or draft, but the main responsibility still stays with the agent handling the session.
- Show full email content in the payload. `preview` is only for the sidebar.
- Do not pre-generate reply drafts unless the user explicitly asked for that before opening the page.
- Reply generation is lazy: generate only after the user clicks `Reply`.
- The reply text comes from the agent's own generation unless the user wired some other drafting system explicitly.

## Step 1: Ensure AgentClick is running

```bash
AGENTCLICK_BASE="${AGENTCLICK_URL:-http://localhost:${AGENTCLICK_PORT:-${PORT:-38173}}}"

if ! curl -s --max-time 1 "$AGENTCLICK_BASE/api/health" > /dev/null 2>&1; then
  npm start >/tmp/agentclick.log 2>&1 &

  for _ in $(seq 1 30); do
    if curl -s --max-time 1 "$AGENTCLICK_BASE/api/health" > /dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

curl -s --max-time 1 "$AGENTCLICK_BASE/api/health"
```

If health still fails, stop and fix the server problem before creating a session.

## Step 2: Fetch Gmail data with the parallel fetch script

Use the bundled parallel fetch script as the default inbox-loading path. It uses `gog` underneath and is faster than serial message fetches.

Script:
- `skills/clickui-email/scripts/fetch_gmail_inbox_parallel.mjs`

Example for 10 recent inbox emails:

```bash
node skills/clickui-email/scripts/fetch_gmail_inbox_parallel.mjs \
  --query 'in:inbox' \
  --max 10 \
  --out /tmp/clickui_inbox.json
```

Example scoped to unread updates with explicit account and concurrency:

```bash
node skills/clickui-email/scripts/fetch_gmail_inbox_parallel.mjs \
  --query 'category:updates is:unread' \
  --max 10 \
  --account you@gmail.com \
  --concurrency 5 \
  --out /tmp/clickui_inbox.json
```

Guidelines:
- Prefer 10 recent emails unless the user asked for a different count.
- Use this script first when loading multiple emails because it fetches in parallel.
- The script should produce inbox JSON for the live session payload. Load that file instead of rebuilding the inbox array inline when possible.
- Normalize categories to Gmail-style values when possible: `Primary`, `Social`, `Promotions`, `Updates`, `Forums`.
- Keep full email text in `body` and only use `preview` for the sidebar.
- If you need one-off message detail beyond the script output, use `gog gmail get <message_id>`.

Suggested inbox item shape:

```json
{
  "id": "gmail-message-id",
  "category": "Updates",
  "from": "Sender <sender@example.com>",
  "to": ["me@example.com"],
  "cc": [],
  "bcc": [],
  "subject": "Email subject",
  "preview": "Short sidebar preview",
  "body": "Full email body shown in the main panel",
  "headers": {
    "date": "Sat, 7 Mar 2026 10:30:00 -0500"
  },
  "read": false
}
```

## Step 3: Create the live session

Write the payload to disk before POSTing.

```bash
cat > /tmp/clickui_email_review.json <<'JSON'
{
  "type": "email_review",
  "sessionKey": "SESSION_KEY",
  "payload": {
    "inbox": [],
    "draft": {
      "replyTo": "",
      "to": "",
      "subject": "",
      "paragraphs": []
    }
  }
}
JSON

RESPONSE=$(curl -s -X POST "$AGENTCLICK_BASE/api/review" \
  -H "Content-Type: application/json" \
  -d @/tmp/clickui_email_review.json)

SESSION_ID=$(echo "$RESPONSE" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
echo "$SESSION_ID"
```

Payload rules:
- Include real inbox data in `payload.inbox`.
- Leave `payload.draft.paragraphs` empty unless the user asked for an initial draft before page open.
- The page should open with full emails available, not only previews.

## Step 4: Monitor the session as the agent

After creating the session, the same agent must stay attached to it.

Preferred loop:

```bash
curl -s --max-time 310 "$AGENTCLICK_BASE/api/sessions/${SESSION_ID}/wait"
```

Fallback if blocking is unavailable:

```bash
while true; do
  curl -s "$AGENTCLICK_BASE/api/sessions/${SESSION_ID}"
  sleep 10
done
```

When using the fallback, inspect:
- `status`
- `result`
- `pageStatus`

If `pageStatus.stopMonitoring` is `true`, stop immediately.

## Rewrite / Update Rules

When the session returns `status: "rewriting"`, inspect `result` and apply the minimum needed update.

The UI is not only a final approval screen. The user may:
- read emails
- mark emails as read
- click `Reply` on one email while browsing others
- request `Read More`
- edit reply paragraphs directly
- ask for a paragraph rewrite
- stop monitoring from the page

### Reply requests

If the result indicates `requestReplyDraft: true` for an email:
- update the payload quickly so the UI can show that email as loading
- generate the reply draft yourself as the agent
- PUT the finished draft back into the same session
- do not create a new session

The UI expects:
- lazy reply generation
- folded reply draft by default
- the user can keep browsing while reply is loading
- the email row can later show a ready state and unread dot when the draft arrives

### Read more requests

If `result.readMore` is true:
- fetch more Gmail emails with `gog`
- keep the request scoped to the current category filter if the result includes categories
- merge new emails into the current inbox payload instead of replacing the whole list unless replacement is explicitly intended

### Read state changes

If the user marks emails as read:
- record which message ids changed
- if the task includes Gmail sync, update Gmail through `gog`
- reflect the new read state in the session payload

### Draft edits

If the user edits draft paragraphs in the page:
- preserve their edits
- only regenerate paragraphs the user explicitly asked to rewrite
- keep `replyTo`, `to`, and `subject` stable unless the UI explicitly changed supported fields
- CC and BCC additions from the page should be preserved and returned

## PUT payload updates

Always write the updated payload to a temp file before PUT.

```bash
cat > /tmp/clickui_email_payload.json <<'JSON'
{
  "payload": {
    "inbox": [],
    "draft": {
      "replyTo": "sender@example.com",
      "to": "sender@example.com",
      "subject": "Re: Original subject",
      "paragraphs": [
        {"id": "p1", "content": "Paragraph 1"},
        {"id": "p2", "content": "Paragraph 2"}
      ]
    }
  }
}
JSON

curl -s -X PUT "$AGENTCLICK_BASE/api/sessions/${SESSION_ID}/payload" \
  -H "Content-Type: application/json" \
  -d @/tmp/clickui_email_payload.json
```

Rules:
- Reuse the same `SESSION_ID` for the full interaction.
- If the UI asked for loading first, PUT a fast loading-state update, then PUT the completed draft.
- If PUT fails, fix it before continuing.

## Completion Rules

When the user confirms:
- treat the session as approved work
- send the final email if that is part of the task
- sync Gmail read state if the task requires it
- do not ask the user again if they already confirmed in UI

When the user stops monitoring from the page:
- stop immediately
- do not keep polling in the background
- do not leave any detached monitor running

## UI Expectations

Assume the page behaves like this and update payloads accordingly:
- Full email content is shown in the main panel.
- Sidebar uses short preview text only.
- Category filters may be folded by default.
- `Read More` appears at the bottom of the email list.
- Reply draft is folded by default.
- Paragraphs can be edited directly and also individually rewritten.
- When a draft becomes ready after a reply request, the corresponding email row may show a ready state and an unread marker until opened.
- Clicking stop or back may set `pageStatus.stopMonitoring = true`.

## Practical Notes

- Keep the monitor logic in the current agent turn when feasible.
- If the environment cannot keep a long blocking wait, poll the session every 10 seconds instead.
- Do not claim a reply came from Gmail or from a background process if the agent generated it.
- Prefer the bundled parallel fetch script for inbox loading, and use direct `gog` calls for one-off follow-up detail when needed.
