import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import runtimeSource from './runtime.ts?iife';
import {
	FRAME_ANCHOR_RECTS_MESSAGE,
	FRAME_HEIGHT_MESSAGE,
	FRAME_HOVER_MESSAGE,
	FRAME_KEY_MESSAGE,
	FRAME_PICK_MESSAGE,
	FRAME_READY_MESSAGE,
	FRAME_WHEEL_MESSAGE,
} from './frameMessages';

// ponytail: a soft ceiling on the runtime every exported canvas.html embeds: a 31,039-char
// unminified baseline plus 4,096. Re-baseline when a toolchain bump changes the unminified output.
const RUNTIME_SIZE_BUDGET = 35_135;

test('canvas runtime stays within its size budget', () => {
	assert.ok(runtimeSource.length < RUNTIME_SIZE_BUDGET, String(runtimeSource.length));
});

test('canvas runtime posts only its frame messages and writes the artboard only to preview', () => {
	// Picking and pin listeners live in functions bundled above; what matters is the call order:
	// capture parent, register wheel, install picking, install pin anchors, then announce cd:ready.
	const parentIndex = runtimeSource.indexOf('window.parent');
	const wheelIndex = runtimeSource.indexOf('window.addEventListener("wheel"');
	const installIndex = runtimeSource.indexOf('installCommentPicking(host);');
	const anchorsIndex = runtimeSource.indexOf('installPinAnchors(host);');
	const readyIndex = runtimeSource.indexOf('host.postMessage({ type: FRAME_READY_MESSAGE }');
	assert.ok(parentIndex >= 0 && wheelIndex >= 0 && installIndex >= 0);
	assert.ok(parentIndex < wheelIndex && wheelIndex < installIndex && installIndex < anchorsIndex);
	assert.ok(anchorsIndex < readyIndex);
	assert.ok(!runtimeSource.includes('</'));
	assert.ok(runtimeSource.includes(JSON.stringify(FRAME_HEIGHT_MESSAGE)));
	assert.ok(runtimeSource.includes(JSON.stringify(FRAME_WHEEL_MESSAGE)));
	for (const type of [
		FRAME_READY_MESSAGE,
		FRAME_HOVER_MESSAGE,
		FRAME_PICK_MESSAGE,
		FRAME_KEY_MESSAGE,
		FRAME_ANCHOR_RECTS_MESSAGE,
	]) {
		assert.ok(runtimeSource.includes(JSON.stringify(type)), type);
	}
	// height, wheel, key, hover, pick, anchor-rects, ready
	assert.equal(runtimeSource.split('host.postMessage').length - 1, 7);
	assert.ok(runtimeSource.includes('parentElement'));
	assert.ok(runtimeSource.includes('overflowY'));
	assert.ok(runtimeSource.includes('overflowX'));
	assert.ok(runtimeSource.includes('"overlay"'));
	assert.ok(runtimeSource.includes('scrollHeight - 1 >'));
	assert.ok(runtimeSource.includes('2e4') || runtimeSource.includes('20000'));
	assert.ok(runtimeSource.includes('x: event.clientX'));
	assert.ok(runtimeSource.includes('y: event.clientY'));
	assert.ok(runtimeSource.includes('passive: false'));
	assert.ok(runtimeSource.includes('capture: true'));
	// Finder reads element.classList; only its mutators are forbidden. pinAnchors.ts is bundled
	// into the same string (its observers are present), so the check covers it too.
	assert.ok(runtimeSource.includes('new MutationObserver('));
	for (const forbidden of [
		'.style',
		'classList.add',
		'classList.remove',
		'classList.toggle',
		'classList.replace',
		'classList.value',
		'className =',
		'removeAttribute',
		'.dataset',
		'innerHTML',
		'data-dc-',
		'sc-host',
		'design_doc_mode',
	]) {
		assert.ok(!runtimeSource.includes(forbidden), forbidden);
	}
	// The one style write is cd:edit-apply's Edit-mode preview.
	assert.equal(runtimeSource.split('setAttribute(').length - 1, 1);
	// Finder is bundled into the runtime string (a dropped import fails here).
	assert.ok(runtimeSource.includes("Can't generate CSS selector"));
});

test('comment mode trusts only the captured parent, blocks input and picks by hit test', () => {
	assert.ok(runtimeSource.includes('event.source !== host'));
	// cd:ready goes out after every listener is registered.
	const afterListeners = runtimeSource.slice(runtimeSource.lastIndexOf('addEventListener'));
	assert.match(afterListeners, /host\.postMessage\(\{ type: (FRAME_READY_MESSAGE|"cd:ready") \}/);
	for (const blocked of [
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
		assert.ok(runtimeSource.includes(JSON.stringify(blocked)), blocked);
	}
	for (const required of [
		'"Enter"',
		'" "',
		'"ArrowUp"',
		'"ArrowDown"',
		'preventDefault()',
		'stopImmediatePropagation()',
		'window.focus()',
		'elementsFromPoint',
		'requestAnimationFrame',
		'cancelAnimationFrame',
		// Scroll/resize re-posts are batched per frame and cancelled by cd:mode.
		'cancelAnimationFrame(pendingRepost',
		'ownerSVGElement',
		// The paint check reads styles itself; selector.ts reading them must not satisfy this.
		'paintsFromStyle({',
	]) {
		assert.ok(runtimeSource.includes(required), required);
	}
});
