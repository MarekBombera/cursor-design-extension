// 16px grid, stroked with currentColor unless `fill: true` (`path` is a path's `d`, `radius` a
// circle's `r`). An icon is added in the change that first renders it.
export type IconShape =
	| { kind: 'path'; path: string; fill?: true }
	| { kind: 'circle'; cx: number; cy: number; radius: number; fill?: true }
	| { kind: 'rect'; x: number; y: number; width: number; height: number; rx?: number };

export const ICONS = {
	'arrow-down': [{ kind: 'path', path: 'M8 3v9.5M4 8.5l4 4 4-4' }],
	'arrow-up': [{ kind: 'path', path: 'M8 13V3.5M4 7.5l4-4 4 4' }],
	artboard: [
		{ kind: 'rect', x: 2.5, y: 2.5, width: 11, height: 11, rx: 1.2 },
		{ kind: 'path', path: 'M2.5 5.5h11' },
	],
	check: [{ kind: 'path', path: 'M3 8.5l3.2 3.2L13 4.8' }],
	'chevron-down': [{ kind: 'path', path: 'M4 6l4 4 4-4' }],
	'chevron-right': [{ kind: 'path', path: 'M6 4l4 4-4 4' }],
	close: [{ kind: 'path', path: 'M4 4l8 8M12 4l-8 8' }],
	comment: [
		{
			kind: 'path',
			path: 'M3 3h10a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H8.2L5 14v-2.5H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
		},
	],
	comments: [
		{
			kind: 'path',
			path: 'M2.5 2.5h7.5a1 1 0 0 1 1 1V8a1 1 0 0 1-1 1H6L3.5 11V9h-1a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z',
		},
		{ kind: 'path', path: 'M13 5.5h.5a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1h-1v2L10 12H7.5' },
	],
	cursor: [{ kind: 'path', path: 'M3.5 2.5l9.5 5.3-4.2 1.1-1.9 4.1z' }],
	dot: [{ kind: 'circle', cx: 8, cy: 8, radius: 4, fill: true }],
	edit: [{ kind: 'path', path: 'M10.5 2.5l3 3-8 8H2.5v-3zM9 4l3 3' }],
	element: [{ kind: 'path', path: 'M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5' }],
	error: [
		{ kind: 'circle', cx: 8, cy: 8, radius: 6 },
		{ kind: 'path', path: 'M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2' },
	],
	fit: [{ kind: 'path', path: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10' }],
	frame: [{ kind: 'path', path: 'M5 1.5v13M11 1.5v13M1.5 5h13M1.5 11h13' }],
	gripper: [
		{ kind: 'circle', cx: 6, cy: 4, radius: 1, fill: true },
		{ kind: 'circle', cx: 10, cy: 4, radius: 1, fill: true },
		{ kind: 'circle', cx: 6, cy: 8, radius: 1, fill: true },
		{ kind: 'circle', cx: 10, cy: 8, radius: 1, fill: true },
		{ kind: 'circle', cx: 6, cy: 12, radius: 1, fill: true },
		{ kind: 'circle', cx: 10, cy: 12, radius: 1, fill: true },
	],
	info: [
		{ kind: 'circle', cx: 8, cy: 8, radius: 6 },
		{ kind: 'path', path: 'M8 7.4v3.8' },
		{ kind: 'circle', cx: 8, cy: 5.1, radius: 0.85, fill: true },
	],
	page: [{ kind: 'path', path: 'M4 1.5h5l3 3v10H4zM9 1.5v3h3' }],
	plug: [{ kind: 'path', path: 'M6 1.8v3M10 1.8v3M4.5 4.8h7v2.7a3.5 3.5 0 0 1-7 0zM8 11v3.2' }],
	question: [
		{ kind: 'circle', cx: 8, cy: 8, radius: 6 },
		{ kind: 'path', path: 'M6.3 6.4a1.8 1.8 0 1 1 2.5 1.6c-.5.25-.8.6-.8 1.1v.3' },
		{ kind: 'circle', cx: 8, cy: 11.3, radius: 0.85, fill: true },
	],
	redo: [{ kind: 'path', path: 'M9 3.5l3 3-3 3M12 6.5H6a3 3 0 0 0 0 6h3' }],
	reopen: [
		{ kind: 'path', path: 'M2.8 8a5.2 5.2 0 1 0 1.6-3.7' },
		{ kind: 'path', path: 'M2.8 2.6v3h3' },
	],
	reply: [{ kind: 'path', path: 'M6.5 3.5L3 7l3.5 3.5M3.5 7H10a3.5 3.5 0 0 1 3.5 3.5V12.5' }],
	send: [
		{ kind: 'path', path: 'M2 7.6l11.8-5.3-4 11.6-2.4-4.5z' },
		{ kind: 'path', path: 'M7.4 9.4l6.3-7.1' },
	],
	sparkle: [
		{
			kind: 'path',
			path: 'M7 1.5c.45 3.1 1.9 4.55 5 5-3.1.45-4.55 1.9-5 5-.45-3.1-1.9-4.55-5-5 3.1-.45 4.55-1.9 5-5z',
			fill: true,
		},
		{
			kind: 'path',
			path: 'M12.5 9.5c.22 1.38.87 2.03 2.25 2.25-1.38.22-2.03.87-2.25 2.25-.22-1.38-.87-2.03-2.25-2.25 1.38-.22 2.03-.87 2.25-2.25z',
			fill: true,
		},
	],
	spinner: [{ kind: 'path', path: 'M8 2a6 6 0 1 1-6 6' }],
	target: [
		{ kind: 'circle', cx: 8, cy: 8, radius: 4.5 },
		{ kind: 'path', path: 'M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3' },
	],
	undo: [{ kind: 'path', path: 'M7 3.5l-3 3 3 3M4 6.5h6a3 3 0 0 1 0 6H7' }],
	warning: [
		{ kind: 'path', path: 'M8 2.3l6.3 11H1.7zM8 6.6v3' },
		{ kind: 'circle', cx: 8, cy: 11.5, radius: 0.85, fill: true },
	],
} as const satisfies Record<string, readonly IconShape[]>;

export type IconName = keyof typeof ICONS;
