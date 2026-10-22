import { CANVAS_RUNTIME_ATTRIBUTE } from './frame/frameMessages';

// The blob frame inherits the chrome's nonce CSP, so bare script/style tags would be blocked.
// Stamping the chrome nonce re-allows exactly those tags; inline handlers, style attributes,
// and subresources stay blocked (v1 limit). DOMParser never executes scripts, and meta
// http-equiv is stripped so the artboard cannot stack its own policy on top. The canvas
// runtime goes into the blob copy only; disk and export HTML never see it.
export const stampArtboardHtml = ({
	html,
	nonce,
	runtimeSource,
}: {
	html: string;
	nonce: string;
	runtimeSource: string;
}): string => {
	const parsed = new DOMParser().parseFromString(html, 'text/html');
	for (const element of parsed.querySelectorAll('meta[http-equiv]')) {
		element.remove();
	}
	for (const element of parsed.querySelectorAll('script, style')) {
		element.setAttribute('nonce', nonce);
	}
	for (const element of parsed.querySelectorAll(`script[${CANVAS_RUNTIME_ATTRIBUTE}]`)) {
		element.remove();
	}
	// First in head (after meta charset) so the runtime captures window.parent and registers
	// its wheel listener before any artboard script.
	const runtimeScript = parsed.createElement('script');
	runtimeScript.setAttribute('nonce', nonce);
	runtimeScript.setAttribute(CANVAS_RUNTIME_ATTRIBUTE, '');
	runtimeScript.textContent = runtimeSource;
	const charsetMeta = parsed.head.querySelector('meta[charset]');
	if (charsetMeta === null) {
		parsed.head.prepend(runtimeScript);
	} else {
		charsetMeta.after(runtimeScript);
	}
	return `<!DOCTYPE html>${parsed.documentElement.outerHTML}`;
};
