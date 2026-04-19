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

  async create({ cwd, title } = {}) {
    const r = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, title }),
    });
    if (!r.ok) throw new Error(`create failed: ${r.status}`);
    return await r.json();
  },

  async cancel(id) {
    await fetch(`/api/sessions/${encodeURIComponent(id)}/cancel`, { method: "POST" });
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

  async remove(id) {
    const r = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok && r.status !== 404) throw new Error(`delete failed: ${r.status}`);
  },

  async stream(id, text, onEvent, signal) {
    const r = await fetch(`/api/sessions/${encodeURIComponent(id)}/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`stream failed: ${r.status} ${body}`);
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
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
    const last = buf.trim();
    if (last) { try { onEvent(JSON.parse(last)); } catch {} }
  },
};

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

function shortCwd(cwd) {
  const home = cwd.match(/^\/(Users|home)\/[^/]+/);
  if (home) return "~" + cwd.slice(home[0].length);
  return cwd;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

Object.assign(window, { api, nowTime, formatTime, shortCwd, uid });
