import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vite-plus/test';

// The guard that keeps the chrome on the design system (rule 08): a static scan of every chrome
// stylesheet and component. Each matcher is a small pure function with a failing fixture, so
// deleting or loosening one fails this file.

const WEBVIEW_DIR = join(process.cwd(), 'src', 'webview');
const THEME_PATH = 'ui/theme.css';

// An exemption names a selector and the only properties its rules may set, so an exempt selector
// never exempts a whole rule (an `outline: none` slipped in next to an allowed `outline-offset`).
type Exemptions = Readonly<Record<string, readonly string[]>>;

// Control-state rules outside ui/ that are allowed, by file: the stage's zoom-scaled ring on the
// label and handle (and the handle's bar on focus), and the script-only focus fallbacks.
const CONTROL_STATE_EXCEPTIONS: Record<string, Exemptions> = {
	'Stage.svelte': {
		'.label': ['outline', 'outline-offset'],
		'.resize-handle': ['outline', 'outline-offset', 'opacity'],
		'.viewport': ['outline'],
	},
	'CommentsPanel.svelte': { aside: ['outline'] },
};

// :global( outside ui/, by file: Stage lets pointer events pass through every frame's iframe during
// a move or resize gesture, and those iframes belong to Frame.svelte.
const GLOBAL_EXCEPTIONS: Record<string, Exemptions> = {
	'Stage.svelte': {
		'.frame-gesture-move': ['pointer-events'],
		'.frame-gesture-resize': ['pointer-events'],
	},
};

// Meaning-coloured icons outside ui/, by file: each selector's element holds only an Icon, so the
// meaning colours the glyph, never text.
const ICON_COLOUR_EXCEPTIONS: Record<string, Exemptions> = {
	'Stage.svelte': { '.active .label-icon': ['color'], '.hint-icon': ['display', 'color'] },
	'Frame.svelte': { '.error .tile-icon': ['color'] },
	'Pins.svelte': { '.badge.stale': ['color'] },
	'CommentsPanel.svelte': { '.summary-icon': ['display', 'color'] },
};

// The meaning colours (and the accent), read directly. Text stays --cd-fg / --cd-fg-2.
const MEANING_COLOUR = /var\(\s*--cd-(?:warning|error|info|agent|resolved|open|accent)\s*[,)]/;

// The CSS named colours (CSS Color 4), minus transparent and currentColor, which are allowed.
const NAMED_COLOURS = [
	'aliceblue',
	'antiquewhite',
	'aqua',
	'aquamarine',
	'azure',
	'beige',
	'bisque',
	'black',
	'blanchedalmond',
	'blue',
	'blueviolet',
	'brown',
	'burlywood',
	'cadetblue',
	'chartreuse',
	'chocolate',
	'coral',
	'cornflowerblue',
	'cornsilk',
	'crimson',
	'cyan',
	'darkblue',
	'darkcyan',
	'darkgoldenrod',
	'darkgray',
	'darkgreen',
	'darkgrey',
	'darkkhaki',
	'darkmagenta',
	'darkolivegreen',
	'darkorange',
	'darkorchid',
	'darkred',
	'darksalmon',
	'darkseagreen',
	'darkslateblue',
	'darkslategray',
	'darkslategrey',
	'darkturquoise',
	'darkviolet',
	'deeppink',
	'deepskyblue',
	'dimgray',
	'dimgrey',
	'dodgerblue',
	'firebrick',
	'floralwhite',
	'forestgreen',
	'fuchsia',
	'gainsboro',
	'ghostwhite',
	'gold',
	'goldenrod',
	'gray',
	'green',
	'greenyellow',
	'grey',
	'honeydew',
	'hotpink',
	'indianred',
	'indigo',
	'ivory',
	'khaki',
	'lavender',
	'lavenderblush',
	'lawngreen',
	'lemonchiffon',
	'lightblue',
	'lightcoral',
	'lightcyan',
	'lightgoldenrodyellow',
	'lightgray',
	'lightgreen',
	'lightgrey',
	'lightpink',
	'lightsalmon',
	'lightseagreen',
	'lightskyblue',
	'lightslategray',
	'lightslategrey',
	'lightsteelblue',
	'lightyellow',
	'lime',
	'limegreen',
	'linen',
	'magenta',
	'maroon',
	'mediumaquamarine',
	'mediumblue',
	'mediumorchid',
	'mediumpurple',
	'mediumseagreen',
	'mediumslateblue',
	'mediumspringgreen',
	'mediumturquoise',
	'mediumvioletred',
	'midnightblue',
	'mintcream',
	'mistyrose',
	'moccasin',
	'navajowhite',
	'navy',
	'oldlace',
	'olive',
	'olivedrab',
	'orange',
	'orangered',
	'orchid',
	'palegoldenrod',
	'palegreen',
	'paleturquoise',
	'palevioletred',
	'papayawhip',
	'peachpuff',
	'peru',
	'pink',
	'plum',
	'powderblue',
	'purple',
	'rebeccapurple',
	'red',
	'rosybrown',
	'royalblue',
	'saddlebrown',
	'salmon',
	'sandybrown',
	'seagreen',
	'seashell',
	'sienna',
	'silver',
	'skyblue',
	'slateblue',
	'slategray',
	'slategrey',
	'snow',
	'springgreen',
	'steelblue',
	'tan',
	'teal',
	'thistle',
	'tomato',
	'turquoise',
	'violet',
	'wheat',
	'white',
	'whitesmoke',
	'yellow',
	'yellowgreen',
];

