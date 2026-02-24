---
name: clawui-email
description: Use this skill when you have finished writing an email draft and need the user to review it before sending.
---

# ClawUI Email Review

## Trigger Conditions (high priority)

Use this skill by default when the user asks you to draft an email and review it before sending.

Common trigger phrases include (Chinese or English):
- "写好后让我审阅"
- "先让我在浏览器里审阅"
- "发之前让我看一下"
- "先草拟邮件给我确认"
- "write the email and let me review first"
- "before sending, let me review"
- "draft it and I will approve"

If the request is an email draft + human review, prefer this skill over generic chat drafting.

## Do Not Use These Alternatives

For email review requests handled by this skill:
- Do NOT use the `browser` tool to manually render a draft
- Do NOT use the `canvas` tool to manually render a draft
- Do NOT ask the user to review the draft directly in chat first

Always submit to AgentClick via `POST /api/review` and let the user review in the AgentClick UI.

When you have an email draft ready for user review, execute these steps **in order** using the bash tool.
This workflow must be fast and mechanical:
- NEVER use `/wait` (use only `GET /api/sessions/${SESSION_ID}`)
- During polling, do not narrate between polls unless STATUS changes to `rewriting` or `completed`
- Keep polling interval fixed at `sleep 1` (do not increase to 2/3/5 seconds)
- Do NOT use `for`/`while` shell loops for polling
- Each poll must be a single `exec` call (one GET request only), then branch in Step 3
- Do NOT run background polling jobs or long-running polling commands

## Step 1: Submit draft for review

```bash
RESPONSE=$(curl -s -X POST http://host.docker.internal:3001/api/review \
  -H "Content-Type: application/json" \
  -d '{
    "type": "email_review",
    "payload": {
      "inbox": [
        {
          "id": "e1",
          "from": "SENDER_EMAIL",
          "subject": "ORIGINAL_SUBJECT",
          "preview": "ORIGINAL_EMAIL_PREVIEW_TEXT",
          "category": "Work",
          "isRead": false,
          "timestamp": UNIX_MS_TIMESTAMP
        }
      ],
      "draft": {
        "replyTo": "e1",
        "to": "RECIPIENT_EMAIL",
        "subject": "Re: ORIGINAL_SUBJECT",
        "paragraphs": [
          {"id": "p1", "content": "PARAGRAPH_1"},
          {"id": "p2", "content": "PARAGRAPH_2"},
          {"id": "p3", "content": "PARAGRAPH_3"}
        ],
        "intentSuggestions": [
          {"id": "i1", "text": "Agree to the proposal"},
          {"id": "i2", "text": "Schedule a follow-up meeting"}
        ]
      }
    }
  }')
SESSION_ID=$(echo "$RESPONSE" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
echo "Session: $SESSION_ID"
```

Replace placeholders with actual content. Split body into 2–4 logical paragraphs.

## Step 2: Poll review status (short request)

```bash
RESULT=$(curl -s "http://host.docker.internal:3001/api/sessions/${SESSION_ID}")
STATUS=$(echo "$RESULT" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "STATUS=$STATUS"
if [ "$STATUS" != "pending" ]; then
  echo "$RESULT"
fi
```

The browser opens automatically. This is a short poll request (do not use `/wait` here).
Do not use any other polling endpoint.
Do not wrap polling in a shell loop (`for`, `while`, `until`).

## Step 3: Act based on STATUS

Do not print extra debug lines here. Branch directly on `STATUS`.

There are exactly three cases:

- **Case A: STATUS is `pending`** → The user is still reviewing. Run `sleep 1` and then go back to Step 2 immediately. Do not output extra explanation text.
- **Case B: STATUS is `completed`** → The user confirmed. Send the email immediately. Do NOT ask the user again. You are done.
- **Case C: STATUS is `rewriting`** → The user wants changes. You MUST execute Step 4 below. Do NOT skip it.

Use this command when STATUS is `pending`:

```bash
sleep 1
```

## Step 4: Rewrite draft and PUT it back (REQUIRED when STATUS is "rewriting")

You MUST execute this step when STATUS was "rewriting". This is not optional.

First, read `result.actions` and `result.userIntention` from the Step 2 response. Rewrite the paragraphs accordingly.

Rewrite rules (for speed and correctness):
- Apply the **minimum** change needed to satisfy the user feedback
- Change only the paragraph(s) referenced in `result.actions` when possible
- Keep all other paragraph text exactly unchanged
- Keep `inbox` exactly unchanged from the last payload
- Keep `draft.subject`, `draft.to`, and `draft.replyTo` unchanged unless explicitly requested

Then write the payload JSON to a temp file first (REQUIRED for stability, especially with Chinese/French/apostrophes), and send it with `-d @file`.

Do NOT inline JSON directly in the curl command.

Use this exact two-step pattern:

```bash
cat > /tmp/clawui_payload.json <<'JSON'
{
  "payload": {
    "inbox": [... keep the same inbox array from Step 1 ...],
    "draft": {
      "replyTo": "e1",
      "to": "RECIPIENT_EMAIL",
      "subject": "Re: ORIGINAL_SUBJECT",
      "paragraphs": [
        {"id": "p1", "content": "NEW_REWRITTEN_PARAGRAPH_1"},
        {"id": "p2", "content": "NEW_REWRITTEN_PARAGRAPH_2"}
      ]
    }
  }
}
JSON

HTTP_CODE=$(curl -s -o /tmp/clawui_put_response.txt -w "%{http_code}" \
  -X PUT "http://host.docker.internal:3001/api/sessions/${SESSION_ID}/payload" \
  -H "Content-Type: application/json" \
  -d @/tmp/clawui_payload.json)
echo "PUT_PAYLOAD_HTTP=$HTTP_CODE"
cat /tmp/clawui_put_response.txt
```

If HTTP is not `200`, fix the JSON file and retry Step 4. Do not continue polling with a failed PUT.

**IMPORTANT:** Do NOT create a new session. Reuse the same `SESSION_ID`.
**IMPORTANT:** Do not rewrite the whole email from scratch when only one paragraph changed.

After the PUT succeeds (HTTP 200), **go back to Step 2** and poll again. The user will see the updated draft in the same browser tab. Repeat Step 2 → 3 → 4 until the user finally confirms.
