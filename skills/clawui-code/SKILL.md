---
name: clawui-code
description: Use this skill when you want to run a shell command that could be destructive or irreversible and need user confirmation first.
---

# ClawUI Code Review

Before running risky shell commands, get user approval via this skill.

## Step 1: Submit the command for review

```bash
RESPONSE=$(curl -s -X POST http://host.docker.internal:3001/api/review \
  -H "Content-Type: application/json" \
  -d '{
    "type": "code_review",
    "payload": {
      "command": "THE_EXACT_COMMAND_YOU_WANT_TO_RUN",
      "cwd": "WORKING_DIRECTORY",
      "explanation": "WHAT_THIS_COMMAND_DOES_AND_WHY",
      "risk": "low|medium|high",
      "files": ["src/index.ts", "src/pages/Home.tsx"]
    }
  }')
echo "$RESPONSE"
```

`files` is optional — list the files this command will affect, shown as a file tree in the UI.

Save the `sessionId` from the response.

## Step 2: Wait for decision (blocks up to 5 minutes)

```bash
SESSION_ID="<sessionId from Step 1>"
curl -s "http://host.docker.internal:3001/api/sessions/${SESSION_ID}/wait"
```

The browser opens automatically. This call blocks until the user submits.

## Step 3: Act on the decision

- `result.approved: true` → **Run the command immediately. Do NOT ask the user again.** The user already approved in the UI. If `result.note` is set, adjust the command accordingly.
- `result.approved: false` → Do not run the command. Inform the user.
