import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { ZOOM_PRESETS, zoomChoices } from './zoomChoices';

test('zoomChoices selects a preset, slots a non-preset zoom in sorted place, and rounds onto a preset', () => {
	const presetValues = ZOOM_PRESETS.map(String);
	const exact = zoomChoices(1.5);
	assert.deepEqual(
		exact.options.map((option) => option.value),
		presetValues,
	);
	assert.equal(exact.selected, '1.5');
	assert.equal(exact.options.find((option) => option.value === '1.5')?.label, '150%');

	// Between 0.5 and 0.75, so arrow keys from it step to a neighbouring preset.
	const between = zoomChoices(0.63);
	assert.deepEqual(
		between.options.map((option) => option.value),
		['0.5', '0.63', ...presetValues.slice(1)],
	);
	assert.deepEqual(between.options[1], { value: '0.63', label: '63%' });
	assert.equal(between.selected, '0.63');
	// Below and above every preset: first and last.
	assert.equal(zoomChoices(0.25).options[0]?.value, '0.25');
	assert.equal(zoomChoices(3).options.at(-1)?.value, '3');

	const rounded = zoomChoices(0.996);
	assert.equal(rounded.options.length, presetValues.length);
	assert.equal(rounded.selected, '1');
});
