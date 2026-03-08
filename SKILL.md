# AgentClick Skill Router

Use this file only to route to the right sub-skill.

Base flow:
1. Detect AgentClick URL: try `http://localhost:38173/api/health` first; if unreachable, use `http://host.docker.internal:38173`.
2. If the server is not reachable at either address, start AgentClick locally with `npm start`, then re-check.
3. Create a session with `POST /api/review`.
4. Monitor the session — polling strategy depends on environment (see sub-skill for details):
   - Non-Docker (Claude Code, Codex, local): use `GET /api/sessions/:id/wait` (blocks until state changes).
   - Docker (OpenClaw): use short-poll `GET /api/sessions/:id` one call per exec; you are the loop controller.
5. If status is `rewriting`, update with `PUT /api/sessions/:id/payload` and continue monitoring the same session until `status=completed` or `pageStatus.stopMonitoring=true`.

Sub-skills:
- `action_approval` -> `skills/clickui-approve/SKILL.md`
- `code_review` -> `skills/clickui-code/SKILL.md`
- `email_review` -> `skills/clickui-email/SKILL.md`
- `plan_review` -> `skills/clickui-plan/SKILL.md`
- `trajectory_review` -> `skills/clickui-trajectory/SKILL.md`
- `memory_review` and `memory_management` -> `skills/clickui-memory/SKILL.md`

Keyword routing for `UI review`:
- `action`, `approval` -> `action_approval`
- `command`, `shell`, `script`, `diff`, `code` -> `code_review`
- `email`, `draft`, `reply` -> `email_review`
- `plan`, `steps`, `strategy` -> `plan_review`
- `trajectory`, `run log` -> `trajectory_review`
- `memory`, `memory files`, `browse memory` -> `skills/clickui-memory/SKILL.md`
