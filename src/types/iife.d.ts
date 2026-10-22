// `?iife` imports resolve to the module bundled as an IIFE string (scripts/iifeStringPlugin.ts).
declare module '*?iife' {
	const source: string;
	export default source;
}
