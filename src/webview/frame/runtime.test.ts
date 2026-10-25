import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import runtimeSource from './runtime.ts?iife';
import {
	FRAME_HEIGHT_MESSAGE,
	FRAME_HOVER_MESSAGE,
	FRAME_PICK_MESSAGE,
	FRAME_READY_MESSAGE,
	FRAME_WHEEL_MESSAGE,
} from './frameMessages';

test('canvas runtime posts only its frame messages and never touches the artboard', () => {
	// Picking listeners live in a function bundled above; what matters is the call order:
	// capture parent, register wheel, install picking, then announce cd:ready.
	const parentIndex = runtimeSource.indexOf('window.parent');
	const wheelIndex = runtimeSource.indexOf('window.addEventListener("wheel"');
	const installIndex = runtimeSource.indexOf('installCommentPicking(host);');
	const readyIndex = runtimeSource.indexOf('host.postMessage({ type: FRAME_READY_MESSAGE }');
	assert.ok(parentIndex >= 0 && wheelIndex >= 0 && installIndex >= 0);
	assert.ok(parentIndex < wheelIndex && wheelIndex < installIndex && installIndex < readyIndex);
	assert.ok(!runtimeSource.includes('</'));
	assert.ok(runtimeSource.includes(JSON.stringify(FRAME_HEIGHT_MESSAGE)));
	assert.ok(runtimeSource.includes(JSON.stringify(FRAME_WHEEL_MESSAGE)));
	for (const type of [FRAME_READY_MESSAGE, FRAME_HOVER_MESSAGE, FRAME_PICK_MESSAGE]) {
		assert.ok(runtimeSource.includes(JSON.stringify(type)), type);
	}
	// height, wheel, hover, pick, ready
	assert.equal(runtimeSource.split('host.postMessage').length - 1, 5);
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
	// Finder reads element.classList; only its mutators are forbidden.
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
		'setAttribute',
		'data-dc-',
		'sc-host',
		'design_doc_mode',
	]) {
		assert.ok(!runtimeSource.includes(forbidden), forbidden);
	}
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
		'ownerSVGElement',
		// The paint check reads styles itself; selector.ts reading them must not satisfy this.
		'paintsFromStyle({',
	]) {
		assert.ok(runtimeSource.includes(required), required);
	}
});
