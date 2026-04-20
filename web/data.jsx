// API client + small helpers. Talks to the Node server over /api.
// Stream responses use application/x-ndjson; parsed line-by-line below.

const api = {
  async list() {
    const r = await fetch("/api/sessions");
    if (!r.ok) throw new Error(`list failed: ${r.status}`);
    return await r.json();
  },

  async get(id) {
    const r = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(`get failed: ${r.status}`);
    return await r.json();
  },

  async create({ cwd, title, model } = {}) {
    const r = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, title, model }),
    });
    if (!r.ok) throw new Error(`create failed: ${r.status}`);
    return await r.json();
  },

  async update(id, patch) {
    const r = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(`update failed: ${r.status}`);
    return await r.json();
  },

  async cancel(id) {
    await fetch(`/api/sessions/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  },

  async confirm(id, correlationId, outcome, feedback) {
    const r = await fetch(`/api/sessions/${encodeURIComponent(id)}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ correlationId, outcome, feedback }),
    });
    if (!r.ok && r.status !== 409 && r.status !== 404) {
      throw new Error(`confirm failed: ${r.status}`);
    }
  },

  async listDirs(q) {
    const r = await fetch(`/api/ls?q=${encodeURIComponent(q || "")}`);
    if (!r.ok) throw new Error(`ls failed: ${r.status}`);
    return await r.json();
  },

  async remove(id) {
    const r = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok && r.status !== 404) throw new Error(`delete failed: ${r.status}`);
  },

  async fork(id, { upToMessageId, title } = {}) {
    const r = await fetch(`/api/sessions/${encodeURIComponent(id)}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ upToMessageId, title }),
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`fork failed: ${r.status} ${body}`);
    }
    return await r.json();
  },

  async stream(id, text, onEvent, signal) {
    const r = await safeFetch(`/api/sessions/${encodeURIComponent(id)}/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    }, "stream");
    return consumeNdjson(r, onEvent, "stream");
  },

  async quota() {
    const r = await fetch("/api/quota");
    if (!r.ok) return { available: false, reason: "fetch-failed" };
    return await r.json();
  },

  async resend(id, { model } = {}, onEvent, signal) {
    const r = await safeFetch(`/api/sessions/${encodeURIComponent(id)}/resend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
      signal,
    }, "resend");
    return consumeNdjson(r, onEvent, "resend");
  },
};

// fetch() rejects for network-layer failures (DNS, offline, CORS, abort).
// Surface them as typed "network" errors so the UI can render a retry bubble.
async function safeFetch(url, init, label) {
  let r;
  try {
    r = await fetch(url, init);
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw streamError("network", err?.message || "Connection failed");
  }
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw streamError("network", `${label} failed: ${r.status}${body ? ` ${body}` : ""}`);
  }
  return r;
}

async function consumeNdjson(r, onEvent, _label) {
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try { onEvent(JSON.parse(line)); } catch (e) { console.warn("bad event", line, e); }
      }
    }
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw streamError("network", err?.message || "Connection dropped");
  }
  const last = buf.trim();
  if (last) { try { onEvent(JSON.parse(last)); } catch {} }
}

// Attach a kind so callers can render a typed error bubble.
function streamError(kind, message) {
  const e = new Error(message);
  e.kind = kind;
  return e;
}

const ERROR_KIND_LABEL = {
  network: "Network error",
  model: "Model error",
  tool: "Tool error",
};

function errorKindLabel(kind) {
  return ERROR_KIND_LABEL[kind] || "Error";
}

function nowTime() {
  return new Date().toISOString();
}

// "14:03" if today; "YYYY-MM-DD 14:03" otherwise.
function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const now = new Date();
  const hhmm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return hhmm;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day} ${hhmm}`;
}

// "3h 12m" / "42m" / "59s" — used for quota reset countdowns.
function formatResetIn(iso) {
  if (!iso) return "";
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return "";
  let secs = Math.max(0, Math.round((target - Date.now()) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function shortCwd(cwd) {
  const home = cwd.match(/^\/(Users|home)\/[^/]+/);
  if (home) return "~" + cwd.slice(home[0].length);
  return cwd;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// Models exposed by the Gemini CLI core SDK. The empty-value option means
// "server default" (currently PREVIEW_GEMINI_MODEL_AUTO).
const MODELS = [
  { value: "", short: "Auto", label: "Default (auto)" },
  { value: "auto-gemini-3", short: "Auto 3", label: "Auto · Gemini 3 preview" },
  { value: "auto-gemini-2.5", short: "Auto 2.5", label: "Auto · Gemini 2.5" },
  { value: "gemini-3-pro-preview", short: "3 Pro", label: "Gemini 3 Pro (preview)" },
  { value: "gemini-3-flash-preview", short: "3 Flash", label: "Gemini 3 Flash (preview)" },
  { value: "gemini-2.5-pro", short: "2.5 Pro", label: "Gemini 2.5 Pro" },
  { value: "gemini-2.5-flash", short: "2.5 Flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.5-flash-lite", short: "2.5 Flash Lite", label: "Gemini 2.5 Flash Lite" },
];

function modelLabel(value) {
  const m = MODELS.find((m) => m.value === (value || ""));
  return m ? m.label : value;
}

function modelShort(value) {
  const m = MODELS.find((m) => m.value === (value || ""));
  return m ? m.short : value;
}

Object.assign(window, { api, MODELS, modelLabel, modelShort, nowTime, formatTime, formatResetIn, shortCwd, uid, errorKindLabel });
