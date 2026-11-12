import { CANVAS_RUNTIME_ATTRIBUTE } from './frame/frameMessages';

// Second policy stamped on top of the inherited chrome CSP; a request must pass both. The chrome
// nonce has to go on every artboard script and style for them to run, but artboard JS can read it
// and stamp it on a new <script src>, so the nonce alone would let a design load remote code.
// This policy allows inline code only, so no script, style, image, font or fetch leaves the frame.
// ponytail: Chromium's CSP does not govern WebRTC or DNS prefetch hints; the sandbox (opaque
// origin, no VS Code API) is the wall that matters. Upgrade path: none short of a network proxy.
export const FRAME_CSP =
	"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'";

// The blob frame inherits the chrome's nonce CSP, so bare script/style tags would be blocked.
// Stamping the chrome nonce re-allows exactly those tags; inline handlers and style attributes
// stay blocked by the inherited policy, and FRAME_CSP blocks every subresource. The artboard's
// own meta http-equiv is stripped so it cannot loosen or stack policies; FRAME_CSP goes in first.
// The canvas runtime goes into the blob copy only; disk and export HTML never see either.
export const stampArtboardHtml = ({
	html,
	nonce,
	runtimeSource,
}: {
	html: string;
	nonce: string;
	runtimeSource: string;
}): string => {
	// A <style> connected to any document, even a DOMParser one, is checked against the chrome CSP
	// before it has the nonce, and logs a violation. So the artboard parses into a detached <html>.
	// Its document has no browsing context, so nothing in it runs or loads. A fragment parse drops
	// the <html> tag's attributes, so DOMParser reads them from the text before head, body or style.
	// ponytail: an <html> tag after those, or a leading comment naming one, loses its attributes;
	// upgrade path: a real tokenizer (parse5).
	const beforeContent = html.search(/<(?:head|body|style)\b/i);
	const root = new DOMParser().parseFromString(
		beforeContent === -1 ? html : html.slice(0, beforeContent),
		'text/html',
	).documentElement;
	root.remove();
	root.innerHTML = html;
	const parsed = root.ownerDocument;
	for (const element of root.querySelectorAll('meta[http-equiv]')) {
		element.remove();
	}
	for (const element of root.querySelectorAll('script, style')) {
		element.setAttribute('nonce', nonce);
	}
	for (const element of root.querySelectorAll(`script[${CANVAS_RUNTIME_ATTRIBUTE}]`)) {
		element.remove();
	}
	// The runtime captures window.parent and registers its wheel listener before any artboard script.
	const runtimeScript = parsed.createElement('script');
	runtimeScript.setAttribute('nonce', nonce);
	runtimeScript.setAttribute(CANVAS_RUNTIME_ATTRIBUTE, '');
	runtimeScript.textContent = runtimeSource;
	// Head order: the artboard's meta charset (moved up, so the encoding stays in the first bytes),
	// then FRAME_CSP, then the runtime, then everything else. The policy must come before every
	// artboard script: a script parsed before it runs unrestricted and could inject a nonce'd
	// <script src> before the policy applies.
	const policyMeta = parsed.createElement('meta');
	policyMeta.setAttribute('http-equiv', 'Content-Security-Policy');
	policyMeta.setAttribute('content', FRAME_CSP);
	const head = root.querySelector('head') ?? root;
	head.prepend(policyMeta, runtimeScript);
	const charsetMeta = root.querySelector('meta[charset]');
	if (charsetMeta !== null) {
		head.prepend(charsetMeta);
	}
	return `<!DOCTYPE html>${root.outerHTML}`;
};
