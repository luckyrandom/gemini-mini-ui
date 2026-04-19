/**
 * gemini-mini-ui server — static web + REST/NDJSON API over the vendored SDK.
 *
 * Endpoints:
 *   GET    /api/sessions                     → list in-memory sessions
 *   POST   /api/sessions        {cwd,title?} → create
 *   GET    /api/sessions/:id                 → record + history loaded from disk
 *   POST   /api/sessions/:id/stream {text}   → NDJSON stream of SDK events
 *   POST   /api/sessions/:id/cancel          → abort in-flight stream
 *
 * Static files under web/ are served at /. One process, one port.
 */

import { randomUUID } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

import {
  Storage,
  loadConversationRecord,
  type MessageRecord,
} from '@google/gemini-cli-core';

import type { GeminiCliSession } from './vendor/gemini-cli-sdk/index.js';
import { newSession } from './sdk.js';

type SessionRecord = {
  id: string;
  cwd: string;
  title: string;
  createdAt: string;
  lastUsedAt: string;
};

type SessionSlot = {
  record: SessionRecord;
  session: GeminiCliSession;
  abort?: AbortController;
};

const PORT = Number(process.env['PORT'] ?? 3000);
const WEB_ROOT = resolve(process.cwd(), 'web');
const sessions = new Map<string, SessionSlot>();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jsx': 'text/babel; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
  });
  res.end(data);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function titleFromText(text: string, fallback: string): string {
  const t = text.trim().split('\n')[0]?.slice(0, 60) ?? '';
  return t || fallback;
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const urlPath = (req.url ?? '/').split('?')[0] ?? '/';
  const rel = urlPath === '/' ? '/app.html' : urlPath;
  const abs = normalize(join(WEB_ROOT, rel));
  if (!abs.startsWith(WEB_ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const st = statSync(abs);
    if (!st.isFile()) throw new Error('not a file');
    const mime = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, {
      'content-type': mime,
      'content-length': st.size,
      'cache-control': 'no-cache',
    });
    createReadStream(abs).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}

type UiMessage =
  | { id: string; role: 'user'; text: string; time: string }
  | { id: string; role: 'assistant'; text: string; time: string; error?: boolean }
  | {
      id: string;
      role: 'tool';
      name: string;
      args: Record<string, unknown>;
      result: unknown;
      time: string;
      startedAt?: number;
      duration?: number;
    };

function partsToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p && typeof p === 'object' && 'text' in p && typeof (p as { text: unknown }).text === 'string') {
          return (p as { text: string }).text;
        }
        return '';
      })
      .join('');
  }
  if (content && typeof content === 'object' && 'text' in content && typeof (content as { text: unknown }).text === 'string') {
    return (content as { text: string }).text;
  }
  return '';
}

function timeOf(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function normalizeMessages(records: MessageRecord[]): UiMessage[] {
  const out: UiMessage[] = [];
  for (const m of records) {
    const t = timeOf(m.timestamp);
    if (m.type === 'user') {
      out.push({ id: m.id, role: 'user', text: partsToText(m.content), time: t });
    } else if (m.type === 'gemini') {
      for (const tc of m.toolCalls ?? []) {
        out.push({
          id: `${m.id}:${tc.id}`,
          role: 'tool',
          name: tc.name,
          args: tc.args,
          result: tc.resultDisplay ?? tc.result ?? null,
          time: timeOf(tc.timestamp),
        });
      }
      const text = partsToText(m.content);
      if (text) out.push({ id: m.id, role: 'assistant', text, time: t });
    } else if (m.type === 'error' || m.type === 'warning') {
      out.push({ id: m.id, role: 'assistant', text: partsToText(m.content), time: t, error: true });
    }
  }
  return out;
}

async function loadHistory(cwd: string, sessionId: string): Promise<UiMessage[]> {
  try {
    const storage = new Storage(cwd);
    await storage.initialize();
    const files = await storage.listProjectChatFiles();
    const truncated = sessionId.slice(0, 8);
    const candidates = files.filter((f) => f.filePath.includes(truncated));
    const toCheck = candidates.length > 0 ? candidates : files;
    for (const f of toCheck) {
      const abs = join(storage.getProjectTempDir(), f.filePath);
      const loaded = await loadConversationRecord(abs);
      if (loaded && loaded.sessionId === sessionId) {
        return normalizeMessages(loaded.messages);
      }
    }
  } catch (err) {
    console.warn('[history] load failed', err);
  }
  return [];
}

async function getSession(id: string, res: ServerResponse): Promise<void> {
  const slot = sessions.get(id);
  if (!slot) return sendJson(res, 404, { error: 'session not found' });
  const messages = await loadHistory(slot.record.cwd, slot.record.id);
  sendJson(res, 200, { record: slot.record, messages });
}

function listSessions(res: ServerResponse): void {
  const list = [...sessions.values()].map((s) => s.record);
  list.sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : -1));
  sendJson(res, 200, list);
}

async function createSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (await readJson(req)) as { cwd?: string; title?: string };
  const cwd = body.cwd ? resolve(body.cwd) : process.cwd();
  const id = randomUUID();
  const session = newSession(cwd, id);
  const now = new Date().toISOString();
  const record: SessionRecord = {
    id: session.id,
    cwd,
    title: body.title?.trim() || 'Untitled',
    createdAt: now,
    lastUsedAt: now,
  };
  sessions.set(record.id, { record, session });
  sendJson(res, 201, record);
}

async function streamSession(
  id: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const slot = sessions.get(id);
  if (!slot) {
    sendJson(res, 404, { error: 'session not found' });
    return;
  }
  if (slot.abort) {
    sendJson(res, 409, { error: 'stream already in flight' });
    return;
  }
  const body = (await readJson(req)) as { text?: string };
  const text = (body.text ?? '').trim();
  if (!text) {
    sendJson(res, 400, { error: 'text required' });
    return;
  }

  if (slot.record.title === 'Untitled') {
    slot.record.title = titleFromText(text, 'Untitled');
  }
  slot.record.lastUsedAt = new Date().toISOString();

  const abort = new AbortController();
  slot.abort = abort;
  req.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });

  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache',
    'x-accel-buffering': 'no',
  });

  const write = (evt: unknown): void => {
    res.write(JSON.stringify(evt) + '\n');
  };

  try {
    for await (const evt of slot.session.sendStream(text, abort.signal)) {
      write(evt);
    }
    write({ type: 'done' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    write({ type: 'error', value: { message } });
  } finally {
    slot.abort = undefined;
    res.end();
  }
}

function cancelSession(id: string, res: ServerResponse): void {
  const slot = sessions.get(id);
  if (!slot) return sendJson(res, 404, { error: 'session not found' });
  slot.abort?.abort();
  res.writeHead(204).end();
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const path = url.pathname;

    if (!path.startsWith('/api/')) {
      serveStatic(req, res);
      return;
    }

    if (path === '/api/sessions' && req.method === 'GET') return listSessions(res);
    if (path === '/api/sessions' && req.method === 'POST') return createSession(req, res);

    const m = path.match(/^\/api\/sessions\/([^/]+)(\/stream|\/cancel)?$/);
    if (m) {
      const id = m[1]!;
      const sub = m[2];
      if (!sub && req.method === 'GET') return getSession(id, res);
      if (sub === '/stream' && req.method === 'POST') return streamSession(id, req, res);
      if (sub === '/cancel' && req.method === 'POST') return cancelSession(id, res);
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) sendJson(res, 500, { error: message });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}`);
  console.log(`[server] serving ${WEB_ROOT}`);
});
