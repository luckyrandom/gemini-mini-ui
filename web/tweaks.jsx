function Switch({ on, onChange }) {
  return (
    <button
      className="switch"
      data-on={on ? "true" : "false"}
      onClick={() => onChange(!on)}
      aria-pressed={on}
    />
  );
}

function Seg({ value, options, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TweaksPanel({ tweaks, setTweak, onClose }) {
  return (
    <div className="tweaks" role="dialog" aria-label="Tweaks">
      <div className="tweaks-head">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <SlidersIcon /> Tweaks
        </span>
        <button className="icon-btn" style={{ width: 20, height: 20 }} onClick={onClose} title="Close">
          <XIcon />
        </button>
      </div>
      <div className="tweaks-body">
        <div className="tweak-row">
          <label>Theme</label>
          <Seg
            value={tweaks.theme}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            onChange={(v) => setTweak("theme", v)}
          />
        </div>
        <div className="tweak-row">
          <label>Sidebar collapsed</label>
          <Switch on={tweaks.sidebarCollapsed} onChange={(v) => setTweak("sidebarCollapsed", v)} />
        </div>
        <div className="tweak-row">
          <label>Streaming</label>
          <Switch on={tweaks.streaming} onChange={(v) => setTweak("streaming", v)} />
        </div>
        <div className="tweak-row">
          <label>Tool-call expanded</label>
          <Switch on={tweaks.toolCallExpanded} onChange={(v) => setTweak("toolCallExpanded", v)} />
        </div>
        <div className="tweak-row">
          <label>Show error state</label>
          <Switch on={tweaks.errorVisible} onChange={(v) => setTweak("errorVisible", v)} />
        </div>
        <div className="tweak-row">
          <label>Right pane open</label>
          <Switch on={tweaks.rightPaneOpen} onChange={(v) => setTweak("rightPaneOpen", v)} />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { TweaksPanel, Switch, Seg });
