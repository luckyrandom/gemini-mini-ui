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
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugBySid, setDebugBySid] = useState({});
  const [pendingApprovalsById, setPendingApprovalsById] = useState({});

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
  const debugEvents = (activeId && debugBySid[activeId]) || [];

  const DEBUG_EVENT_CAP = 500;
  const pushDebug = useCallback((sid, kind, data) => {
    if (!sid) return;
    const evt = { id: uid(), at: Date.now(), kind, data };
    setDebugBySid((prev) => {
      const list = prev[sid] ? [...prev[sid], evt] : [evt];
      const trimmed = list.length > DEBUG_EVENT_CAP ? list.slice(-DEBUG_EVENT_CAP) : list;
      return { ...prev, [sid]: trimmed };
    });
  }, []);

  const clearDebug = useCallback((sid) => {
    if (!sid) return;
    setDebugBySid((prev) => {
      if (!(sid in prev)) return prev;
      const { [sid]: _gone, ...rest } = prev;
      return rest;
    });
  }, []);

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

    const activeAtSend = sessions.find((s) => s.id === sid) || null;
    pushDebug(sid, "request", {
      sessionId: sid,
      cwd: activeAtSend?.cwd,
      model: activeAtSend?.model || "(server default)",
      text,
    });

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

    // Replace the streaming assistant bubble with a typed system error
    // bubble so the user sees a single terminal surface per failed turn.
    const emitError = (kind, message) => {
      setMessagesById((prev) => {
        const list = (prev[sid] || []).filter((m) => m.id !== assistantId);
        list.push({
          id: uid(),
          role: "system",
          error: true,
          errorKind: kind,
          text: message,
          retryText: text,
          time: nowTime(),
        });
        return { ...prev, [sid]: list };
      });
    };

    // Maps correlationId → tool-call row id so approval resolution can clear
    // the "awaiting" state on the right row.
    const approvalToToolRow = new Map();

    try {
      await api.stream(sid, text, (evt) => {
        const type = evt.type;
        if (type === "content") {
          pushDebug(sid, "chunk", { value: evt.value });
          setMessagesById((prev) => {
            const list = (prev[sid] || []).map((m) =>
              m.id === assistantId ? { ...m, text: (m.text || "") + (evt.value || "") } : m,
            );
            return { ...prev, [sid]: list };
          });
        } else if (type === "tool_call_request") {
          const v = evt.value || {};
          pushDebug(sid, "tool_request", v);
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
          pushDebug(sid, "tool_response", v);
          const mid = toolByCallId.get(v.callId);
          if (mid) {
            pendingTools.delete(mid);
            const result = v.error
              ? { error: typeof v.error === "string" ? v.error : (v.error?.message || String(v.error)) }
              : (v.resultDisplay ?? v.responseParts ?? { ok: true });
            updateMsg(sid, mid, { result, duration: Date.now() });
          }
        } else if (type === "tool_confirmation_request") {
          const v = evt.value || {};
          pushDebug(sid, "tool_confirmation_request", v);
          const toolRowId = toolByCallId.get(v.callId);
          if (toolRowId) {
            approvalToToolRow.set(v.correlationId, toolRowId);
            updateMsg(sid, toolRowId, { awaitingApproval: true });
          }
          setPendingApprovalsById((prev) => ({ ...prev, [sid]: v }));
        } else if (type === "tool_confirmation_resolved") {
          const v = evt.value || {};
          pushDebug(sid, "tool_confirmation_resolved", v);
          const toolRowId = approvalToToolRow.get(v.correlationId);
          if (toolRowId) {
            approvalToToolRow.delete(v.correlationId);
            updateMsg(sid, toolRowId, { awaitingApproval: false });
          }
          setPendingApprovalsById((prev) => {
            if (!prev[sid] || prev[sid].correlationId !== v.correlationId) return prev;
            const { [sid]: _gone, ...rest } = prev;
            return rest;
          });
        } else if (type === "error") {
          const kind = evt.value?.kind || "model";
          const msg = evt.value?.message || evt.value?.error?.message || "Stream error";
          pushDebug(sid, "stream_error", { kind, message: msg, value: evt.value });
          emitError(kind, msg);
        } else if (type === "user_cancelled") {
          pushDebug(sid, "cancelled", { value: evt.value });
          updateMsg(sid, assistantId, { streaming: false, text: (/* keep what we have */ undefined) });
        } else if (type === "done") {
          pushDebug(sid, "done", {});
        } else {
          pushDebug(sid, type || "event", evt.value ?? evt);
        }
      });
    } catch (err) {
      const kind = err?.kind || "network";
      pushDebug(sid, "stream_exception", { kind, message: err?.message || String(err) });
      emitError(kind, err?.message || String(err));
    } finally {
      finalizePendingTools("incomplete");
      setPendingApprovalsById((prev) => {
        if (!(sid in prev)) return prev;
        const { [sid]: _gone, ...rest } = prev;
        return rest;
      });
      setStreamingId((cur) => (cur === sid ? null : cur));
      setMessagesById((prev) => {
        const list = (prev[sid] || []).map((m) =>
          m.id === assistantId && m.streaming ? { ...m, streaming: false } : m,
        );
        return { ...prev, [sid]: list };
      });
      // refresh sessions list to pick up title/lastUsedAt bumps
      api.list().then(setSessions).catch(() => {});
      // Pull the persisted history back so message ids match the chat file.
      // Without this, freshly-streamed messages carry client-only uids and
      // can't be used as anchors for fork. Only replace when the server has
      // a chatFile + real messages (so the fake test session, which writes
      // nothing, keeps the client-side bubbles we just rendered).
      api.get(sid)
        .then(({ messages: persisted, chatFile }) => {
          if (chatFile) {
            setChatFileById((prev) => ({ ...prev, [sid]: chatFile }));
          }
          if (chatFile && Array.isArray(persisted) && persisted.length > 0) {
            setMessagesById((prev) => ({ ...prev, [sid]: persisted }));
          }
        })
        .catch(() => {});
    }
  };

  const handleRetry = (errMsg) => {
    if (!activeId || isStreaming) return;
    const text = errMsg?.retryText;
    if (!text) return;
    // Remove the error bubble and the preceding user bubble (which the retry
    // will re-emit) so the log doesn't accumulate duplicates.
    setMessagesById((prev) => {
      const list = prev[activeId] || [];
      const idx = list.findIndex((m) => m.id === errMsg.id);
      if (idx < 0) return prev;
      let start = idx;
      for (let i = idx - 1; i >= 0; i--) {
        if (list[i].role === "user" && list[i].text === text) { start = i; break; }
      }
      return { ...prev, [activeId]: [...list.slice(0, start), ...list.slice(idx + 1)] };
    });
    handleSend(text);
  };

  const handleStop = async () => {
    if (!activeId) return;
    await api.cancel(activeId);
    showToast("Stopped");
  };

  const handleApproval = async (outcome) => {
    if (!activeId) return;
    const pending = pendingApprovalsById[activeId];
    if (!pending) return;
    // Clear optimistically so the modal closes even if the resolved event
    // arrives after the HTTP POST returns.
    setPendingApprovalsById((prev) => {
      if (!prev[activeId] || prev[activeId].correlationId !== pending.correlationId) return prev;
      const { [activeId]: _gone, ...rest } = prev;
      return rest;
    });
    try {
      await api.confirm(activeId, pending.correlationId, outcome);
    } catch (err) {
      console.error("approval failed", err);
      showToast("Approval failed");
    }
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

  const handleFork = async (upToMessageId) => {
    if (!activeId || !upToMessageId) return;
    try {
      const { record } = await api.fork(activeId, { upToMessageId });
      setSessions((prev) => [record, ...prev.filter((s) => s.id !== record.id)]);
      setActiveId(record.id);
      showToast("Forked to new session");
    } catch (err) {
      console.error(err);
      const msg = /409/.test(err?.message || "")
        ? "Nothing to fork yet — send a turn first"
        : "Fork failed";
      showToast(msg);
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
    clearDebug(id);
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
              debugOpen={debugOpen}
              debugCount={debugEvents.length}
              onToggleDebug={activeSession ? () => setDebugOpen((v) => !v) : undefined}
            />
            <div className="msg-log" ref={logRef}>
              {bootError && (
                <div className="msg-group">
                  <ErrorBubble m={{ errorKind: "network", text: bootError, time: nowTime() }} />
                </div>
              )}
              {!bootError && messages.length === 0 && (
                <EmptyChat onPick={(t) => handleSend(t)} />
              )}
              {messages.map((m, i) => {
                if (m.role === "user") return (
                  <div key={m.id} className="msg-group">
                    <UserBubble m={m} onFork={handleFork} forkDisabled={isStreaming} />
                  </div>
                );
                if (m.role === "tool") return (
                  <ToolCallRow key={m.id} m={m} defaultOpen={tweaks.toolCallExpanded} />
                );
                if (m.role === "system" || (m.role === "assistant" && m.error)) {
                  return (
                    <div key={m.id} className="msg-group">
                      <ErrorBubble m={m} onRetry={handleRetry} />
                    </div>
                  );
                }
                if (m.role === "assistant") {
                  return (
                    <div key={m.id} className="msg-group">
                      <AssistantBubble
                        m={m}
                        streaming={!!m.streaming}
                        onFork={handleFork}
                        forkDisabled={isStreaming}
                      />
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
            <DebugDrawer
              open={debugOpen && !!activeId}
              events={debugEvents}
              sessionId={activeId}
              onClose={() => setDebugOpen(false)}
              onClear={() => clearDebug(activeId)}
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
      {activeId && pendingApprovalsById[activeId] && (
        <ApprovalModal
          pending={pendingApprovalsById[activeId]}
          onDecision={handleApproval}
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
