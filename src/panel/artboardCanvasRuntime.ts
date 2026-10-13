export const CANVAS_RUNTIME_ATTRIBUTE = 'data-cd-canvas-runtime';

export const CANVAS_WHEEL_MESSAGE = 'canvas:wheel';

// Runs inside the artboard iframe, injected first in head. Must stay free of the
// less-than character so textContent serialization can never close the script.
// `parent` is a replaceable global, so it is captured before any artboard script runs.
export const ARTBOARD_CANVAS_RUNTIME_SOURCE = `(() => {
	const host = window.parent;
	window.addEventListener(
		'wheel',
		(event) => {
			if (!event.ctrlKey && !event.metaKey) {
				return;
			}
			event.preventDefault();
			host.postMessage({ type: ${JSON.stringify(CANVAS_WHEEL_MESSAGE)}, deltaY: event.deltaY }, '*');
		},
		{ passive: false, capture: true },
	);
})();`;
