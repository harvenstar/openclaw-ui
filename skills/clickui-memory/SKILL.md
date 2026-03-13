---
name: clickui-memory
description: Browse memory files and propose memory updates through AgentClick memory management UI.
---

# ClickUI Memory Management

Use this skill for memory file browsing, inclusion decisions, and proposing memory updates.

There is **one session type**: `memory_management`. It handles both browsing and proposed updates.
To propose changes to memory files, pass `modifications` when creating the session — the UI highlights changed files and shows the diff inline.

## Step 1: Ensure AgentClick is running

```bash
if curl -s --max-time 1 http://localhost:38173/api/health > /dev/null 2>&1; then
  AGENTCLICK_BASE="http://localhost:38173"
else
  AGENTCLICK_BASE="http://host.docker.internal:38173"
fi

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

## Step 2: Create the session

### Browse only (no proposed changes)

```bash
RESPONSE=$(curl -s -X POST "$AGENTCLICK_BASE/api/memory/management/create" \
  -H 'Content-Type: application/json' \
  -d '{}')

SESSION_ID=$(echo "$RESPONSE" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
echo "$SESSION_ID"
```

### With proposed memory updates

Pass `modifications` to highlight changed files and show diffs in the UI.

```bash
cat > /tmp/clickui_memory_create.json <<'JSON'
{
  "sessionKey": "memory-update",
  "modifications": [
    {
      "id": "mod_1",
      "fileId": "<file-id-from-catalog>",
      "filePath": "/abs/path/to/MEMORY.md",
      "location": "MEMORY.md",
      "oldContent": "<current file content>",
      "newContent": "<proposed new content>",
      "generatedContent": "<proposed new content>"
    }
  ]
}
JSON

RESPONSE=$(curl -s -X POST "$AGENTCLICK_BASE/api/memory/management/create" \
  -H 'Content-Type: application/json' \
  -d @/tmp/clickui_memory_create.json)

SESSION_ID=$(echo "$RESPONSE" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
echo "$SESSION_ID"
```

To get file IDs for the `modifications` array, fetch the catalog first:

```bash
curl -s "$AGENTCLICK_BASE/api/memory/files" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for f in data['files']:
    print(f['id'], f['relativePath'])
"
```

Optional body fields:
- `modifications`: array of proposed changes — highlighted in UI with inline diff
- `currentContextFiles`: array of file paths already in agent context
- `extraMarkdownDirs`: array of additional directories to scan
- `searchQuery`: optional search filter
- `noOpen`: set to true to suppress opening browser
- `sessionKey`: optional dedup key

### Modification object fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique modification ID (e.g. `"mod_1"`) |
| `fileId` | yes | File ID from the catalog (`files[].id`) |
| `filePath` | yes | Absolute path to the file |
| `location` | yes | Human-readable location label |
| `oldContent` | yes | Current file content (for diff) |
| `newContent` | yes | Proposed new content (for diff) |
| `generatedContent` | yes | Same as `newContent` — the content to write if approved |

## Step 3: Monitor the session

After creating the session, the same agent must stay attached to it. Do NOT use a background process or subagent.

**Environment detection:** `GOG_ACCOUNT` is set in Docker (via docker-compose.yml) and absent elsewhere.

```bash
# Detect environment: GOG_ACCOUNT is set in Docker (docker-compose.yml), absent elsewhere
if [ -n "$GOG_ACCOUNT" ]; then
  # Docker: use short-poll (one curl per exec, you are the loop controller)
  curl -s "$AGENTCLICK_BASE/api/sessions/${SESSION_ID}"
else
  # Non-Docker: use blocking /wait
  curl -s --max-time 310 "$AGENTCLICK_BASE/api/sessions/${SESSION_ID}/wait"
fi
```

After each poll:
- If `pageStatus.stopMonitoring` is `true` -> stop immediately
- If `status` is `"completed"` -> stop
- If `status` is `"rewriting"` -> handle the action (see Action Handling below), then poll again
- Otherwise -> wait 1 second (`sleep 1` as a separate exec), then poll again

## Step 4: Action Handling

When the session returns `status: "rewriting"`, inspect `result`:

- `action`: `"include"` | `"exclude"` | `"delete"`
- `path`: the absolute file path the user acted on
- `regenerate`: `true`

### Include action

The UI has already persisted the include preference. The agent should:
1. Read the file content and add it to the agent's working context
2. Rebuild the catalog and PUT updated payload back to the session
3. Resume polling

### Exclude action

The UI has already persisted the exclude preference. The agent should:
1. Note the file should no longer be treated as active context
2. Rebuild the catalog and PUT updated payload
3. Resume polling

### Delete action

The agent must delete the file from disk:
1. Delete the file: `rm "$RESULT_PATH"`
2. Rebuild the catalog and PUT updated payload
3. Resume polling

## PUT payload updates

After each action, rebuild the catalog (preserving modifications) and PUT:

```bash
CATALOG=$(curl -s "$AGENTCLICK_BASE/api/memory/files")

# Merge existing modifications back into the catalog
python3 -c "
import sys, json
catalog = json.loads('$CATALOG')
mods = json.loads(open('/tmp/clickui_memory_create.json').read()).get('modifications', [])
catalog['modifications'] = mods
print(json.dumps({'payload': catalog}))
" > /tmp/clickui_memory_payload.json

curl -s -X PUT "$AGENTCLICK_BASE/api/sessions/${SESSION_ID}/payload" \
  -H "Content-Type: application/json" \
  -d @/tmp/clickui_memory_payload.json
```

## Compacting a Session (Writing Memory Updates)

Use this flow at the end of a session when the user asks to compact or when the context is getting long.

### Step 1: Read file guidance

Before proposing any changes, check if the user has written guidance for each memory file you plan to update:

```bash
curl -s "$AGENTCLICK_BASE/api/memory/guidance?path=/abs/path/to/MEMORY.md"
# Returns: { "path": "...", "guidance": "user instructions for how to update this file" }
```

Follow the guidance instructions when writing the proposed content.

### Step 2: Summarize the session into proposed modifications

For each memory file you want to update:
1. Read the current file content
2. Write the proposed new content (respecting any file guidance)
3. Build a `modification` object with `oldContent` and `newContent`

### Step 3: Open the memory management UI with modifications

```bash
cat > /tmp/clickui_memory_compact.json <<'JSON'
{
  "sessionKey": "session-compact",
  "modifications": [
    {
      "id": "mod_memory",
      "fileId": "<file-id-from-catalog>",
      "filePath": "/abs/path/to/MEMORY.md",
      "location": "MEMORY.md",
      "oldContent": "<current file content>",
      "newContent": "<proposed new content>",
      "generatedContent": "<proposed new content>"
    }
  ]
}
JSON

RESPONSE=$(curl -s -X POST "$AGENTCLICK_BASE/api/memory/management/create" \
  -H 'Content-Type: application/json' \
  -d @/tmp/clickui_memory_compact.json)

SESSION_ID=$(echo "$RESPONSE" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
echo "$SESSION_ID"
```

The UI highlights modified files with an **M** badge and shows the diff inline. The user can also write or edit Update Guidance for any file while reviewing.

### Step 4: Monitor and act on approval

Poll with `/wait`. On `status: "completed"`:
- `result.approved: true` → write the proposed content to each modified file on disk
- `result.approved: false` → do not write

```bash
curl -s --max-time 310 "$AGENTCLICK_BASE/api/sessions/${SESSION_ID}/wait"
```

After the user approves, write the files:

```bash
cat > /path/to/MEMORY.md << 'EOF'
<new content>
EOF
```

## Update Guidance (per-file instructions)

Each memory file can have user-written guidance that tells the agent how to update it. This is persisted across sessions.

- **Read guidance** before proposing changes: `GET /api/memory/guidance?path=<abs-path>`
- **Write guidance** (agent can also save it): `POST /api/memory/guidance` with body `{ "path": "...", "guidance": "..." }`
- The user writes guidance in the "Update Guidance" textarea in the memory management UI

Always read file guidance before writing modifications. If guidance exists, follow it exactly.

## Standalone browsing (no session)

For simple file browsing without agent interaction:
- List memory files: `GET /api/memory/files`
- Open a file: `GET /api/memory/file?path=<absolute-path>`
- UI route: `/memory-management`
