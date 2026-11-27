import type { Attachment } from 'svelte/attachments';

import {
	arrowNudge,
	type FrameGestureKind,
	type StageFrameGesture,
	type StageWheel,
} from './frameGesture';

type GestureTarget = { id: string; kind: FrameGestureKind };

// Stage's gesture glue: frame move / resize by pointer and keyboard, empty-stage drag pan, wheel.
export class StageGestures {
	readonly #viewport: () => HTMLDivElement | undefined;
	readonly #onFrameGesture: (gesture: StageFrameGesture) => void;
	readonly #onDragPan: (deltaX: number, deltaY: number) => void;
	readonly #onWheel: (wheel: StageWheel) => void;

	#dragging = $state(false);
	#lastPointerX = 0;
	#lastPointerY = 0;
	// Cleared before 'end' / 'cancel' is reported, so the lostpointercapture after pointerup
	// reports nothing. Only Escape reverts: a release outside the panel (capture lost) or a
	// pointercancel commits the last preview.
	#captured: (GestureTarget & { pointerId: number; element: Element }) | undefined = $state();
	// A plain Set on purpose: only the key handlers read it, so it needs no reactivity (not SvelteSet).
	readonly #heldArrows = new Set<string>();

	constructor({
		viewport,
		onFrameGesture,
		onDragPan,
		onWheel,
	}: {
		viewport: () => HTMLDivElement | undefined;
		onFrameGesture: (gesture: StageFrameGesture) => void;
		onDragPan: (deltaX: number, deltaY: number) => void;
		onWheel: (wheel: StageWheel) => void;
	}) {
		this.#viewport = viewport;
		this.#onFrameGesture = onFrameGesture;
		this.#onDragPan = onDragPan;
		this.#onWheel = onWheel;

		$effect(() => {
			const current = this.#captured;
			if (current === undefined) {
				return;
			}
			const handleKeydown = (event: KeyboardEvent): void => {
				if (event.key !== 'Escape') {
					return;
				}
				this.#captured = undefined;
				if (current.element.hasPointerCapture(current.pointerId)) {
					current.element.releasePointerCapture(current.pointerId);
				}
				this.#onFrameGesture({
					id: current.id,
					kind: current.kind,
					source: 'pointer',
					phase: 'cancel',
					screenX: 0,
					screenY: 0,
				});
			};
			window.addEventListener('keydown', handleKeydown);
			return () => {
				window.removeEventListener('keydown', handleKeydown);
			};
		});
	}

	get captured(): GestureTarget | undefined {
		return this.#captured;
	}

	get dragging(): boolean {
		return this.#dragging;
	}

	#viewportPoint = (event: PointerEvent): { screenX: number; screenY: number } => {
		const rect = this.#viewport()?.getBoundingClientRect();
		return {
			screenX: event.clientX - (rect?.left ?? 0),
			screenY: event.clientY - (rect?.top ?? 0),
		};
	};

	#isCaptured = (event: PointerEvent, target: GestureTarget): boolean =>
		this.#captured !== undefined &&
		this.#captured.id === target.id &&
		this.#captured.kind === target.kind &&
		this.#captured.pointerId === event.pointerId;

	startFrameGesture = (
		event: PointerEvent & { currentTarget: Element },
		target: GestureTarget,
	): void => {
		if (event.button !== 0 || this.#captured !== undefined) {
			return;
		}
		event.currentTarget.setPointerCapture(event.pointerId);
		this.#captured = { ...target, pointerId: event.pointerId, element: event.currentTarget };
		this.#onFrameGesture({
			...target,
			source: 'pointer',
			phase: 'start',
			...this.#viewportPoint(event),
		});
	};

	moveFrameGesture = (event: PointerEvent, target: GestureTarget): void => {
		if (!this.#isCaptured(event, target)) {
			return;
		}
		this.#onFrameGesture({
			...target,
			source: 'pointer',
			phase: 'move',
			...this.#viewportPoint(event),
		});
	};

	endFrameGesture = (event: PointerEvent, target: GestureTarget): void => {
		if (!this.#isCaptured(event, target)) {
			return;
		}
		this.#captured = undefined;
		this.#onFrameGesture({
			...target,
			source: 'pointer',
			phase: 'end',
			...this.#viewportPoint(event),
		});
	};

	// A label or handle removed mid-gesture (its frame was deleted) never gets lostpointercapture,
	// so teardown drops the capture, or every later drag returns early until Escape.
	// CanvasState's settleFrameGesture already dropped the gesture.
	releaseOnRemove: Attachment<Element> = (element) => () => {
		if (this.#captured?.element === element) {
			this.#captured = undefined;
		}
	};

	handleFrameKeydown = (event: KeyboardEvent, target: GestureTarget): void => {
		if (event.key === 'Escape') {
			this.#heldArrows.clear();
			this.#onFrameGesture({ ...target, source: 'keyboard', phase: 'cancel' });
			return;
		}
		const step = arrowNudge({
			key: event.key,
			shiftKey: event.shiftKey,
			hasModifier: event.ctrlKey || event.metaKey || event.altKey,
			kind: target.kind,
		});
		if (step === undefined) {
			return;
		}
		event.preventDefault();
		this.#heldArrows.add(event.key);
		this.#onFrameGesture({
			...target,
			source: 'keyboard',
			phase: 'nudge',
			...step,
			repeat: event.repeat,
		});
	};

	// Commits once no arrow is held, so holding two arrows and releasing one keeps nudging.
	handleFrameKeyup = (event: KeyboardEvent, target: GestureTarget): void => {
		if (this.#heldArrows.delete(event.key) && this.#heldArrows.size === 0) {
			this.#onFrameGesture({ ...target, source: 'keyboard', phase: 'end' });
		}
	};

	handleFrameBlur = (target: GestureTarget): void => {
		this.#heldArrows.clear();
		this.#onFrameGesture({ ...target, source: 'keyboard', phase: 'end' });
	};

	// Wheel inside an iframe never bubbles here, so this and cd:frame-wheel cannot double-zoom.
	// A listener, not onwheel: Svelte makes onwheel passive, and preventDefault needs non-passive.
	attachWheel: Attachment<HTMLDivElement> = (element) => {
		const handleWheel = (event: WheelEvent): void => {
			event.preventDefault();
			const rect = element.getBoundingClientRect();
			this.#onWheel({
				deltaX: event.deltaX,
				deltaY: event.deltaY,
				zoom: event.ctrlKey || event.metaKey,
				screenX: event.clientX - rect.left,
				screenY: event.clientY - rect.top,
			});
		};
		element.addEventListener('wheel', handleWheel, { passive: false });
		return () => {
			element.removeEventListener('wheel', handleWheel);
		};
	};

	startDrag = (event: PointerEvent & { currentTarget: HTMLDivElement }): void => {
		if (event.button !== 0) {
			return;
		}
		// Empty stage: the viewport or any direct child of it (Pins wraps its buttons for this).
		const onEmptyStage =
			event.target === event.currentTarget ||
			(event.target instanceof Element && event.target.parentElement === event.currentTarget);
		if (!onEmptyStage) {
			return;
		}
		this.#dragging = true;
		event.currentTarget.setPointerCapture(event.pointerId);
		this.#lastPointerX = event.clientX;
		this.#lastPointerY = event.clientY;
	};

	moveDrag = (event: PointerEvent): void => {
		if (!this.#dragging) {
			return;
		}
		this.#onDragPan(this.#lastPointerX - event.clientX, this.#lastPointerY - event.clientY);
		this.#lastPointerX = event.clientX;
		this.#lastPointerY = event.clientY;
	};

	endDrag = (): void => {
		this.#dragging = false;
	};
}
