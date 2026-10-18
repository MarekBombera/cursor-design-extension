export const CANVAS_RUNTIME_ATTRIBUTE = 'data-cd-canvas-runtime';

export const FRAME_WHEEL_MESSAGE = 'cd:frame-wheel';

export const FRAME_HEIGHT_MESSAGE = 'cd:frame-height';

// Runs inside the artboard iframe, injected first in head. Must stay free of the
// less-than character so textContent serialization can never close the script.
// `parent` is a replaceable global, so it is captured before any artboard script runs.
export const ARTBOARD_CANVAS_RUNTIME_SOURCE = `(() => {
	const host = window.parent;
	const heightType = ${JSON.stringify(FRAME_HEIGHT_MESSAGE)};
	const wheelType = ${JSON.stringify(FRAME_WHEEL_MESSAGE)};
	const maxHeight = 20000;
	let lastSentHeight;
	let heightTimer;

	const measureHeight = () => {
		const htmlHeight = document.documentElement.getBoundingClientRect().height;
		const bodyHeight = document.body ? document.body.scrollHeight : 0;
		return Math.ceil(Math.max(htmlHeight, bodyHeight));
	};

	const postHeight = () => {
		heightTimer = undefined;
		const measured = measureHeight();
		const height = measured > maxHeight ? maxHeight : measured;
		if (height === lastSentHeight) {
			return;
		}
		lastSentHeight = height;
		host.postMessage({ type: heightType, height: height }, '*');
	};

	const scheduleHeight = () => {
		if (heightTimer !== undefined) {
			clearTimeout(heightTimer);
		}
		heightTimer = setTimeout(postHeight, 100);
	};

	const heightObserver = new ResizeObserver(scheduleHeight);
	heightObserver.observe(document.documentElement);
	const observeBody = () => {
		if (document.body) {
			heightObserver.observe(document.body);
		}
	};
	if (document.body) {
		observeBody();
	} else {
		window.addEventListener('DOMContentLoaded', observeBody);
	}
	window.addEventListener('load', scheduleHeight);

	const overflowCanScroll = (value) =>
		value === 'auto' || value === 'scroll' || value === 'overlay';

	const canTakeWheel = (element, event, useY) => {
		const style = window.getComputedStyle(element);
		if (useY) {
			if (!overflowCanScroll(style.overflowY)) {
				return false;
			}
			if (event.deltaY > 0) {
				return element.scrollHeight - 1 > element.scrollTop + element.clientHeight;
			}
			if (0 > event.deltaY) {
				return element.scrollTop > 0;
			}
			return false;
		}
		if (!overflowCanScroll(style.overflowX)) {
			return false;
		}
		if (event.deltaX > 0) {
			return element.scrollWidth - 1 > element.scrollLeft + element.clientWidth;
		}
		if (0 > event.deltaX) {
			return element.scrollLeft > 0;
		}
		return false;
	};

	const postWheel = (event, ctrlKey) => {
		host.postMessage(
			{
				type: wheelType,
				deltaX: event.deltaX,
				deltaY: event.deltaY,
				ctrlKey: ctrlKey,
				x: event.clientX,
				y: event.clientY,
			},
			'*',
		);
	};

	window.addEventListener(
		'wheel',
		(event) => {
			if (event.ctrlKey || event.metaKey) {
				event.preventDefault();
				postWheel(event, true);
				return;
			}
			const useY = Math.abs(event.deltaY) >= Math.abs(event.deltaX);
			let node = event.target;
			if (node && node.nodeType !== 1) {
				node = node.parentElement;
			}
			while (node && node !== document.body && node !== document.documentElement) {
				if (canTakeWheel(node, event, useY)) {
					return;
				}
				node = node.parentElement;
			}
			event.preventDefault();
			postWheel(event, false);
		},
		{ passive: false, capture: true },
	);
})();`;
