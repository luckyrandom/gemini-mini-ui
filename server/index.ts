/**
 * gemini-mini-ui server — static web + REST/NDJSON API over the vendored SDK.
 *
 * Endpoints:
 *   GET    /api/sessions                              → list in-memory sessions
 *   POST   /api/sessions        {cwd,title?,model?}   → create
 *   GET    /api/sessions/:id                          → record + history loaded from disk
 *   PATCH  /api/sessions/:id    {title?,model?}       → rename / change model
 *   DELETE /api/sessions/:id                          → abort + remove session
 *   POST   /api/sessions/:id/stream {text}            → NDJSON stream of SDK events
 *   POST   /api/sessions/:id/cancel                   → abort in-flight stream
 *   POST   /api/sessions/:id/fork {upToMessageId,title?} → branch history into a new session
 *   POST   /api/sessions/:id/resend {model?}          → rewind + regenerate the last assistant turn
 *   GET    /api/ls?q=<path>                           → directory autocomplete
 *
 * Static files under web/ are served at /. One process, one port.
 */

import { randomUUID } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir, platform } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';

import {
  Storage,
  loadConversationRecord,
  type MessageRecord,
} from '@google/gemini-cli-core';

import type { GeminiCliSession } from './vendor/gemini-cli-sdk/index.js';
import { resumeSession } from './sdk.js';
import { ApprovalBridge, type ApprovalOutcome } from './approvals.js';

type SessionRecord = {
  id: string;
  cwd: string;
  title: string;
  createdAt: string;
  lastUsedAt: string;
  model?: string;
};

type SessionSlot = {
  record: SessionRecord;
  session?: GeminiCliSession;
  abort?: AbortController;
  bridge?: ApprovalBridge;
};

const PORT = Number(process.env['PORT'] ?? 3000);
const WEB_ROOT = resolve(process.cwd(), 'web');
const sessions = new Map<string, SessionSlot>();

function defaultDataDir(): string {
  const override = process.env['GEMINI_MINI_UI_DATA_DIR'];
  if (override) return override;
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'gemini-mini-ui');
  }
  const xdg = process.env['XDG_DATA_HOME'];
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.local', 'share');
  return join(base, 'gemini-mini-ui');
}

const INDEX_PATH = join(defaultDataDir(), 'sessions.json');
const INDEX_VERSION = 1;

let writeChain: Promise<void> = Promise.resolve();
function saveIndex(): Promise<void> {
  const snapshot = [...sessions.values()].map((s) => s.record);
  writeChain = writeChain.then(async () => {
    const payload = JSON.stringify({ version: INDEX_VERSION, sessions: snapshot }, null, 2);
    await mkdir(dirname(INDEX_PATH), { recursive: true });
    const tmp = `${INDEX_PATH}.tmp`;
    await writeFile(tmp, payload, 'utf8');
    await rename(tmp, INDEX_PATH);
  }).catch((err) => {
    console.warn('[index] save failed', err);
  });
  return writeChain;
}

async function loadIndex(): Promise<void> {
  try {
    const raw = await readFile(INDEX_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { version?: number; sessions?: SessionRecord[] };
    for (const rec of parsed.sessions ?? []) {
      if (!rec.id || !rec.cwd) continue;
      sessions.set(rec.id, { record: rec });
    }
    console.log(`[index] loaded ${sessions.size} session(s) from ${INDEX_PATH}`);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') console.warn('[index] load failed', err);
  }
}

async function ensureLiveSession(slot: SessionSlot): Promise<GeminiCliSession> {
  if (slot.session) return slot.session;
  const { cwd, id, model } = slot.record;
  slot.session = await resumeSession(cwd, id, model);
  return slot.session;
}

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

function normalizeMessages(records: MessageRecord[]): UiMessage[] {
  const out: UiMessage[] = [];
  for (const m of records) {
    const t = m.timestamp;
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
          time: tc.timestamp,
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

async function loadConversationFor(
  cwd: string,
  sessionId: string,
): Promise<{
  record: Awaited<ReturnType<typeof loadConversationRecord>>;
  chatFile: string | null;
  storage: Storage;
}> {
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
      return { record: loaded, chatFile: abs, storage };
    }
  }
  return { record: null, chatFile: null, storage };
}

async function loadHistory(
  cwd: string,
  sessionId: string,
): Promise<{ messages: UiMessage[]; chatFile: string | null }> {
  try {
    const { record, chatFile } = await loadConversationFor(cwd, sessionId);
    if (record) return { messages: normalizeMessages(record.messages), chatFile };
  } catch (err) {
    console.warn('[history] load failed', err);
  }
  return { messages: [], chatFile: null };
}

async function getSession(id: string, res: ServerResponse): Promise<void> {
  const slot = sessions.get(id);
  if (!slot) return sendJson(res, 404, { error: 'session not found' });
  const { messages, chatFile } = await loadHistory(slot.record.cwd, slot.record.id);
  sendJson(res, 200, { record: slot.record, messages, chatFile });
}

function listSessions(res: ServerResponse): void {
  const list = [...sessions.values()].map((s) => s.record);
  list.sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : -1));
  sendJson(res, 200, list);
}

