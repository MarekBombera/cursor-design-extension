import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { nextRowIndex, pageRows } from './pagesMenu';

const NOW = Date.parse('2026-11-24T12:00:00.000Z');

test('pageRows keeps order, marks the open page and times each row', () => {
	const rows = pageRows({
		pages: [
			{ id: 'page-2', title: 'Pricing', updatedAt: '2026-11-24T11:59:30.000Z' },
			{ id: 'page-1', title: 'Home', updatedAt: null },
			{ id: 'page-10', title: 'Old', updatedAt: 'not a date' },
		],
		openPageId: 'page-1',
		now: NOW,
	});
	assert.deepEqual(
		rows.map((row) => [row.id, row.current, row.time, row.canDelete]),
		[
			['page-2', false, 'just now', true],
			['page-1', true, undefined, true],
			['page-10', false, undefined, true],
		],
	);
});

test('pageRows: the last page cannot be deleted, and an unlisted open id marks no row', () => {
	const [row] = pageRows({
		pages: [{ id: 'page-1', title: 'Home', updatedAt: null }],
		openPageId: 'page-9',
		now: NOW,
	});
	assert.equal(row?.canDelete, false);
	assert.equal(row?.current, false);
	assert.deepEqual(pageRows({ pages: [], openPageId: '', now: NOW }), []);
});

test('nextRowIndex wraps the arrows and jumps with Home / End', () => {
	assert.equal(nextRowIndex({ key: 'ArrowDown', index: 2, count: 3 }), 0);
	assert.equal(nextRowIndex({ key: 'ArrowUp', index: 0, count: 3 }), 2);
	assert.equal(nextRowIndex({ key: 'ArrowDown', index: 0, count: 3 }), 1);
	assert.equal(nextRowIndex({ key: 'Home', index: 2, count: 3 }), 0);
	assert.equal(nextRowIndex({ key: 'End', index: 0, count: 3 }), 2);
});

test('nextRowIndex ignores other keys and an empty menu', () => {
	assert.equal(nextRowIndex({ key: 'Tab', index: 0, count: 3 }), undefined);
	assert.equal(nextRowIndex({ key: 'Enter', index: 0, count: 3 }), undefined);
	assert.equal(nextRowIndex({ key: 'ArrowDown', index: 0, count: 0 }), undefined);
});
