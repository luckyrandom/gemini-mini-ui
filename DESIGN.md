# gemini-mini-ui — Design Spec

A minimal desktop-style web UI on top of `@google/gemini-cli-sdk`. Runs locally: one Node process serves both a static SPA and a small HTTP API that bridges browser requests to live `GeminiCliSession` objects.

---

## 1. Goals & non-goals

### Goals

- Chat with Gemini CLI agents from a browser, with **per-session working directory (cwd)** and **persistent conversation history**.
- Three-pane layout to leave room for future artifact / diff / tool-confirmation surfaces without restructuring.
- Thin glue over the official SDK — no reimplementation of auth, streaming, tool scheduling, or on-disk history.
- Local-only: no auth layer, no multi-user, no remote deployment concerns.

### Non-goals (for v0)

- Tool-call rendering beyond logging (artifact pane stays empty/reserved).
- Image / file upload.
- Multi-provider model backends (Gemini only; that's what the official SDK supports).
- Shared / collaborative sessions.
- Packaging as an installable app.

---

## 2. Architecture at a glance

```
┌────────────────── browser tab ──────────────────┐
│ React SPA (Vite build)                          │
│  ├─ SessionList (left)                          │
│  ├─ ChatPane    (center)                        │
│  └─ ArtifactPane (right, collapsed, reserved)   │
└──────────────────────┬──────────────────────────┘
                       │ HTTP + SSE (same origin)
┌──────────────────────▼──────────────────────────┐
│ Node server (single process)                    │
│  ├─ Static file server (serves Vite build)      │
│  ├─ REST API   — sessions CRUD + list           │
│  ├─ SSE stream — /sessions/:id/stream           │
│  └─ SessionManager                              │
│       └─ Map<sessionId, GeminiCliSession>       │
└──────────────────────┬──────────────────────────┘
                       │ in-process import
┌──────────────────────▼──────────────────────────┐
│ @google/gemini-cli-sdk                          │
│  GeminiCliAgent                                 │
│    ├─ .session({ sessionId? })                  │
│    └─ .resumeSession(sessionId) → loads history │
│       from <projectTempDir>/chats/*.json        │
└─────────────────────────────────────────────────┘
```

- **One Node process.** The HTTP server and the SDK live in the same process, so `GeminiCliSession` instances can be kept in an in-memory `Map` and streamed directly to SSE responses without serializing across a process boundary.
- **No websocket.** SSE is sufficient: model → browser is the only streaming direction. Browser → model is discrete `POST` messages.
- **Static SPA.** The Vite `dist/` is served by the same Node process on the same port. No CORS, no separate dev origin (in dev, Vite proxies API calls to the Node server).

---

## 3. SDK integration

### 3.1 Library choice

We depend on the gemini-cli SDK surface in a **split** arrangement:

- **`@google/gemini-cli-core`** — installed normally from npm, pinned to a specific version (initial target: `0.38.2`). This is the engine: auth, `GeminiClient`, `Config`, `ServerGeminiStreamEvent`, tool scheduler, chat recording. It pulls `@google/genai`, MCP SDK, OpenTelemetry, etc. transitively; we don't import those directly.
- **`@google/gemini-cli-sdk`** — **vendored** into `server/vendor/gemini-cli-sdk/` as a copy of `packages/sdk/src/*.ts` from `google-gemini/gemini-cli`. The SDK is ~8 files / ~715 LOC — a thin wrapper around `-core` that provides `GeminiCliAgent` + `GeminiCliSession` with history resume and the agent loop. It is **not yet published to npm**, so vendoring avoids `file:` paths, sibling-folder coupling, and waiting on a registry publish. Apache-2.0 license headers are preserved in every file.

Our own code imports only from `./vendor/gemini-cli-sdk` (for the agent/session surface) and from `@google/gemini-cli-core` (for types that leak through, e.g. `ServerGeminiStreamEvent`). No other gemini-cli packages are direct dependencies.

**Refreshing the vendored SDK:**

```bash
# From the gemini-mini-ui repo root, with google-gemini/gemini-cli cloned at ../gemini-cli
cp ../gemini-cli/packages/sdk/src/*.ts server/vendor/gemini-cli-sdk/
# Then manually exclude test files if any were copied:
rm server/vendor/gemini-cli-sdk/*.test.ts server/vendor/gemini-cli-sdk/*.integration.test.ts
```

When refreshing, **bump `@google/gemini-cli-core` in package.json to a matching version** — the SDK snapshot and core must agree on types and runtime shapes. Any upgrade is a paired bump (core in `package.json`, SDK via `cp`). Record the source commit SHA in `server/vendor/gemini-cli-sdk/VERSION.txt` for traceability.

### 3.1.1 Escape hatch: dropping the SDK

All SDK imports flow through a single file `server/sdk.ts` (see §7). If we later decide we need something the vendored SDK doesn't expose — custom tool-confirmation flow, different session lifecycle, injecting a non-Google model backend — we rewrite that one file to talk to `@google/gemini-cli-core` directly (construct `Config` + `GeminiClient` ourselves, mirroring what `GeminiCliSession.initialize()` does today). The rest of the backend (SessionManager, routes, SSE wire format) is unaffected.

### 3.2 Agent construction

One shared `GeminiCliAgent` per Node process:

```ts
import { GeminiCliAgent } from '@google/gemini-cli-sdk';

const agent = new GeminiCliAgent({
  instructions: 'You are a helpful Gemini CLI assistant.',
  // model: defaults to PREVIEW_GEMINI_MODEL_AUTO
  // tools: none in v0
  // skills: none in v0
});
```

`cwd` is **not** set on the agent — it's set per-session (see below). That way a single Node process can back sessions rooted at different project directories.

### 3.3 Per-session cwd

The SDK takes `cwd` on `GeminiCliAgentOptions`, not on `.session()`. To override cwd per session we instantiate a **fresh agent per cwd**:

```ts
const agentForThisCwd = new GeminiCliAgent({ ...baseOptions, cwd });
const session = agentForThisCwd.session({ sessionId });
```

Agents are cheap (they hold only the options object), so we can do this without caching. If this turns out to be wasteful, we can cache `Map<cwd, GeminiCliAgent>`.

> **Open question (SDK quirk):** verify that `.session({ sessionId })` with a pre-generated id is the right way to reserve an id before the first `sendStream`. Fallback: call `createSessionId()` from core and pass it in.

### 3.4 Auth

Core exposes several auth types ([contentGenerator.ts](../gemini-cli/packages/core/src/core/contentGenerator.ts)): `LOGIN_WITH_GOOGLE` (personal OAuth, creds stored at `~/.gemini/oauth_creds.json`), `USE_GEMINI` (API key), `USE_VERTEX_AI`, `COMPUTE_ADC`, etc. The SDK's `getAuthTypeFromEnv()` only picks `LOGIN_WITH_GOOGLE` when `GOOGLE_GENAI_USE_GCA=true` is set, so out of the box it would *not* reuse the credentials a user already created by running `gemini` and logging in.

Because we've vendored the SDK (§3.1), our `server/sdk.ts` overrides the auth-type resolution before calling `config.refreshAuth()`. The resolution order is:

1. **`GEMINI_API_KEY` set** → `USE_GEMINI`. Explicit API keys win — predictable override for power users.
2. **`~/.gemini/oauth_creds.json` exists** → `LOGIN_WITH_GOOGLE`. Reuses the login from the `gemini` CLI binary. This is the **zero-config happy path**: if the user has ever run `gemini` and signed in, our UI just works.
3. **`GOOGLE_GENAI_USE_VERTEXAI=true`** → `USE_VERTEX_AI`.
4. **otherwise** → `COMPUTE_ADC` (gcloud ADC). Final fallback.

We do not surface an auth UI in v0. If resolution lands on step 4 and ADC is not configured, the server logs a clear error and returns 500 on the first `sendStream`. No retry loop, no browser-based OAuth flow in the UI itself — users who want to log in should run `gemini` once and come back. Adding a "Sign in with Google" button in the UI is future work (would reuse core's `getOauthClient()`; out of scope for v0).

### 3.5 Persistence

The SDK already persists conversations automatically:

- Messages are written to `<projectTempDir>/chats/<shortId>-*.json` by `chatRecordingService` inside core.
- `projectTempDir` is derived from the session's cwd via core's `Storage`.
- `GeminiCliAgent.resumeSession(sessionId)` reloads a session from these files.

**We therefore do not duplicate chat storage.** The UI backend keeps only a small *index* (see §4.2) mapping `sessionId → { cwd, title, createdAt }` so we can populate the left-pane list without crawling temp directories.

### 3.6 Streaming

`GeminiCliSession.sendStream(prompt, signal)` yields `ServerGeminiStreamEvent` objects. The server pipes each event as an SSE `data:` frame, passing through as JSON without interpretation. Event types we care about in v0:

- `Content` — text chunks from the model.
- `ToolCallRequest` — logged only; not rendered yet.
- `UserCancelled`, `Error` — surface to UI as terminal frames.
- Other event types pass through as opaque `{ type, value }` for future panes to consume.

SDK handles the agent loop (tool scheduling, multi-turn until no more tool calls) inside `sendStream`. We don't re-implement it.

---

## 4. Backend logic

### 4.1 Session manager

```ts
class SessionManager {
  private live = new Map<string, GeminiCliSession>();
  private index: SessionIndex;   // see §4.2

  async create(cwd: string, title?: string): Promise<SessionRecord>;
  async get(id: string): Promise<GeminiCliSession>;  // live or resume
  async list(): Promise<SessionRecord[]>;            // from index
  async delete(id: string): Promise<void>;           // remove from index; do NOT delete SDK chat files
  async setTitle(id: string, title: string): Promise<void>;
}
```

- `get()` is lazy: if the session isn't in `live`, call `agent.resumeSession(id)` (or `.session({ sessionId: id })` for never-started sessions), cache it, return it.
- `create()` pre-registers the id in the index but does not instantiate a `GeminiCliSession` until the first message (save memory on page-reload).
- `delete()` only unlinks from the index; SDK-owned chat files on disk are left intact (safer; user can still find them with the `gemini` CLI).

### 4.2 Session index

A single file: `<userDataDir>/gemini-mini-ui/sessions.json`:

```json
{
  "version": 1,
  "sessions": [
    {
      "id": "9f2a…",
      "cwd": "/Users/cx/code/widget",
      "title": "Auth migration",
      "createdAt": "2026-04-18T09:22:11Z",
      "lastUsedAt": "2026-04-18T10:03:47Z"
    }
  ]
}
```

- `userDataDir` resolves via `env.XDG_DATA_HOME ?? ~/.local/share` on Linux and `~/Library/Application Support` on macOS.
- Writes are serialized through a single async mutex so concurrent requests can't corrupt the file. On startup the file is read once; subsequent writes replace it atomically (`writeFile` to `.tmp`, then `rename`).
- The index is **display metadata only**. If it's lost, we can rebuild an approximate list by scanning SDK chat files, but we treat that as a manual recovery step, not v0 code.

### 4.3 HTTP API

All endpoints are same-origin, JSON in/out unless noted.

| Method | Path | Body / query | Response |
|---|---|---|---|
| `GET`    | `/api/sessions`                    | —                       | `SessionRecord[]` (from index) |
| `POST`   | `/api/sessions`                    | `{ cwd, title? }`       | `SessionRecord` |
| `GET`    | `/api/sessions/:id`                | —                       | `SessionRecord` + loaded `messages[]` from SDK history |
| `PATCH`  | `/api/sessions/:id`                | `{ title? }`            | `SessionRecord` |
| `DELETE` | `/api/sessions/:id`                | —                       | `204` |
| `POST`   | `/api/sessions/:id/stream`         | `{ text }`              | `text/event-stream` — see §4.4 |
| `POST`   | `/api/sessions/:id/cancel`         | —                       | `204` — aborts current stream |

Errors use `{ error: string, code?: string }` with appropriate HTTP status.

### 4.4 SSE frame format

Every frame is:

```
event: <type>
data: <json>

```

- `event: message` — `{ type: 'content', text: '...' }` or full `ServerGeminiStreamEvent` passthrough for non-content events.
- `event: error` — `{ message, code? }`.
- `event: done` — emitted when the SDK stream ends successfully. Empty payload.

Client `EventSource` listens for `message`, `error`, `done`. `POST` + `EventSource` is not standard, so for simplicity we use a plain `POST` that holds the connection open with `Content-Type: text/event-stream` and parse it manually on the client via `fetch()` + `ReadableStream`. (`EventSource` doesn't support POST bodies.)

### 4.5 Cancellation

- Each active stream has an `AbortController` stored on the session record: `Map<sessionId, AbortController>`.
- `POST /api/sessions/:id/cancel` calls `controller.abort()`.
- Client also aborts its `fetch()` — which causes the server's request handler to notice `req.aborted` and call the same `.abort()`.
- The SDK propagates the signal into the `GeminiClient.sendMessageStream(..., signal, ...)` call.

### 4.6 Concurrency per session

For v0: **one in-flight stream per session**. If a `POST /stream` arrives while another is active on the same session, we return `409 Conflict`. The UI disables the send button while streaming to avoid this in the happy path.

---

## 5. Capability (v0)

- Create a session rooted at a chosen directory path.
- Name / rename sessions.
- Resume any prior session (cwd + full history) on server or browser reload.
- Send a user message; see the model's streaming response rendered as Markdown.
- Cancel a streaming response mid-flight.
- Delete a session from the sidebar (keeps on-disk history, just hides it).

**Not yet:** file attachments, image input, tool-call surface, artifact pane content, skills, MCP servers, custom models, shell/fs approvals. These are prepared for (right pane exists; all stream events flow through) but not rendered.

---

## 6. UI (brief — we'll iterate)

Three columns, responsive behavior TBD:

- **Left (~260px, resizable):** new-session button, list of sessions sorted by `lastUsedAt` desc. Each row: title (or cwd basename if untitled), cwd path in a muted monospace line below.
- **Center (flex):** message log + growing `<textarea>` input. Shift+Enter = newline, Enter = send. Markdown rendered via bundled `marked`; code blocks via `highlight.js` (bundled). Stream appends token-by-token into the assistant bubble.
- **Right (~320px, collapsed by default):** toggle button in the header bar shows/hides it. Content in v0 is an empty "Nothing to show" placeholder. Later: artifact viewer, diff preview, tool-call confirmation.

State is held in a small React context (session list, active session id, messages per session, streaming state). No Redux. Fetch calls go through a single `api.ts` module.

---

## 7. Repository layout

```
gemini-mini-ui/
├── DESIGN.md                      # this file
├── README.md                      # quick-start once scaffolded
├── package.json                   # server + web scripts in one place
├── tsconfig.json                  # base
├── tsconfig.server.json           # node target
├── tsconfig.web.json              # DOM target
├── vite.config.ts                 # dev proxy → :3000
├── server/
│   ├── index.ts                   # http entry
│   ├── routes.ts                  # REST + SSE handlers
│   ├── sessionManager.ts          # §4.1
│   ├── sessionIndex.ts            # §4.2
│   ├── sdk.ts                     # sole import point for vendored SDK (§3.1.1)
│   ├── vendor/
│   │   └── gemini-cli-sdk/        # copied from google-gemini/gemini-cli @ <sha>
│   │       ├── VERSION.txt        # source commit SHA
│   │       ├── agent.ts
│   │       ├── session.ts
│   │       ├── tool.ts
│   │       ├── fs.ts
│   │       ├── shell.ts
│   │       ├── skills.ts
│   │       ├── types.ts
│   │       └── index.ts
│   └── types.ts
└── web/
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── api.ts
        ├── context.tsx            # SessionsContext
        └── panes/
            ├── SessionList.tsx
            ├── Chat.tsx
            └── Artifact.tsx       # placeholder
```

Scripts:

- `bun dev` — concurrently runs `vite` (web, port 5173) and `tsx watch server/index.ts` (api, port 3000). Vite proxies `/api` → `:3000`.
- `bun build` — `vite build` → `web/dist`, then `tsc -p tsconfig.server.json` → `server/dist`.
- `bun start` — runs built server; serves `web/dist` as static files on a single port (default 3000).

---

## 8. Open questions

1. **Agent-per-cwd caching.** Is constructing a `GeminiCliAgent` per session creation cheap enough to skip caching? Measure once we have it running.
2. **Session-id pre-registration.** Confirm `.session({ sessionId })` accepts an id before the first `sendStream` without side effects on disk.
3. **Title auto-generation.** Use first user message as default title, or leave empty until the user sets one? Leaning: first ~40 chars of first message.
4. **Cwd validation.** When creating a session, should we verify the path exists and is a directory? Leaning: yes, return 400 otherwise. Don't require it to be a git repo.
5. **Abort semantics when browser tab closes.** Does `req.aborted` reliably fire on tab close? Belt-and-suspenders: add a heartbeat ping from the client and abort streams whose client hasn't pinged in N seconds.
6. **Markdown safety.** `marked` with default options renders raw HTML. Enable `marked` in "no raw HTML" mode (or run output through DOMPurify) — model output is untrusted content rendered in our origin.

---

## 9. Future work (explicitly out of scope for v0)

- Tool-call surface in the right pane (read diffs, approve `write_file`, show shell output).
- Skills loader (`options.skills`) so users can drop a skill directory and have it picked up.
- MCP server management UI.
- Image and file inputs.
- Multi-model / OpenAI-compatible backends (would require swapping to a fork like `@office-ai/aioncli-core`, which is why we're *not* building on that fork today).
- Export / share a session as a transcript.
