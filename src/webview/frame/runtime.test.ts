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

// ponytail: a soft ceiling on the runtime every exported canvas.html embeds: a 35,829-char
// unminified baseline (re-baselined in 9h for the Edit-mode pick's computed values and text states)
// plus 4,096. Re-baseline when a toolchain bump changes the unminified output.
const RUNTIME_SIZE_BUDGET = 39_925;

test('canvas runtime stays within its size budget', () => {
	assert.ok(runtimeSource.length < RUNTIME_SIZE_BUDGET, String(runtimeSource.length));
});

test('canvas runtime posts only its frame messages and writes the artboard only to preview', () => {
	// Call order: capture parent, register wheel, install picking, install pin anchors, cd:ready.
	const order = [
		'window.parent',
		'window.addEventListener("wheel"',
		'installCommentPicking(host);',
		'installPinAnchors(host);',
		'host.postMessage({ type: FRAME_READY_MESSAGE }',
	].map((marker) => runtimeSource.indexOf(marker));
	assert.ok(!order.includes(-1), String(order));
	assert.deepEqual(
		[...order].sort((left, right) => left - right),
		order,
	);
	assert.ok(!runtimeSource.includes('</'));
	for (const type of [
		FRAME_HEIGHT_MESSAGE,
		FRAME_WHEEL_MESSAGE,
		FRAME_KEY_MESSAGE,
		FRAME_HOVER_MESSAGE,
		FRAME_PICK_MESSAGE,
		FRAME_ANCHOR_RECTS_MESSAGE,
		FRAME_READY_MESSAGE,
	]) {
		assert.ok(runtimeSource.includes(JSON.stringify(type)), type);
	}
	// One postMessage per type above, no other.
	assert.equal(runtimeSource.split('host.postMessage').length - 1, 7);
	// Finder reads element.classList; only its mutators are forbidden. pinAnchors.ts is bundled
	// into the same string, so the check covers it too.
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

// ponytail: a source grep until a browser spec proves a design posting cd:mode or cd:edit-apply
// to its own window changes nothing (11f B2P2).
test('the runtime trusts only the captured parent and announces cd:ready after every listener', () => {
	// One check per message listener: comment picking and pin anchors.
	assert.equal(runtimeSource.split('event.source !== host').length - 1, 2);
	const afterListeners = runtimeSource.slice(runtimeSource.lastIndexOf('addEventListener'));
	assert.match(afterListeners, /host\.postMessage\(\{ type: (FRAME_READY_MESSAGE|"cd:ready") \}/);
});
