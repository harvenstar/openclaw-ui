# Deployment Guide

This guide covers the current production-style deployment shape for AgentClick (`agentclick` codebase).

## Runtime Model

After building the web app, a single Node.js process serves:

- API routes (`/api/*`)
- Built frontend assets (`packages/web/dist`)
- SPA fallback (`index.html`) for frontend routes

This means production-style local usage is a single port:

```bash
npm run build
npm start
# http://localhost:3001
```

## Environment Variables

The server reads environment variables from the process and auto-loads a root `.env` file via `dotenv`.

Supported variables:

- `PORT` (default: `3001`)
- `OPENCLAW_WEBHOOK` (default: `http://localhost:18789/hooks/agent`)
- `OPENCLAW_TOKEN` (optional; sent as bearer token on callback requests)

Example `.env`:

```bash
PORT=3001
OPENCLAW_WEBHOOK=http://localhost:18789/hooks/agent
OPENCLAW_TOKEN=
```

## Local Production-Style Check

Use this when validating packaging or deployment behavior (instead of Vite dev mode):

```bash
npm install
npm run build
PORT=3101 npm start
```

Quick checks:

```bash
curl -sI http://localhost:3101/
curl -sI http://localhost:3101/review/test-session   # SPA fallback should return index.html
curl -s http://localhost:3101/api/sessions
```

## Reverse Proxy (Nginx Example)

Use a reverse proxy if you want HTTPS, domain routing, or shared infra.

Minimal Nginx example:

```nginx
server {
  listen 80;
  server_name agentclick.example.com;

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Notes:

- AgentClick is an SPA, so frontend routes (for example `/review/:id`) must reach the Node app unchanged.
- Do not rewrite `/api/*` to another path unless you also update clients/integration config.

## Docker / OpenClaw Integration Notes

If OpenClaw runs in Docker and AgentClick runs on the host machine:

- Configure the skill / callback URL to use `host.docker.internal:3001` instead of `localhost:3001`

Reason:

- Inside a container, `localhost` points to the container itself, not your host machine.

Example target from a containerized agent:

```text
http://host.docker.internal:3001/api/review
```

## Common Pitfalls

- `npm start` without `npm run build` first:
  - The API still runs, but built frontend assets may not exist yet.
- Port conflict on `3001`:
  - Set `PORT=3101 npm start` (or another free port).
- Review URL opens on wrong origin:
  - In production mode the app should return URLs on the same port as `PORT`.
  - If not, ensure you are running the built server (`npm start`) rather than Vite dev mode.

## Current Limits (Known)

- No built-in HTTPS termination (use a reverse proxy)
- No process manager config included yet (`systemd`, `pm2`, Dockerfile not added in this repo yet)
- No auth layer on the UI/API endpoints by default (deploy only in trusted/local setups until hardened)
