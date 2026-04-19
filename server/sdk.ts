/**
 * Single import point for the vendored gemini-cli SDK (see DESIGN.md §3.1.1).
 * Resolves auth and produces GeminiCliSession instances rooted at arbitrary cwds.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  GeminiCliAgent,
  type GeminiCliSession,
} from './vendor/gemini-cli-sdk/index.js';
import { makeFakeSession } from './fake-session.js';

let authResolved = false;

export function resolveAuthMode(): string {
  if (process.env['GEMINI_API_KEY']) return 'USE_GEMINI (GEMINI_API_KEY)';
  if (process.env['GOOGLE_GENAI_USE_VERTEXAI'] === 'true') return 'USE_VERTEX_AI';

  const credsPath = join(homedir(), '.gemini', 'oauth_creds.json');
  if (existsSync(credsPath)) {
    process.env['GOOGLE_GENAI_USE_GCA'] = 'true';
    return `LOGIN_WITH_GOOGLE (${credsPath})`;
  }
  return 'COMPUTE_ADC (fallback)';
}

export function ensureAuthResolved(): string {
  if (!authResolved) {
    const mode = resolveAuthMode();
    console.log(`[auth] ${mode}`);
    authResolved = true;
    return mode;
  }
  return '(already resolved)';
}

const INSTRUCTIONS =
  'You are a helpful assistant running inside gemini-mini-ui. Be concise.';

export function newSession(cwd: string, sessionId?: string): GeminiCliSession {
  if (process.env['GEMINI_MINI_UI_FAKE'] === '1') {
    return makeFakeSession(cwd, sessionId);
  }
  ensureAuthResolved();
  const agent = new GeminiCliAgent({ instructions: INSTRUCTIONS, cwd });
  return agent.session(sessionId ? { sessionId } : undefined);
}

/**
 * Rehydrate a session by id. If on-disk chat history exists, the SDK's
 * `resumeSession` replays it; otherwise we fall back to a fresh session bound
 * to the same id so the first message still writes under the expected file.
 */
export async function resumeSession(cwd: string, sessionId: string): Promise<GeminiCliSession> {
  if (process.env['GEMINI_MINI_UI_FAKE'] === '1') {
    return makeFakeSession(cwd, sessionId);
  }
  ensureAuthResolved();
  const agent = new GeminiCliAgent({ instructions: INSTRUCTIONS, cwd });
  try {
    return await agent.resumeSession(sessionId);
  } catch {
    return agent.session({ sessionId });
  }
}
