import { defineConfig } from 'vite';

// Bundles npm-only markdown deps into a single IIFE the server can serve as a plain <script>.
// React/ReactDOM stay external — the page still loads them via UMD <script> tags.
export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'web/vendor',
    emptyOutDir: false,
    lib: {
      entry: 'web/vendor-src/markdown.ts',
      formats: ['iife'],
      name: 'MarkdownLibs',
      fileName: () => 'markdown.iife.js',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react-dom/client'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react-dom/client': 'ReactDOM',
        },
      },
    },
    minify: true,
    target: 'es2020',
  },
});
