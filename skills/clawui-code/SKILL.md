---
name: clawui-code
description: Use this skill when you want to run a shell command that could be destructive or irreversible and need user confirmation first.
---

# ClawUI Code Review

Before running risky shell commands, get user approval via this skill. Always show the user exactly which files will change and what the diffs look like — this is the default, not optional.

## Step 1: Generate the diff

Before submitting, capture the exact changes so the user can see them in the review UI.

```bash
# Changes a patch would make (before applying):
git diff --unified=3 HEAD -- path/to/file.ts

# All staged changes:
git diff --cached --unified=3

# What a specific commit changed:
git show <commit> --unified=3

# Multiple files at once:
git diff --unified=3 HEAD -- src/api/client.ts src/utils/retry.ts
```

Escape each diff as a JSON string: replace newlines with `\n` and double-quotes with `\"`.

## Step 2: Submit the command for review

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
      "affectedFiles": [
        {
          "path": "src/utils/retry.ts",
          "status": "added",
          "diff": "@@ -0,0 +1,12 @@\n+export async function retry<T>(fn: () => Promise<T>, times = 3): Promise<T> {\n+  let last: unknown\n+  for (let i = 0; i < times; i++) {\n+    try { return await fn() } catch (e) { last = e }\n+  }\n+  throw last\n+}"
        },
        {
          "path": "src/api/client.ts",
          "status": "modified",
          "diff": "@@ -1,8 +1,9 @@\n import axios from '\''axios'\''\n+import { retry } from '\''../utils/retry'\''\n \n export async function fetchUser(id: string) {\n-  return axios.get(`/users/${id}`)\n+  return retry(() => axios.get(`/users/${id}`))\n }"
        },
        {
          "path": "src/api/legacyClient.ts",
          "status": "deleted",
          "diff": "@@ -1,5 +0,0 @@\n-// deprecated — use client.ts\n-import axios from '\''axios'\''\n-export const get = (url: string) => axios.get(url)"
        },
        {
          "path": "src/api/index.ts",
          "status": "renamed",
          "oldPath": "src/api/exports.ts",
          "diff": "@@ -1,2 +1,2 @@\n-export * from '\''./legacyClient'\''\n+export * from '\''./client'\''"
        }
      ]
    }
  }')
SESSION_ID=$(echo "$RESPONSE" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
echo "Session: $SESSION_ID"
```

### `affectedFiles` entry fields

| Field | Required | Description |
|-------|----------|-------------|
| `path` | yes | File path relative to `cwd` |
| `status` | yes | `"added"` \| `"modified"` \| `"deleted"` \| `"renamed"` |
| `diff` | **recommended** | Unified diff string — shown as a GitHub-style diff in the review UI |
| `oldPath` | no | Previous path, only for `"renamed"` files |

If you cannot generate a diff (e.g. the command doesn't touch tracked files), omit `diff` and the file will still appear in the mind-map tree without a diff panel.

**Legacy fallback**: If you only have a flat list of paths and no diffs, use `"files": ["src/index.ts", ...]` instead of `affectedFiles`. The UI will show the tree without diff panels.

## Step 3: Wait for decision (blocks up to 5 minutes)

```bash
curl -s "http://host.docker.internal:3001/api/sessions/${SESSION_ID}/wait"
```

The browser opens automatically. This call blocks until the user approves or rejects.

## Step 4: Act on the decision

- `result.approved: true` → **Run the command immediately. Do NOT ask the user again.** The user already approved in the UI. If `result.note` is set, adjust the command accordingly.
- `result.approved: false` → Do not run the command. Inform the user.
