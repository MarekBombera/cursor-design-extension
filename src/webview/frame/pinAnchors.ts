import { anchorsMoved, capAnchorRect } from './anchorRects';
import { visibleRect } from './commentPicking';
import {
	type AnchorRect,
	type AnchorRequest,
	FRAME_ANCHOR_RECTS_MESSAGE,
	FRAME_ANCHORS_MESSAGE,
	parseChromeFrameMessage,
	postToChrome,
} from './frameMessages';

const CAPTURED_TRIGGERS = ['scroll', 'transitionend', 'animationend'] as const;

// Reads layout only; observes nothing while chrome has sent no anchors.
// ponytail: every measurement re-resolves every selector (≤ MAX_COMMENTS querySelectorAll per
// frame). Upgrade path: re-resolve only after a mutation.
// ponytail: a pin does not follow its element during a CSS transition or animation; it catches up
// on transitionend / animationend or any other trigger. Upgrade path: measure per frame while one
// runs.
export const installPinAnchors = (host: Window): void => {
	let requests: readonly AnchorRequest[] = [];
	let last: readonly AnchorRect[] | undefined;
	// Set by each cd:anchors: the next measurement posts even when nothing moved.
	let force = false;
	let pending: number | undefined;
	let resizeObserver: ResizeObserver | undefined;
	let mutationObserver: MutationObserver | undefined;
	// What resizeObserver observes. observe() fires an initial notification, so re-observing an
	// element on every measurement would loop forever.
	let observed = new Set<Element>();

	const measure = (): void => {
		pending = undefined;
		const resolved = new Set<Element>([document.documentElement]);
		const anchors: AnchorRect[] = requests.map(({ id, selector }) => {
			let matches: NodeListOf<Element> | undefined;
			try {
				matches = document.querySelectorAll(selector);
			} catch {
				matches = undefined;
			}
			const target = matches?.length === 1 ? matches[0] : undefined;
			if (target === undefined) {
				return { id, box: null, visible: null };
			}
			resolved.add(target);
			const { x, y, width, height } = target.getBoundingClientRect();
			const visible = visibleRect(target);
			return {
				id,
				box: capAnchorRect({ x, y, width, height }),
				visible: visible === null ? null : capAnchorRect(visible),
			};
		});
		if (resizeObserver !== undefined) {
			for (const element of observed) {
				if (!resolved.has(element)) {
					resizeObserver.unobserve(element);
				}
			}
			for (const element of resolved) {
				if (!observed.has(element)) {
					resizeObserver.observe(element);
				}
			}
			observed = resolved;
		}
		if (!force && !anchorsMoved({ last, next: anchors })) {
			return;
		}
		force = false;
		last = anchors;
		postToChrome(host, { type: FRAME_ANCHOR_RECTS_MESSAGE, anchors });
	};

	const schedule = (): void => {
		if (pending === undefined) {
			pending = requestAnimationFrame(measure);
		}
	};

	const start = (): void => {
		if (resizeObserver !== undefined) {
			return;
		}
		resizeObserver = new ResizeObserver(schedule);
		mutationObserver = new MutationObserver(schedule);
		mutationObserver.observe(document.documentElement, {
			childList: true,
			subtree: true,
			attributes: true,
			characterData: true,
		});
		for (const type of CAPTURED_TRIGGERS) {
			window.addEventListener(type, schedule, { capture: true });
		}
		window.addEventListener('resize', schedule);
	};

	const stop = (): void => {
		resizeObserver?.disconnect();
		mutationObserver?.disconnect();
		resizeObserver = undefined;
		mutationObserver = undefined;
		observed = new Set();
		for (const type of CAPTURED_TRIGGERS) {
			window.removeEventListener(type, schedule, { capture: true });
		}
		window.removeEventListener('resize', schedule);
		if (pending !== undefined) {
			cancelAnimationFrame(pending);
			pending = undefined;
		}
	};

	window.addEventListener('message', (event) => {
		if (event.source !== host) {
			return;
		}
		const message = parseChromeFrameMessage(event.data);
		if (message?.type !== FRAME_ANCHORS_MESSAGE) {
			return;
		}
		requests = message.anchors;
		if (requests.length === 0) {
			stop();
		} else {
			start();
		}
		force = true;
		schedule();
	});
};
