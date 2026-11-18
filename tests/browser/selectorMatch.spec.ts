import { expect, test } from '@playwright/test';

import { SELECTOR_CASES } from '../../src/disk/selectorMatch.cases';

// Chromium is the authority for selectMatches' matching rules: every case the in-house matcher
// answers (expected !== null) must get the same answer from querySelectorAll. Runs in a plain page,
// no harness: the rules concern an HTML document in no-quirks mode, which is what the frame copy is.
test('Chromium agrees with every selector case', async ({ page }) => {
	for (const { name, html, selector, expected } of SELECTOR_CASES) {
		if (expected === null) {
			continue;
		}
		const document = html.startsWith('<!doctype') ? html : `<!doctype html>${html}`;
		await page.setContent(document);
		const actual = await page.evaluate(
			(query) =>
				Array.from(
					globalThis.document.querySelectorAll(query),
					(element) => element.getAttribute('data-t') ?? '?',
				),
			selector,
		);
		expect(actual, `${name}: ${selector}`).toEqual(expected);
	}
});