const COLOUR_PROPERTY =
	/^(?:color|background(?:-[\w-]+)?|border(?:-[\w-]+)?|outline(?:-[\w-]+)?|fill|stroke|box-shadow|text-shadow|filter|scrollbar-color|text-decoration(?:-[\w-]+)?|caret-color|accent-color)$/;
const HEX_COLOUR = /#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{3,4})\b/i;
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const NAMED_COLOUR = new RegExp(`(?<![\\w-])(?:${NAMED_COLOURS.join('|')})(?![\\w-])`, 'i');

type ScannedFile = { path: string; text: string; css: string };
type CssRule = { selector: string; body: string };

// CSS only: in a .svelte script a '/*' string would swallow real code.
const stripComments = (css: string): string => css.replaceAll(/\/\*[\s\S]*?\*\//g, '');

const styleBlocks = (svelteText: string): string =>
	[...svelteText.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
		.map((match) => match[1] ?? '')
		.join('\n');

// Innermost `selector { declarations }` pairs; an @media prelude never matches, its rules do.
const cssRules = (css: string): CssRule[] =>
	[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
		selector: (match[1] ?? '').trim(),
		body: match[2] ?? '',
	}));

const declarations = (body: string): { property: string; value: string }[] =>
	body
		.split(';')
		.map((declaration) => declaration.split(':'))
		.filter((parts) => parts.length > 1)
		.map(([property = '', ...value]) => ({
			property: property.trim().toLowerCase(),
			value: value.join(':'),
		}));

// Custom property names are stripped first, so `var(--cd-red-edge)` is never the colour red.
const hasColourLiteral = (value: string): boolean => {
	const bare = value.replaceAll(/--[\w-]+/g, '');
	return HEX_COLOUR.test(bare) || COLOUR_FUNCTION.test(bare) || NAMED_COLOUR.test(bare);
};

const declaredTokens = (css: string): Set<string> =>
	new Set([...css.matchAll(/(--cd-[\w-]+)\s*:/g)].map((match) => match[1] ?? ''));

// 1. A raw host token outside theme.css.
const vscodeTokens = (text: string): string[] => text.match(/--vscode-[\w-]*/g) ?? [];

