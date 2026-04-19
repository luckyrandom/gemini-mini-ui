// Lightweight markdown renderer — handles:
//   - fenced code blocks (```lang\n...\n```)
//   - inline code `x`
//   - bold **x**, italic *x*
//   - lists (- or 1.)
//   - paragraphs
// Plus a tiny tokenizer for TS/JS/JSON/bash-ish highlighting.

function highlight(code, lang) {
  const l = (lang || "").toLowerCase();
  const isJsTs = /^(js|jsx|ts|tsx|javascript|typescript)$/.test(l);
  const isJson = /^json$/.test(l);
  const isBash = /^(bash|sh|shell|zsh)$/.test(l);

  // tokens: [{cls, text}]
  let tokens = [{ cls: null, text: code }];

  function applyRegex(re, cls) {
    const next = [];
    for (const t of tokens) {
      if (t.cls) { next.push(t); continue; }
      let last = 0;
      const s = t.text;
      for (const m of s.matchAll(re)) {
        if (m.index > last) next.push({ cls: null, text: s.slice(last, m.index) });
        next.push({ cls, text: m[0] });
        last = m.index + m[0].length;
      }
      if (last < s.length) next.push({ cls: null, text: s.slice(last) });
    }
    tokens = next;
  }

  // comments first so they don't get partially tokenized
  applyRegex(/\/\/[^\n]*/g, "tok-com");
  applyRegex(/\/\*[\s\S]*?\*\//g, "tok-com");
  if (isBash) applyRegex(/#[^\n]*/g, "tok-com");

  // strings
  applyRegex(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, "tok-str");

  // numbers
  applyRegex(/\b\d+(?:\.\d+)?\b/g, "tok-num");

  if (isJsTs) {
    applyRegex(/\b(const|let|var|function|return|if|else|for|while|import|from|export|default|async|await|new|class|extends|this|typeof|instanceof|null|true|false|undefined)\b/g, "tok-kw");
    applyRegex(/\b([a-zA-Z_$][\w$]*)(?=\s*\()/g, "tok-key");
  } else if (isJson) {
    applyRegex(/"[^"]+"\s*:/g, "tok-key");
  } else if (isBash) {
    applyRegex(/\$\{?\w+\}?/g, "tok-key");
    applyRegex(/^\s*(\w+)/gm, "tok-kw");
  }

  // punctuation (subtle)
  applyRegex(/[{}\[\]();,]/g, "tok-pun");

  return tokens.map((t, i) =>
    t.cls ? <span key={i} className={t.cls}>{t.text}</span> : <React.Fragment key={i}>{t.text}</React.Fragment>
  );
}

// inline: bold/italic/code, render to React fragment
function renderInline(text, keyPrefix = "") {
  const parts = [];
  let rest = text;
  let idx = 0;
  // one-pass: match **..**, *..*, `..`
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2] !== undefined) parts.push(<strong key={`${keyPrefix}b${idx++}`}>{m[2]}</strong>);
    else if (m[3] !== undefined) parts.push(<em key={`${keyPrefix}i${idx++}`}>{m[3]}</em>);
    else if (m[4] !== undefined) parts.push(<code key={`${keyPrefix}c${idx++}`} className="inline">{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function CodeBlock({ lang, code }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = () => {
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="code-block">
      <div className="cb-head">
        <span>{lang || "text"}</span>
        <button className="copy" onClick={handleCopy}>
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre>{highlight(code, lang)}</pre>
    </div>
  );
}

function Markdown({ text, streaming = false }) {
  // Split by fenced blocks
  const blocks = [];
  const re = /```(\w*)\n([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) blocks.push({ type: "text", value: text.slice(last, m.index) });
    blocks.push({ type: "code", lang: m[1], value: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) blocks.push({ type: "text", value: text.slice(last) });

  const out = [];
  blocks.forEach((b, bi) => {
    if (b.type === "code") {
      out.push(<CodeBlock key={`cb-${bi}`} lang={b.lang} code={b.value} />);
      return;
    }
    // render text block: paragraphs + lists
    const lines = b.value.split("\n");
    let para = [];
    let list = null; // {type, items}
    const flushPara = () => {
      if (para.length) {
        const txt = para.join("\n").trim();
        if (txt) out.push(<p key={`p-${bi}-${out.length}`}>{renderInline(txt, `p${bi}-${out.length}`)}</p>);
        para = [];
      }
    };
    const flushList = () => {
      if (list) {
        const Tag = list.type === "ol" ? "ol" : "ul";
        out.push(
          <Tag key={`l-${bi}-${out.length}`}>
            {list.items.map((it, i) => (
              <li key={i}>{renderInline(it, `li${bi}-${i}`)}</li>
            ))}
          </Tag>
        );
        list = null;
      }
    };
    for (const line of lines) {
      const ulM = line.match(/^\s*[-•]\s+(.*)$/);
      const olM = line.match(/^\s*\d+\.\s+(.*)$/);
      const hM = line.match(/^(#{1,3})\s+(.*)$/);
      if (hM) {
        flushPara(); flushList();
        const level = hM[1].length;
        const H = `h${level}`;
        out.push(React.createElement(H, { key: `h-${bi}-${out.length}` }, renderInline(hM[2])));
      } else if (ulM) {
        flushPara();
        if (!list || list.type !== "ul") { flushList(); list = { type: "ul", items: [] }; }
        list.items.push(ulM[1]);
      } else if (olM) {
        flushPara();
        if (!list || list.type !== "ol") { flushList(); list = { type: "ol", items: [] }; }
        list.items.push(olM[1]);
      } else if (line.trim() === "") {
        flushPara(); flushList();
      } else {
        if (list) flushList();
        para.push(line);
      }
    }
    flushPara(); flushList();
  });

  return <div className="md">{out}</div>;
}

Object.assign(window, { Markdown, CodeBlock, highlight });
