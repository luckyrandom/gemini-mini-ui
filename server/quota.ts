/**
 * /api/quota — surfaces gemini-cli's `/model` quota panel data.
 *
 * Backed by the internal cloudcode-pa endpoint that gemini-cli itself uses;
 * only works when the user is on Code Assist OAuth (LOGIN_WITH_GOOGLE).
 * For API-key / Vertex / ADC modes we return { available: false } so the
 * UI can hide the badge without a retry storm.
 */

import { type ServerResponse } from 'node:http';

import {
  AuthType,
  Config,
  PREVIEW_GEMINI_MODEL_AUTO,
} from '@google/gemini-cli-core';

import { ensureAuthResolved, getResolvedAuthType } from './sdk.js';

type QuotaBucket = {
  modelId: string;
  label: string;
  short: string;
  remainingFraction?: number;
  remainingAmount?: number;
  resetTime?: string;
};

type QuotaResponse =
  | { available: true; buckets: QuotaBucket[] }
  | { available: false; reason: 'auth-not-oauth' | 'fetch-failed'; message?: string };

const TRACKED_MODELS: Array<{ modelId: string; label: string; short: string }> = [
  { modelId: 'gemini-2.5-pro', label: 'Pro', short: 'P' },
  { modelId: 'gemini-2.5-flash', label: 'Flash', short: 'F' },
  { modelId: 'gemini-2.5-flash-lite', label: 'Flash Lite', short: 'L' },
];

let configPromise: Promise<Config> | null = null;

async function getQuotaConfig(): Promise<Config> {
  if (!configPromise) {
    configPromise = (async () => {
      const cwd = process.cwd();
      const config = new Config({
        sessionId: 'quota-probe',
        targetDir: cwd,
        cwd,
        debugMode: false,
        model: PREVIEW_GEMINI_MODEL_AUTO,
        enableHooks: false,
        mcpEnabled: false,
        extensionsEnabled: false,
        interactive: false,
      });
      await config.refreshAuth(AuthType.LOGIN_WITH_GOOGLE);
      await config.initialize();
      return config;
    })().catch((err) => {
      configPromise = null;
      throw err;
    });
  }
  return configPromise;
}

function sendJson(res: ServerResponse, status: number, body: QuotaResponse): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function getQuota(res: ServerResponse): Promise<void> {
  ensureAuthResolved();
  if (getResolvedAuthType() !== AuthType.LOGIN_WITH_GOOGLE) {
    return sendJson(res, 200, { available: false, reason: 'auth-not-oauth' });
  }
  try {
    const config = await getQuotaConfig();
    await config.refreshUserQuotaIfStale(60_000);
    const buckets: QuotaBucket[] = [];
    for (const { modelId, label, short } of TRACKED_MODELS) {
      const q = config.getRemainingQuotaForModel(modelId);
      if (!q) continue;
      buckets.push({
        modelId,
        label,
        short,
        ...(q.remainingFraction != null ? { remainingFraction: q.remainingFraction } : {}),
        ...(q.remainingAmount != null ? { remainingAmount: q.remainingAmount } : {}),
        ...(q.resetTime ? { resetTime: q.resetTime } : {}),
      });
    }
    return sendJson(res, 200, { available: true, buckets });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[quota] fetch failed', message);
    return sendJson(res, 200, { available: false, reason: 'fetch-failed', message });
  }
}
