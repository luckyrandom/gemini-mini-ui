# TODO

## Reliability

- [x] **Informative error messages.** Replace bare "Stream error / network error" with
      a typed error surface (network vs. model vs. tool) shown inline in the chat
      as a system bubble, with a retry affordance. Example of current bad UX:
      `assistant · 11:57 PM · Stream error · network error`.

## Safety

- [x] **Policy control for tool calls.** Approval gate before destructive/write tools
      execute. Minimum v1: prompt-per-call on write tools, no cross-turn memory of
      approvals. Future: per-session allowlists.

## Session management

- [x] **Fork chat to a new session.** Branch the current session into a new one at a
      chosen message; original stays untouched.
- [x] **Resend last turn with different model / context.** Mutates the current session
      in place — e.g. switch from Flash to Pro and regenerate. Distinct from fork.
- [ ] **Full page session management.** A button expand the session list to a full page, where user can manage all sessions. (search, filter, delete, etc.) Also, allow user to write brief notes on the session.

## Observability

- [x] **Debug panel / view.** Right-side drawer toggled from the session header.
      Shows request payload sent to the model, streamed response chunks, tool calls,
      and tool outputs for the current session.
- [x] **Merged-chunk mode in the debug drawer.** Add a toggle that coalesces
      consecutive `chunk` events into a single collapsed block of concatenated
      text, so a streamed assistant reply reads as one message instead of dozens
      of per-token rows. Raw per-chunk view remains available behind the toggle.
- [x] **Understand the debug output.** Figure out how the model answers "what is in the dir?" without a tool call. (Resolved: @google/gemini-cli-core auto-injects folder tree via getEnvironmentContext).

## UI & UX Improvement

- [x] **Make the panel resizable.** Sidebar and debug drawer can be dragged by their inner edges; widths persist in `localStorage` and restore on load; double-click the handle resets to defaults.
- [x] **Tool call indicator.** Add a small icon as indicator in the chat message when tool calls happen, while keeping the real tool call in the current display fashion.
- [x] **Add latex rendering.** e.g. output $$1 - \frac{1}{3} + \frac{1}{5} - \frac{1}{7} + \frac{1}{9} - \dots = \frac{\pi}{4}$$
- [x] **Add hotkey support.** ⌘↵ to send, enter to send (fixed leading issues), cmd + n for new session, cmd + shift + n for dir selector.
- [x] **Surface errors in the main UI.** Errors like quota exhaustion are now surfaced in the chat, not just the debug panel.

## Future Work / Planned Improvements

- [ ] **Approval improvement.**
    - It is not a good idea to ask for approval for each file edit.
    - When esc (rejected), it should not continue automatically. It should give the user a chance to specify what is the change they want to make, and then send it to the model again. (not simply reject)
- [ ] **Background session.** Is it supported? What happens when it needs attention (approval)? Notify when done?
