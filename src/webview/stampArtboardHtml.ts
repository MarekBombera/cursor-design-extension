import { CANVAS_RUNTIME_ATTRIBUTE } from './frame/frameMessages';

// Second policy on top of the inherited chrome CSP (a request must pass both). Artboard JS can read
// the chrome nonce and stamp it on a new <script src>, so this inline-only policy is what stops
// every remote script, style, image, font or fetch.
// ponytail: Chromium's CSP does not govern WebRTC or DNS prefetch hints; the sandbox (opaque
// origin, no VS Code API) is the wall that matters. Upgrade path: none short of a network proxy.
export const FRAME_CSP =
	"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'";

// Nonces every artboard script and style (the blob frame inherits the chrome's nonce CSP), strips
// every meta http-equiv so the artboard cannot loosen or stack policies, and adds FRAME_CSP and the
// canvas runtime. Blob copy only: disk and export HTML never see any of it.
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
	// Before any artboard script, so a design cannot tamper with window.parent or the wheel
	// listener before the runtime captures them.
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
