const { useState, useEffect, useRef, useCallback } = React;

function App() {
  const [tweaks, setTweaksState] = useState(() => ({ ...window.__TWEAK_DEFAULTS }));
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messagesById, setMessagesById] = useState({});
  const [chatFileById, setChatFileById] = useState({});
  const [hydratedIds, setHydratedIds] = useState(() => new Set());
  const [streamingId, setStreamingId] = useState(null);
  const [bootError, setBootError] = useState(null);
  const [pickingDir, setPickingDir] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      if (!e.data || typeof e.data !== "object") return;
      if (e.data.type === "__activate_edit_mode") setTweaksOpen(true);
      if (e.data.type === "__deactivate_edit_mode") setTweaksOpen(false);
    };
    window.addEventListener("message", handler);
    window.parent.postMessage({ type: "__edit_mode_available" }, "*");
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = tweaks.theme;
  }, [tweaks.theme]);

  const setTweak = (k, v) => {
    setTweaksState((prev) => {
      const next = { ...prev, [k]: v };
      window.parent.postMessage({ type: "__edit_mode_set_keys", edits: { [k]: v } }, "*");
      return next;
    });
  };

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => setToast(null), 1400);
  }, []);

  // boot: list sessions; if none, create one rooted at the server's cwd
  useEffect(() => {
    (async () => {
      try {
        let list = await api.list();
        if (list.length === 0) {
          const rec = await api.create({});
          list = [rec];
        }
        setSessions(list);
        setActiveId(list[0].id);
      } catch (err) {
        setBootError(err.message || String(err));
      }
    })();
  }, []);

  // hydrate history from the server whenever we switch to a session we
  // haven't loaded yet (handles page reload + session-switch).
  useEffect(() => {
    if (!activeId || hydratedIds.has(activeId) || streamingId === activeId) return;
    let cancelled = false;
    (async () => {
      try {
        const { messages: history, chatFile } = await api.get(activeId);
        if (cancelled) return;
        setMessagesById((prev) => ({ ...prev, [activeId]: history || [] }));
        setChatFileById((prev) => ({ ...prev, [activeId]: chatFile || null }));
        setHydratedIds((prev) => new Set(prev).add(activeId));
      } catch (err) {
        console.warn("load history failed", err);
      }
    })();
    return () => { cancelled = true; };
  }, [activeId, hydratedIds, streamingId]);

  const activeSession = sessions.find((s) => s.id === activeId) || null;
  const messages = (activeId && messagesById[activeId]) || [];
  const isStreaming = streamingId === activeId;

  const pushMsg = (sid, m) => {
    setMessagesById((prev) => {
      const list = prev[sid] ? [...prev[sid], m] : [m];
      return { ...prev, [sid]: list };
    });
  };

  const updateMsg = (sid, mid, patch) => {
    setMessagesById((prev) => {
      const list = (prev[sid] || []).map((m) => (m.id === mid ? { ...m, ...patch } : m));
      return { ...prev, [sid]: list };
    });
  };

  const handleSend = async (text) => {
    if (!activeId || isStreaming) return;
    const sid = activeId;

    pushMsg(sid, { id: uid(), role: "user", text, time: nowTime() });
    const assistantId = uid();
    pushMsg(sid, { id: assistantId, role: "assistant", text: "", time: nowTime(), streaming: true });

    setStreamingId(sid);
    setHydratedIds((prev) => {
      const next = new Set(prev);
      next.add(sid);
      return next;
    });
    const toolByCallId = new Map();
    const pendingTools = new Set();

    const finalizePendingTools = (reason) => {
      if (pendingTools.size === 0) return;
      const now = Date.now();
      setMessagesById((prev) => {
        const list = (prev[sid] || []).map((m) =>
          pendingTools.has(m.id) && m.result == null
            ? { ...m, result: { status: reason || "unknown" }, duration: now }
            : m,
        );
        return { ...prev, [sid]: list };
      });
      pendingTools.clear();
    };

    try {
      await api.stream(sid, text, (evt) => {
        const type = evt.type;
        if (type === "content") {
          setMessagesById((prev) => {
            const list = (prev[sid] || []).map((m) =>
              m.id === assistantId ? { ...m, text: (m.text || "") + (evt.value || "") } : m,
            );
            return { ...prev, [sid]: list };
          });
        } else if (type === "tool_call_request") {
          const v = evt.value || {};
          const toolMsgId = uid();
          toolByCallId.set(v.callId, toolMsgId);
          pendingTools.add(toolMsgId);
          setMessagesById((prev) => {
            const list = [...(prev[sid] || [])];
            const idx = list.findIndex((m) => m.id === assistantId);
            const toolMsg = {
              id: toolMsgId, role: "tool",
              name: v.name, args: v.args ?? {},
              result: null, duration: null, time: nowTime(),
              startedAt: Date.now(),
            };
            if (idx >= 0) list.splice(idx, 0, toolMsg); else list.push(toolMsg);
            return { ...prev, [sid]: list };
          });
        } else if (type === "tool_call_response") {
          const v = evt.value || {};
          const mid = toolByCallId.get(v.callId);
          if (mid) {
            pendingTools.delete(mid);
            const result = v.error
              ? { error: typeof v.error === "string" ? v.error : (v.error?.message || String(v.error)) }
              : (v.resultDisplay ?? v.responseParts ?? { ok: true });
            updateMsg(sid, mid, { result, duration: Date.now() });
          }
        } else if (type === "error") {
          const msg = evt.value?.message || evt.value?.error?.message || "Stream error";
          updateMsg(sid, assistantId, { streaming: false, error: true, text: (msg) });
        } else if (type === "user_cancelled") {
          updateMsg(sid, assistantId, { streaming: false, text: (/* keep what we have */ undefined) });
        }
      });
    } catch (err) {
      updateMsg(sid, assistantId, { streaming: false, error: true, text: err.message || String(err) });
    } finally {
      finalizePendingTools("incomplete");
      setStreamingId((cur) => (cur === sid ? null : cur));
      setMessagesById((prev) => {
        const list = (prev[sid] || []).map((m) =>
          m.id === assistantId && m.streaming ? { ...m, streaming: false } : m,
        );
        return { ...prev, [sid]: list };
      });
      // refresh sessions list to pick up title/lastUsedAt bumps
      api.list().then(setSessions).catch(() => {});
      // refresh chatFile for this session (created on first turn)
      if (!chatFileById[sid]) {
        api.get(sid)
          .then(({ chatFile }) => setChatFileById((prev) => ({ ...prev, [sid]: chatFile || null })))
          .catch(() => {});
      }
    }
  };

  const handleStop = async () => {
    if (!activeId) return;
    await api.cancel(activeId);
    showToast("Stopped");
  };

  const handleModelChange = async (model) => {
    if (!activeId) return;
    const prev = sessions;
    setSessions((list) => list.map((s) => (s.id === activeId ? { ...s, model: model || undefined } : s)));
    try {
      const rec = await api.update(activeId, { model });
      setSessions((list) => list.map((s) => (s.id === rec.id ? rec : s)));
      showToast(`Model: ${modelLabel(rec.model)}`);
    } catch (err) {
      setSessions(prev);
      showToast("Update failed");
      console.error(err);
    }
  };

  const handleNewSession = () => setPickingDir(true);

  const createWithCwd = async (cwd) => {
    setPickingDir(false);
    try {
      const rec = await api.create(cwd ? { cwd } : {});
      setSessions((prev) => [rec, ...prev]);
      setActiveId(rec.id);
    } catch (err) {
      showToast(err?.message?.includes("400") ? "Invalid directory" : "Create failed");
      console.error(err);
    }
  };

  const recentDirs = Array.from(new Set(sessions.map((s) => s.cwd).filter(Boolean))).slice(0, 8);

  const handleRenameSession = async (id, title) => {
    // Optimistic — server is the source of truth on next reload, but the
    // PATCH is cheap enough that we don't need a separate revert path.
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
    try {
      await api.update(id, { title });
    } catch (err) {
      showToast("Rename failed");
      console.error(err);
      // Refetch to recover on failure.
      api.list().then(setSessions).catch(() => {});
    }
  };

  const handleDeleteSession = async (id) => {
    const wasActive = id === activeId;
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (wasActive) setActiveId(next[0]?.id ?? null);
      return next;
    });
    setMessagesById((prev) => {
      if (!(id in prev)) return prev;
      const { [id]: _gone, ...rest } = prev;
      return rest;
    });
    setHydratedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    try {
      await api.remove(id);
    } catch (err) {
      showToast("Delete failed");
      console.error(err);
      api.list().then(setSessions).catch(() => {});
    }
  };

  const logRef = useRef(null);
  const [showJump, setShowJump] = useState(false);
  useEffect(() => {
    const el = logRef.current; if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      setShowJump(!atBottom);
    };
    el.addEventListener("scroll", onScroll);
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  // auto-scroll while streaming
  useEffect(() => {
    if (!isStreaming) return;
    const el = logRef.current; if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming]);

  const jumpToLatest = () => {
    const el = logRef.current; if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  return (
    <>
      <div className="shell">
        <TopBar
          tweaks={tweaks}
          setTweak={setTweak}
          onToast={showToast}
          activeSession={activeSession}
        />
        <div
          className="layout"
          data-sidebar={tweaks.sidebarCollapsed ? "collapsed" : "expanded"}
          data-artifact={tweaks.rightPaneOpen ? "open" : "closed"}
        >
          <Sidebar
            collapsed={tweaks.sidebarCollapsed}
            sessions={sessions}
            activeId={activeId}
            streamingId={streamingId}
            onSelect={setActiveId}
            onNew={handleNewSession}
            onRename={handleRenameSession}
            onDelete={handleDeleteSession}
          />

          <div className="pane chat">
            <ChatHeader
              session={activeSession}
              chatFile={activeId ? chatFileById[activeId] : null}
              onToast={showToast}
            />
            <div className="msg-log" ref={logRef}>
              {bootError && (
                <div className="msg-group">
                  <ErrorBubble m={{ text: `Server error: ${bootError}`, time: nowTime() }} />
                </div>
              )}
              {!bootError && messages.length === 0 && (
                <EmptyChat onPick={(t) => handleSend(t)} />
              )}
              {messages.map((m, i) => {
                if (m.role === "user") return (
                  <div key={m.id} className="msg-group"><UserBubble m={m} /></div>
                );
                if (m.role === "tool") return (
                  <ToolCallRow key={m.id} m={m} defaultOpen={tweaks.toolCallExpanded} />
                );
                if (m.role === "assistant") {
                  if (m.error) return (
                    <div key={m.id} className="msg-group"><ErrorBubble m={m} /></div>
                  );
                  return (
                    <div key={m.id} className="msg-group">
                      <AssistantBubble m={m} streaming={!!m.streaming} />
                    </div>
                  );
                }
                return null;
              })}
            </div>
            <div className={"jump-pill" + (showJump ? " show" : "")} onClick={jumpToLatest}>
              Jump to latest ↓
            </div>
            <Composer
              streaming={isStreaming}
              onSend={handleSend}
              onStop={handleStop}
              model={activeSession?.model || ""}
              onModelChange={activeSession ? handleModelChange : undefined}
            />
          </div>

          {tweaks.rightPaneOpen && <ArtifactPane />}
        </div>
      </div>

      {tweaksOpen && <TweaksPanel tweaks={tweaks} setTweak={setTweak} onClose={() => setTweaksOpen(false)} />}
      {pickingDir && (
        <DirPicker
          initial={activeSession?.cwd || ""}
          recent={recentDirs}
          onCancel={() => setPickingDir(false)}
          onPick={createWithCwd}
        />
      )}
      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}

function EmptyChat({ onPick }) {
  const prompts = [
    "Summarize the files in this directory",
    "Draft a README outline for this project",
    "Explain the project layout",
  ];
  return (
    <div className="empty" style={{ minHeight: 320 }}>
      <div className="glyph-lg"><SparkleIcon size={22} /></div>
      <h3>Ready when you are</h3>
      <p>Ask Gemini about this working directory, or pick a starter below.</p>
      <div className="chips">
        {prompts.map((p) => (
          <button key={p} className="chip" onClick={() => onPick(p)}>{p}</button>
        ))}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
