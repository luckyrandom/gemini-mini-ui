/**
 * Deterministic stand-in for GeminiCliSession used by Playwright tests.
 *
 * Activated by setting GEMINI_MINI_UI_FAKE=1. Yields a scripted sequence of
 * ServerGeminiStreamEvent-shaped objects so the web layer exercises the same
 * code paths (content streaming, tool_call_request/response, done) without
 * network or auth.
 */

import { randomUUID } from 'node:crypto';

import type { GeminiCliSession } from './vendor/gemini-cli-sdk/index.js';

type FakeEvent =
  | { type: 'content'; value: string }
  | { type: 'tool_call_request'; value: { callId: string; name: string; args: Record<string, unknown> } }
  | { type: 'tool_call_response'; value: { callId: string; resultDisplay: string; error?: undefined } };

function scriptFor(prompt: string): FakeEvent[] {
  const wantsTool = /\b(list|ls|files|dir)\b/i.test(prompt);
  const greeting = `You said: ${prompt}.\n\n`;
  if (wantsTool) {
    const callId = randomUUID();
    return [
      { type: 'content', value: 'Let me check.\n\n' },
      { type: 'tool_call_request', value: { callId, name: 'list_directory', args: { path: '.' } } },
      { type: 'tool_call_response', value: { callId, resultDisplay: 'README.md\npackage.json\nweb\nserver\n' } },
      { type: 'content', value: greeting },
      { type: 'content', value: 'Done.' },
    ];
  }
  return [
    { type: 'content', value: greeting },
    { type: 'content', value: 'This is a fake streaming response for tests.' },
  ];
}

export function makeFakeSession(_cwd: string, sessionId?: string): GeminiCliSession {
  const id = sessionId ?? randomUUID();
  const fake = {
    get id() {
      return id;
    },
    async initialize() {
      /* no-op */
    },
    async *sendStream(prompt: string, signal?: AbortSignal): AsyncGenerator<FakeEvent> {
      const events = scriptFor(prompt);
      for (const evt of events) {
        if (signal?.aborted) return;
        await new Promise((r) => setTimeout(r, 30));
        yield evt;
      }
    },
  };
  return fake as unknown as GeminiCliSession;
}
