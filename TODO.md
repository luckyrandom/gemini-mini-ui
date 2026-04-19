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

- [ ] **Figure out how the model answers "what is in the dir?" without a tool call.**
      Observed with `gemini-3-flash-preview` on cwd `/Users/chenliangxu/green`: the
      reply listed real folders (`daily/`, `garden/`, `.obsidian/`, `skill/`, etc.)
      and files (`README.md`, `AGENTS.md`) accurately, but the debug drawer shows
      14 chunks over ~1.3s with no tool call recorded. Something is feeding the
      model directory context we aren't sending explicitly — check system prompt
      assembly, any implicit file/context attachments, and whether the server
      default is injecting cwd contents.

## Improve the UI

- [ ] This is confusing, becasue there is actually a tool call heppen in between. However, it is not desired to show the tool call bar in the chat message, as it may call many tools.
      Maybe, put a small icon as indicator in the chat message, while keep the real tool call in the current display fashion.

> I will add a paragraph about a Python "Hello World" program to the hello_world.md file.I have added a paragraph describing a Python "Hello World" program to the hello_world.md file.

## Add latex rendering

- [ ] e.g. out put $$1 - \frac{1}{3} + \frac{1}{5} - \frac{1}{7} + \frac{1}{9} - \dots = \frac{\pi}{4}$$

## Add hotkey support

- [ ] ⌘↵ to send is missing leading, enther to send
- [ ] cmd + n for new session in the same dir, cmd + shift + n for new session with dir selector
