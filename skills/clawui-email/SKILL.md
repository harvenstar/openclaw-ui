---
name: clawui-email
description: Use this skill when you have finished writing an email draft and need the user to review it before sending.
---

# ClawUI Email Review

When you have an email draft ready for user review, execute these steps **in order** using the bash tool.

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

## Step 2: Wait for user review

```bash
RESULT=$(curl -s "http://host.docker.internal:3001/api/sessions/${SESSION_ID}/wait")
echo "$RESULT"
```

The browser opens automatically. This call blocks until the user submits their decision.

## Step 3: Check the status field in the response

Parse the `status` field from the response.

**If `status` is `"completed"`:** The user confirmed. Send the email now. Do NOT ask "are you sure?" — the user already confirmed in the UI. Apply any `result.actions` before sending. Then stop — you are done.

**If `status` is `"rewriting"`:** The user wants you to rewrite the draft. Go to Step 4.

## Step 4: Rewrite and update the SAME session (only if status was "rewriting")

Read `result.actions` and `result.userIntention` from the response. Rewrite the draft paragraphs based on the user's feedback. Then send the rewritten draft back to the **same session** using this PUT request:

```bash
curl -s -X PUT "http://host.docker.internal:3001/api/sessions/${SESSION_ID}/payload" \
  -H "Content-Type: application/json" \
  -d '{
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
  }'
```

**IMPORTANT:** Do NOT create a new session. Reuse the same `SESSION_ID`.

After the PUT succeeds, **go back to Step 2** and wait again. The user will see the updated draft in the same browser tab. Repeat Step 2 → 3 → 4 until the user confirms.