async function createSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (await readJson(req)) as { cwd?: string; title?: string; model?: string };
  let cwd = process.cwd();
  if (body.cwd && body.cwd.trim()) {
    cwd = resolve(expandHome(body.cwd.trim()));
    try {
      if (!statSync(cwd).isDirectory()) {
        sendJson(res, 400, { error: 'cwd is not a directory' });
        return;
      }
    } catch {
      sendJson(res, 400, { error: 'cwd does not exist' });
      return;
    }
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const model = body.model?.trim();
  const record: SessionRecord = {
    id,
    cwd,
    title: body.title?.trim() || 'Untitled',
    createdAt: now,
    lastUsedAt: now,
    ...(model ? { model } : {}),
  };
  sessions.set(record.id, { record });
  void saveIndex();
  sendJson(res, 201, record);
}

async function updateSession(
  id: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const slot = sessions.get(id);
  if (!slot) return sendJson(res, 404, { error: 'session not found' });
  const body = (await readJson(req)) as { title?: string; model?: string | null };
  let changed = false;
  if (typeof body.title === 'string') {
    slot.record.title = body.title.trim() || 'Untitled';
    changed = true;
  }
  if ('model' in body) {
    if (slot.abort) return sendJson(res, 409, { error: 'stream in flight' });
    const next = typeof body.model === 'string' ? body.model.trim() : '';
    if (next) slot.record.model = next;
    else delete slot.record.model;
    // drop the live session so the next stream picks up the new model
    slot.session = undefined;
    changed = true;
  }
  if (changed) void saveIndex();
  sendJson(res, 200, slot.record);
}

function deleteSession(id: string, res: ServerResponse): void {
  const slot = sessions.get(id);
  if (!slot) return sendJson(res, 404, { error: 'session not found' });
  slot.abort?.abort();
  sessions.delete(id);
  void saveIndex();
  res.writeHead(204).end();
}


type ErrorKind = 'network' | 'model' | 'tool';

