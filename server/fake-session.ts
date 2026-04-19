/**
 * Deterministic stand-in for GeminiCliSession used by Playwright tests.
 *
 * Activated by setting GEMINI_MINI_UI_FAKE=1. Yields a scripted sequence of
 * ServerGeminiStreamEvent-shaped objects so the web layer exercises the same
 * code paths (content streaming, tool_call_request/response, done) without
 * network or auth.
 *
 * The fake also exposes a minimal `messageBus` compatible with
 * ApprovalBridge's narrow contract so the server can drive the approval
 * flow end-to-end in tests.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  MessageBusType,
  type Message,
  type ToolCallsUpdateMessage,
  type ToolConfirmationResponse,
} from '@google/gemini-cli-core';

import type { GeminiCliSession } from './vendor/gemini-cli-sdk/index.js';
import type { ApprovalBus } from './approvals.js';

type FakeEvent =
  | { type: 'content'; value: string }
  | { type: 'tool_call_request'; value: { callId: string; name: string; args: Record<string, unknown> } }
  | {
      type: 'tool_call_response';
      value: {
        callId: string;
        resultDisplay?: unknown;
        error?: { message: string };
      };
    }
  | { type: 'error'; value: { error: { message: string } } };

class FakeBus extends EventEmitter implements ApprovalBus {
  subscribe(
    type: MessageBusType.TOOL_CALLS_UPDATE,
    listener: (msg: ToolCallsUpdateMessage) => void,
  ): void {
    this.on(type, listener);
  }
  unsubscribe(
    type: MessageBusType.TOOL_CALLS_UPDATE,
    listener: (msg: ToolCallsUpdateMessage) => void,
  ): void {
    this.off(type, listener);
  }
  publish(message: Message): void {
    this.emit(message.type, message);
  }
}

function awaitResponse(
  bus: FakeBus,
  correlationId: string,
): Promise<ToolConfirmationResponse> {
  return new Promise((resolve) => {
    const listener = (msg: ToolConfirmationResponse): void => {
      if (msg.correlationId !== correlationId) return;
      bus.off(MessageBusType.TOOL_CONFIRMATION_RESPONSE, listener);
      resolve(msg);
    };
    bus.on(MessageBusType.TOOL_CONFIRMATION_RESPONSE, listener);
  });
}

/**
 * Emits a synthetic "awaiting_approval" TOOL_CALLS_UPDATE so the ApprovalBridge
 * picks it up and asks the UI. Returns when the user decides.
 */
async function askApproval(
  bus: FakeBus,
  call: {
    callId: string;
    name: string;
    args: Record<string, unknown>;
    details?: unknown;
  },
): Promise<'proceed' | 'cancel'> {
  const correlationId = randomUUID();
  const update = {
    type: MessageBusType.TOOL_CALLS_UPDATE,
    schedulerId: 'fake',
    toolCalls: [
      {
        status: 'awaiting_approval',
        request: {
          callId: call.callId,
          name: call.name,
          args: call.args,
          isClientInitiated: false,
          prompt_id: 'fake',
        },
        correlationId,
        confirmationDetails: call.details,
      },
    ],
  } as unknown as ToolCallsUpdateMessage;
  const waiter = awaitResponse(bus, correlationId);
  bus.publish(update);
  const response = await waiter;
  return response.confirmed ? 'proceed' : 'cancel';
}

function isWriteIsh(prompt: string): boolean {
  return /\b(write|edit|create|save|shell|run|mkdir|touch)\b/i.test(prompt);
}

function isListIsh(prompt: string): boolean {
  return /\b(list|ls|files|dir)\b/i.test(prompt);
}

export function makeFakeSession(_cwd: string, sessionId?: string): GeminiCliSession {
  const id = sessionId ?? randomUUID();
  const bus = new FakeBus();

  const fake = {
    get id() {
      return id;
    },
    get messageBus() {
      return bus;
    },
    async initialize() {
      /* no-op */
    },
    async *sendStream(
      prompt: string,
      signal?: AbortSignal,
    ): AsyncGenerator<FakeEvent> {
      const delay = (ms: number) =>
        new Promise<void>((r) => setTimeout(r, ms));

      // Test hook: prompts starting with "simulate-error:" yield a stream-level
      // error event so the client can exercise the typed-error bubble + retry.
      //   simulate-error:model  → model-kind error
      //   simulate-error:tool   → tool-kind error (message mentions "tool")
      const err = prompt.match(/^simulate-error:(model|tool)\s*(.*)$/i);
      if (err) {
        const kind = err[1]!.toLowerCase();
        const suffix = err[2]?.trim() ? ` (${err[2]!.trim()})` : '';
        const message =
          kind === 'tool'
            ? `tool failed: read_file denied${suffix}`
            : `model quota exhausted${suffix}`;
        if (signal?.aborted) return;
        await delay(30);
        yield { type: 'content', value: 'Thinking…' };
        if (signal?.aborted) return;
        await delay(30);
        yield { type: 'error', value: { error: { message } } };
        return;
      }

      if (isWriteIsh(prompt)) {
        const callId = randomUUID();
        yield { type: 'content', value: 'Proposing a write.\n\n' };
        yield {
          type: 'tool_call_request',
          value: {
            callId,
            name: 'write_file',
            args: { file_path: 'notes.txt', content: `From: ${prompt}\n` },
          },
        };

        const outcome = await askApproval(bus, {
          callId,
          name: 'write_file',
          args: { file_path: 'notes.txt', content: `From: ${prompt}\n` },
          details: {
            type: 'edit',
            title: 'Write notes.txt',
            fileName: 'notes.txt',
            filePath: 'notes.txt',
            fileDiff: `+ From: ${prompt}`,
            originalContent: null,
            newContent: `From: ${prompt}\n`,
          },
        });

        if (signal?.aborted) return;

        if (outcome === 'cancel') {
          yield {
            type: 'tool_call_response',
            value: {
              callId,
              error: { message: 'User cancelled the tool call.' },
            },
          };
          yield { type: 'content', value: 'Cancelled by user.' };
          return;
        }

        yield {
          type: 'tool_call_response',
          value: { callId, resultDisplay: 'Wrote notes.txt (1 line).' },
        };
        yield { type: 'content', value: 'Done writing.' };
        return;
      }

      if (isListIsh(prompt)) {
        const callId = randomUUID();
        yield { type: 'content', value: 'Let me check.\n\n' };
        await delay(30);
        yield {
          type: 'tool_call_request',
          value: { callId, name: 'list_directory', args: { path: '.' } },
        };
        await delay(30);
        yield {
          type: 'tool_call_response',
          value: {
            callId,
            resultDisplay: 'README.md\npackage.json\nweb\nserver\n',
          },
        };
        await delay(30);
        yield { type: 'content', value: `You said: ${prompt}.\n\n` };
        yield { type: 'content', value: 'Done.' };
        return;
      }

      yield { type: 'content', value: `You said: ${prompt}.\n\n` };
      await delay(30);
      yield { type: 'content', value: 'This is a fake streaming response for tests.' };
    },
  };
  return fake as unknown as GeminiCliSession;
}