// 2. A --cd-* token read but declared neither in theme.css nor in the same stylesheet.
const undeclaredTokens = ({
	css,
	themeTokens,
}: {
	css: string;
	themeTokens: Set<string>;
}): string[] => {
	const local = declaredTokens(css);
	return [...css.matchAll(/var\(\s*(--cd-[\w-]+)/g)]
		.map((match) => match[1] ?? '')
		.filter((token) => !themeTokens.has(token) && !local.has(token));
};

// 3. A colour literal in a colour-bearing declaration, or (outside theme.css, where the tokens
// keep literal fallbacks) in any custom property, which could carry it into a colour anyway.
const colourLiterals = ({
	css,
	customProperties,
}: {
	css: string;
	customProperties: boolean;
}): string[] =>
	cssRules(css).flatMap((rule) =>
		declarations(rule.body)
			.filter(
				({ property, value }) =>
					(COLOUR_PROPERTY.test(property) || (customProperties && property.startsWith('--'))) &&
					hasColourLiteral(value),
			)
			.map(({ property, value }) => `${rule.selector} { ${property}:${value} }`),
	);

// `.pin` matches `.pin:focus-visible`, never `.pins`.
const startsWithSelector = (selector: string, allowed: string): boolean =>
	selector.startsWith(allowed) && !/[\w-]/.test(selector.charAt(allowed.length));

// Every selector of the rule starts with an exempt one that allows every property the rule sets.
const isExempt = (rule: CssRule, exempt: Exemptions): boolean => {
	const properties = declarations(rule.body).map(({ property }) => property);
	return rule.selector
		.split(',')
		.map((selector) => selector.trim())
		.every((selector) =>
			Object.entries(exempt).some(
				([allowed, allowedProperties]) =>
					startsWithSelector(selector, allowed) &&
					properties.every((property) => allowedProperties.includes(property)),
			),
		);
};

// 4. A control state (focus ring, disabled look) styled outside the primitives.
const controlStateRules = ({ css, exempt }: { css: string; exempt: Exemptions }): string[] =>
	cssRules(css)
		.filter(
			(rule) =>
				/:focus-visible|:disabled|\[aria-disabled/.test(rule.selector) ||
				/(?:^|[;\s])(?:outline(?:-style)?\s*:\s*(?:none|0)\s*(?:!important\s*)?(?:;|$)|all\s*:\s*unset)/.test(
					rule.body,
				),
		)
		.filter((rule) => !isExempt(rule, exempt))
		.map((rule) => rule.selector);

// 5. A :global( selector outside the kit: a component styling markup it does not own.
const globalSelectors = ({ css, exempt }: { css: string; exempt: Exemptions }): string[] =>
	cssRules(css)
		.filter((rule) => rule.selector.includes(':global') && !isExempt(rule, exempt))
		.map((rule) => rule.selector);

const readsVariable = (value: string, names: ReadonlySet<string>): boolean =>
	[...names].some((name) => new RegExp(`var\\(\\s*${name}\\s*[,)]`).test(value));

// The stylesheet's own custom properties that carry a meaning colour, directly or through another
// one (`--cd-tone: var(--cd-error)`, then `--cd-ink: var(--cd-tone)`), in any declaration order.
const meaningVariables = (css: string): ReadonlySet<string> => {
	const custom = cssRules(css)
		.flatMap((rule) => declarations(rule.body))
		.filter(({ property }) => property.startsWith('--'));
	const grow = (names: ReadonlySet<string>): ReadonlySet<string> => {
		const next = new Set(
			custom
				.filter(({ value }) => MEANING_COLOUR.test(value) || readsVariable(value, names))
				.map(({ property }) => property),
		);
		return next.size === names.size ? names : grow(next);
	};
	return grow(new Set());
};

// 6. A meaning colour on text outside the kit, read directly or through a local custom property:
// text stays --cd-fg / --cd-fg-2, and the meaning goes to a Message, a Badge or an icon.
const meaningTextColours = ({ css, exempt }: { css: string; exempt: Exemptions }): string[] => {
	const local = meaningVariables(css);
	const readsMeaning = (value: string): boolean =>
		MEANING_COLOUR.test(value) || readsVariable(value, local);
	return cssRules(css)
		.filter(
			(rule) =>
				!isExempt(rule, exempt) &&
				declarations(rule.body).some(
					({ property, value }) => property === 'color' && readsMeaning(value),
				),
		)
		.map((rule) => rule.selector);
};

// 7. A style attribute (chrome convention: dynamic values go through style: directives) or a
// colour literal in a style: directive, quoted ("…" or '…', expressions dropped) or a string
// literal in braces ({'…'}).
const inlineStyles = (svelteText: string): string[] => [
	...(svelteText.match(/(?<![\w.:-])style\s*=/g) ?? []),
	...[
		...svelteText.matchAll(
			/style:[\w-]+\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)\s*\})/g,
		),
	]
		.filter((match) => {
			const quoted = (match[1] ?? match[2] ?? '').replaceAll(/\{[^}]*\}/g, '');
			const literal = match[3] ?? match[4] ?? match[5] ?? '';
			return hasColourLiteral(`${quoted} ${literal}`);
		})
		.map((match) => match[0]),
];

const scanWebview = (): ScannedFile[] =>
	readdirSync(WEBVIEW_DIR, { recursive: true, encoding: 'utf8' })
		.filter((path) => path.endsWith('.svelte') || path.endsWith('.css'))
		.map((path) => {
			const relativePath = path.split('\\').join('/');
			const text = readFileSync(join(WEBVIEW_DIR, path), 'utf8');
			return {
				path: relativePath,
				text,
				css: stripComments(relativePath.endsWith('.css') ? text : styleBlocks(text)),
			};
		});

