---
name: clawui-email
description: Use this skill when you have finished writing an email draft and need the user to review it before sending.
---

# ClawUI Email Review

When you have an email draft ready for user review, execute these steps using the bash tool.

## Step 1: Submit draft for review (Format B)

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
echo "$RESPONSE"
```

Replace placeholders with actual content. Split body into 2–4 logical paragraphs. `intentSuggestions` are optional guesses about what the user might want — the user toggles Yes/No on each.

Save the `sessionId` from the response.

## Step 2: Wait for the user to finish (blocks up to 5 minutes)

```bash
SESSION_ID="<sessionId from Step 1>"
curl -s "http://host.docker.internal:3001/api/sessions/${SESSION_ID}/wait"
```

The browser opens automatically. This call blocks until the user submits.

## Step 3: Read the result and act

The response contains `status` and `result`:

### If `status` is `completed` and `result.confirmed` is `true`:

**Execute immediately. Do NOT ask the user for confirmation again.** The user already confirmed in the UI — proceed with sending the email.

Apply any `result.actions` (paragraph-level delete/rewrite) before sending.

### If `status` is `rewriting` (or `result.regenerate` is `true`):

The user requested a rewrite. Apply `result.actions` and `result.userIntention` to rewrite the draft, then **update the same session** (do NOT create a new session):

```bash
SESSION_ID="<same sessionId from Step 1>"
curl -s -X PUT "http://host.docker.internal:3001/api/sessions/${SESSION_ID}/payload" \
  -H "Content-Type: application/json" \
  -d '{
    "payload": {
      "inbox": [... same inbox ...],
      "draft": {
        "replyTo": "e1",
        "to": "RECIPIENT_EMAIL",
        "subject": "Re: ORIGINAL_SUBJECT",
        "paragraphs": [
          {"id": "p1", "content": "REWRITTEN_PARAGRAPH_1"},
          {"id": "p2", "content": "REWRITTEN_PARAGRAPH_2"}
        ],
        "intentSuggestions": [...]
      }
    }
  }'
```

Then **wait again on the same session** — go back to Step 2. The UI refreshes in-place with the new draft. Repeat until the user confirms or rejects.

### Additional result fields:

- `result.selectedIntents` → `[{id, accepted}]` intent decisions the user made
- `result.userIntention` → free-text note from the user
- `result.markedAsRead` → email IDs the user chose to skip
