/**
 * PoC: ask Gemini "Why is the sky blue?" via the vendored gemini-cli SDK.
 *
 * Auth resolution:
 *   1. GEMINI_API_KEY      → USE_GEMINI
 *   2. ~/.gemini/oauth_creds.json present → LOGIN_WITH_GOOGLE (reuses `gemini` CLI login)
 *   3. otherwise SDK default (COMPUTE_ADC) — likely 500s without gcloud ADC
 *
 * We nudge the SDK toward the OAuth creds by setting GOOGLE_GENAI_USE_GCA=true
 * when we detect ~/.gemini/oauth_creds.json and no explicit GEMINI_API_KEY.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { GeminiCliAgent } from '../server/vendor/gemini-cli-sdk/index.js';

function resolveAuthMode(): string {
  if (process.env['GEMINI_API_KEY']) return 'USE_GEMINI (GEMINI_API_KEY)';
  if (process.env['GOOGLE_GENAI_USE_VERTEXAI'] === 'true') return 'USE_VERTEX_AI';

  const credsPath = join(homedir(), '.gemini', 'oauth_creds.json');
  if (existsSync(credsPath)) {
    process.env['GOOGLE_GENAI_USE_GCA'] = 'true';
    return `LOGIN_WITH_GOOGLE (${credsPath})`;
  }
  return 'COMPUTE_ADC (fallback)';
}

async function main() {
  const mode = resolveAuthMode();
  console.log(`[auth] ${mode}`);

  const agent = new GeminiCliAgent({
    instructions: 'You are a concise assistant. Answer in 3-4 sentences.',
  });
  const session = agent.session();

  const prompt = 'Why is the sky blue?';
  console.log(`[prompt] ${prompt}\n`);

  let sawContent = false;
  for await (const evt of session.sendStream(prompt)) {
    const type = (evt as { type?: string }).type ?? 'unknown';
    if (type === 'content') {
      const value = (evt as { value?: string }).value ?? '';
      process.stdout.write(value);
      sawContent = true;
    } else if (type === 'error') {
      console.error(`\n[error]`, JSON.stringify(evt, null, 2));
      process.exitCode = 1;
      return;
    }
  }

  if (sawContent) process.stdout.write('\n');
  console.log('\n[auth] ✓ confirmed — received content from Gemini');
}

main().catch((err) => {
  console.error('[auth] ✗ failed');
  console.error(err);
  process.exitCode = 1;
});
