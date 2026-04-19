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

function DirGroup({ cwd, items, activeId, streamingId, onSelect }) {
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
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionRow({ s, active, streaming, onClick }) {
  const relLast = relativeTime(s.lastUsedAt);
  return (
    <div className={"session-row" + (active ? " active" : "")} onClick={onClick}>
      <div className="title">
        {streaming && <span className="streaming-dot" />}
        <span className="title-text">{s.title || "Untitled"}</span>
      </div>
      <div className="meta">{relLast}</div>
      <button className="row-menu" onClick={(e) => e.stopPropagation()} title="More">
        <MoreIcon />
      </button>
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

function Sidebar({ collapsed, sessions, activeId, streamingId, onSelect, onNew }) {
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

function ChatHeader({ session, chatFile, onToast }) {
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

function Composer({ streaming, onSend, onStop }) {
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

Object.assign(window, {
  TopBar, Sidebar, SessionRow,
  UserBubble, AssistantBubble, ErrorBubble, ToolCallRow,
  ChatHeader, Composer, ArtifactPane,
});
