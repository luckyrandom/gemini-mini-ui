# gemini-mini-ui — UI Design Doc

Companion to [DESIGN.md](DESIGN.md). This doc is for sketching with a UI engineer: layout, components, states, and interactions only. No backend details — see DESIGN.md §3–4 for API shapes.

---

## 1. Frame

Single-window desktop-style web app, full-viewport, no scrolling at the page level. Three columns, fixed header bar across the top.

```
┌──────────────────────────────────────────────────────────────┐
│  ▤  gemini-mini-ui            cwd: ~/code/widget       ⌬ ⚙  │  ← TopBar (40px)
├────────────┬───────────────────────────────────┬─────────────┤
│            │                                   │             │
│  Sessions  │            Chat                   │  Artifact   │
│  (260px)   │           (flex)                  │  (320px,    │
│            │                                   │   collapsed)│
│            │                                   │             │
│            │                                   │             │
│            ├───────────────────────────────────┤             │
│            │  [ textarea ............... ▶ ]  │             │
└────────────┴───────────────────────────────────┴─────────────┘
```

- Min window width: 900px. Below that, left pane collapses to an icon rail (56px) with a hover/click flyout.
- Resizable splitters between columns; positions persist in `localStorage`.
- Right pane is **collapsed by default**; toggle via ⌬ icon in TopBar.

---

## 2. TopBar

Height 40px. Left to right:

| Element | Behavior |
|---|---|
| ▤ Sidebar toggle | Collapses/expands left pane. |
| App title | `gemini-mini-ui` — static text, muted. |
| Active cwd | Truncated path of the current session's cwd, monospace, muted. Click → copy to clipboard, toast "copied". Empty when no session selected. |
| ⌬ Right-pane toggle | Disabled in v0 (right pane is placeholder), but visible. |
| ⚙ Settings | Opens a modal: theme (light/dark/system), font size, "open data dir" link. v0 minimal. |

---

## 3. Left pane — SessionList

### Header (sticky, 48px)
- **+ New session** — primary button, full-width minus padding. Opens "New session" modal (§6.1).
- Search field below (optional in v0; sketch as placeholder).

### List
Sessions sorted by `lastUsedAt` descending. Each row:

```
┌──────────────────────────────────────┐
│  Auth migration                  ⋯   │   ← title (bold, 14px)
│  ~/code/widget                       │   ← cwd basename + parent (muted, 12px, mono)
│  2h ago                              │   ← relative time (muted, 11px)
└──────────────────────────────────────┘
```

States:
- **Default**: transparent bg.
- **Hover**: subtle bg, ⋯ menu icon appears.
- **Active** (selected): accent-tinted bg, left border 2px accent.
- **Streaming**: small animated dot next to the title.

Row menu (⋯):
- Rename
- Reveal cwd in Finder/Explorer (calls a small backend endpoint, or just copies the path in v0)
- Delete (confirm modal — "Hide from list. Chat history stays on disk.")

Empty state: centered illustration + "No sessions yet. Create one to get started."

---

## 4. Center pane — Chat

### Message log (scrollable)
- Auto-scrolls to bottom on new content unless the user has scrolled up (then show a "Jump to latest ↓" pill).
- Top padding includes an optional session header card: title, cwd, created date. Sketched as a small banner that scrolls away with the log.

### Message bubble

Two roles: **user** and **assistant**. No avatars in v0; use alignment + label.

```
                                        ┌────────────────────────┐
                                        │ How do I add a route?  │
                                        └────────────────────────┘
                                                    you · 10:03

assistant · 10:03
┌──────────────────────────────────────────────────────┐
│ You can add a route by editing `routes.ts`:          │
│                                                      │
│   ```ts                                              │
│   app.get('/foo', handler)                           │
│   ```                                                │
│                                                      │
│ Then restart the dev server.                         │
└──────────────────────────────────────────────────────┘
                                              copy ⧉  regen ↻
```

- User bubbles: right-aligned, accent bg, max-width 70%.
- Assistant bubbles: left-aligned, surface bg, max-width 90%, Markdown rendered.
- Code blocks: monospace, syntax highlighted, copy button on hover.
- Hover footer on assistant bubble: copy markdown, copy plain text. (Regenerate = future.)

### Streaming state
- Assistant bubble appears immediately with a blinking caret while tokens stream in.
- A subtle "Stop" button replaces the send button in the composer (§4.2). Click → cancels via `/cancel`.

### Tool-call rows (v0: log-only)
Render as a thin one-line collapsed row between bubbles:

