function TopBar({ tweaks, setTweak, onToast, activeSession }) {
  const cwd = activeSession ? shortCwd(activeSession.cwd) : "(no session)";
  const copyCwd = () => {
    if (!activeSession) return;
    navigator.clipboard?.writeText(activeSession.cwd);
    onToast("Path copied");
  };
  return (
    <header className="topbar">
      <button
        className="icon-btn"
        onClick={() => setTweak("sidebarCollapsed", !tweaks.sidebarCollapsed)}
        title="Toggle sidebar"
      >
        <SidebarIcon size={15} />
      </button>
      <div className="title">
        <span className="mark">
          <span className="glyph" />
          <span>gemini-mini-ui</span>
        </span>
      </div>
      <button className="cwd" onClick={copyCwd} title="Click to copy">
        <span className="lbl">cwd:</span>{cwd}
      </button>
      <div className="spacer" />
      <button
        className={"icon-btn" + (tweaks.rightPaneOpen ? " active" : "")}
        onClick={() => setTweak("rightPaneOpen", !tweaks.rightPaneOpen)}
        title="Toggle artifact pane"
      >
        <PanelRightIcon size={15} />
      </button>
      <button className="icon-btn" title="Settings">
        <GearIcon size={15} />
      </button>
    </header>
  );
}

