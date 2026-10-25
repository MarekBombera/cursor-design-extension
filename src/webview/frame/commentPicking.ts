import {
	FRAME_HOVER_MESSAGE,
	FRAME_MODE_MESSAGE,
	FRAME_PICK_MESSAGE,
	type FrameMode,
	type FrameRect,
	PICK_PARENT_MESSAGE,
	parseChromeFrameMessage,
} from './frameMessages';
import { stepToChild, stepToParent } from './pickPath';
import {
	clipRect,
	isUnchangedPick,
	paintsFromStyle,
	pickTarget,
	pointInTarget,
	sameRect,
} from './pickTarget';
import { describeElement, type PickDescription } from './selector';

// Comment mode (8d1). Chrome sends cd:mode / cd:pick-parent / cd:pick-child; the runtime blocks
// the design's own input and reports what a click picks. It never writes to the design DOM.
// Part of the frame runtime: runtime.ts calls this after capturing `host`, before cd:ready.
export const installCommentPicking = (host: Window): void => {
	let mode: FrameMode = 'interact';
	// Index 0 is the clicked element, the last entry the current pick; empty means no pick.
	let path: readonly Element[] = [];
	// The click inside path[0]'s unclipped box, so the pick point follows the element.
	let anchorOffset = { x: 0, y: 0 };
	// describeElement per element of the current path, cleared on each click and cd:mode. Finder
	// can take its full timeout, so ↑/↓ over the same path never runs it twice.
	let descriptions = new Map<Element, PickDescription>();
	// Path elements already described again after the design removed them (once each).
	let removed = new WeakSet<Element>();
	// Last posted hover; undefined means none posted since the last reset.
	let hover: { element: Element | undefined; rect: FrameRect | null } | undefined;
	let lastPointer: { x: number; y: number; altKey: boolean } | undefined;
	let pendingHover: number | undefined;
	// The last cd:pick sent; a scroll or resize re-post that would repeat it is skipped.
	let lastPosted:
		| {
				element: Element;
				described: PickDescription;
				rect: FrameRect | null;
				point: { x: number; y: number };
		  }
		| undefined;
	let pendingRepost: number | undefined;

	const isRoot = (element: Element): boolean =>
		element.localName === 'html' || element.localName === 'body';

	// SVG internals resolve to the outermost <svg>.
	const resolve = (element: Element): Element => {
		let current = element;
		while (current instanceof SVGElement && current.ownerSVGElement !== null) {
			current = current.ownerSVGElement;
		}
		return current;
	};

	const contains = (ancestor: Element, element: Element): boolean => ancestor.contains(element);

	const hasOwnText = (element: Element): boolean =>
		Array.from(element.childNodes).some(
			(child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim() !== '',
		);

	const paints = (element: Element): boolean => {
		const box = element.getBoundingClientRect();
		return paintsFromStyle({
			localName: element.localName,
			width: box.width,
			height: box.height,
			hasOwnText: hasOwnText(element),
			style: window.getComputedStyle(element),
		});
	};

	const parentOf = (element: Element): Element | null =>
		element.parentElement === null ? null : resolve(element.parentElement);

	const stepUp = (current: readonly Element[]): readonly Element[] =>
		stepToParent({ path: current, parentOf, isRoot });

	// The path a click at this point starts; Alt+click starts one step up, so ↓ returns.
	const pathAt = (point: { x: number; y: number; altKey: boolean }): readonly Element[] => {
		const picked = pickTarget({
			stack: document.elementsFromPoint(point.x, point.y),
			resolve,
			isRoot,
			paints,
			contains,
		});
		const start = [picked ?? document.body ?? document.documentElement];
		return point.altKey ? stepUp(start) : start;
	};

	const toFrameRect = (box: DOMRect): FrameRect => ({
		x: box.x,
		y: box.y,
		width: box.width,
		height: box.height,
	});

	// Frame-local client px, clipped to scrolling ancestors and the frame viewport. html and body
	// are not clip boxes: their overflow applies to the viewport, which is clipped last.
	const visibleRect = (element: Element): FrameRect | null => {
		if (!element.isConnected) {
			return null;
		}
		const viewport = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
		if (isRoot(element)) {
			return clipRect(toFrameRect(document.documentElement.getBoundingClientRect()), [viewport]);
		}
		const clips: FrameRect[] = [];
		for (
			let ancestor = element.parentElement;
			ancestor !== null && !isRoot(ancestor);
			ancestor = ancestor.parentElement
		) {
			const style = window.getComputedStyle(ancestor);
			if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
				clips.push(toFrameRect(ancestor.getBoundingClientRect()));
			}
		}
		clips.push(viewport);
		return clipRect(toFrameRect(element.getBoundingClientRect()), clips);
	};

	// A throw leaves no entry, so postPick sends nothing rather than another element's data.
	const describeCurrent = (): void => {
		const current = path.at(-1);
		if (current !== undefined && !descriptions.has(current)) {
			descriptions.set(current, describeElement(current, isRoot(current)));
		}
	};

	// A page pick is relative to the documentElement box, the same box as its rect.
	const pickPoint = (anchor: Element, target: Element): { x: number; y: number } =>
		anchor.isConnected && target.isConnected
			? pointInTarget({
					anchorBox: anchor.getBoundingClientRect(),
					offset: anchorOffset,
					targetBox: (isRoot(target) ? document.documentElement : target).getBoundingClientRect(),
				})
			: { x: 0, y: 0 };

	// Every post recomputes rect and point; the descriptions are kept, so scrolls skip finder.
	// A click or step forces the post; a re-post is skipped when chrome already has this pick.
	const postPick = ({ force }: { force: boolean }): void => {
		const anchor = path[0];
		const current = path.at(-1);
		const cached = current === undefined ? undefined : descriptions.get(current);
		// A target the design removed since it was described has no selector, text or styles now.
		// Described once (a page pick or a target finder never resolved included): later re-posts
		// carry the same description object and compare equal.
		if (
			current !== undefined &&
			cached !== undefined &&
			!current.isConnected &&
			!removed.has(current)
		) {
			descriptions.set(current, describeElement(current, isRoot(current)));
			removed.add(current);
		}
		const described = current === undefined ? undefined : descriptions.get(current);
		if (anchor === undefined || current === undefined || described === undefined) {
			return;
		}
		const next = {
			element: current,
			described,
			rect: visibleRect(current),
			point: pickPoint(anchor, current),
		};
		if (!force && lastPosted !== undefined && isUnchangedPick({ last: lastPosted, next })) {
			return;
		}
		host.postMessage(
			{
				type: FRAME_PICK_MESSAGE,
				...described,
				rect: next.rect,
				point: next.point,
				isPage: isRoot(current),
			},
			'*',
		);
		lastPosted = next;
	};

	// Posts only when the hovered element or its rect changed.
	const postHover = (element: Element | undefined): void => {
		const rect = element === undefined ? null : visibleRect(element);
		if (hover !== undefined && hover.element === element && sameRect(hover.rect, rect)) {
			return;
		}
		hover = { element, rect };
		host.postMessage({ type: FRAME_HOVER_MESSAGE, rect }, '*');
	};

	const cancelPendingHover = (): void => {
		if (pendingHover !== undefined) {
			cancelAnimationFrame(pendingHover);
			pendingHover = undefined;
		}
	};

	// Chrome relies on this: every cd:mode, even a repeat, forgets the pick and the hover.
	const setMode = (next: FrameMode): void => {
		mode = next;
		path = [];
		anchorOffset = { x: 0, y: 0 };
		descriptions = new Map();
		removed = new WeakSet();
		hover = undefined;
		lastPointer = undefined;
		cancelPendingHover();
		if (pendingRepost !== undefined) {
			cancelAnimationFrame(pendingRepost);
			pendingRepost = undefined;
		}
	};

	// A step always posts, even when the path did not change.
	const stepPick = (toParent: boolean): void => {
		if (path.length === 0) {
			return;
		}
		path = toParent ? stepUp(path) : stepToChild(path);
		describeCurrent();
		postPick({ force: true });
	};

	const BLOCKED_KEYS = new Set(['Enter', ' ', 'ArrowUp', 'ArrowDown']);

	// One capture listener for every blocked event, so picking can never race a second listener.
	// It blocks before picking, so a throw while describing still leaves the event blocked.
	const blockInComment = (event: Event): void => {
		if (mode !== 'comment') {
			return;
		}
		if (event instanceof KeyboardEvent && !BLOCKED_KEYS.has(event.key)) {
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		if (event instanceof KeyboardEvent) {
			const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
			if (plain && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
				stepPick(event.key === 'ArrowUp');
			}
		} else if (event.type === 'click' && event instanceof MouseEvent && event.button === 0) {
			// detail 0 is a keyboard or scripted click, which has no real pointer position.
			if (event.detail > 0) {
				path = pathAt({ x: event.clientX, y: event.clientY, altKey: event.altKey });
				descriptions = new Map();
				removed = new WeakSet();
				const clicked = path[0];
				if (clicked !== undefined) {
					const box = clicked.getBoundingClientRect();
					anchorOffset = { x: event.clientX - box.x, y: event.clientY - box.y };
				}
				describeCurrent();
				postPick({ force: true });
				// The blocked mousedown never moves focus, so ↑/↓ would stay in whatever had it
				// (Cursor chat). Focus this frame's window; the design DOM is untouched.
				window.focus();
			}
		}
	};

	for (const type of [
		'pointerdown',
		'pointerup',
		'mousedown',
		'mouseup',
		'click',
		'dblclick',
		'auxclick',
		'contextmenu',
		'submit',
		'keydown',
	]) {
		window.addEventListener(type, blockInComment, { capture: true });
	}

	const updateHover = (): void => {
		pendingHover = undefined;
		if (mode !== 'comment' || lastPointer === undefined) {
			return;
		}
		postHover(pathAt(lastPointer).at(-1));
	};

	// ponytail: hover follows pointer moves only; a wheel-pan under a still cursor keeps the old
	// hover until the next move. Upgrade: re-hit-test on scroll too.
	window.addEventListener(
		'pointermove',
		(event) => {
			if (mode !== 'comment') {
				return;
			}
			lastPointer = { x: event.clientX, y: event.clientY, altKey: event.altKey };
			if (pendingHover === undefined) {
				pendingHover = requestAnimationFrame(updateHover);
			}
		},
		{ capture: true },
	);

	window.addEventListener(
		'mouseout',
		(event) => {
			if (mode !== 'comment' || event.relatedTarget !== null) {
				return;
			}
			lastPointer = undefined;
			cancelPendingHover();
			postHover(undefined);
		},
		{ capture: true },
	);

	// A scroll or resize fires before that frame's rAF callbacks, so batching adds no lag.
	const repostFrame = (): void => {
		pendingRepost = undefined;
		if (mode !== 'comment') {
			return;
		}
		if (hover?.element !== undefined) {
			postHover(hover.element);
		}
		if (path.length > 0) {
			postPick({ force: false });
		}
	};

	// At most one re-post per animation frame, however many boxes scroll in it.
	const repostRects = (): void => {
		if (mode === 'comment' && pendingRepost === undefined) {
			pendingRepost = requestAnimationFrame(repostFrame);
		}
	};
	window.addEventListener('scroll', repostRects, { capture: true });
	window.addEventListener('resize', repostRects);

	// ponytail: a nested <iframe> in the design is its own document. Its interior is never hovered,
	// picked or blocked, and the iframe element cannot be clicked into. Upgrade: inject this
	// runtime into nested frames.
	window.addEventListener('message', (event) => {
		if (event.source !== host) {
			return;
		}
		const message = parseChromeFrameMessage(event.data);
		if (message === undefined) {
			return;
		}
		if (message.type === FRAME_MODE_MESSAGE) {
			setMode(message.mode);
			return;
		}
		stepPick(message.type === PICK_PARENT_MESSAGE);
	});
};
