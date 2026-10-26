// @vitest-environment happy-dom
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { CANVAS_RUNTIME_ATTRIBUTE } from './frame/frameMessages';
import runtimeSource from './frame/runtime.ts?iife';
import { FRAME_CSP, stampArtboardHtml } from './stampArtboardHtml';

const runtimeSelector = `script[${CANVAS_RUNTIME_ATTRIBUTE}]`;

const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

const stamp = (html: string): Document =>
	parse(stampArtboardHtml({ html, nonce: 'N', runtimeSource: 'window.runtime = 1;' }));

test('the artboard meta http-equiv is replaced by FRAME_CSP and every script and style carries the nonce', () => {
	const stamped = stamp(
		'<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"><style>p{}</style></head><body><script>1</script><script nonce="old">2</script></body></html>',
	);
	const policies = stamped.querySelectorAll('meta[http-equiv]');
	assert.equal(policies.length, 1);
	assert.equal(policies[0]?.getAttribute('http-equiv'), 'Content-Security-Policy');
	assert.equal(policies[0]?.getAttribute('content'), FRAME_CSP);
	const tagged = [...stamped.querySelectorAll('script, style')];
	assert.equal(tagged.length, 4);
	for (const element of tagged) {
		assert.equal(element.getAttribute('nonce'), 'N');
	}
});

const policySelector = 'meta[http-equiv="Content-Security-Policy"]';

test('head starts with charset (when present), FRAME_CSP, then the runtime', () => {
	const withCharset = stamp('<head><title>t</title><meta charset="utf-8"><style>x</style></head>');
	const first = withCharset.head.firstElementChild;
	assert.ok(first?.matches('meta[charset]'));
	assert.ok(first?.nextElementSibling?.matches(policySelector));
	assert.ok(first?.nextElementSibling?.nextElementSibling?.matches(runtimeSelector));

	const withoutCharset = stamp('<head><title>t</title></head><p>x</p>');
	assert.ok(withoutCharset.head.firstElementChild?.matches(policySelector));
	assert.ok(withoutCharset.head.firstElementChild?.nextElementSibling?.matches(runtimeSelector));

	const fragment = stamp('<p>only body</p>');
	assert.ok(fragment.head.firstElementChild?.matches(policySelector));
	assert.ok(fragment.head.firstElementChild?.nextElementSibling?.matches(runtimeSelector));
});

// A script parsed before the policy would run unrestricted and could inject a nonce'd remote script.
test('FRAME_CSP precedes every artboard script, even one placed before meta charset', () => {
	const stamped = stamp('<head><script>early()</script><meta charset="utf-8"></head><body></body>');
	const policy = stamped.querySelector(policySelector);
	assert.ok(policy);
	for (const script of stamped.querySelectorAll('script')) {
		assert.ok(
			policy.compareDocumentPosition(script) & Node.DOCUMENT_POSITION_FOLLOWING,
			script.outerHTML,
		);
	}
});

test('a pre-existing runtime script is replaced, not duplicated', () => {
	const stamped = stamp(
		`<head><meta charset="utf-8"></head><body><script ${CANVAS_RUNTIME_ATTRIBUTE}>evil()</script></body>`,
	);
	const runtimes = stamped.querySelectorAll(runtimeSelector);
	assert.equal(runtimes.length, 1);
	assert.equal(runtimes[0]?.textContent, 'window.runtime = 1;');
	assert.equal(runtimes[0]?.getAttribute('nonce'), 'N');
});

test('output starts with a doctype and re-parses with the real runtime exactly once', () => {
	const output = stampArtboardHtml({
		html: '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>a</p></body></html>',
		nonce: 'N',
		runtimeSource,
	});
	assert.ok(output.startsWith('<!DOCTYPE html><html'));
	const runtimes = parse(output).querySelectorAll(runtimeSelector);
	assert.equal(runtimes.length, 1);
	assert.equal(runtimes[0]?.textContent, runtimeSource);
});
