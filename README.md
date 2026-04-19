# gemini-mini-ui

> ⚠️ Vibe-coded as a hobby project. Use at your own risk — no stability, security, or support guarantees.

A minimal desktop-style web UI on top of [`@google/gemini-cli-core`](https://www.npmjs.com/package/@google/gemini-cli-core). Chat with Gemini CLI agents from a browser, with per-session working directories, persistent history, tool calls, and a debug drawer that surfaces the raw per-turn context.

Runs locally: one Node process serves the SPA and bridges HTTP/SSE to live Gemini sessions.

## Features

- **Multi-session sidebar** — create, fork, rename, delete; each session has its own cwd and model.
- **Streaming chat** — markdown + KaTeX math, typed error bubbles with retry.
- **Tool calls** — folded cards with approval modal for destructive operations.
- **Debug drawer** — per-session SSE event log (raw / merged-chunk modes) and a Request tab that shows the exact system prompt, environment context, user memory, transcript, and current prompt sent upstream.
- **Command palette** (⌘/ or ⌘K) — Raycast-style; switch model, new session.
- **Hotkeys** — Enter to send, ⌘N new session here, ⌘⇧N new session with directory picker.

## Requirements

- Node 20+
- Gemini CLI installed and configured

## Run

```bash
npm install
npm run dev       # tsx watch, reloads on server changes
# or
npm start         # plain tsx
```

Open <http://localhost:3000>. Override with `PORT=4000 npm run dev`.

## Tests

```bash
npx playwright install chromium   # once
npm run test:e2e
```

The e2e suite (`tests/e2e/smoke.spec.ts`) runs against a fake in-process session (`server/fake-session.ts`) so it needs no API key.

## Layout

```
server/     Node HTTP + SSE bridge, session manager, approval bridge
  index.ts        REST + /sessions/:id/stream (SSE)
  sdk.ts          thin wrapper around @google/gemini-cli-core
  approvals.ts    destructive-tool gating
  fake-session.ts deterministic session for e2e
web/        Browser SPA (Babel-standalone, no build step)
  app.jsx         root + routing
  components.jsx  chat, sidebar, debug drawer, palette, approval modal
  markdown.jsx    markdown + KaTeX render
tests/e2e/  Playwright smoke tests
scripts/    vendor-sdk.sh pulls private SDK source into server/vendor
```

See [DESIGN.md](DESIGN.md) and [UI_DESIGN.md](UI_DESIGN.md) for the design spec.

## Status

Built as a learning/playground project. Everything works locally; nothing is packaged or deployed.