```
  ⚙ tool · read_file(path="src/app.ts")     ▾
```

Click expands a `<details>` to show args/result JSON. Reserved hook for the artifact pane later.

### Errors
Render inline as a red-tinted bubble with the error message + a "Retry" button (resends the last user message).

### Empty state
Centered: "Start the conversation. Messages stream in real time." + a couple of suggestion chips (e.g. "Summarize this repo", "List the files").

### Composer (sticky bottom, ~96px)

```
┌────────────────────────────────────────────────────────────┐
│  Message Gemini…                                       │   │  ← textarea (auto-grows 1–8 rows)
│                                                            │
├────────────────────────────────────────────────────────────┤
│  📎 (disabled v0)                          ⌘↵ to send  ▶  │  ← actions row
└────────────────────────────────────────────────────────────┘
```

- `Enter` = send. `Shift+Enter` = newline.
- Send button disabled when empty or when a stream is in flight (replaced with **■ Stop**).
- Character count appears only when >2k chars.
- Drag-and-drop affordance (visual only in v0; backend handling deferred).

---

## 5. Right pane — Artifact (placeholder)

v0 renders a centered empty state:

> **Nothing to show**
> Tool outputs, diffs, and previews will appear here.

Width 320px, hidden by default. When toggled open, animates in from the right (200ms ease).

Sketch the toggle and the panel frame so we don't have to redo layout when we wire artifacts later.

---

## 6. Modals

### 6.1 New session
Triggered from the **+ New session** button.

Fields:
- **Working directory** (required): text input + "Browse…" button. Browse opens a backend-mediated directory picker (or just paste a path in v0). Inline validation: "Path doesn't exist" / "Not a directory".
- **Title** (optional): defaults to "Untitled" → renamed to first 40 chars of first message after send.

Buttons: Cancel · Create. Create button disabled until cwd is valid.

### 6.2 Rename
Single text field, prefilled. Enter = save, Esc = cancel.

### 6.3 Delete confirmation
Title + body: "Hide *Auth migration* from the list. Your chat history files on disk are kept." Buttons: Cancel · Hide.

### 6.4 Settings
Vertical form:
- Theme: light · dark · system (radio).
- Font size: S · M · L.
- "Open data directory" — opens index file location.

---

## 7. Visual system

Sketch-time defaults (the engineer can refine):

- **Type**: system UI font for chrome (`-apple-system`, `Inter`); JetBrains Mono / SF Mono for code & paths.
- **Sizes**: 13px chrome, 14px body, 12px muted, 11px timestamps.
- **Spacing**: 4 / 8 / 12 / 16 / 24 grid.
- **Colors**: light + dark themes via CSS variables. Single accent color (sketch in `#4f46e5` or similar). Muted = 60% opacity of foreground.
- **Radius**: 8px for bubbles & cards, 6px for buttons, 4px for inputs.
- **Motion**: 150–200ms ease for hover, panel toggle; no entrance animations on bubbles (would fight the streaming caret).

---

## 8. State & interaction inventory

For the engineer's checklist while sketching:

| State | Where | Notes |
|---|---|---|
| No sessions | left pane | empty illustration |
| No active session | center pane | "Pick or create a session" |
| Idle session | center pane | empty-state with suggestions |
| Streaming | composer + bubble | Stop button, blinking caret |
| Stream error | inline bubble | Retry button |
| Cancelled | inline bubble | "Stopped." muted |
| 409 conflict (double-send) | toast | "A response is already streaming." |
| Backend offline | top banner | "Disconnected — retrying…" |
| Long path in TopBar | TopBar | middle-ellipsis truncate |
| Right pane open/closed | layout | persisted |
| Sidebar collapsed | layout | icon rail |

---

## 9. What's intentionally NOT in v0

So the engineer doesn't sketch them:

- Avatars / user identity
- Multi-tab or split chat views
- Inline tool approval UI
- Artifact rendering (diff viewer, file preview)
- File/image attachments (drop zone is visual-only)
- Markdown editor toolbar
- Search across messages
- Keyboard shortcut help overlay (nice-to-have, defer)

---

## 10. Sketch deliverables to ask for

1. **Wireframes** (low-fi): layout at 1440×900, 1024×768, 900×700.
2. **Hi-fi mock**: light + dark, default state with one active session and a streaming response.
3. **States**: empty session, error bubble, tool-call row collapsed/expanded, right-pane open.
4. **Modals**: New session, Settings.
5. **Component spec**: bubble, list row, composer — with paddings/colors annotated.