describe('guard matchers', () => {
	const themeTokens = new Set(['--cd-fg']);

	it('flags a raw host token', () => {
		expect(vscodeTokens('.a { color: var(--vscode-foreground); }')).toEqual([
			'--vscode-foreground',
		]);
	});

	it('flags a token typo and allows a component-local token', () => {
		expect(undeclaredTokens({ css: '.a { color: var(--cd-fgg); }', themeTokens })).toEqual([
			'--cd-fgg',
		]);
		expect(
			undeclaredTokens({
				css: '.a { --cd-gap: 4px; gap: var(--cd-gap); color: var(--cd-fg); }',
				themeTokens,
			}),
		).toEqual([]);
	});

	it.each([
		'.a { color: #fff; }',
		'.a { border: 1px solid #00000080; }',
		'.a { background: rgb(0 0 0 / 0.5); }',
		'.a { box-shadow: 0 0 2px oklch(0.5 0.1 200); }',
		'.a { outline-color: Red; }',
		'@media (forced-colors: none) { .a { fill: white; } }',
		'.a { text-shadow: 0 1px 0 black; }',
		'.a { filter: drop-shadow(0 0 2px #000); }',
		'.a { scrollbar-color: gray transparent; }',
	])('flags a colour literal in %s', (css) => {
		expect(colourLiterals({ css, customProperties: false })).toHaveLength(1);
	});

	it('flags a colour literal in a custom property only outside theme.css', () => {
		const css = '.a { --cd-local-edge: #ccc; --cd-gap: 4px; }';
		expect(colourLiterals({ css, customProperties: true })).toHaveLength(1);
		expect(colourLiterals({ css, customProperties: false })).toEqual([]);
	});

	it('never flags selectors, other properties, tokens or allowed keywords', () => {
		expect(
			colourLiterals({
				css:
					'.red-card { white-space: nowrap; grid-area: tan; color: currentColor; ' +
					'background: color-mix(in srgb, var(--cd-red-fg) 10%, transparent); border-color: inherit; }',
				customProperties: true,
			}),
		).toEqual([]);
	});

	it.each([
		'.thing:focus-visible { outline-offset: 1px; }',
		'button:disabled { color: var(--cd-fg); }',
		"button[aria-disabled='true'] { cursor: default; }",
		'.thing:focus { outline: none; }',
		'.thing { outline: 0 }',
		'.thing { all: unset; }',
		'.thing:focus { outline: none !important; }',
		'.thing:focus { outline-style: none; }',
	])('flags a control-state rule %s', (css) => {
		expect(controlStateRules({ css, exempt: {} })).toHaveLength(1);
	});

	it('allows only the exact exempt selector, and only the properties it lists', () => {
		const exempt = { '.pin': ['outline-offset'] };
		expect(
			controlStateRules({ css: '.pin:focus-visible { outline-offset: 1px; }', exempt }),
		).toEqual([]);
		expect(
			controlStateRules({ css: '.pins:focus-visible { outline-offset: 1px; }', exempt }),
		).toHaveLength(1);
		expect(
			controlStateRules({
				css: '.pin:focus-visible { outline-offset: 1px; outline: none; }',
				exempt,
			}),
		).toEqual(['.pin:focus-visible']);
		expect(controlStateRules({ css: '.thing { outline-offset: 0; }', exempt: {} })).toEqual([]);
	});

	it('flags :global( unless the rule is exempt for every property it sets', () => {
		expect(globalSelectors({ css: '.a :global(svg) { fill: none; }', exempt: {} })).toHaveLength(1);
		const exempt = { '.frame-gesture-move': ['pointer-events'] };
		expect(
			globalSelectors({
				css: '.frame-gesture-move :global(iframe) { pointer-events: none; }',
				exempt,
			}),
		).toEqual([]);
		expect(
			globalSelectors({
				css: '.frame-gesture-move :global(iframe) { pointer-events: none; opacity: 0; }',
				exempt,
			}),
		).toHaveLength(1);
	});

	it('flags a meaning colour on text unless the rule is an exempt icon', () => {
		expect(meaningTextColours({ css: '.note { color: var(--cd-error); }', exempt: {} })).toEqual([
			'.note',
		]);
		expect(
			meaningTextColours({ css: '.note { color: var(--cd-accent); }', exempt: {} }),
		).toHaveLength(1);
		expect(
			meaningTextColours({
				css:
					'.a { color: var(--cd-fg); background: var(--cd-warning); } ' +
					'.b { color: var(--cd-on-open); --cd-tone: var(--cd-agent); } ' +
					'.c { color: var(--cd-error-bg); } .hint-icon { color: var(--cd-open); }',
				exempt: { '.hint-icon': ['color'] },
			}),
		).toEqual([]);
	});

	it('flags a meaning colour that reaches text through a local custom property', () => {
		expect(
			meaningTextColours({
				css: '.a { --cd-tone: var(--cd-error); } .b { color: var(--cd-tone); }',
				exempt: {},
			}),
		).toEqual(['.b']);
		// Through a chain, declared in any order.
		expect(
			meaningTextColours({
				css:
					'.c { color: var(--cd-ink, var(--cd-fg)); } .b { --cd-ink: var(--cd-tone); } ' +
					'.a { --cd-tone: var(--cd-warning); }',
				exempt: {},
			}),
		).toEqual(['.c']);
		// A local token with no meaning colour, or one only used off text, passes.
		expect(
			meaningTextColours({
				css:
					'.a { --cd-ink: var(--cd-fg); --cd-tone: var(--cd-agent); } ' +
					'.b { color: var(--cd-ink); background: var(--cd-tone); } ' +
					'.c { color: var(--cd-tone-bg); }',
				exempt: {},
			}),
		).toEqual([]);
	});

	it('flags a style attribute and a colour-literal style: value', () => {
		expect(inlineStyles('<div style="left: 1px"></div>')).toHaveLength(1);
		expect(inlineStyles('<div style:color="#fff"></div>')).toHaveLength(1);
		expect(inlineStyles("<div style:color='red'></div>")).toHaveLength(1);
		expect(inlineStyles("<div style:background={'rgb(0 0 0)'}></div>")).toHaveLength(1);
		expect(inlineStyles('<div style:left="{x}px" style:--cd-stage-zoom={zoom}></div>')).toEqual([]);
	});
});

