// Side-effect stylesheet imports (src/webview/main.ts): Vite bundles them into chrome.css.
// The empty body types the import as side-effect only: it has no exports to misuse.
declare module '*.css' {}
