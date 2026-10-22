import * as z from 'zod/mini';

import { MAX_FRAME_COORDINATE } from '../disk/layout';
import type { ChromeMessage } from '../webview/hostMessages';

// No `vscode` import: the panel's untrusted chrome → host input is parsed here so it stays unit-testable.

// z.number() already rejects NaN and ±Infinity.
const coordinate = z.number().check(z.gte(-MAX_FRAME_COORDINATE), z.lte(MAX_FRAME_COORDINATE));

const width = z.number().check(z.gt(0), z.lte(MAX_FRAME_COORDINATE));

const placementShape = { x: coordinate, y: coordinate, width };

// The artboard id charset is enforced by placeFrame's parseArtboardId.
const chromeMessageSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('artboard:ready') }),
	z.object({
		type: z.literal('frame:place'),
		id: z.string(),
		...placementShape,
		base: z.object(placementShape),
	}),
]);

// Unknown `type`, a non-object, or any failing field returns undefined; never throws.
export const parseChromeMessage = (value: unknown): ChromeMessage | undefined => {
	const parsed = chromeMessageSchema.safeParse(value);
	return parsed.success ? parsed.data : undefined;
};

// True for anything that claims to be frame:place, valid or not, so every attempt gets an answer.
export const isFramePlaceAttempt = (value: unknown): boolean =>
	value !== null &&
	typeof value === 'object' &&
	'type' in value &&
	(value as { type: unknown }).type === 'frame:place';
