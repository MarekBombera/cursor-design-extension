import { MAX_FRAME_HEIGHT } from '../../disk/layout';
import { installCommentPicking } from './commentPicking';
import {
	FRAME_HEIGHT_MESSAGE,
	FRAME_KEY_MESSAGE,
	FRAME_READY_MESSAGE,
	FRAME_WHEEL_MESSAGE,
} from './frameMessages';

// Runs inside the artboard iframe, injected first in head. Consumers import it as a string
// through `?iife` (scripts/iifeStringPlugin.ts). `parent` is a replaceable global, so it is
// captured before any artboard script runs.
const host = window.parent;
let lastSentHeight: number | undefined;
let heightTimer: ReturnType<typeof setTimeout> | undefined;

const measureHeight = (): number => {
	const htmlHeight = document.documentElement.getBoundingClientRect().height;
	const bodyHeight = document.body ? document.body.scrollHeight : 0;
	return Math.ceil(Math.max(htmlHeight, bodyHeight));
};

const postHeight = (): void => {
	heightTimer = undefined;
	const measured = measureHeight();
	const height = measured > MAX_FRAME_HEIGHT ? MAX_FRAME_HEIGHT : measured;
	if (height === lastSentHeight) {
		return;
	}
	lastSentHeight = height;
	host.postMessage({ type: FRAME_HEIGHT_MESSAGE, height }, '*');
};

const scheduleHeight = (): void => {
	if (heightTimer !== undefined) {
		clearTimeout(heightTimer);
	}
	heightTimer = setTimeout(postHeight, 100);
};

const heightObserver = new ResizeObserver(scheduleHeight);
heightObserver.observe(document.documentElement);
const observeBody = (): void => {
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

const overflowCanScroll = (value: string): boolean =>
	value === 'auto' || value === 'scroll' || value === 'overlay';

const canTakeWheel = (element: Element, event: WheelEvent, useY: boolean): boolean => {
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

const postWheel = (event: WheelEvent, ctrlKey: boolean): void => {
	host.postMessage(
		{
			type: FRAME_WHEEL_MESSAGE,
			deltaX: event.deltaX,
			deltaY: event.deltaY,
			ctrlKey,
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
		let node: Element | null =
			event.target instanceof Element
				? event.target
				: event.target instanceof Node
					? event.target.parentElement
					: null;
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

// C and Escape with focus in the frame reach the chrome as cd:key; the chrome decides what they do.
// Never prevented, so the design still sees them. Separate from Comment mode's input blocking.
// ponytail: a design with its own bare `c` shortcut also toggles Comment mode in Interact mode;
// only editable targets are excluded. `event.key` is layout-dependent, so a layout that never
// produces `c` cannot toggle by key (the Comment button still works).
window.addEventListener(
	'keydown',
	(event) => {
		if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.isComposing) {
			return;
		}
		const key =
			event.key === 'c' || event.key === 'C' ? 'c' : event.key === 'Escape' ? 'Escape' : undefined;
		if (key === undefined) {
			return;
		}
		// composedPath, so an input inside a shadow root counts as editable too.
		const origin = event.composedPath()[0];
		if (
			origin instanceof HTMLElement &&
			(origin.isContentEditable || origin.matches('input, textarea, select'))
		) {
			return;
		}
		host.postMessage({ type: FRAME_KEY_MESSAGE, key }, '*');
	},
	{ capture: true },
);

installCommentPicking(host);

// Last, after every listener exists: chrome answers with the current cd:mode.
host.postMessage({ type: FRAME_READY_MESSAGE }, '*');
