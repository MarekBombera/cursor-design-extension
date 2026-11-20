import { type Page } from '@playwright/test';
import { type VscodeTheme } from '../vscodeHost';

type ContrastRow = {
	pair: string;
	theme: VscodeTheme;
	foreground: string;
	background: string;
	ratio: number;
	threshold: number;
	pass: boolean;
	// Set for pairs that are listed but never fail (non-text, disabled).
	exempt?: string;
};

export const contrastRows: ContrastRow[] = [];
export const sweepFailures = new Map<string, ContrastRow>();

// One self-contained function (Playwright serialises it into the page). Colours are composited the
// way they paint: a semi-transparent text colour over the element's actual background (every
// ancestor fill up to the first opaque one), and a ring over its neighbour's.
export type MeasureRequest =
	| { kind: 'text'; selector: string }
	| { kind: 'placeholder'; selector: string }
	| { kind: 'ring'; selector: string }
	| { kind: 'tokens'; foreground: string; background: string }
	| { kind: 'sweep' };

type Measured = { label: string; foreground: string; background: string; ratio: number };

const measureInPage = (request: MeasureRequest): Measured[] => {
	type Rgba = { r: number; g: number; b: number; a: number };
	const channel = (token: string): number =>
		token.endsWith('%') ? Number.parseFloat(token) / 100 : Number(token);
	const parse = (value: string): Rgba => {
		const rgb = /^rgba?\(([^)]+)\)$/.exec(value);
		if (rgb !== null) {
			const parts = (rgb[1] ?? '').split(/[\s,/]+/).filter(Boolean);
			return {
				r: Number(parts[0]),
				g: Number(parts[1]),
				b: Number(parts[2]),
				a: parts[3] === undefined ? 1 : channel(parts[3]),
			};
		}
		const srgb = /^color\(srgb ([^)]+)\)$/.exec(value);
		if (srgb !== null) {
			const parts = (srgb[1] ?? '').split(/[\s/]+/).filter(Boolean);
			return {
				r: Number(parts[0]) * 255,
				g: Number(parts[1]) * 255,
				b: Number(parts[2]) * 255,
				a: parts[3] === undefined ? 1 : channel(parts[3]),
			};
		}
		throw new Error(`Unparsed colour: ${value}`);
	};
	const over = (top: Rgba, bottom: Rgba): Rgba => ({
		r: top.r * top.a + bottom.r * (1 - top.a),
		g: top.g * top.a + bottom.g * (1 - top.a),
		b: top.b * top.a + bottom.b * (1 - top.a),
		a: 1,
	});
	const luminance = (color: Rgba): number => {
		const linear = (value: number): number => {
			const scaled = value / 255;
			return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
		};
		return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
	};
	const hex = (color: Rgba): string =>
		`#${[color.r, color.g, color.b]
			.map((value) => Math.round(value).toString(16).padStart(2, '0'))
			.join('')}`;
	const fillBehind = (start: Element | null): Rgba => {
		const fills: Rgba[] = [];
		for (let node = start; node !== null; node = node.parentElement) {
			const fill = parse(getComputedStyle(node).backgroundColor);
			if (fill.a > 0) {
				fills.push(fill);
				if (fill.a >= 0.999) {
					break;
				}
			}
		}
		let base: Rgba = { r: 255, g: 255, b: 255, a: 1 };
		for (const fill of [...fills].reverse()) {
			base = over(fill, base);
		}
		return base;
	};
	const opacityOf = (element: Element): number => {
		let opacity = 1;
		for (let node: Element | null = element; node !== null; node = node.parentElement) {
			opacity *= Number(getComputedStyle(node).opacity);
		}
		return opacity;
	};
	const resolveToken = (token: string): Rgba => {
		const probe = document.createElement('span');
		probe.style.color = `var(${token})`;
		document.body.append(probe);
		const color = parse(getComputedStyle(probe).color);
		probe.remove();
		return color;
	};
	const measured = (label: string, foreground: Rgba, background: Rgba): Measured => {
		const effective = over(foreground, background);
		const lighter = Math.max(luminance(effective), luminance(background));
		const darker = Math.min(luminance(effective), luminance(background));
		return {
			label,
			foreground: hex(effective),
			background: hex(background),
			ratio: (lighter + 0.05) / (darker + 0.05),
		};
	};
	const textOf = (element: Element, color: string): Measured => {
		const foreground = parse(color);
		foreground.a *= opacityOf(element);
		return measured(element.tagName.toLowerCase(), foreground, fillBehind(element));
	};

	if (request.kind === 'tokens') {
		return [
			measured(
				request.foreground,
				resolveToken(request.foreground),
				over(resolveToken(request.background), { r: 255, g: 255, b: 255, a: 1 }),
			),
		];
	}
	if (request.kind === 'sweep') {
		const rows: Measured[] = [];
		for (const element of document.querySelectorAll('#svelte-root *')) {
			const hasText = Array.from(element.childNodes).some(
				(node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
			);
			const style = getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			if (
				!hasText ||
				rect.width === 0 ||
				rect.height === 0 ||
				style.visibility === 'hidden' ||
				element.closest('[hidden], .visually-hidden') !== null
			) {
				continue;
			}
			const row = textOf(element, style.color);
			// The toolbar's C hint is muted with the mode buttons it belongs to (Toolbar's kbd.muted),
			// so it counts as their inactive text.
			const disabled =
				element.closest(':disabled, [aria-disabled="true"]') !== null ||
				element.matches('.bar kbd.muted');
			const text = (element.textContent ?? '').trim().slice(0, 40);
			rows.push({
				...row,
				label: `${row.label}.${String(element.className).split(' ')[0] ?? ''} "${text}"${disabled ? ' [disabled]' : ''}`,
			});
		}
		return rows;
	}
	const element = document.querySelector(request.selector);
	if (element === null) {
		throw new Error(`No element matches ${request.selector}`);
	}
	if (request.kind === 'text') {
		return [{ ...textOf(element, getComputedStyle(element).color), label: request.selector }];
	}
	if (request.kind === 'placeholder') {
		return [
			{
				...textOf(element, getComputedStyle(element, '::placeholder').color),
				label: request.selector,
			},
		];
	}
	// ring: a ring outside the element (offset >= 0) sits on the parent's fill; an inset one on its own.
	const style = getComputedStyle(element);
	if (style.outlineStyle === 'none' || !element.matches(':focus-visible')) {
		throw new Error(`${request.selector} shows no focus ring.`);
	}
	const inset = Number.parseFloat(style.outlineOffset) < 0;
	return [
		{
			...measured(
				request.selector,
				parse(style.outlineColor),
				fillBehind(inset ? element : element.parentElement),
			),
			label: request.selector,
		},
	];
};

