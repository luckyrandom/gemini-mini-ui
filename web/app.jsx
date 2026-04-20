const { useState, useEffect, useLayoutEffect, useRef, useCallback } = React;

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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugBySid, setDebugBySid] = useState({});
  const [requestRawBySid, setRequestRawBySid] = useState({});
  const [pendingApprovalsById, setPendingApprovalsById] = useState({});
  // Per-session staged approval decisions while the user reviews a batch.
  // Shape: { [sid]: { [correlationId]: { decision: 'approved'|'denied', feedback?: string } } }
  // Nothing reaches the SDK until handleSubmitApprovals fires.
  const [stagedApprovalsById, setStagedApprovalsById] = useState({});
  const [quota, setQuota] = useState(null);

  const refreshQuota = useCallback(async () => {
    try {
      const q = await api.quota();
      setQuota(q);
      return q;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    (async () => {
      const first = await refreshQuota();
      if (cancelled) return;
      // Stop polling if quota isn't applicable in this auth mode.
      if (!first || first.available === false) return;
      timer = setInterval(refreshQuota, 60_000);
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [refreshQuota]);

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

  const layoutRef = useRef(null);
  useLayoutEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return;
    if (tweaks.sidebarCollapsed) {
      layout.style.removeProperty("--sidebar-w");
      return;
    }
    const saved = readStoredWidth(SIDEBAR_WIDTH_KEY);
    if (saved == null) {
      layout.style.removeProperty("--sidebar-w");
      return;
    }
    layout.style.setProperty("--sidebar-w", clampSidebarWidth(saved, layout) + "px");
  }, [tweaks.sidebarCollapsed, tweaks.rightPaneOpen]);

  const newHereRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = (e.key || "").toLowerCase();
      const isSlash = k === "/" || e.code === "Slash";
      if (k === "n") {
        e.preventDefault();
        if (e.shiftKey) setPickingDir(true);
        else newHereRef.current?.();
      } else if (isSlash && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen((v) => !v);
      } else if (k === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

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
        const { messages: history, chatFile, pendingApprovals } = await api.get(activeId);
        if (cancelled) return;
        setMessagesById((prev) => ({ ...prev, [activeId]: history || [] }));
        setChatFileById((prev) => ({ ...prev, [activeId]: chatFile || null }));
        if (pendingApprovals && pendingApprovals.length > 0) {
          setPendingApprovalsById((prev) => ({ ...prev, [activeId]: pendingApprovals }));
        }
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
  const requestRawSnapshots = (activeId && requestRawBySid[activeId]) || [];

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
    setRequestRawBySid((prev) => {
      if (!(sid in prev)) return prev;
      const { [sid]: _gone, ...rest } = prev;
      return rest;
    });
  }, []);

  const REQUEST_RAW_CAP = 50;
  const pushRequestRaw = useCallback((sid, snapshot) => {
    if (!sid || !snapshot) return;
    setRequestRawBySid((prev) => {
      const list = prev[sid] ? [...prev[sid], snapshot] : [snapshot];
      const trimmed = list.length > REQUEST_RAW_CAP ? list.slice(-REQUEST_RAW_CAP) : list;
      return { ...prev, [sid]: trimmed };
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

  const runTurn = async (sid, assistantId, text, startStream) => {
    setStreamingId(sid);
    setHydratedIds((prev) => {
      const next = new Set(prev);
      next.add(sid);
      return next;
    });
    const toolByCallId = new Map();
    const pendingTools = new Set();
    // Track the assistant bubble currently receiving content. When a tool
    // call arrives we reset this to null so the next content chunk spawns a
    // fresh assistant bubble — this matches how persisted history is
    // rendered (text split around tool calls), avoiding a big reshuffle on
    // refresh.
    let currentAssistantId = assistantId;
    const assistantIds = new Set([assistantId]);

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
        // Drop any empty assistant placeholders we added this turn, keep
        // ones with accumulated text so partial output survives the error.
        const list = (prev[sid] || []).filter(
          (m) => !(assistantIds.has(m.id) && !m.text),
        );
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
      await startStream((evt) => {
        const type = evt.type;
        if (type === "content") {
          pushDebug(sid, "chunk", { value: evt.value });
          const chunk = evt.value || "";
          if (currentAssistantId == null) {
            const newId = uid();
            currentAssistantId = newId;
            assistantIds.add(newId);
            setMessagesById((prev) => {
              const list = [
                ...(prev[sid] || []),
                { id: newId, role: "assistant", text: chunk, time: nowTime(), streaming: true },
              ];
              return { ...prev, [sid]: list };
            });
          } else {
            const targetId = currentAssistantId;
            setMessagesById((prev) => {
              const list = (prev[sid] || []).map((m) =>
                m.id === targetId ? { ...m, text: (m.text || "") + chunk } : m,
              );
              return { ...prev, [sid]: list };
            });
          }
        } else if (type === "tool_call_request") {
          const v = evt.value || {};
          pushDebug(sid, "tool_request", v);
          const toolMsgId = uid();
          toolByCallId.set(v.callId, toolMsgId);
          pendingTools.add(toolMsgId);
          const closedAssistantId = currentAssistantId;
          currentAssistantId = null;
          setMessagesById((prev) => {
            const curList = prev[sid] || [];
            // Close out the current assistant bubble (stop the "streaming…"
            // indicator) and drop it if it never accumulated any text, so
            // we don't leave an empty bubble above the tool row.
            const trimmed = curList
              .filter((m) => !(m.id === closedAssistantId && !m.text))
              .map((m) =>
                m.id === closedAssistantId ? { ...m, streaming: false } : m,
              );
            trimmed.push({
              id: toolMsgId, role: "tool",
              name: v.name, args: v.args ?? {},
              result: null, duration: null, time: nowTime(),
              startedAt: Date.now(),
            });
            return { ...prev, [sid]: trimmed };
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
        } else if (type === "tool_output_update") {
          const v = evt.value || {};
          pushDebug(sid, "tool_output_update", v);
          const mid = toolByCallId.get(v.callId);
          if (mid) {
            updateMsg(sid, mid, { liveOutput: v.output });
          }
        } else if (type === "tool_confirmation_request") {
          const v = evt.value || {};
          pushDebug(sid, "tool_confirmation_request", v);
          const toolRowId = toolByCallId.get(v.callId);
          if (toolRowId) {
            approvalToToolRow.set(v.correlationId, toolRowId);
            updateMsg(sid, toolRowId, { awaitingApproval: true });
          }
          setPendingApprovalsById((prev) => {
            const cur = prev[sid] || [];
            if (cur.some((p) => p.correlationId === v.correlationId)) return prev;
            return { ...prev, [sid]: [...cur, v] };
          });
        } else if (type === "tool_confirmation_resolved") {
          const v = evt.value || {};
          pushDebug(sid, "tool_confirmation_resolved", v);
          const toolRowId = approvalToToolRow.get(v.correlationId);
          if (toolRowId) {
            approvalToToolRow.delete(v.correlationId);
            updateMsg(sid, toolRowId, { awaitingApproval: false });
          }
          setPendingApprovalsById((prev) => {
            const cur = prev[sid];
            if (!cur || cur.length === 0) return prev;
            const next = cur.filter((p) => p.correlationId !== v.correlationId);
            if (next.length === cur.length) return prev;
            if (next.length === 0) {
              const { [sid]: _gone, ...rest } = prev;
              return rest;
            }
            return { ...prev, [sid]: next };
          });
          setStagedApprovalsById((prev) => {
            const cur = prev[sid];
            if (!cur || !cur[v.correlationId]) return prev;
            const { [v.correlationId]: _gone, ...rest } = cur;
            if (Object.keys(rest).length === 0) {
              const { [sid]: _gs, ...top } = prev;
              return top;
            }
            return { ...prev, [sid]: rest };
          });
        } else if (type === "debug_request_raw") {
          pushRequestRaw(sid, evt.value);
          pushDebug(sid, "request_raw", evt.value);
        } else if (type === "error") {
          const kind = evt.value?.kind || "model";
          const msg = evt.value?.message || evt.value?.error?.message || "Stream error";
          pushDebug(sid, "stream_error", { kind, message: msg, value: evt.value });
          emitError(kind, msg);
        } else if (type === "user_cancelled") {
          pushDebug(sid, "cancelled", { value: evt.value });
          setMessagesById((prev) => {
            const list = (prev[sid] || []).map((m) =>
              assistantIds.has(m.id) ? { ...m, streaming: false } : m,
            );
            return { ...prev, [sid]: list };
          });
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
          assistantIds.has(m.id) && m.streaming ? { ...m, streaming: false } : m,
        );
        return { ...prev, [sid]: list };
      });
      // refresh sessions list to pick up title/lastUsedAt bumps + model changes
      api.list().then(setSessions).catch(() => {});
      // Quota likely shifted after a turn — refetch (server-side cache caps to 60s).
      refreshQuota();
      // Pull the persisted history back so message ids match the chat file.
      // Without this, freshly-streamed messages carry client-only uids and
      // can't be used as anchors for fork. Only replace when the server has
      // a chatFile + real messages (so the fake test session, which writes
      // nothing, keeps the client-side bubbles we just rendered).
      api.get(sid)
        .then(({ messages: persisted, chatFile, pendingApprovals }) => {
          if (chatFile) {
            setChatFileById((prev) => ({ ...prev, [sid]: chatFile }));
          }
          if (chatFile && Array.isArray(persisted) && persisted.length > 0) {
            setMessagesById((prev) => {
              // Preserve client-synthesized system error bubbles — the server
              // chat file doesn't record them, so a naive replace would wipe
              // the only UI surface for quota/model/network failures.
              const localErrors = (prev[sid] || []).filter(
                (m) => m.role === "system" && m.error,
              );
              return { ...prev, [sid]: [...persisted, ...localErrors] };
            });
          }
          if (pendingApprovals && pendingApprovals.length > 0) {
            setPendingApprovalsById((prev) => ({ ...prev, [sid]: pendingApprovals }));
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

  const sendTextToSession = async (sid, text) => {
    if (!sid) return;
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

    await runTurn(sid, assistantId, text, (onEvent) => api.stream(sid, text, onEvent));
  };

  const handleSend = async (text) => {
    if (!activeId || isStreaming) return;
    await sendTextToSession(activeId, text);
  };

  const handleResend = async (model) => {
    if (!activeId || isStreaming) return;
    const sid = activeId;
    const cur = messagesById[sid] || [];
    let lastUserIdx = -1;
    for (let i = cur.length - 1; i >= 0; i--) {
      if (cur[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx < 0) {
      showToast("Nothing to regenerate");
      return;
    }
    const lastUserText = cur[lastUserIdx]?.text || "";

    const assistantId = uid();
    const trimmed = cur.slice(0, lastUserIdx + 1);
    setMessagesById((prev) => ({
      ...prev,
      [sid]: [
        ...trimmed,
        { id: assistantId, role: "assistant", text: "", time: nowTime(), streaming: true },
      ],
    }));
    // Optimistically reflect the model change in the session list.
    if (model !== undefined) {
      setSessions((list) =>
        list.map((s) => (s.id === sid ? { ...s, model: model || undefined } : s)),
      );
    }

    const activeAtResend = sessions.find((s) => s.id === sid) || null;
    const resolvedModel = model !== undefined
      ? (model || "(server default)")
      : (activeAtResend?.model || "(server default)");
    pushDebug(sid, "request", {
      sessionId: sid,
      cwd: activeAtResend?.cwd,
      model: resolvedModel,
      resend: true,
    });

    await runTurn(sid, assistantId, lastUserText, (onEvent) =>
      api.resend(sid, { model }, onEvent),
    );
  };

  const handleStop = async () => {
    if (!activeId) return;
    await api.cancel(activeId);
    showToast("Stopped");
  };

  const handleApproval = async (outcome, correlationId, newContent) => {
    if (!activeId) return;
    const queue = pendingApprovalsById[activeId];
    if (!Array.isArray(queue) || queue.length === 0) return;
    const bulk = outcome === 'proceed_all' || outcome === 'cancel_all';
    let targets;
    if (bulk) {
      targets = queue.slice();
    } else if (correlationId) {
      const match = queue.find((p) => p.correlationId === correlationId);
      if (!match) return;
      targets = [match];
    } else {
      targets = [queue[0]];
    }
    const resolvedOutcome = outcome === 'proceed_all' ? 'proceed'
      : outcome === 'cancel_all' ? 'cancel'
      : outcome;
    const targetIds = new Set(targets.map((p) => p.correlationId));
    const overrideContent = resolvedOutcome === 'proceed' && !bulk && typeof newContent === 'string'
      ? newContent
      : undefined;
    // Clear optimistically so the modal closes even if resolved events
    // arrive after the HTTP POSTs return.
    setPendingApprovalsById((prev) => {
      const cur = prev[activeId];
      if (!Array.isArray(cur) || cur.length === 0) return prev;
      const next = cur.filter((p) => !targetIds.has(p.correlationId));
      if (next.length === cur.length) return prev;
      if (next.length === 0) {
        const { [activeId]: _gone, ...rest } = prev;
        return rest;
      }
      return { ...prev, [activeId]: next };
    });
    try {
      await Promise.all(
        targets.map((p) => api.confirm(activeId, p.correlationId, resolvedOutcome, undefined, overrideContent)),
      );
    } catch (err) {
      console.error("approval failed", err);
      showToast("Approval failed");
    }
  };

  const stageDecision = (correlationId, decision) => {
    if (!activeId) return;
    setStagedApprovalsById((prev) => {
      const cur = prev[activeId] || {};
      const existing = cur[correlationId] || {};
      return { ...prev, [activeId]: { ...cur, [correlationId]: { ...existing, decision } } };
    });
  };

  const clearDecision = (correlationId) => {
    if (!activeId) return;
    setStagedApprovalsById((prev) => {
      const cur = prev[activeId];
      if (!cur || !cur[correlationId]) return prev;
      const { [correlationId]: _gone, ...rest } = cur;
      if (Object.keys(rest).length === 0) {
        const { [activeId]: _gs, ...top } = prev;
        return top;
      }
      return { ...prev, [activeId]: rest };
    });
  };

  const setFeedback = (correlationId, feedback) => {
    if (!activeId) return;
    setStagedApprovalsById((prev) => {
      const cur = prev[activeId] || {};
      const existing = cur[correlationId] || { decision: 'denied' };
      return { ...prev, [activeId]: { ...cur, [correlationId]: { ...existing, feedback } } };
    });
  };

  const setEditedContent = (correlationId, newContent) => {
    if (!activeId) return;
    setStagedApprovalsById((prev) => {
      const cur = prev[activeId] || {};
      const existing = cur[correlationId] || {};
      const next = { ...existing };
      if (typeof newContent === 'string') next.newContent = newContent;
      else delete next.newContent;
      return { ...prev, [activeId]: { ...cur, [correlationId]: next } };
    });
  };

  const stageAll = (decision) => {
    if (!activeId) return;
    const queue = pendingApprovalsById[activeId];
    if (!Array.isArray(queue) || queue.length === 0) return;
    setStagedApprovalsById((prev) => {
      const cur = prev[activeId] || {};
      const next = { ...cur };
      for (const p of queue) {
        const existing = next[p.correlationId] || {};
        next[p.correlationId] = { ...existing, decision };
      }
      return { ...prev, [activeId]: next };
    });
  };

  const handleSubmitApprovals = async () => {
    if (!activeId) return;
    const sid = activeId;
    const queue = pendingApprovalsById[sid];
    const staged = stagedApprovalsById[sid] || {};
    if (!Array.isArray(queue) || queue.length === 0) return;
    // Build the list of resolutions. Skip any row the UI shouldn't have let
    // through (no staged decision) — caller disables Submit until all decided.
    const resolutions = queue
      .map((p) => ({ p, s: staged[p.correlationId] }))
      .filter((r) => r.s?.decision === 'approved' || r.s?.decision === 'denied');
    if (resolutions.length === 0) return;

    const targetIds = new Set(resolutions.map((r) => r.p.correlationId));
    // Clear queue + staged optimistically so the card closes immediately.
    setPendingApprovalsById((prev) => {
      const cur = prev[sid];
      if (!Array.isArray(cur) || cur.length === 0) return prev;
      const next = cur.filter((p) => !targetIds.has(p.correlationId));
      if (next.length === cur.length) return prev;
      if (next.length === 0) {
        const { [sid]: _gone, ...rest } = prev;
        return rest;
      }
      return { ...prev, [sid]: next };
    });
    setStagedApprovalsById((prev) => {
      if (!(sid in prev)) return prev;
      const { [sid]: _gone, ...rest } = prev;
      return rest;
    });

    try {
      await Promise.all(
        resolutions.map((r) =>
          api.confirm(
            sid,
            r.p.correlationId,
            r.s.decision === 'approved' ? 'proceed' : 'cancel',
            r.s.decision === 'denied' ? (r.s.feedback || '').trim() || undefined : undefined,
            r.s.decision === 'approved' && typeof r.s.newContent === 'string' ? r.s.newContent : undefined,
          ),
        ),
      );
    } catch (err) {
      console.error("approval submit failed", err);
      showToast("Approval failed");
    }
  };

  const handleCancelTurn = async () => {
    if (!activeId) return;
    const queue = pendingApprovalsById[activeId];
    if (!Array.isArray(queue) || queue.length === 0) return;
    // Reuse bulk-cancel path; clears both pending + staged via the drain flow.
    setStagedApprovalsById((prev) => {
      if (!(activeId in prev)) return prev;
      const { [activeId]: _gone, ...rest } = prev;
      return rest;
    });
    await handleApproval('cancel_all');
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

  const handleNewSessionHere = async () => {
    const cwd = sessions.find((s) => s.id === activeId)?.cwd;
    try {
      const rec = await api.create(cwd ? { cwd } : {});
      setSessions((prev) => [rec, ...prev]);
      setActiveId(rec.id);
    } catch (err) {
      showToast("Create failed");
      console.error(err);
    }
  };
  newHereRef.current = handleNewSessionHere;

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

  const paletteCommands = [
    {
      id: "new-session-here",
      label: "New session (same directory)",
      run: () => newHereRef.current?.(),
    },
    {
      id: "new-session-pick",
      label: "New session in another directory…",
      run: () => setPickingDir(true),
    },
    {
      id: "switch-model",
      label: "Switch model",
      disabled: !activeSession,
      hint: activeSession ? "" : "Open a session first",
      submenu: activeSession
        ? MODELS.map((m) => ({
            id: `model:${m.value || "default"}`,
            label: m.label,
            selected: (activeSession.model || "") === m.value,
            trailing: (activeSession.model || "") === m.value ? "✓" : null,
            run: () => handleModelChange(m.value),
          }))
        : undefined,
    },
  ];

  return (
    <>
      <div className="shell">
        <TopBar
          tweaks={tweaks}
          setTweak={setTweak}
          onToast={showToast}
          activeSession={activeSession}
          onOpenTweaks={() => setTweaksOpen((v) => !v)}
          quota={quota}
        />
        <div
          className="layout"
          ref={layoutRef}
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
              {(() => {
                let lastAssistantIdx = -1;
                for (let i = messages.length - 1; i >= 0; i--) {
                  const m = messages[i];
                  if (m.role === "assistant" && !m.error && !m.streaming) {
                    lastAssistantIdx = i;
                    break;
                  }
                }
                // Coalesce runs of consecutive tool messages into a single
                // ToolGroup so long sequences don't bury the conversation.
                const items = [];
                let run = null;
                messages.forEach((m, i) => {
                  if (m.role === "tool") {
                    if (!run) {
                      run = { kind: "toolGroup", tools: [m] };
                      items.push(run);
                    } else {
                      run.tools.push(m);
                    }
                  } else {
                    run = null;
                    items.push({ kind: "msg", m, i });
                  }
                });
                return items.map((it) => {
                  if (it.kind === "toolGroup") {
                    return (
                      <ToolGroup
                        key={it.tools[0].id}
                        tools={it.tools}
                        defaultOpen={tweaks.toolCallExpanded}
                      />
                    );
                  }
                  const { m, i } = it;
                  if (m.role === "user") return (
                    <div key={m.id} className="msg-group">
                      <UserBubble m={m} onFork={handleFork} forkDisabled={isStreaming} />
                    </div>
                  );
                  if (m.role === "system" || (m.role === "assistant" && m.error)) {
                    return (
                      <div key={m.id} className="msg-group">
                        <ErrorBubble m={m} onRetry={handleRetry} />
                      </div>
                    );
                  }
                  if (m.role === "assistant") {
                    const isLast = i === lastAssistantIdx;
                    return (
                      <div key={m.id} className="msg-group">
                        <AssistantBubble
                          m={m}
                          streaming={!!m.streaming}
                          onFork={handleFork}
                          forkDisabled={isStreaming}
                          onResend={isLast ? handleResend : undefined}
                          resendDisabled={isStreaming}
                          currentModel={activeSession?.model || ""}
                        />
                      </div>
                    );
                  }
                  return null;
                });
              })()}
              {activeId && Array.isArray(pendingApprovalsById[activeId]) && pendingApprovalsById[activeId].length > 0 && (
                <div className="msg-group">
                  <div className="msg-bubble assistant" style={{ background: 'transparent', padding: 0, border: 'none' }}>
                    <ApprovalModal
                      pending={pendingApprovalsById[activeId][0]}
                      queue={pendingApprovalsById[activeId]}
                      staged={stagedApprovalsById[activeId] || {}}
                      onStage={stageDecision}
                      onClear={clearDecision}
                      onFeedbackChange={setFeedback}
                      onEditedContentChange={setEditedContent}
                      onApproveAll={() => stageAll('approved')}
                      onDenyAll={() => stageAll('denied')}
                      onSubmit={handleSubmitApprovals}
                      onCancelTurn={handleCancelTurn}
                      onDecision={handleApproval}
                    />
                  </div>
                </div>
              )}
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
              requestSnapshots={requestRawSnapshots}
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
      {paletteOpen && (
        <CommandPalette
          commands={paletteCommands}
          onClose={() => setPaletteOpen(false)}
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