function messageFromInlineError(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const v = value as { message?: unknown; error?: unknown };
  if (typeof v.message === 'string') return v.message;
  const inner = v.error;
  if (typeof inner === 'string') return inner;
  if (inner && typeof inner === 'object' && 'message' in inner) {
    const m = (inner as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return '';
}

function classifyMessage(message: string): ErrorKind {
  if (/\btool\b|scheduler|fatal tool|tool_call/i.test(message)) return 'tool';
  return 'model';
}

function classifyThrown(err: unknown): ErrorKind {
  const message = err instanceof Error ? err.message : String(err);
  return classifyMessage(message);
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

  let liveSession: GeminiCliSession;
  try {
    liveSession = await ensureLiveSession(slot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: `failed to resume session: ${message}` });
    return;
  }

  if (slot.record.title === 'Untitled') {
    slot.record.title = titleFromText(text, 'Untitled');
  }
  slot.record.lastUsedAt = new Date().toISOString();
  void saveIndex();

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

  const writeTypedError = (kind: ErrorKind, message: string): void => {
    write({ type: 'error', value: { kind, message: message || 'Unknown error' } });
  };

  // Bridge core's per-call approval requests into synthetic NDJSON events
  // so the browser can render a modal and post the user's decision back.
  const bridge = new ApprovalBridge(liveSession.messageBus, (evt) => write(evt));
  slot.bridge = bridge;

  try {
    try {
      const snap = await liveSession.getDebugSnapshot(text);
      write({ type: 'debug_request_raw', value: snap });
    } catch (err) {
      console.warn('[debug-raw] snapshot failed', err);
    }
    for await (const evt of liveSession.sendStream(text, abort.signal)) {
      if ((evt as { type?: unknown }).type === 'error') {
        const raw = messageFromInlineError((evt as { value?: unknown }).value);
        writeTypedError(classifyMessage(raw), raw);
      } else {
        write(evt);
      }
    }
    write({ type: 'done' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeTypedError(classifyThrown(err), message);
  } finally {
    await bridge.cancelAllPending();
    bridge.dispose();
    slot.bridge = undefined;
    slot.abort = undefined;
    res.end();
  }
}

async function confirmSession(
  id: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const slot = sessions.get(id);
  if (!slot) return sendJson(res, 404, { error: 'session not found' });
  const body = (await readJson(req)) as {
    correlationId?: string;
    outcome?: ApprovalOutcome;
  };
  const { correlationId, outcome } = body;
  if (!correlationId || (outcome !== 'proceed' && outcome !== 'cancel')) {
    return sendJson(res, 400, { error: 'correlationId and outcome required' });
  }
  const bridge = slot.bridge;
  if (!bridge) return sendJson(res, 409, { error: 'no pending approval' });
  if (!bridge.getPending(correlationId)) {
    return sendJson(res, 404, { error: 'no pending approval for correlationId' });
  }
  await bridge.resolve(correlationId, outcome);
  res.writeHead(204).end();
}

async function resendSession(
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

  const body = (await readJson(req)) as { model?: string | null };

  const { record: conv, chatFile } = await loadConversationFor(
    slot.record.cwd,
    slot.record.id,
  );
  if (!conv || !chatFile) {
    sendJson(res, 409, { error: 'no prior turn to resend' });
    return;
  }

  let lastUserIdx = -1;
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    if (conv.messages[i]?.type === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) {
    sendJson(res, 409, { error: 'no user turn to resend' });
    return;
  }
  const lastUser = conv.messages[lastUserIdx]!;
  const lastUserText = partsToText(lastUser.content);
  if (!lastUserText.trim()) {
    sendJson(res, 409, { error: 'last user message is empty' });
    return;
  }

  // Rewind the persisted chat so the SDK resumes to a state ending at the
  // turn *before* the last user message. The SDK's JSONL loader interprets
  // `$rewindTo` by dropping that message and everything after it.
  await appendFile(chatFile, JSON.stringify({ $rewindTo: lastUser.id }) + '\n');

  if ('model' in body) {
    const next = typeof body.model === 'string' ? body.model.trim() : '';
    if (next) slot.record.model = next;
    else delete slot.record.model;
  }
  // Force a fresh live session so the new model + rewound history take effect.
  slot.session = undefined;

  let liveSession: GeminiCliSession;
  try {
    liveSession = await ensureLiveSession(slot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: `failed to resume session: ${message}` });
    return;
  }

  slot.record.lastUsedAt = new Date().toISOString();
  void saveIndex();

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

  const writeTypedError = (kind: ErrorKind, message: string): void => {
    write({ type: 'error', value: { kind, message: message || 'Unknown error' } });
  };

  const bridge = new ApprovalBridge(liveSession.messageBus, (evt) => write(evt));
  slot.bridge = bridge;

  try {
    try {
      const snap = await liveSession.getDebugSnapshot(lastUserText);
      write({ type: 'debug_request_raw', value: snap });
    } catch (err) {
      console.warn('[debug-raw] snapshot failed', err);
    }
    for await (const evt of liveSession.sendStream(lastUserText, abort.signal)) {
      if ((evt as { type?: unknown }).type === 'error') {
        const raw = messageFromInlineError((evt as { value?: unknown }).value);
        writeTypedError(classifyMessage(raw), raw);
      } else {
        write(evt);
      }
    }
    write({ type: 'done' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeTypedError(classifyThrown(err), message);
  } finally {
    await bridge.cancelAllPending();
    bridge.dispose();
    slot.bridge = undefined;
    slot.abort = undefined;
    res.end();
  }
}

function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/')) return join(homedir(), p.slice(1));
  return p;
}

async function listDirs(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const q = (url.searchParams.get('q') ?? '').trim();
  let base: string;
  let prefix = '';
  if (!q) {
    base = homedir();
  } else {
    const expanded = expandHome(q);
    const abs = expanded.startsWith('/') ? expanded : resolve(process.cwd(), expanded);
    try {
      if (statSync(abs).isDirectory() && q.endsWith('/')) {
        base = abs;
      } else {
        base = dirname(abs);
        prefix = abs.slice(base.length + (base.endsWith('/') ? 0 : 1));
      }
    } catch {
      base = dirname(abs);
      prefix = abs.slice(base.length + (base.endsWith('/') ? 0 : 1));
    }
  }
  try {
    const entries = await readdir(base, { withFileTypes: true });
    const matches = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name.toLowerCase().startsWith(prefix.toLowerCase()))
      .map((e) => join(base, e.name))
      .sort()
      .slice(0, 20);
    sendJson(res, 200, { base, entries: matches });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 200, { base, entries: [], error: message });
  }
}

async function forkSession(
  sourceId: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const srcSlot = sessions.get(sourceId);
  if (!srcSlot) return sendJson(res, 404, { error: 'session not found' });

  const body = (await readJson(req)) as { upToMessageId?: string; title?: string };
  const upToId = body.upToMessageId?.trim();
  if (!upToId) return sendJson(res, 400, { error: 'upToMessageId required' });

  const { record: srcRecord, storage } = await loadConversationFor(
    srcSlot.record.cwd,
    srcSlot.record.id,
  );
  if (!srcRecord) {
    return sendJson(res, 409, { error: 'source session has no persisted history' });
  }

  // Tool-row ids are `${geminiMessageId}:${toolId}`; fold them onto the
  // parent record so the cut falls on the turn that owns the tool call.
  const rawTarget = upToId.includes(':') ? (upToId.split(':')[0] ?? upToId) : upToId;
  const cutIdx = srcRecord.messages.findIndex((m) => m.id === rawTarget);
  if (cutIdx < 0) return sendJson(res, 404, { error: 'message not found in source' });

  const slice = srcRecord.messages.slice(0, cutIdx + 1);

  const newId = randomUUID();
  const nowIso = new Date().toISOString();
  const chatsDir = join(storage.getProjectTempDir(), 'chats');
  await mkdir(chatsDir, { recursive: true });
  const stamp = nowIso.slice(0, 16).replace(/:/g, '-');
  const filename = `session-${stamp}-${newId.slice(0, 8)}.jsonl`;
  const absPath = join(chatsDir, filename);

  const metadata: Record<string, unknown> = {
    sessionId: newId,
    projectHash: srcRecord.projectHash,
    startTime: nowIso,
    lastUpdated: nowIso,
  };
  if (srcRecord.kind) metadata['kind'] = srcRecord.kind;
  if (srcRecord.directories) metadata['directories'] = srcRecord.directories;

  const lines = [JSON.stringify(metadata), ...slice.map((m) => JSON.stringify(m))];
  await writeFile(absPath, lines.join('\n') + '\n', 'utf8');

  const srcTitle = srcSlot.record.title || 'Untitled';
  const newRecord: SessionRecord = {
    id: newId,
    cwd: srcSlot.record.cwd,
    title: body.title?.trim() || `Fork of ${srcTitle}`,
    createdAt: nowIso,
    lastUsedAt: nowIso,
    ...(srcSlot.record.model ? { model: srcSlot.record.model } : {}),
  };
  sessions.set(newId, { record: newRecord });
  void saveIndex();

  sendJson(res, 201, { record: newRecord, chatFile: absPath });
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
    if (path === '/api/ls' && req.method === 'GET') return listDirs(req, res);

    const m = path.match(/^\/api\/sessions\/([^/]+)(\/stream|\/cancel|\/confirm|\/fork|\/resend)?$/);
    if (m) {
      const id = m[1]!;
      const sub = m[2];
      if (!sub && req.method === 'GET') return getSession(id, res);
      if (!sub && req.method === 'PATCH') return updateSession(id, req, res);
      if (!sub && req.method === 'DELETE') return deleteSession(id, res);
      if (sub === '/stream' && req.method === 'POST') return streamSession(id, req, res);
      if (sub === '/cancel' && req.method === 'POST') return cancelSession(id, res);
      if (sub === '/confirm' && req.method === 'POST') return confirmSession(id, req, res);
      if (sub === '/fork' && req.method === 'POST') return forkSession(id, req, res);
      if (sub === '/resend' && req.method === 'POST') return resendSession(id, req, res);
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) sendJson(res, 500, { error: message });
    else res.end();
  }
});

await loadIndex();

server.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}`);
  console.log(`[server] serving ${WEB_ROOT}`);
});
