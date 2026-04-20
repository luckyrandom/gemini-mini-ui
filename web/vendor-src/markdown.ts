import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

declare global {
  interface Window {
    ReactMarkdown: typeof ReactMarkdown;
    remarkGfm: typeof remarkGfm;
    remarkMath: typeof remarkMath;
    rehypeKatex: typeof rehypeKatex;
  }
}

window.ReactMarkdown = ReactMarkdown;
window.remarkGfm = remarkGfm;
window.remarkMath = remarkMath;
window.rehypeKatex = rehypeKatex;