const SWEEP: MeasureRequest = { kind: 'sweep' };
const TEXT_THRESHOLD = 4.5;
export const NON_TEXT_THRESHOLD = 3;

export const record = async ({
	page,
	theme,
	pair,
	request,
	threshold = TEXT_THRESHOLD,
	exempt,
}: {
	page: Page;
	theme: VscodeTheme;
	pair: string;
	request: MeasureRequest;
	threshold?: number;
	exempt?: string;
}): Promise<void> => {
	const [row] = await page.evaluate(measureInPage, request);
	if (row === undefined) {
		throw new Error(`Nothing measured for ${pair}.`);
	}
	const ratio = Math.round(row.ratio * 100) / 100;
	contrastRows.push({
		pair,
		theme,
		foreground: row.foreground,
		background: row.background,
		ratio,
		threshold,
		pass: ratio >= threshold,
		...(exempt === undefined ? {} : { exempt }),
	});
};

// Every visible text node of the shot, so a pair the named probes miss still shows up. Only
// failures are kept (one row per theme, element and text); disabled text is exempt.
export const sweep = async (page: Page, theme: VscodeTheme, shot: string): Promise<void> => {
	for (const row of await page.evaluate(measureInPage, SWEEP)) {
		const ratio = Math.round(row.ratio * 100) / 100;
		if (ratio >= TEXT_THRESHOLD) {
			continue;
		}
		const disabled = row.label.endsWith('[disabled]');
		sweepFailures.set(`${theme} ${row.label}`, {
			pair: `${row.label} (first seen in ${shot})`,
			theme,
			foreground: row.foreground,
			background: row.background,
			ratio,
			threshold: TEXT_THRESHOLD,
			pass: false,
			...(disabled ? { exempt: 'disabled text (WCAG 1.4.3)' } : {}),
		});
	}
};
