// Markdown renderer using react-markdown + remark-gfm + remark-math + rehype-katex.
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

const components = {
  // react-markdown v9: no `inline` prop. Block code is wrapped in <pre>; use that to detect.
  code({node, className, children, ...props}) {
    const isBlock = node?.position?.start?.line !== node?.position?.end?.line || /language-/.test(className || '');
    const code = String(children).replace(/\n$/, '');
    if (isBlock) {
      const match = /language-(\w+)/.exec(className || '');
      return <CodeBlock lang={match ? match[1] : 'text'} code={code} />;
    }
    return <code className={className || "inline"} {...props}>{children}</code>;
  },
  // react-markdown v9 wraps block <code> in <pre>; return children directly so CodeBlock renders its own <pre>.
  pre({children}) { return <>{children}</>; },
  table({children}) {
    return <div className="md-table-wrap"><table>{children}</table></div>;
  }
};

function Markdown({ text, streaming = false }) {
  const ReactMarkdown = window.ReactMarkdown;
  const remarkGfm = window.remarkGfm;
  const remarkMath = window.remarkMath;
  const rehypeKatex = window.rehypeKatex;

  if (!ReactMarkdown) {
    return <div className="md" style={{ whiteSpace: 'pre-wrap' }}>{text}</div>;
  }

  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {text}
      </ReactMarkdown>
      {streaming && <span className="caret" />}
    </div>
  );
}

Object.assign(window, { Markdown, CodeBlock, highlight });