function DirGroup({ cwd, items, activeId, streamingId, onSelect, onRename, onDelete }) {
  const [collapsed, setCollapsed] = React.useState(false);
  return (
    <div className="dir-group">
      <button
        className="dir-head"
        onClick={() => setCollapsed(!collapsed)}
        data-collapsed={collapsed}
        title={cwd}
      >
        <span className="dir-caret"><ChevronDownIcon size={11} /></span>
        <span className="dir-path">{cwd}</span>
        <span className="dir-count">{items.length}</span>
      </button>
      {!collapsed && (
        <div className="dir-items">
          {items.map((s) => (
            <SessionRow
              key={s.id}
              s={s}
              active={s.id === activeId}
              streaming={s.id === streamingId}
              onClick={() => onSelect(s.id)}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionRow({ s, active, streaming, onClick, onRename, onDelete }) {
  const relLast = relativeTime(s.lastUsedAt);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(s.title || "");
  const wrapRef = React.useRef(null);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  React.useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  const startRename = (e) => {
    e?.stopPropagation();
    setMenuOpen(false);
    setDraft(s.title || "");
    setEditing(true);
  };
  const commitRename = () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === (s.title || "")) return;
    onRename?.(s.id, trimmed);
  };
  const cancelRename = () => {
    setEditing(false);
    setDraft(s.title || "");
  };
  const handleDelete = (e) => {
    e.stopPropagation();
    setMenuOpen(false);
    if (!window.confirm(`Delete "${s.title || 'Untitled'}"?`)) return;
    onDelete?.(s.id);
  };

  return (
    <div
      className={"session-row" + (active ? " active" : "") + (editing ? " editing" : "")}
      onClick={editing ? undefined : onClick}
      onDoubleClick={editing ? undefined : startRename}
    >
      <div className="title">
        {streaming && <span className="streaming-dot" />}
        {editing ? (
          <input
            ref={inputRef}
            className="title-edit"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitRename(); }
              else if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
            }}
            onBlur={commitRename}
            spellCheck={false}
          />
        ) : (
          <span className="title-text">{s.title || "Untitled"}</span>
        )}
      </div>
      <div className="meta">{relLast}</div>
      {!editing && (
        <div className="row-menu-wrap" ref={wrapRef}>
          <button
            className="row-menu"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            title="More"
            aria-label="More actions"
          >
            <MoreIcon />
          </button>
          {menuOpen && (
            <div className="row-menu-pop" role="menu" onClick={(e) => e.stopPropagation()}>
              <button type="button" role="menuitem" onClick={startRename}>Rename</button>
              <button type="button" role="menuitem" className="danger" onClick={handleDelete}>Delete</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function relativeTime(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const s = Math.floor(diff / 1000);
  if (s < 45) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  return `${w}w ago`;
}

function groupByDir(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const key = shortCwd(s.cwd);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  const groups = [];
  for (const [cwd, items] of map) {
    items.sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : -1));
    const mostRecent = items[0]?.lastUsedAt || "";
    groups.push({ cwd, items, mostRecent });
  }
  groups.sort((a, b) => (a.mostRecent < b.mostRecent ? 1 : -1));
  return groups;
}

function Sidebar({ collapsed, sessions, activeId, streamingId, onSelect, onNew, onRename, onDelete }) {
  if (collapsed) {
    return (
      <div className="pane sidebar">
        <div className="rail">
          <button className="rail-item" title="New session" onClick={onNew}>
            <PlusIcon size={14} />
          </button>
          <div className="divider" />
          {sessions.slice(0, 8).map((s) => (
            <button
              key={s.id}
              className={"rail-item" + (s.id === activeId ? " active" : "")}
              title={s.title}
              onClick={() => onSelect(s.id)}
            >
              <MessagesIcon size={14} />
              {s.id === streamingId && <span className="dot" />}
            </button>
          ))}
        </div>
      </div>
    );
  }
  const groups = groupByDir(sessions);
  return (
    <div className="pane sidebar">
      <div className="sidebar-head">
        <button className="new-btn" onClick={onNew}><PlusIcon size={12} /> New session</button>
        <div className="search">
          <span className="search-icon"><SearchIcon /></span>
          <input placeholder="Search sessions…" />
        </div>
      </div>
      <div className="session-list">
        {groups.length === 0 && (
          <div style={{ padding: "12px 10px", color: "var(--fg-dim)", fontSize: 12 }}>
            No sessions yet.
          </div>
        )}
        {groups.length > 0 && <div className="sec-label">Recent</div>}
        {groups.map((g) => (
          <DirGroup
            key={g.cwd}
            cwd={g.cwd}
            items={g.items}
            activeId={activeId}
            streamingId={streamingId}
            onSelect={onSelect}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}

function UserBubble({ m }) {
  return (
    <div className="msg user">
      <div className="label">
        <span className="role">you</span>
        <span>·</span>
        <span title={m.time}>{formatTime(m.time)}</span>
      </div>
      <div className="bubble">{m.text}</div>
    </div>
  );
}

function AssistantBubble({ m, streaming }) {
  const text = m.text || "";
  return (
    <div className="msg assistant">
      <div className="label">
        <span className="role">assistant</span>
        <span>·</span>
        <span title={m.time}>{formatTime(m.time)}</span>
        {streaming && <span style={{ color: "var(--accent)" }}>streaming…</span>}
      </div>
      <div className="bubble">
        {text ? <Markdown text={text} /> : (streaming ? <span style={{ color: "var(--fg-muted)" }}>Thinking…</span> : null)}
        {streaming && (
          <div className="streaming-line" style={{ marginTop: 2, padding: "2px 4px", borderRadius: 3, display: "inline-block" }}>
            <span style={{ color: "var(--fg-muted)" }}>Generating</span>
            <span className="caret" />
          </div>
        )}
      </div>
      {!streaming && text && (
        <div className="footer">
          <button onClick={() => navigator.clipboard?.writeText(`[${formatTime(m.time)}] assistant\n\n${text}`)}><CopyIcon /> copy</button>
        </div>
      )}
    </div>
  );
}

function ErrorBubble({ m }) {
  return (
    <div className="msg assistant">
      <div className="label">
        <span className="role" style={{ color: "var(--danger)" }}>assistant</span>
        <span>·</span>
        <span title={m.time}>{formatTime(m.time)}</span>
      </div>
      <div className="bubble error">
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <span style={{ color: "var(--danger)", marginTop: 2 }}><AlertIcon size={13} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ color: "var(--danger)", fontWeight: 600, marginBottom: 2, fontSize: 12 }}>Stream error</div>
            <div style={{ color: "var(--fg)", fontSize: 12.5 }}>{m.text}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolCallRow({ m, defaultOpen }) {
  const [open, setOpen] = React.useState(defaultOpen);
  React.useEffect(() => setOpen(defaultOpen), [defaultOpen]);

  const argsStr = safeStringify(m.args);
  const duration = m.duration && m.startedAt ? `${m.duration - m.startedAt}ms` : (m.result == null ? "…" : "");
  const inlineArg = pickInlineArg(m.args);
  const resultView = renderResult(m.result, m.name);
  const usesOwnContainer = React.isValidElement(resultView) && (
    resultView.type === FileDiffView ||
    resultView.type === ShellResultView ||
    resultView.type === CollapsibleText
  );

  return (
    <div className="tool-call" data-open={open}>
      <div className="tc-head" onClick={() => setOpen(!open)}>
        <span className="caret-icon"><ChevronRightIcon /></span>
        <span className="badge">tool</span>
        <ToolIcon />
        <span className="tool-name">{m.name}</span>
        {inlineArg && (
          <>
            <span style={{ color: "var(--fg-dim)" }}>(</span>
            <span className="tok-key">{inlineArg.key}</span>
            <span className="tok-pun">=</span>
            <span className="tok-str">"{inlineArg.val}"</span>
            <span style={{ color: "var(--fg-dim)" }}>)</span>
          </>
        )}
        <span className="duration">{duration}</span>
      </div>
      {open && (
        <div className="tc-body">
          <div>
            <div className="sec-h">args</div>
            <pre>{highlight(argsStr, "json")}</pre>
          </div>
          <div>
            <div className="sec-h">result</div>
            {usesOwnContainer ? resultView : <pre>{resultView}</pre>}
          </div>
        </div>
      )}
    </div>
  );
}

function safeStringify(v) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

const COLLAPSE_LINE_THRESHOLD = 30;

function renderResult(result, toolName) {
  if (result == null) return "running…";
  if (typeof result === "string") return renderStringResult(result, toolName);
  if (typeof result === "object" && result && typeof result.error === "string") {
    return <span style={{ color: "var(--danger)" }}>{result.error}</span>;
  }
  // write_file / replace tools: render the unified diff with a header.
  if (typeof result === "object" && result && typeof result.fileDiff === "string") {
    return <FileDiffView result={result} />;
  }
  // resultDisplay may come as { text, ... } or a plain structured object
  if (typeof result === "object" && result && typeof result.text === "string" && Object.keys(result).length <= 2) {
    return renderStringResult(result.text, toolName);
  }
  return highlight(safeStringify(result), "json");
}

function renderStringResult(text, toolName) {
  if (!text) return <span className="result-empty">(no output)</span>;
  // run_shell_command results follow "Output: ...\nExit Code: N\n..."
  if (toolName === "run_shell_command" && /(^|\n)(Output:|Exit Code:)/.test(text)) {
    return <ShellResultView text={text} />;
  }
  const lines = text.split("\n");
  if (lines.length > COLLAPSE_LINE_THRESHOLD) {
    return <CollapsibleText text={text} lines={lines} />;
  }
  return text;
}

function ShellResultView({ text }) {
  // Parse the loose key/value structure shell.js produces. Anything that
  // doesn't match a known label gets folded into the previous section so we
  // never lose data.
  const sections = { output: "", error: "", exitCode: null, signal: null, extras: [] };
  const lines = text.split("\n");
  let cur = "output";
  for (const line of lines) {
    const m = line.match(/^(Output|Error|Exit Code|Signal|Background PIDs|Process Group PGID):\s?(.*)$/);
    if (m) {
      const [, label, val] = m;
      if (label === "Output") { cur = "output"; sections.output = val; }
      else if (label === "Error") { cur = "error"; sections.error = val; }
      else if (label === "Exit Code") { cur = "exit"; sections.exitCode = val.trim(); }
      else if (label === "Signal") { cur = "extras"; sections.signal = val.trim(); }
      else { cur = "extras"; sections.extras.push(`${label}: ${val}`); }
    } else {
      if (cur === "output") sections.output += (sections.output ? "\n" : "") + line;
      else if (cur === "error") sections.error += (sections.error ? "\n" : "") + line;
      else sections.extras.push(line);
    }
  }
  const exit = sections.exitCode;
  const exitNum = exit != null ? Number(exit) : null;
  const exitClass = exitNum === 0 ? "shell-exit ok" : (exitNum != null ? "shell-exit fail" : "shell-exit");
  return (
    <div className="shell-result">
      <div className="shell-head">
        <span className="shell-label">stdout</span>
        {exit != null && <span className={exitClass}>exit {exit}</span>}
        {sections.signal && <span className="shell-exit fail">signal {sections.signal}</span>}
      </div>
      <pre className="shell-body">{sections.output || <span className="result-empty">(no output)</span>}</pre>
      {sections.error && (
        <>
          <div className="shell-head"><span className="shell-label err">stderr</span></div>
          <pre className="shell-body err">{sections.error}</pre>
        </>
      )}
      {sections.extras.length > 0 && (
        <pre className="shell-extras">{sections.extras.join("\n")}</pre>
      )}
    </div>
  );
}

function CollapsibleText({ text, lines }) {
  const [expanded, setExpanded] = React.useState(false);
  if (expanded) {
    return (
      <div className="collapsible">
        <pre className="collapsible-body">{text}</pre>
        <button type="button" className="collapsible-toggle" onClick={() => setExpanded(false)}>
          show less
        </button>
      </div>
    );
  }
  const head = lines.slice(0, COLLAPSE_LINE_THRESHOLD).join("\n");
  const remaining = lines.length - COLLAPSE_LINE_THRESHOLD;
  return (
    <div className="collapsible">
      <pre className="collapsible-body">{head}</pre>
      <button type="button" className="collapsible-toggle" onClick={() => setExpanded(true)}>
        show all ({remaining} more line{remaining === 1 ? "" : "s"})
      </button>
    </div>
  );
}

function FileDiffView({ result }) {
  const [raw, setRaw] = React.useState(false);
  const lines = String(result.fileDiff).split("\n");
  const path = result.filePath || result.fileName || "";
  const stat = result.diffStat;
  return (
    <div className="file-diff">
      <div className="fd-head">
        <span className="fd-path">{path}</span>
        {stat && (
          <span className="fd-stat">
            {result.isNewFile && <span className="fd-new">new</span>}
            <span className="fd-add">+{stat.model_added_lines ?? 0}</span>
            <span className="fd-del">−{stat.model_removed_lines ?? 0}</span>
          </span>
        )}
        <div className="fd-toggle" role="tablist">
          <button
            type="button"
            className={"fd-toggle-btn" + (!raw ? " active" : "")}
            onClick={() => setRaw(false)}
            role="tab"
            aria-selected={!raw}
          >diff</button>
          <button
            type="button"
            className={"fd-toggle-btn" + (raw ? " active" : "")}
            onClick={() => setRaw(true)}
            role="tab"
            aria-selected={raw}
          >raw</button>
        </div>
      </div>
      {raw ? (
        <pre className="fd-raw">{highlight(safeStringify(result), "json")}</pre>
      ) : (
        <div className="fd-body">
          {lines.map((line, i) => {
            // Skip diff metadata lines (Index:, ===, ---, +++, @@) — noisy
            if (
              line.startsWith("Index:") ||
              line.startsWith("===") ||
              line.startsWith("--- ") ||
              line.startsWith("+++ ") ||
              line.startsWith("@@")
            ) return null;
            const cls = line.startsWith("+") ? "fd-line fd-add-line"
              : line.startsWith("-") ? "fd-line fd-del-line"
              : "fd-line";
            return <div key={i} className={cls}>{line || "\u00A0"}</div>;
          })}
        </div>
      )}
    </div>
  );
}

function pickInlineArg(args) {
  if (!args || typeof args !== "object") return null;
  const prefer = ["path", "file", "file_path", "command", "query", "pattern", "url"];
  for (const k of prefer) {
    if (typeof args[k] === "string" && args[k].length < 80) return { key: k, val: args[k] };
  }
  const firstKey = Object.keys(args)[0];
  if (firstKey && typeof args[firstKey] === "string" && args[firstKey].length < 80) {
    return { key: firstKey, val: args[firstKey] };
  }
  return null;
}

function ChatHeader({ session, chatFile, onToast, debugOpen, onToggleDebug, debugCount }) {
  const [showInfo, setShowInfo] = React.useState(false);
  const wrapRef = React.useRef(null);
  React.useEffect(() => {
    if (!showInfo) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowInfo(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [showInfo]);

  if (!session) {
    return <div className="chat-header"><div className="h-title">No session</div></div>;
  }
  const created = new Date(session.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const copyPath = async () => {
    if (!chatFile) return;
    try {
      await navigator.clipboard.writeText(chatFile);
      onToast?.("Path copied");
    } catch {
      onToast?.("Copy failed");
    }
  };
  return (
    <div className="chat-header">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="h-title">{session.title || "Untitled"}</div>
        <div className="h-meta" style={{ marginTop: 2 }}>
          <span>{shortCwd(session.cwd)}</span>
          <span className="dot" />
          <span>created {created}</span>
        </div>
      </div>
      {onToggleDebug && (
        <button
          className="h-info-btn"
          title={debugOpen ? "Hide debug drawer" : `Show debug drawer${debugCount ? ` (${debugCount} events)` : ""}`}
          aria-label="Toggle debug drawer"
          aria-pressed={!!debugOpen}
          onClick={onToggleDebug}
          style={{
            position: "relative",
            ...(debugOpen ? { background: "var(--bg-elev-2)", color: "var(--fg)", borderColor: "var(--border)" } : null),
          }}
        >
          <BugIcon size={14} />
          {debugCount > 0 && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--accent)",
              }}
            />
          )}
        </button>
      )}
      <div className="h-info-wrap" ref={wrapRef}>
        <button
          className="h-info-btn"
          title="Session info"
          aria-label="Session info"
          onClick={() => setShowInfo((v) => !v)}
        >
          <InfoIcon size={14} />
        </button>
        {showInfo && (
          <div className="h-info-pop" role="dialog">
            <div className="h-info-label">Chat session file</div>
            {chatFile ? (
              <>
                <div className="h-info-path" title={chatFile}>{chatFile}</div>
                <button className="h-info-copy" onClick={copyPath}>
                  <CopyIcon size={11} /> Copy path
                </button>
              </>
            ) : (
              <div className="h-info-empty">
                No chat file yet — send a message to create one.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ModelPicker({ value, onChange, disabled }) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const current = value || "";
  return (
    <div className="model-picker" ref={wrapRef}>
      <button
        type="button"
        className="model-btn"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={`Model: ${modelLabel(current)}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="model-btn-text">{modelShort(current)}</span>
        <ChevronDownIcon size={10} />
      </button>
      {open && (
        <div className="model-pop" role="listbox">
          {MODELS.map((m) => {
            const on = m.value === current;
            return (
              <button
                type="button"
                key={m.value || "__default"}
                className={"model-opt" + (on ? " on" : "")}
                role="option"
                aria-selected={on}
                onClick={() => { onChange?.(m.value); setOpen(false); }}
              >
                <span>{m.label}</span>
                {on && (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Composer({ streaming, onSend, onStop, model, onModelChange }) {
  const [val, setVal] = React.useState("");
  const ref = React.useRef(null);
  const autosize = () => {
    const el = ref.current; if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(180, Math.max(38, el.scrollHeight)) + "px";
  };
  React.useEffect(autosize, [val]);
  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (val.trim() && !streaming) { onSend(val); setVal(""); }
    }
  };
  const canSend = val.trim().length > 0 && !streaming;
  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          ref={ref}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Message Gemini…"
          rows={1}
        />
        <div className="composer-actions">
          <div className="left">
            <button className="icon-btn" disabled title="Attachments (coming soon)">
              <PaperclipIcon />
            </button>
            <ModelPicker
              value={model}
              onChange={onModelChange}
              disabled={streaming || !onModelChange}
            />
          </div>
          <div className="hint">
            {val.length > 2000 && (
              <span style={{ marginRight: 10, color: val.length > 4000 ? "var(--danger)" : "var(--fg-muted)" }}>
                {val.length.toLocaleString()} chars
              </span>
            )}
            <span className="kbd">⌘</span><span className="kbd">↵</span> <span style={{ opacity: 0.7 }}>to send</span>
          </div>
          {streaming ? (
            <button className="send-btn stop" onClick={onStop} title="Stop generating">
              <StopIcon size={11} />
            </button>
          ) : (
            <button className="send-btn" onClick={() => { if (canSend) { onSend(val); setVal(""); } }} disabled={!canSend} title="Send">
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const DEBUG_EVENT_LABELS = {
  request: "request",
  chunk: "chunk",
  chunk_group: "chunks",
  tool_request: "tool →",
  tool_response: "tool ←",
  stream_error: "error",
  stream_exception: "exception",
  cancelled: "cancelled",
  done: "done",
};

const CHUNK_GROUP_SUMMARY_CHARS = 140;

function mergeChunkRuns(events) {
  const out = [];
  let run = null;
  for (const evt of events) {
    if (evt.kind === "chunk") {
      const chunk = typeof evt.data?.value === "string"
        ? evt.data.value
        : String(evt.data?.value ?? "");
      if (run) {
        run.data.text += chunk;
        run.data.chunkCount += 1;
        run.data.lastAt = evt.at;
      } else {
        run = {
          id: evt.id,
          at: evt.at,
          kind: "chunk_group",
          data: { text: chunk, chunkCount: 1, firstAt: evt.at, lastAt: evt.at },
        };
      }
    } else {
      if (run) { out.push(run); run = null; }
      out.push(evt);
    }
  }
  if (run) out.push(run);
  return out;
}

function summarizeDebugEvent(evt) {
  const d = evt.data || {};
  if (evt.kind === "request") {
    const text = typeof d.text === "string" ? d.text : "";
    const model = d.model ? `  [${d.model}]` : "";
    return `${text.slice(0, 140)}${text.length > 140 ? "…" : ""}${model}`;
  }
  if (evt.kind === "chunk") {
    const text = typeof d.value === "string" ? d.value : String(d.value ?? "");
    return JSON.stringify(text).slice(0, 160);
  }
  if (evt.kind === "chunk_group") {
    const text = typeof d.text === "string" ? d.text : "";
    const preview = text.slice(0, CHUNK_GROUP_SUMMARY_CHARS);
    const ell = text.length > CHUNK_GROUP_SUMMARY_CHARS ? "…" : "";
    const count = d.chunkCount || 0;
    return `(${count} chunk${count === 1 ? "" : "s"}) ${JSON.stringify(preview)}${ell}`;
  }
  if (evt.kind === "tool_request") {
    const args = d.args ? safeStringify(d.args).replace(/\s+/g, " ").slice(0, 120) : "";
    return `${d.name || "(unnamed)"}  ${args}`;
  }
  if (evt.kind === "tool_response") {
    if (d.error) return `error: ${typeof d.error === "string" ? d.error : safeStringify(d.error)}`;
    const body = d.resultDisplay ?? d.responseParts ?? d;
    const preview = typeof body === "string" ? body : safeStringify(body);
    return preview.replace(/\s+/g, " ").slice(0, 160);
  }
  if (evt.kind === "stream_error" || evt.kind === "stream_exception") {
    return typeof d.message === "string" ? d.message : safeStringify(d);
  }
  if (evt.kind === "cancelled") return "user cancelled";
  if (evt.kind === "done") return "stream complete";
  return safeStringify(d).slice(0, 160);
}

function formatDebugTime(at) {
  if (!at) return "";
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function DebugEventRow({ evt }) {
  const [open, setOpen] = React.useState(false);
  const label = DEBUG_EVENT_LABELS[evt.kind] || evt.kind;
  const summary = summarizeDebugEvent(evt);
  return (
    <div className="dd-event" data-open={open} data-kind={evt.kind}>
      <div className="dd-evt-head" onClick={() => setOpen((v) => !v)}>
        <span className="dd-evt-caret"><ChevronRightIcon size={10} /></span>
        <span className="dd-evt-kind">{label}</span>
        <span className="dd-evt-summary" title={summary}>{summary || "—"}</span>
        <span className="dd-evt-time">{formatDebugTime(evt.at)}</span>
      </div>
      {open && (
        <div className="dd-evt-body">
          {evt.kind === "chunk_group"
            ? <ChunkGroupBody data={evt.data} />
            : <pre>{safeStringify(evt.data)}</pre>}
        </div>
      )}
    </div>
  );
}

function ChunkGroupBody({ data }) {
  const count = data?.chunkCount || 0;
  const firstAt = data?.firstAt;
  const lastAt = data?.lastAt;
  const span = (firstAt != null && lastAt != null) ? Math.max(0, lastAt - firstAt) : null;
  const text = typeof data?.text === "string" ? data.text : "";
  return (
    <div className="dd-chunk-group">
      <div className="dd-chunk-meta">
        <span>{count} chunk{count === 1 ? "" : "s"}</span>
        {firstAt != null && lastAt != null && (
          <>
            <span>·</span>
            <span>{formatDebugTime(firstAt)} → {formatDebugTime(lastAt)}</span>
          </>
        )}
        {span != null && <><span>·</span><span>{span}ms</span></>}
      </div>
      <pre className="dd-chunk-text">{text}</pre>
    </div>
  );
}

function DebugDrawer({ open, events, sessionId, onClose, onClear }) {
  const bodyRef = React.useRef(null);
  const [stick, setStick] = React.useState(true);
  const [modeBySid, setModeBySid] = React.useState({});
  const mode = (sessionId && modeBySid[sessionId]) || "merged";
  const setMode = (next) => {
    if (!sessionId) return;
    setModeBySid((prev) => (prev[sessionId] === next ? prev : { ...prev, [sessionId]: next }));
  };
  const visibleEvents = mode === "merged" ? mergeChunkRuns(events) : events;
  React.useEffect(() => {
    if (!open || !stick) return;
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, stick, visibleEvents]);
  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    setStick(atBottom);
  };
  if (!open) return null;
  const count = events.length;
  return (
    <aside className="debug-drawer" role="complementary" aria-label="Debug drawer">
      <div className="dd-head">
        <span className="dd-title">Debug</span>
        <span className="dd-count">{count}</span>
        <div className="spacer" />
        <div className="dd-mode" role="tablist" aria-label="Debug view mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "merged"}
            className={"dd-mode-btn" + (mode === "merged" ? " active" : "")}
            onClick={() => setMode("merged")}
            title="Collapse consecutive chunks into one row"
          >Merged</button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "raw"}
            className={"dd-mode-btn" + (mode === "raw" ? " active" : "")}
            onClick={() => setMode("raw")}
            title="Show every raw event"
          >Raw</button>
        </div>
        <button
          type="button"
          className="dd-btn"
          onClick={onClear}
          disabled={count === 0 || !sessionId}
          title="Clear events for this session"
        >
          Clear
        </button>
        <button
          type="button"
          className="dd-btn"
          onClick={onClose}
          title="Close debug drawer"
          aria-label="Close debug drawer"
        >
          <XIcon size={11} />
        </button>
      </div>
      <div className="dd-body" ref={bodyRef} onScroll={onScroll}>
        {count === 0 ? (
          <div className="dd-empty">
            <div>No debug events yet.</div>
            <div className="dd-empty-hint">
              Send a message to see the outgoing payload, streamed chunks, and tool activity.
            </div>
          </div>
        ) : (
          visibleEvents.map((evt) => <DebugEventRow key={evt.id} evt={evt} />)
        )}
      </div>
    </aside>
  );
}

function ArtifactPane() {
  return (
    <div className="pane artifact">
      <div className="artifact-head">
        <span>Artifact</span>
      </div>
      <div className="empty" style={{ flex: 1 }}>
        <div className="glyph-lg"><SparkleIcon size={22} /></div>
        <h3>Nothing to show</h3>
        <p>Tool outputs, diffs, and previews will appear here.</p>
      </div>
    </div>
  );
}

function DirPicker({ initial, recent, onCancel, onPick }) {
  const { useState, useEffect, useRef } = React;
  const [value, setValue] = useState(initial || "");
  const [matches, setMatches] = useState([]);
  const [hover, setHover] = useState(0);
  const inputRef = useRef(null);
  const reqIdRef = useRef(0);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  useEffect(() => {
    const id = ++reqIdRef.current;
    const t = setTimeout(async () => {
      try {
        const { entries } = await api.listDirs(value);
        if (reqIdRef.current === id) { setMatches(entries || []); setHover(0); }
      } catch {
        if (reqIdRef.current === id) setMatches([]);
      }
    }, 80);
    return () => clearTimeout(t);
  }, [value]);

  const visible = value.trim() ? matches : recent;

  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHover((h) => Math.min(h + 1, Math.max(0, visible.length - 1))); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setHover((h) => Math.max(0, h - 1)); return; }
    if (e.key === "Tab" && visible[hover]) { e.preventDefault(); setValue(visible[hover] + "/"); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const picked = (visible[hover] && !value.trim()) ? visible[hover] : value.trim();
      if (picked) onPick(picked);
    }
  };

  return (
    <div className="dp-backdrop" onMouseDown={onCancel}>
      <div className="dp-card" role="dialog" aria-label="Pick directory" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dp-head">New session — directory</div>
        <input
          ref={inputRef}
          className="dp-input"
          value={value}
          placeholder="/Users/you/project or ~/code"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          spellCheck={false}
        />
        <div className="dp-list">
          {visible.length === 0 && (
            <div className="dp-empty">{value.trim() ? "No matches" : "No recent directories"}</div>
          )}
          {visible.map((p, i) => (
            <button
              key={p}
              className={"dp-item" + (i === hover ? " on" : "")}
              onMouseEnter={() => setHover(i)}
              onClick={() => onPick(p)}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="dp-foot">
          <span className="dp-hint">↵ use · ⇥ complete · esc cancel</span>
          <div className="dp-actions">
            <button className="dp-btn" onClick={onCancel}>Cancel</button>
            <button className="dp-btn primary" onClick={() => onPick(value.trim())} disabled={!value.trim()}>Create</button>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  TopBar, Sidebar, SessionRow,
  UserBubble, AssistantBubble, ErrorBubble, ToolCallRow,
  ChatHeader, Composer, ModelPicker, ArtifactPane, DirPicker,
  DebugDrawer,
});