describe('the chrome stays on the design system', () => {
	const files = scanWebview();
	const theme = files.find((file) => file.path === THEME_PATH);
	const themeTokens = declaredTokens(theme?.css ?? '');
	const findings = (check: (file: ScannedFile) => string[], scope = files): string[] =>
		scope.flatMap((file) => check(file).map((finding) => `${file.path}: ${finding}`));

	it('scans the theme and every component', () => {
		expect(theme).toBeDefined();
		expect(themeTokens.size).toBeGreaterThan(50);
		expect(files.filter((file) => file.path.endsWith('.svelte')).length).toBeGreaterThan(10);
	});

	it('reads --vscode-* only in theme.css', () => {
		expect(
			findings(
				(file) => vscodeTokens(file.text),
				files.filter((file) => file !== theme),
			),
		).toEqual([]);
	});

	it('reads only declared --cd-* tokens', () => {
		expect(findings((file) => undeclaredTokens({ css: file.css, themeTokens }))).toEqual([]);
	});

	it('has no colour literal in a colour property or a component custom property', () => {
		expect(
			findings((file) => colourLiterals({ css: file.css, customProperties: file !== theme })),
		).toEqual([]);
	});

	it('leaves control states to the primitives', () => {
		const outsideKit = files.filter((file) => !file.path.startsWith('ui/'));
		expect(
			findings(
				(file) =>
					controlStateRules({ css: file.css, exempt: CONTROL_STATE_EXCEPTIONS[file.path] ?? {} }),
				outsideKit,
			),
		).toEqual([]);
	});

	it('styles only its own markup outside the kit', () => {
		expect(
			findings(
				(file) => globalSelectors({ css: file.css, exempt: GLOBAL_EXCEPTIONS[file.path] ?? {} }),
				files.filter((file) => !file.path.startsWith('ui/')),
			),
		).toEqual([]);
	});

	it('keeps meaning colours off text outside the kit', () => {
		expect(
			findings(
				(file) =>
					meaningTextColours({ css: file.css, exempt: ICON_COLOUR_EXCEPTIONS[file.path] ?? {} }),
				files.filter((file) => !file.path.startsWith('ui/')),
			),
		).toEqual([]);
	});

	it('keeps every exemption on a selector that still exists', () => {
		const tables = [CONTROL_STATE_EXCEPTIONS, GLOBAL_EXCEPTIONS, ICON_COLOUR_EXCEPTIONS];
		const dead = tables.flatMap((table) =>
			Object.entries(table).flatMap(([path, exempt]) => {
				const selectors = cssRules(files.find((file) => file.path === path)?.css ?? '').flatMap(
					(rule) => rule.selector.split(',').map((selector) => selector.trim()),
				);
				return Object.keys(exempt)
					.filter((allowed) => !selectors.some((selector) => startsWithSelector(selector, allowed)))
					.map((allowed) => `${path}: ${allowed}`);
			}),
		);
		expect(dead).toEqual([]);
	});

	it('has no inline style attribute or colour-literal style: value', () => {
		expect(
			findings(
				(file) => inlineStyles(file.text),
				files.filter((file) => file.path.endsWith('.svelte')),
			),
		).toEqual([]);
	});
});
