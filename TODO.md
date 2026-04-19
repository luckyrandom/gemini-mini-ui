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

## Observability

- [x] **Debug panel / view.** Right-side drawer toggled from the session header.
      Shows request payload sent to the model, streamed response chunks, tool calls,
      and tool outputs for the current session.
- [x] **Merged-chunk mode in the debug drawer.** Add a toggle that coalesces
      consecutive `chunk` events into a single collapsed block of concatenated
      text, so a streamed assistant reply reads as one message instead of dozens
      of per-token rows. Raw per-chunk view remains available behind the toggle.

## Understand the debug output

- [x] **Figure out how the model answers "what is in the dir?" without a tool call.**
      Root cause: `@google/gemini-cli-core` auto-injects a folder tree via
      `getEnvironmentContext` on every turn (cwd, date, OS, directory listing).
      Now visible in the drawer's Request tab under *Env context*, alongside the
      system prompt, user memory, transcript, and current prompt.
